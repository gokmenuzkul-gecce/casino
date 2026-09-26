import type { FastifyInstance } from "fastify";
import {
  depositSchema,
  Errors,
  kycSubmitSchema,
  limitsSchema,
  paginationSchema,
  withdrawalSchema,
} from "@aurora/shared";
import { prisma } from "@aurora/db";
import { ledger, parseAmount } from "../services/ledger.js";
import { bonusService } from "../services/bonuses.js";
import { authenticate } from "../middleware/auth.js";

export async function walletRoutes(app: FastifyInstance): Promise<void> {
  const payments = () => app.payments;

  app.get("/wallet", { preHandler: authenticate }, async (request) => {
    const user = request.user!;
    return ledger.summary(user.id, user.currency);
  });

  app.get("/wallet/transactions", { preHandler: authenticate }, async (request) => {
    const query = paginationSchema.parse(request.query);
    const type = (request.query as { type?: string }).type;

    const where = { userId: request.user!.id, type: type || undefined };
    const [total, rows] = await Promise.all([
      prisma.transaction.count({ where }),
      prisma.transaction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      transactions: rows.map((tx) => ({
        id: tx.id,
        reference: tx.reference,
        type: tx.type,
        status: tx.status,
        amount: tx.amount.toString(),
        fee: tx.fee.toString(),
        currency: tx.currency,
        method: tx.method,
        description: tx.description,
        balanceAfter: tx.balanceAfter?.toString() ?? null,
        createdAt: tx.createdAt,
      })),
    };
  });

  app.get("/wallet/payment-methods", { preHandler: authenticate }, async (request) => {
    return { methods: await payments().methodConfigs(request.user!.currency) };
  });

  // ── deposits ──────────────────────────────────────────────────────────

  app.post("/wallet/deposit", { preHandler: authenticate }, async (request) => {
    const body = depositSchema.parse(request.body);
    const user = request.user!;
    return payments().deposit({
      userId: user.id,
      amount: body.amount,
      currency: body.currency ?? user.currency,
      method: body.method,
      bonusCode: body.bonusCode,
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });
  });

  app.get("/wallet/deposits", { preHandler: authenticate }, async (request) => {
    const query = paginationSchema.parse(request.query);
    const where = { userId: request.user!.id, direction: "DEPOSIT" };
    const [total, rows] = await Promise.all([
      prisma.paymentIntent.count({ where }),
      prisma.paymentIntent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      deposits: rows.map((row) => ({
        reference: row.reference,
        amount: row.amount.toString(),
        fee: row.fee.toString(),
        currency: row.currency,
        method: row.method,
        status: row.status,
        createdAt: row.createdAt,
        completedAt: row.completedAt,
        failureReason: row.failureReason,
      })),
    };
  });

  // ── withdrawals ───────────────────────────────────────────────────────

  app.post("/wallet/withdraw", { preHandler: authenticate }, async (request) => {
    const body = withdrawalSchema.parse(request.body);
    const user = request.user!;
    return payments().withdrawal({
      userId: user.id,
      amount: body.amount,
      currency: body.currency ?? user.currency,
      method: body.method,
      iban: body.iban,
      walletAddress: body.walletAddress,
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });
  });

  app.get("/wallet/withdrawals", { preHandler: authenticate }, async (request) => {
    const query = paginationSchema.parse(request.query);
    const where = { userId: request.user!.id, direction: "WITHDRAWAL" };
    const [total, rows] = await Promise.all([
      prisma.paymentIntent.count({ where }),
      prisma.paymentIntent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      withdrawals: rows.map((row) => ({
        reference: row.reference,
        amount: row.amount.toString(),
        fee: row.fee.toString(),
        currency: row.currency,
        method: row.method,
        status: row.status,
        requiresReview: row.requiresReview,
        createdAt: row.createdAt,
        completedAt: row.completedAt,
        failureReason: row.failureReason,
      })),
    };
  });

  /** Cancel a pending withdrawal request and release the locked funds. */
  app.delete("/wallet/withdrawals/:reference", { preHandler: authenticate }, async (request) => {
    const { reference } = request.params as { reference: string };
    const intent = await prisma.paymentIntent.findUnique({ where: { reference } });
    if (!intent || intent.userId !== request.user!.id) throw Errors.notFound("Cekim talebi");
    if (intent.status !== "PENDING") throw Errors.validation("Sadece bekleyen talepler iptal edilebilir");

    await ledger.unlockFunds(intent.userId, intent.currency, intent.amount);
    await prisma.paymentIntent.update({
      where: { id: intent.id },
      data: { status: "CANCELLED", failureReason: "Oyuncu tarafindan iptal edildi" },
    });
    return { ok: true };
  });

  // ── bonuses ───────────────────────────────────────────────────────────

  app.get("/wallet/bonuses", { preHandler: authenticate }, async (request) => {
    return { bonuses: await bonusService.listUserBonuses(request.user!.id) };
  });

  app.post("/wallet/bonuses/claim", { preHandler: authenticate }, async (request) => {
    const body = (request.body ?? {}) as { code?: string };
    if (!body.code) throw Errors.validation("Bonus kodu gerekli");
    const user = request.user!;
    const result = await bonusService.grantByCode({
      userId: user.id,
      code: body.code,
      depositAmount: 0n,
      currency: user.currency,
    });
    return result;
  });

  app.post("/wallet/bonuses/:id/forfeit", { preHandler: authenticate }, async (request) => {
    const { id } = request.params as { id: string };
    const userBonus = await prisma.userBonus.findUnique({ where: { id } });
    if (!userBonus || userBonus.userId !== request.user!.id) throw Errors.notFound("Bonus");
    await bonusService.expireBonus(id, "Oyuncu tarafindan iptal edildi");
    return { ok: true };
  });

  // ── responsible gaming limits ─────────────────────────────────────────

  app.get("/wallet/limits", { preHandler: authenticate }, async (request) => {
    const rows = await prisma.playerLimit.findMany({
      where: { userId: request.user!.id, isActive: true },
      orderBy: { createdAt: "desc" },
    });
    return {
      limits: rows.map((row) => ({
        id: row.id,
        type: row.type,
        period: row.period,
        amount: row.amount.toString(),
        currency: row.currency,
        effectiveAt: row.effectiveAt,
        expiresAt: row.expiresAt,
      })),
    };
  });

  app.post("/wallet/limits", { preHandler: authenticate }, async (request) => {
    const body = limitsSchema.parse(request.body);
    const user = request.user!;
    const currency = user.currency;
    const created: string[] = [];

    const entries: { type: string; period: string; amount: string | null | undefined }[] = [
      { type: "DEPOSIT", period: "DAILY", amount: body.depositDaily },
      { type: "DEPOSIT", period: "WEEKLY", amount: body.depositWeekly },
      { type: "DEPOSIT", period: "MONTHLY", amount: body.depositMonthly },
      { type: "LOSS", period: "DAILY", amount: body.lossDaily },
      { type: "LOSS", period: "WEEKLY", amount: body.lossWeekly },
      { type: "WAGER", period: "DAILY", amount: body.wagerDaily },
    ];

    for (const entry of entries) {
      if (entry.amount === undefined) continue;

      if (entry.amount === null) {
        await prisma.playerLimit.updateMany({
          where: { userId: user.id, type: entry.type, period: entry.period, isActive: true },
          data: { isActive: false },
        });
        continue;
      }

      const amount = parseAmount(entry.amount, currency);
      await prisma.playerLimit.updateMany({
        where: { userId: user.id, type: entry.type, period: entry.period, isActive: true },
        data: { isActive: false },
      });
      const limit = await prisma.playerLimit.create({
        data: { userId: user.id, type: entry.type, period: entry.period, amount, currency },
      });
      created.push(limit.id);

      await prisma.responsibleGamingEvent.create({
        data: { userId: user.id, type: "LIMIT_SET", detail: `${entry.type}/${entry.period}` },
      });
    }

    return { ok: true, created: created.length };
  });

  /** Self-exclusion: irreversible for the chosen period. */
  app.post("/wallet/self-exclude", { preHandler: authenticate }, async (request) => {
    const body = (request.body ?? {}) as { days?: number; reason?: string };
    const days = Number(body.days ?? 0);
    if (![1, 7, 30, 90, 180, 365].includes(days)) throw Errors.validation("Gecersiz sure");

    const until = new Date(Date.now() + days * 24 * 3600 * 1000);
    await prisma.user.update({
      where: { id: request.user!.id },
      data: { selfExcludedAt: new Date(), selfExclusionUntil: until, status: "SELF_EXCLUDED" },
    });
    await prisma.responsibleGamingEvent.create({
      data: { userId: request.user!.id, type: "SELF_EXCLUSION", detail: `${days} gun - ${body.reason ?? "sebep belirtilmedi"}` },
    });
    return { ok: true, until };
  });

  app.post("/wallet/cool-off", { preHandler: authenticate }, async (request) => {
    const body = (request.body ?? {}) as { hours?: number };
    const hours = Math.min(Math.max(Number(body.hours ?? 24), 1), 24 * 7);
    const until = new Date(Date.now() + hours * 3600 * 1000);
    await prisma.user.update({ where: { id: request.user!.id }, data: { coolOffUntil: until } });
    await prisma.responsibleGamingEvent.create({
      data: { userId: request.user!.id, type: "COOL_OFF", detail: `${hours} saat` },
    });
    return { ok: true, until };
  });

  // ── KYC ───────────────────────────────────────────────────────────────

  app.get("/kyc", { preHandler: authenticate }, async (request) => {
    const profile = await prisma.kycProfile.findUnique({
      where: { userId: request.user!.id },
      include: { documents: { select: { id: true, type: true, side: true, verified: true, createdAt: true } } },
    });
    return {
      status: profile?.status ?? "NOT_STARTED",
      level: profile?.level ?? 0,
      submittedAt: profile?.submittedAt ?? null,
      reviewedAt: profile?.reviewedAt ?? null,
      rejectionReason: profile?.rejectionReason ?? null,
      documents: profile?.documents ?? [],
      personal: profile
        ? {
            fullName: profile.fullName,
            birthDate: profile.birthDate,
            nationality: profile.nationality,
            documentType: profile.documentType,
            address: profile.address,
            city: profile.city,
            country: profile.country,
          }
        : null,
    };
  });

  app.post("/kyc/submit", { preHandler: authenticate }, async (request) => {
    const body = kycSubmitSchema.parse(request.body);
    const user = request.user!;

    const existing = await prisma.kycProfile.findUnique({ where: { userId: user.id } });
    if (existing?.status === "APPROVED") throw Errors.validation("Kimlik dogrulamaniz zaten onayli");
    if (existing?.status === "IN_REVIEW" || existing?.status === "PENDING") {
      throw Errors.validation("Basarisiz basvurunuz incelemede");
    }

    const profile = await prisma.kycProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        status: "PENDING",
        fullName: body.fullName,
        birthDate: new Date(body.birthDate),
        nationality: body.nationality,
        documentType: body.documentType,
        documentNumber: body.documentNumber,
        address: body.address,
        city: body.city,
        postalCode: body.postalCode,
        country: body.country,
        submittedAt: new Date(),
      },
      update: {
        status: "PENDING",
        fullName: body.fullName,
        birthDate: new Date(body.birthDate),
        nationality: body.nationality,
        documentType: body.documentType,
        documentNumber: body.documentNumber,
        address: body.address,
        city: body.city,
        postalCode: body.postalCode,
        country: body.country,
        submittedAt: new Date(),
        rejectionReason: null,
      },
    });

    if (body.documents?.length) {
      await prisma.kycDocument.deleteMany({ where: { kycId: profile.id } });
      await prisma.kycDocument.createMany({
        data: body.documents.map((url) => ({ kycId: profile.id, type: body.documentType, fileUrl: url })),
      });
    }

    // Hand off to the configured KYC vendor; the demo adapter reviews locally.
    const result = await app.providers.kyc
      .verify({
        reference: profile.id,
        fullName: body.fullName,
        birthDate: body.birthDate,
        nationality: body.nationality,
        documentType: body.documentType,
        documentNumber: body.documentNumber,
        address: body.address,
        city: body.city,
        country: body.country,
        documentUrls: body.documents ?? [],
        ip: request.ip,
      })
      .catch((error) => {
        console.error("[kyc] saglayici hatasi", error);
        return null;
      });

    if (result) {
      await prisma.kycProfile.update({
        where: { id: profile.id },
        data: {
          providerName: app.providers.kyc.name,
          providerRef: result.providerRef,
          providerResult: (result.raw ?? {}) as never,
          status: result.status,
          level: result.level ?? profile.level,
          pepMatch: result.pepMatch ?? false,
          sanctionsMatch: result.sanctionsMatch ?? false,
          riskLevel: result.riskLevel,
          rejectionReason: result.status === "REJECTED" ? result.reason : null,
          reviewedAt: result.status === "APPROVED" || result.status === "REJECTED" ? new Date() : null,
        },
      });
    }

    return {
      status: result?.status ?? "PENDING",
      reason: result?.reason ?? null,
      provider: app.providers.kyc.name,
      mode: app.providers.kyc.mode,
    };
  });

  app.get("/kyc/requirements", async () => {
    return {
      required: process.env.FEATURE_KYC !== "false",
      minLevelForWithdrawal: 1,
      documentTypes: ["NATIONAL_ID", "PASSPORT", "DRIVERS_LICENSE", "RESIDENCE_PERMIT"],
    };
  });

  // ── VIP ───────────────────────────────────────────────────────────────

  app.get("/vip", { preHandler: authenticate }, async (request) => {
    const [profile, tiers] = await Promise.all([
      prisma.vipProfile.findUnique({ where: { userId: request.user!.id } }),
      prisma.vipTierConfig.findMany({ where: { isActive: true }, orderBy: { level: "asc" } }),
    ]);

    const currentLevel = profile?.level ?? 1;
    const nextTier = tiers.find((t) => t.level > currentLevel);

    return {
      current: profile
        ? {
            tier: profile.tier,
            level: profile.level,
            loyaltyPoints: profile.loyaltyPoints.toString(),
            lifetimeWagered: profile.lifetimeWagered.toString(),
            cashbackBalance: profile.cashbackBalance.toString(),
            rakebackBalance: profile.rakebackBalance.toString(),
          }
        : null,
      next: nextTier
        ? {
            tier: nextTier.tier,
            name: nextTier.name,
            minWagered: nextTier.minWagered.toString(),
            remaining: ((nextTier.minWagered - (profile?.lifetimeWagered ?? 0n)) > 0n
              ? nextTier.minWagered - (profile?.lifetimeWagered ?? 0n)
              : 0n
            ).toString(),
          }
        : null,
      tiers: tiers.map((t) => ({
        tier: t.tier,
        name: t.name,
        level: t.level,
        minWagered: t.minWagered.toString(),
        cashbackPercent: t.cashbackPercent.toString(),
        weeklyBonus: t.weeklyBonus.toString(),
        monthlyBonus: t.monthlyBonus.toString(),
        rakebackPercent: t.rakebackPercent.toString(),
        benefits: t.benefits,
        color: t.color,
      })),
    };
  });

  app.get("/leaderboard", async (request) => {
    const query = request.query as { period?: string; metric?: string };
    const period = query.period ?? "DAILY";
    const metric = query.metric ?? "WAGERED";

    const since = periodStart(period);
    const rows = await prisma.bet.groupBy({
      by: ["userId"],
      where: { isDemo: false, placedAt: { gte: since } },
      _sum: { stake: true, payout: true },
      orderBy: { _sum: { stake: "desc" } },
      take: 50,
    });

    const users = await prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.userId) } },
      select: { id: true, username: true, vip: { select: { tier: true } } },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    return {
      period,
      metric,
      leaders: rows.map((row, index) => ({
        rank: index + 1,
        userId: row.userId,
        username: userMap.get(row.userId)?.username ?? "Gizli",
        vipTier: userMap.get(row.userId)?.vip?.tier ?? null,
        value: (metric === "WON" ? row._sum.payout : row._sum.stake)?.toString() ?? "0",
      })),
    };
  });

  app.get("/tournaments", async () => {
    const rows = await prisma.tournament.findMany({
      where: { status: { in: ["SCHEDULED", "ACTIVE"] } },
      orderBy: { startAt: "asc" },
      take: 20,
    });
    return {
      tournaments: rows.map((t) => ({
        slug: t.slug,
        name: t.name,
        description: t.description,
        bannerUrl: t.bannerUrl,
        type: t.type,
        status: t.status,
        metric: t.metric,
        prizePool: t.prizePool.toString(),
        currency: t.currency,
        entryFee: t.entryFee.toString(),
        startAt: t.startAt,
        endAt: t.endAt,
      })),
    };
  });

  app.get("/tournaments/:slug", async (request) => {
    const { slug } = request.params as { slug: string };
    const tournament = await prisma.tournament.findUnique({
      where: { slug },
      include: {
        entries: {
          orderBy: { score: "desc" },
          take: 100,
          include: { user: { select: { username: true, vip: { select: { tier: true } } } } },
        },
      },
    });
    if (!tournament) throw Errors.notFound("Turnuva");

    return {
      tournament: {
        slug: tournament.slug,
        name: tournament.name,
        description: tournament.description,
        bannerUrl: tournament.bannerUrl,
        status: tournament.status,
        metric: tournament.metric,
        prizePool: tournament.prizePool.toString(),
        currency: tournament.currency,
        startAt: tournament.startAt,
        endAt: tournament.endAt,
      },
      leaderboard: tournament.entries.map((entry, index) => ({
        rank: entry.rank ?? index + 1,
        username: entry.user.username,
        vipTier: entry.user.vip?.tier ?? null,
        score: entry.score.toString(),
        prize: entry.prizeAmount.toString(),
      })),
    };
  });
}

function periodStart(period: string): Date {
  const now = new Date();
  if (period === "DAILY") {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  if (period === "WEEKLY") {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d;
  }
  if (period === "MONTHLY") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return new Date(0);
}
