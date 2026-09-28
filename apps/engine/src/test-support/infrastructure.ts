import { PrismaClient } from "@prisma/client";

/**
 * Infrastructure guard for engine tests.
 *
 * The wallet and webhook tests assert against real Postgres state, so they need
 * the services from `infra/docker-compose.yml`. On a bare checkout they skip
 * with an explicit reason instead of failing, which keeps `npm test` honest:
 * green means "verified", not "silently skipped because the database was down".
 */
export async function databaseAvailable(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  const probe = new PrismaClient();
  try {
    await probe.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await probe.$disconnect();
  }
}

export const SKIP_REASON =
  "Postgres erisilemedi: infra/docker-compose.yml servislerini baslatip tekrar deneyin";
