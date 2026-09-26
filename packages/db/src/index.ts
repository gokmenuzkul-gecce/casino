import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __auroraPrisma: PrismaClient | undefined;
}

/**
 * A single Prisma client per process. In dev, hot reloads would otherwise leak
 * connections, so the instance is cached on globalThis.
 */
export const prisma =
  globalThis.__auroraPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalThis.__auroraPrisma = prisma;

export type { Prisma } from "@prisma/client";
export * from "@prisma/client";
