import type { FastifyInstance } from "fastify";
import {
  AuditAction,
  Errors,
  UserRole,
  UserStatus,
  loginSchema,
  registerSchema,
  twoFactorVerifySchema,
} from "@aurora/shared";
import { prisma } from "@aurora/db";
import { authService } from "../services/auth.js";
import { audit } from "../services/audit.js";
import { ledger } from "../services/ledger.js";
import { authenticate, clientIp, userAgent } from "../middleware/auth.js";
import { env } from "../lib/env.js";
import { nanoid } from "nanoid";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /** Registration with age/terms confirmation and affiliate attribution. */
  app.post("/auth/register", async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const ip = clientIp(request);
    const ua = userAgent(request);

    const blocked = await prisma.blocklist.findFirst({
      where: { isActive: true, type: "IP", value: ip ?? "" },
    });
    if (blocked) throw Errors.forbidden("Kayit bu adresten yapilamiyor");

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: body.email }, { username: body.username }] },
      select: { email: true, username: true },
    });
    if (existing) {
      throw Errors.conflict(existing.email === body.email ? "Bu e-posta zaten kayitli" : "Bu kullanici adi alinmis");
    }

    let referredById: string | undefined;
    if (body.referralCode) {
      const referrer = await prisma.user.findFirst({
        where: { OR: [{ affiliateCode: body.referralCode }, { affiliate: { code: body.referralCode } }] },
        select: { id: true },
      });
      referredById = referrer?.id;
    }

    const passwordHash = await authService.hashPassword(body.password);
    const currency = body.currency;

    const user = await prisma.user.create({
      data: {
        email: body.email,
        username: body.username,
        passwordHash,
        phone: body.phone,
        currency,
        roles: [UserRole.PLAYER],
        status: env.features.kyc ? UserStatus.PENDING_VERIFICATION : UserStatus.ACTIVE,
        registrationIp: ip,
        registrationSource: ua,
        affiliateCode: nanoid(10),
        referredById,
      },
    });

    await ledger.ensureWallets(user.id, currency);

    // Demo wallet starts funded so players can explore without depositing.
    await prisma.wallet.updateMany({
      where: { userId: user.id, currency, type: "DEMO" },
      data: { balance: 1_000_00n },
    });

    await prisma.vipProfile.create({ data: { userId: user.id } });

    await prisma.affiliate.upsert({
      where: { userId: user.id },
      create: { userId: user.id, code: nanoid(10).toLowerCase() },
      update: {},
    });

    if (referredById) {
      const referrerAffiliate = await prisma.affiliate.findUnique({ where: { userId: referredById } });
      if (referrerAffiliate) {
        await prisma.affiliate.update({
          where: { id: referrerAffiliate.id },
          data: { signups: { increment: 1 } },
        });
      }
    }

    const tokens = await authService.issueTokens(user.id, user.roles, { ip, userAgent: ua });

    await audit.log({
      actorId: user.id,
      action: AuditAction.REGISTER,
      entityType: "User",
      entityId: user.id,
      ip,
      userAgent: ua,
    });

    setAuthCookies(reply, tokens.accessToken, tokens.refreshToken);
    return reply.code(201).send({
      user: publicUser(user),
      tokens,
      wallets: await ledger.summary(user.id, currency),
    });
  });

  /** Login by email or username, with lockout and optional 2FA. */
  app.post("/auth/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const ip = clientIp(request);
    const ua = userAgent(request);

    const blockedIp = await prisma.blocklist.findFirst({ where: { isActive: true, type: "IP", value: ip ?? "" } });
    if (blockedIp) throw Errors.forbidden("Bu adresten giris yapilamiyor");

    const identifier = body.identifier.toLowerCase();
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: identifier }, { username: body.identifier }] },
    });

    const since = new Date(Date.now() - LOCKOUT_MINUTES * 60 * 1000);
    const recentFailures = await prisma.loginAttempt.count({
      where: { identifier, success: false, createdAt: { gte: since } },
    });
    if (recentFailures >= MAX_FAILED_ATTEMPTS) {
      throw Errors.rateLimited(`${LOCKOUT_MINUTES} dakika boyunca cok fazla hatali deneme. Lutfen bekleyin.`);
    }

    const valid = user ? await authService.verifyPassword(user.passwordHash, body.password) : false;

    if (!user || !valid) {
      await prisma.loginAttempt.create({
        data: { userId: user?.id, identifier, ip, userAgent: ua, success: false, reason: "BAD_CREDENTIALS" },
      });
      await audit.log({
        actorId: user?.id,
        action: AuditAction.LOGIN_FAILED,
        entityType: "User",
        entityId: user?.id,
        ip,
        userAgent: ua,
        severity: "WARNING",
      });
      throw Errors.unauthorized("E-posta/kullanici adi veya sifre hatali");
    }

    if (user.lockedAt) throw Errors.accountBlocked(user.lockReason ?? "Hesabiniz kilitli");
    if (user.status === UserStatus.BANNED) throw Errors.accountBlocked("Hesabiniz kapatildi");

    // 2FA is checked before tokens are issued.
    if (user.twoFactorEnabled) {
      if (!body.totp) {
        return reply.code(200).send({ requiresTwoFactor: true });
      }
      const ok = await authService.verifyTwoFactor(user.id, body.totp);
      if (!ok) {
        await prisma.loginAttempt.create({
          data: { userId: user.id, identifier, ip, userAgent: ua, success: false, reason: "BAD_2FA" },
        });
        throw Errors.unauthorized("Dogrulama kodu gecersiz");
      }
    }

    await prisma.loginAttempt.create({ data: { userId: user.id, identifier, ip, userAgent: ua, success: true } });
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastLoginIp: ip },
    });

    const tokens = await authService.issueTokens(user.id, user.roles, { ip, userAgent: ua });

    await audit.log({ actorId: user.id, action: AuditAction.LOGIN, entityType: "User", entityId: user.id, ip, userAgent: ua });

    setAuthCookies(reply, tokens.accessToken, tokens.refreshToken);
    return reply.send({
      user: publicUser(user),
      tokens,
      wallets: await ledger.summary(user.id, user.currency),
    });
  });

  app.post("/auth/refresh", async (request, reply) => {
    const body = (request.body ?? {}) as { refreshToken?: string };
    const token = body.refreshToken ?? (request.cookies as Record<string, string> | undefined)?.refresh_token;
    if (!token) throw Errors.unauthorized("Yenileme anahtari yok");

    const tokens = await authService.refresh(token, { ip: clientIp(request), userAgent: userAgent(request) });
    setAuthCookies(reply, tokens.accessToken, tokens.refreshToken);
    return reply.send({ tokens });
  });

  app.post("/auth/logout", { preHandler: authenticate }, async (request, reply) => {
    if (request.auth) await authService.revokeSession(request.auth.sid);
    clearAuthCookies(reply);
    return reply.send({ ok: true });
  });

  app.post("/auth/logout-all", { preHandler: authenticate }, async (request, reply) => {
    if (request.user) await authService.revokeAllSessions(request.user.id);
    clearAuthCookies(reply);
    return reply.send({ ok: true });
  });

  /** Current user with wallet summary, KYC state and VIP tier. */
  app.get("/auth/me", { preHandler: authenticate }, async (request) => {
    const user = await prisma.user.findUnique({
      where: { id: request.user!.id },
      include: { kyc: { select: { status: true, level: true } }, vip: true },
    });
    if (!user) throw Errors.notFound("Kullanici");

    return {
      user: publicUser(user),
      wallets: await ledger.summary(user.id, user.currency),
      kyc: { status: user.kyc?.status ?? "NOT_STARTED", level: user.kyc?.level ?? 0 },
      vip: user.vip
        ? {
            tier: user.vip.tier,
            level: user.vip.level,
            loyaltyPoints: user.vip.loyaltyPoints.toString(),
            lifetimeWagered: user.vip.lifetimeWagered.toString(),
          }
        : null,
      affiliateCode: user.affiliateCode,
    };
  });

  /** Active sessions for the security page. */
  app.get("/auth/sessions", { preHandler: authenticate }, async (request) => {
    const rows = await prisma.session.findMany({
      where: { userId: request.user!.id, isActive: true },
      orderBy: { lastSeenAt: "desc" },
      take: 25,
    });
    return {
      sessions: rows.map((s) => ({
        id: s.id,
        current: s.id === request.auth?.sid,
        ip: s.ip,
        userAgent: s.userAgent,
        country: s.country,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        expiresAt: s.expiresAt,
      })),
    };
  });

  app.delete("/auth/sessions/:id", { preHandler: authenticate }, async (request) => {
    const { id } = request.params as { id: string };
    const session = await prisma.session.findUnique({ where: { id } });
    if (!session || session.userId !== request.user!.id) throw Errors.notFound("Oturum");
    await authService.revokeSession(id, "USER_REVOKED");
    return { ok: true };
  });

  // ── password management ────────────────────────────────────────────────

  app.post("/auth/password/change", { preHandler: authenticate }, async (request) => {
    const body = (request.body ?? {}) as { currentPassword?: string; newPassword?: string };
    if (!body.currentPassword || !body.newPassword) throw Errors.validation("Mevcut ve yeni sifre gerekli");

    const user = await prisma.user.findUnique({ where: { id: request.user!.id } });
    if (!user) throw Errors.notFound("Kullanici");
    if (!(await authService.verifyPassword(user.passwordHash, body.currentPassword))) {
      throw Errors.validation("Mevcut sifre hatali");
    }

    const hash = await authService.hashPassword(body.newPassword);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } });
    await authService.revokeAllSessions(user.id, "PASSWORD_CHANGE");

    await audit.log({
      actorId: user.id,
      action: AuditAction.PASSWORD_CHANGE,
      entityType: "User",
      entityId: user.id,
      ip: clientIp(request),
    });
    return { ok: true };
  });

  // ── two-factor ────────────────────────────────────────────────────────

  app.post("/auth/2fa/setup", { preHandler: authenticate }, async (request) => {
    return authService.setupTwoFactor(request.user!.id);
  });

  app.post("/auth/2fa/enable", { preHandler: authenticate }, async (request) => {
    const body = twoFactorVerifySchema.parse(request.body);
    const codes = await authService.enableTwoFactor(request.user!.id, body.code);
    await audit.log({
      actorId: request.user!.id,
      action: AuditAction.TWO_FA_ENABLED,
      entityType: "User",
      entityId: request.user!.id,
    });
    return { backupCodes: codes };
  });

  app.post("/auth/2fa/disable", { preHandler: authenticate }, async (request) => {
    const body = (request.body ?? {}) as { password?: string; code?: string };
    if (!body.password || !body.code) throw Errors.validation("Sifre ve kod gerekli");
    await authService.disableTwoFactor(request.user!.id, body.password, body.code);
    await audit.log({
      actorId: request.user!.id,
      action: AuditAction.TWO_FA_DISABLED,
      entityType: "User",
      entityId: request.user!.id,
      severity: "WARNING",
    });
    return { ok: true };
  });
}

function setAuthCookies(reply: import("fastify").FastifyReply, accessToken: string, refreshToken: string): void {
  const secure = env.isProduction;
  reply.setCookie("access_token", accessToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: env.jwtAccessTtl,
  });
  reply.setCookie("refresh_token", refreshToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: env.jwtRefreshTtl,
  });
}

function clearAuthCookies(reply: import("fastify").FastifyReply): void {
  reply.clearCookie("access_token", { path: "/" });
  reply.clearCookie("refresh_token", { path: "/" });
}

function publicUser(user: {
  id: string;
  email: string;
  username: string;
  roles: string[];
  status: string;
  currency: string;
  twoFactorEnabled: boolean;
  createdAt?: Date;
  affiliateCode?: string | null;
}) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    roles: user.roles,
    status: user.status,
    currency: user.currency,
    twoFactorEnabled: user.twoFactorEnabled,
    createdAt: user.createdAt,
    affiliateCode: user.affiliateCode ?? null,
  };
}
