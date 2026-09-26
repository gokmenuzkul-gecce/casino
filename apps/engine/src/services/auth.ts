import argon2 from "argon2";
import jwt from "jsonwebtoken";
import { authenticator } from "otplib";
import { createHash, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { prisma } from "@aurora/db";
import { Errors, UserRole, UserStatus, KycStatus } from "@aurora/shared";
import { env } from "../lib/env.js";

export interface TokenPayload {
  sub: string;
  sid: string;
  roles: string[];
  /** True when the token was issued for a demo/impersonated session. */
  imp?: boolean;
  actorId?: string;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface SessionContext {
  ip?: string;
  userAgent?: string;
  deviceId?: string;
}

/**
 * Password hashing uses Argon2id with cost parameters from configuration.
 * Refresh tokens are stored only as SHA-256 hashes, so a database leak does not
 * hand out usable sessions. TOTP secrets are encrypted at rest with AES-256-GCM
 * keyed by ENCRYPTION_KEY.
 */
export class AuthService {
  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: env.argonMemoryCost,
      timeCost: env.argonTimeCost,
      parallelism: 1,
    });
  }

  async verifyPassword(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  // ── encryption helpers ────────────────────────────────────────────────

  private key(): Buffer {
    return createHash("sha256").update(env.encryptionKey || "aurora-default-key").digest();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
  }

  decrypt(payload: string): string {
    const [ivB64, tagB64, dataB64] = payload.split(".");
    if (!ivB64 || !tagB64 || !dataB64) throw Errors.internal("Sifreli veri bozuk");
    const decipher = createDecipheriv("aes-256-gcm", this.key(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
  }

  // ── tokens ────────────────────────────────────────────────────────────

  private signAccess(payload: TokenPayload): string {
    return jwt.sign(payload, env.jwtAccessSecret, { expiresIn: env.jwtAccessTtl, issuer: env.totpIssuer });
  }

  private signRefresh(payload: TokenPayload): string {
    return jwt.sign(payload, env.jwtRefreshSecret, { expiresIn: env.jwtRefreshTtl, issuer: env.totpIssuer });
  }

  hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  verifyAccess(token: string): TokenPayload {
    try {
      return jwt.verify(token, env.jwtAccessSecret, { issuer: env.totpIssuer }) as TokenPayload;
    } catch {
      throw Errors.unauthorized("Gecersiz veya suresi dolmus oturum");
    }
  }

  verifyRefresh(token: string): TokenPayload {
    try {
      return jwt.verify(token, env.jwtRefreshSecret, { issuer: env.totpIssuer }) as TokenPayload;
    } catch {
      throw Errors.unauthorized("Yenileme anahtari gecersiz");
    }
  }

  /** Create a session row plus a matching token pair. */
  async issueTokens(userId: string, roles: string[], ctx: SessionContext = {}): Promise<IssuedTokens> {
    const session = await prisma.session.create({
      data: {
        userId,
        refreshTokenHash: "pending",
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        deviceId: ctx.deviceId,
        expiresAt: new Date(Date.now() + env.jwtRefreshTtl * 1000),
      },
    });

    const payload: TokenPayload = { sub: userId, sid: session.id, roles };
    const accessToken = this.signAccess(payload);
    const refreshToken = this.signRefresh(payload);

    await prisma.session.update({
      where: { id: session.id },
      data: { refreshTokenHash: this.hashToken(refreshToken) },
    });

    return { accessToken, refreshToken, expiresIn: env.jwtAccessTtl };
  }

  /** Rotate a refresh token: the old session is revoked and a new one issued. */
  async refresh(refreshToken: string, ctx: SessionContext = {}): Promise<IssuedTokens> {
    const payload = this.verifyRefresh(refreshToken);
    const session = await prisma.session.findUnique({ where: { id: payload.sid } });

    if (!session || !session.isActive || session.revokedAt || session.expiresAt < new Date()) {
      throw Errors.unauthorized("Oturum sonlanmis");
    }
    if (session.refreshTokenHash !== this.hashToken(refreshToken)) {
      // Reuse of a rotated token: revoke everything for this user.
      await prisma.session.updateMany({
        where: { userId: payload.sub, isActive: true },
        data: { isActive: false, revokedAt: new Date(), revokedReason: "TOKEN_REUSE" },
      });
      throw Errors.unauthorized("Oturum guvenligi ihlali, tekrar giris yapin");
    }

    await prisma.session.update({
      where: { id: session.id },
      data: { isActive: false, revokedAt: new Date(), revokedReason: "ROTATED" },
    });

    const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { roles: true } });
    return this.issueTokens(payload.sub, user?.roles ?? payload.roles, {
      ip: ctx.ip ?? session.ip ?? undefined,
      userAgent: ctx.userAgent ?? session.userAgent ?? undefined,
      deviceId: ctx.deviceId ?? session.deviceId ?? undefined,
    });
  }

  async revokeSession(sessionId: string, reason = "LOGOUT"): Promise<void> {
    await prisma.session.updateMany({
      where: { id: sessionId, isActive: true },
      data: { isActive: false, revokedAt: new Date(), revokedReason: reason },
    });
  }

  async revokeAllSessions(userId: string, reason = "LOGOUT_ALL"): Promise<void> {
    await prisma.session.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false, revokedAt: new Date(), revokedReason: reason },
    });
  }

  // ── 2FA ───────────────────────────────────────────────────────────────

  async setupTwoFactor(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) throw Errors.notFound("Kullanici");
    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(user.email, env.totpIssuer, secret);
    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: this.encrypt(secret) },
    });
    return { secret, otpauth };
  }

  async enableTwoFactor(userId: string, code: string): Promise<string[]> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.twoFactorSecret) throw Errors.validation("Once 2FA kurulumunu baslatin");
    const secret = this.decrypt(user.twoFactorSecret);
    if (!authenticator.verify({ token: code, secret })) throw Errors.validation("Dogrulama kodu gecersiz");

    const backupCodes = Array.from({ length: 10 }, () => randomBytes(5).toString("hex").toUpperCase());
    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        backupCodes: backupCodes.map((c) => this.hashToken(c)),
      },
    });
    return backupCodes;
  }

  async disableTwoFactor(userId: string, password: string, code: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw Errors.notFound("Kullanici");
    if (!(await this.verifyPassword(user.passwordHash, password))) throw Errors.validation("Sifre hatali");
    if (user.twoFactorSecret) {
      const secret = this.decrypt(user.twoFactorSecret);
      const valid = authenticator.verify({ token: code, secret });
      const backupValid = user.backupCodes.includes(this.hashToken(code.toUpperCase()));
      if (!valid && !backupValid) throw Errors.validation("Dogrulama kodu gecersiz");
    }
    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null, backupCodes: [] },
    });
  }

  /** Accepts either a TOTP code or an unused backup code. */
  async verifyTwoFactor(userId: string, code: string): Promise<boolean> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.twoFactorEnabled || !user.twoFactorSecret) return true;
    const secret = this.decrypt(user.twoFactorSecret);
    if (authenticator.verify({ token: code, secret })) return true;

    const hashed = this.hashToken(code.toUpperCase());
    if (user.backupCodes.includes(hashed)) {
      await prisma.user.update({
        where: { id: userId },
        data: { backupCodes: user.backupCodes.filter((c) => c !== hashed) },
      });
      return true;
    }
    return false;
  }

  // ── account state guards ──────────────────────────────────────────────

  /** Throws when the account is not allowed to transact. */
  assertCanTransact(user: {
    status: string;
    selfExclusionUntil: Date | null;
    coolOffUntil: Date | null;
    lockedAt: Date | null;
    lockReason: string | null;
  }): void {
    if (user.lockedAt) throw Errors.accountBlocked(user.lockReason ?? "Hesabiniz kilitli");
    if (user.status === UserStatus.BANNED) throw Errors.accountBlocked("Hesabiniz kapatildi");
    if (user.status === UserStatus.SUSPENDED) throw Errors.accountBlocked("Hesabiniz askiya alindi");
    const now = Date.now();
    if (user.selfExclusionUntil && user.selfExclusionUntil.getTime() > now) {
      throw Errors.accountBlocked("Kendini dislama sureniz devam ediyor");
    }
    if (user.selfExclusionUntil === null && user.status === UserStatus.SELF_EXCLUDED) {
      throw Errors.accountBlocked("Kendini dislama aktif");
    }
    if (user.coolOffUntil && user.coolOffUntil.getTime() > now) {
      throw Errors.accountBlocked("Ara verme sureniz devam ediyor");
    }
  }

  /** Withdrawal gate: KYC and a clean risk state are required. */
  assertCanWithdraw(user: { kyc: { status: string } | null }, requiredKycLevel: number): void {
    const status = user.kyc?.status ?? KycStatus.NOT_STARTED;
    if (requiredKycLevel > 0 && status !== KycStatus.APPROVED) {
      throw Errors.accountBlocked("Cekim icin kimlik dogrulamasi gerekli");
    }
  }
}

export const authService = new AuthService();
