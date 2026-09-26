import Fastify, { FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import { ZodError } from "zod";
import { AppError, Errors } from "@aurora/shared";
import { prisma } from "@aurora/db";

import { env, assertProductionReadiness } from "./lib/env.js";
import { createProviderRegistry, ProviderRegistry } from "./providers/index.js";
import { PaymentService } from "./services/payments.js";
import { authRoutes } from "./routes/auth.js";
import { gameRoutes } from "./routes/games.js";
import { walletRoutes } from "./routes/wallet.js";
import { adminRoutes } from "./routes/admin.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { errorBody } from "./middleware/auth.js";
import { RealtimeServer } from "./realtime/socket.js";
import { crashEngine } from "./realtime/crash.js";
import { startJobs, stopJobs } from "./jobs/index.js";

declare module "fastify" {
  interface FastifyInstance {
    providers: ProviderRegistry;
    payments: PaymentService;
    realtime: RealtimeServer;
  }
}

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: env.isProduction
      ? { level: "info" }
      : { level: "warn", transport: undefined },
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024,
    // Raw body is needed for webhook signature verification.
    genReqId: () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false, // the SPA sets its own CSP
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });

  await app.register(cors, {
    origin: [env.appUrl, "http://localhost:3000", "http://localhost:3001"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "authorization", "idempotency-key", "x-device-id", "x-signature", "x-timestamp"],
  });

  await app.register(cookie, { secret: env.jwtAccessSecret || "aurora-cookie-secret" });

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    // Webhooks are high-volume and authenticated by signature, so exempt them.
    allowList: (request) => request.url.startsWith("/webhooks/"),
    keyGenerator: (request) => (request.headers["x-forwarded-for"] as string)?.split(",")[0] ?? request.ip,
    errorResponseBuilder: () => errorBody(Errors.rateLimited()),
  });

  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 6 },
  });

  // Money is stored as BigInt minor units and route payloads pass those values
  // through untouched. JSON.stringify cannot encode BigInt, so serialise it as a
  // decimal string and let clients parse it.
  const bigintSafeJson = (data: unknown): string =>
    JSON.stringify(data ?? null, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
  app.setReplySerializer((payload) => bigintSafeJson(payload));
  app.setSerializerCompiler(() => (data) => bigintSafeJson(data));

  // Preserve the raw body for HMAC verification on webhook routes.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const raw = body as string;
    if (request.url.startsWith("/webhooks/")) {
      (request as unknown as { rawBody: string }).rawBody = raw;
    }
    try {
      done(null, raw.length === 0 ? {} : JSON.parse(raw));
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  // ── dependency wiring ─────────────────────────────────────────────────
  const providers = createProviderRegistry();
  const payments = new PaymentService(providers);
  app.decorate("providers", providers);
  app.decorate("payments", payments);

  // ── error handling ────────────────────────────────────────────────────
  app.setErrorHandler((error: Error & { statusCode?: number; validation?: unknown }, request, reply) => {
    if (error instanceof AppError) {
      if (error.statusCode >= 500) request.log.error({ err: error }, error.message);
      return reply.code(error.statusCode).send(errorBody(error));
    }
    // Routes validate bodies with zod's `.parse()`, which throws a ZodError.
    // Without this branch the raw issue dump leaks out as a 500.
    if (error instanceof ZodError) {
      const issues = error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
        code: issue.code,
      }));
      return reply.code(422).send(errorBody(Errors.validation("Gecersiz istek verisi", { issues })));
    }
    if (error.validation) {
      return reply.code(422).send(errorBody(Errors.validation(error.message, error.validation as Record<string, unknown>)));
    }
    if (error.statusCode === 429) {
      return reply.code(429).send(errorBody(Errors.rateLimited()));
    }
    request.log.error({ err: error }, "islenmeyen hata");
    return reply.code(error.statusCode ?? 500).send(errorBody(Errors.internal(error.message)));
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send(errorBody(Errors.notFound("Endpoint")));
  });

  // ── health & metadata ─────────────────────────────────────────────────
  app.get("/health", async () => {
    const [dbOk, redisOk] = await Promise.all([probeDatabase(), probeRedis()]);
    return {
      status: dbOk && redisOk ? "ok" : "degraded",
      service: "aurora-engine",
      version: "0.1.0",
      mode: env.platformMode,
      checks: { database: dbOk, redis: redisOk },
      time: new Date().toISOString(),
    };
  });

  app.get("/", async () => ({
    name: `${env.appName} Engine`,
    version: "0.1.0",
    mode: env.platformMode,
    docs: "/docs",
    health: "/health",
  }));

  app.get("/config/public", async () => {
    const [categories, providersList, methods, banners, pages] = await Promise.all([
      prisma.gameCategoryModel.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
      prisma.gameProviderModel.findMany({ where: { isActive: true }, orderBy: { priority: "desc" } }),
      prisma.paymentMethodConfig.findMany({ where: { enabled: true }, orderBy: { sortOrder: "asc" } }),
      prisma.banner.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
      prisma.cmsPage.findMany({ where: { status: "PUBLISHED" }, select: { slug: true, title: true } }),
    ]);

    return {
      appName: env.appName,
      currency: env.currency,
      mode: env.platformMode,
      features: env.features,
      categories: categories.map((c) => ({ slug: c.slug, name: c.name, iconUrl: c.iconUrl })),
      providers: providersList.map((p) => ({ slug: p.slug, name: p.name, logoUrl: p.logoUrl, type: p.type })),
      paymentMethods: methods.map((m) => ({
        method: m.method,
        displayName: m.displayName,
        iconUrl: m.iconUrl,
        currencies: m.currencies,
        maintenanceMode: m.maintenanceMode,
      })),
      banners: banners.map((b) => ({ id: b.id, title: b.title, imageUrl: b.imageUrl, linkUrl: b.linkUrl, position: b.position })),
      pages: pages.map((p) => ({ slug: p.slug, title: p.title })),
    };
  });

  // ── routes ────────────────────────────────────────────────────────────
  await app.register(authRoutes, { prefix: "/api" });
  await app.register(gameRoutes, { prefix: "/api" });
  await app.register(walletRoutes, { prefix: "/api" });
  await app.register(adminRoutes, { prefix: "/api" });
  await app.register(webhookRoutes);

  return app;
}

async function probeDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function probeRedis(): Promise<boolean> {
  try {
    const { getRedis } = await import("./jobs/queues.js");
    const redis = getRedis();
    const pong = await redis.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
}

/**
 * Boot sequence: validate configuration, build the HTTP server, attach the
 * realtime layer, start background jobs and the crash loop, then listen.
 */
async function main(): Promise<void> {
  assertProductionReadiness();

  const app = await buildServer();

  // Attach realtime before listening: Fastify forbids decorators after start.
  const realtime = new RealtimeServer(app.server);
  app.decorate("realtime", realtime);

  await app.listen({ port: Number(process.env.PORT ?? 4000), host: "0.0.0.0" });

  realtime.startLobbyLoop();
  await startJobs(app);
  await crashEngine.start();

  app.log.warn(`Aurora engine hazir - mod: ${env.platformMode}`);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.warn(`${signal} alindi, kapatiliyor...`);
    realtime.stop();
    await stopJobs();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

// Only boot when executed directly, so tests can import buildServer.
const isDirectRun = process.argv[1]?.includes("server");
if (isDirectRun) {
  main().catch((error) => {
    console.error("Sunucu baslatilamadi:", error);
    process.exit(1);
  });
}
