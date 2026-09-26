import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError, Errors, UserRole, isStaff, hasPermission, Permission } from "@aurora/shared";
import { prisma } from "@aurora/db";
import { authService, TokenPayload } from "../services/auth.js";

declare module "fastify" {
  interface FastifyRequest {
    auth?: TokenPayload;
    user?: {
      id: string;
      email: string;
      username: string;
      roles: string[];
      status: string;
      currency: string;
      twoFactorEnabled: boolean;
    };
  }
}

function extractToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  const cookie = (request.cookies as Record<string, string> | undefined)?.access_token;
  return cookie ?? null;
}

/** Require a valid access token; loads the user and rejects blocked accounts. */
export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const token = extractToken(request);
  if (!token) throw Errors.unauthorized();

  const payload = authService.verifyAccess(token);
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      email: true,
      username: true,
      roles: true,
      status: true,
      currency: true,
      twoFactorEnabled: true,
      lockedAt: true,
    },
  });
  if (!user) throw Errors.unauthorized("Kullanici bulunamadi");
  if (user.lockedAt) throw Errors.accountBlocked("Hesabiniz kilitli");
  if (user.status === "BANNED") throw Errors.accountBlocked("Hesabiniz kapatildi");

  request.auth = payload;
  request.user = {
    id: user.id,
    email: user.email,
    username: user.username,
    roles: user.roles,
    status: user.status,
    currency: user.currency,
    twoFactorEnabled: user.twoFactorEnabled,
  };
}

/** Soft auth: attaches the user when a token is present, never throws. */
export async function optionalAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const token = extractToken(request);
  if (!token) return;
  try {
    await authenticate(request, _reply);
  } catch {
    /* anonymous request */
  }
}

export function requireRoles(...roles: UserRole[]) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.user) throw Errors.unauthorized();
    const userRoles = request.user.roles as UserRole[];
    const allowed = roles.length === 0 ? isStaff(userRoles) : userRoles.some((r) => roles.includes(r));
    if (!allowed) throw Errors.forbidden();
  };
}

export function requirePermission(...permissions: Permission[]) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.user) throw Errors.unauthorized();
    const userRoles = request.user.roles as UserRole[];
    const ok = permissions.some((permission) => hasPermission(userRoles, permission));
    if (!ok) throw Errors.forbidden("Bu islem icin yetkiniz yok");
  };
}

export function requireStaff() {
  return requireRoles();
}

export function clientIp(request: FastifyRequest): string | undefined {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0]?.trim();
  return request.ip;
}

export function userAgent(request: FastifyRequest): string | undefined {
  const value = request.headers["user-agent"];
  return typeof value === "string" ? value : undefined;
}

/** Turn any thrown value into a consistent JSON error body. */
export function errorBody(error: unknown) {
  if (error instanceof AppError) {
    return { error: { code: error.code, message: error.message, details: error.details } };
  }
  const message = error instanceof Error ? error.message : "Beklenmeyen hata";
  return { error: { code: "INTERNAL", message } };
}
