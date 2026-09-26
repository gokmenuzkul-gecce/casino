import type { FastifyInstance } from "fastify";
import { betSchema, Errors, paginationSchema } from "@aurora/shared";
import { prisma } from "@aurora/db";
import { bets } from "../services/bets.js";
import { bonusService } from "../services/bonuses.js";
import { authenticate, optionalAuth } from "../middleware/auth.js";

export async function gameRoutes(app: FastifyInstance): Promise<void> {
  /** Lobby catalogue: categories, providers, featured and popular games. */
  app.get("/games", { preHandler: optionalAuth }, async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const page = Number(query.page ?? 1);
    const pageSize = Math.min(Number(query.pageSize ?? 48), 100);

    const where = {
      isActive: true,
      category: query.category ? { slug: query.category } : undefined,
      provider: query.provider ? { slug: query.provider } : undefined,
      isFeatured: query.featured === "true" ? true : undefined,
      isNew: query.new === "true" ? true : undefined,
      isJackpot: query.jackpot === "true" ? true : undefined,
      embedType: query.type === "internal" ? "INTERNAL" : query.type === "external" ? "EXTERNAL" : undefined,
      OR: query.search
        ? [
            { name: { contains: query.search, mode: "insensitive" as const } },
            { tags: { has: query.search.toLowerCase() } },
          ]
        : undefined,
    };

    const [total, rows] = await Promise.all([
      prisma.game.count({ where }),
      prisma.game.findMany({
        where,
        orderBy: [{ isFeatured: "desc" }, { sortOrder: "asc" }, { playCount: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          category: { select: { slug: true, name: true } },
          provider: { select: { slug: true, name: true, type: true } },
          jackpot: { select: { currentAmount: true, currency: true } },
        },
      }),
    ]);

    return {
      total,
      page,
      pageSize,
      games: rows.map(shapeGame),
    };
  });

  app.get("/games/categories", async () => {
    const rows = await prisma.gameCategoryModel.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      include: { _count: { select: { games: { where: { isActive: true } } } } },
    });
    return {
      categories: rows.map((row) => ({
        slug: row.slug,
        name: row.name,
        iconUrl: row.iconUrl,
        gameCount: row._count.games,
      })),
    };
  });

  app.get("/games/providers", async () => {
    const rows = await prisma.gameProviderModel.findMany({
      where: { isActive: true },
      orderBy: { priority: "desc" },
      include: { _count: { select: { games: { where: { isActive: true } } } } },
    });
    return {
      providers: rows.map((row) => ({
        slug: row.slug,
        name: row.name,
        logoUrl: row.logoUrl,
        type: row.type,
        gameCount: row._count.games,
      })),
    };
  });

  /** Home page payload: one call for everything the landing view needs. */
  app.get("/lobby", { preHandler: optionalAuth }, async (request) => {
    const [featured, newest, popular, jackpots, categories, bonuses, banners, announcements, bigWins] = await Promise.all([
      prisma.game.findMany({ where: { isActive: true, isFeatured: true }, take: 12, include: { category: true, provider: true, jackpot: true } }),
      prisma.game.findMany({ where: { isActive: true, isNew: true }, orderBy: { releasedAt: "desc" }, take: 12, include: { category: true, provider: true, jackpot: true } }),
      prisma.game.findMany({ where: { isActive: true }, orderBy: { playCount: "desc" }, take: 12, include: { category: true, provider: true, jackpot: true } }),
      prisma.jackpot.findMany({ where: { isActive: true }, take: 6 }),
      prisma.gameCategoryModel.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
      bonusService.listAvailable(request.user?.id, request.user?.currency ?? "TRY"),
      prisma.banner.findMany({ where: { isActive: true, position: "HOME_HERO" }, orderBy: { sortOrder: "asc" }, take: 5 }),
      prisma.announcement.findMany({ where: { isActive: true }, orderBy: { createdAt: "desc" }, take: 3 }),
      prisma.bet.findMany({
        where: { isDemo: false, payout: { gt: 0n }, placedAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
        orderBy: { payout: "desc" },
        take: 10,
        include: { game: { select: { name: true, slug: true } }, user: { select: { username: true } } },
      }),
    ]);

    const onlinePlayers = await prisma.session.count({
      where: { isActive: true, lastSeenAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } },
    });

    // The three shelves must not repeat the same game: with a small catalogue the
    // overlap is total, so each shelf excludes what the previous one claimed.
    const featuredSlugs = new Set(featured.map((game) => game.slug));
    const newestDeduped = newest.filter((game) => !featuredSlugs.has(game.slug));
    const claimed = new Set([...featuredSlugs, ...newestDeduped.map((game) => game.slug)]);
    const popularDeduped = popular.filter((game) => !claimed.has(game.slug));

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayStats = await prisma.bet.aggregate({
      where: { isDemo: false, placedAt: { gte: todayStart } },
      _sum: { stake: true, payout: true },
      _count: true,
    });

    return {
      featured: featured.map(shapeGame),
      newest: newestDeduped.map(shapeGame),
      popular: popularDeduped.map(shapeGame),
      categories: categories.map((c) => ({ slug: c.slug, name: c.name, iconUrl: c.iconUrl })),
      jackpots: jackpots.map((j) => ({
        id: j.id,
        name: j.name,
        amount: j.currentAmount.toString(),
        currency: j.currency,
        lastWonAt: j.lastWonAt,
      })),
      bonuses,
      banners: banners.map((b) => ({ id: b.id, title: b.title, imageUrl: b.imageUrl, linkUrl: b.linkUrl })),
      announcements,
      stats: {
        onlinePlayers,
        totalBetsToday: todayStats._count,
        totalWageredToday: (todayStats._sum.stake ?? 0n).toString(),
        totalPaidToday: (todayStats._sum.payout ?? 0n).toString(),
      },
      bigWins: bigWins.map((b) => ({
        id: b.id,
        username: b.user?.username ?? "Gizli",
        gameName: b.game.name,
        gameSlug: b.game.slug,
        payout: b.payout.toString(),
        currency: b.currency,
        multiplier: b.multiplier?.toString() ?? "0",
        at: b.placedAt,
      })),
    };
  });

  app.get("/games/:slug", { preHandler: optionalAuth }, async (request) => {
    const { slug } = request.params as { slug: string };
    const game = await prisma.game.findUnique({
      where: { slug },
      include: {
        category: true,
        provider: true,
        jackpot: true,
        _count: { select: { bets: true } },
      },
    });
    if (!game || !game.isActive) throw Errors.notFound("Oyun");

    const recent = await prisma.bet.findMany({
      where: { gameId: game.id, isDemo: false },
      orderBy: { placedAt: "desc" },
      take: 15,
      include: { user: { select: { username: true } } },
    });

    const stats = await prisma.bet.aggregate({
      where: { gameId: game.id, isDemo: false, placedAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
      _sum: { stake: true, payout: true },
      _count: true,
    });

    return {
      game: shapeGame(game),
      playCount: game._count.bets,
      stats: {
        bets24h: stats._count,
        wagered24h: (stats._sum.stake ?? 0n).toString(),
        paid24h: (stats._sum.payout ?? 0n).toString(),
      },
      recentBets: recent.map((b) => ({
        id: b.id,
        username: b.user?.username ?? "Gizli",
        stake: b.stake.toString(),
        payout: b.payout.toString(),
        multiplier: b.multiplier?.toString() ?? "0",
        at: b.placedAt,
      })),
      config: game.config,
    };
  });

  /** Place a bet on an internal instant game. */
  app.post("/games/bet", { preHandler: authenticate }, async (request) => {
    const body = betSchema.parse(request.body);
    const user = request.user!;

    const result = await bets.place({
      userId: user.id,
      gameSlug: body.gameSlug,
      amount: body.amount,
      currency: body.currency ?? user.currency,
      params: body.params,
      clientSeed: body.clientSeed,
      idempotencyKey: body.idempotencyKey ?? (request.headers["idempotency-key"] as string | undefined),
      ip: request.ip,
      deviceId: (request.headers["x-device-id"] as string | undefined),
      isDemo: false,
    });

    // Bonus wagering advances on every settled real-money bet.
    const game = await prisma.game.findUnique({
      where: { slug: body.gameSlug },
      include: { category: true },
    });
    if (game?.category) {
      await bonusService
        .applyWagering({
          userId: user.id,
          gameSlug: body.gameSlug,
          categorySlug: game.category.slug,
          stake: BigInt(Math.round(Number(result.stake) * 100)),
          currency: result.currency,
          betId: result.betId,
        })
        .catch((error) => console.error("[bet] wagering hatasi", error));
    }

    return result;
  });

  /** Demo mode: same engine, DEMO wallet, no limits, no bonus. */
  app.post("/games/demo/bet", { preHandler: authenticate }, async (request) => {
    const body = betSchema.parse(request.body);
    const user = request.user!;

    const result = await bets.place({
      userId: user.id,
      gameSlug: body.gameSlug,
      amount: body.amount,
      currency: body.currency ?? user.currency,
      params: body.params,
      clientSeed: body.clientSeed,
      idempotencyKey: body.idempotencyKey,
      ip: request.ip,
      isDemo: true,
    });

    return result;
  });

  app.get("/games/bets/history", { preHandler: authenticate }, async (request) => {
    const query = paginationSchema.parse(request.query);
    return bets.history({
      userId: request.user!.id,
      page: query.page,
      pageSize: query.pageSize,
      gameSlug: query.search,
    });
  });

  /** Provably-fair verification for a specific bet. */
  app.get("/games/bets/:id/verify", { preHandler: authenticate }, async (request) => {
    const { id } = request.params as { id: string };
    const bet = await prisma.bet.findUnique({ where: { id }, select: { userId: true } });
    if (!bet) throw Errors.notFound("Bahis");
    if (bet.userId !== request.user!.id) throw Errors.forbidden();
    return bets.verify(id);
  });

  // ── favourites ────────────────────────────────────────────────────────

  app.get("/games/favorites/list", { preHandler: authenticate }, async (request) => {
    const rows = await prisma.gameFavorite.findMany({
      where: { userId: request.user!.id },
      include: { game: { include: { category: true, provider: true, jackpot: true } } },
      orderBy: { createdAt: "desc" },
    });
    return { games: rows.map((r) => shapeGame(r.game)) };
  });

  app.post("/games/favorites/:slug", { preHandler: authenticate }, async (request) => {
    const { slug } = request.params as { slug: string };
    const game = await prisma.game.findUnique({ where: { slug }, select: { id: true } });
    if (!game) throw Errors.notFound("Oyun");

    const existing = await prisma.gameFavorite.findUnique({
      where: { userId_gameId: { userId: request.user!.id, gameId: game.id } },
    });

    if (existing) {
      await prisma.gameFavorite.delete({ where: { id: existing.id } });
      return { favorite: false };
    }
    await prisma.gameFavorite.create({ data: { userId: request.user!.id, gameId: game.id } });
    return { favorite: true };
  });

  /** Live-casino and external content: launch a provider session. */
  app.post("/games/:slug/launch", { preHandler: authenticate }, async (request) => {
    const { slug } = request.params as { slug: string };
    const body = (request.body ?? {}) as { mode?: "demo" | "real" };

    const game = await prisma.game.findUnique({
      where: { slug },
      include: { provider: true },
    });
    if (!game || !game.isActive) throw Errors.notFound("Oyun");
    if (game.embedType === "INTERNAL") {
      return { internal: true, url: `/play/${game.slug}`, mode: body.mode ?? "real" };
    }

    const registry = app.providers;
    const sessionToken = `${request.user!.id}:${Date.now()}`;
    const result = await registry.gameAggregator.launchSession({
      externalGameId: game.providerGameId ?? game.slug,
      playerId: request.user!.id,
      currency: request.user!.currency,
      locale: "tr",
      mode: body.mode === "demo" ? "demo" : "real",
      returnUrl: `${process.env.APP_URL ?? "http://localhost:3000"}/play/${game.slug}`,
      sessionToken,
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });

    return { internal: false, ...result };
  });
}

function shapeGame(game: {
  slug: string;
  name: string;
  description?: string | null;
  thumbnailUrl?: string | null;
  bannerUrl?: string | null;
  themeColor?: string | null;
  rtp?: unknown;
  volatility?: string;
  minBet?: bigint;
  maxBet?: bigint;
  isFeatured?: boolean;
  isNew?: boolean;
  isJackpot?: boolean;
  isExclusive?: boolean;
  demoEnabled?: boolean;
  realEnabled?: boolean;
  embedType?: string;
  tags?: string[];
  rating?: unknown;
  playCount?: bigint;
  category?: { slug: string; name: string } | null;
  provider?: { slug: string; name: string; type?: string } | null;
  jackpot?: { currentAmount: bigint; currency: string } | null;
}) {
  return {
    slug: game.slug,
    name: game.name,
    description: game.description,
    thumbnailUrl: game.thumbnailUrl,
    bannerUrl: game.bannerUrl,
    themeColor: game.themeColor,
    rtp: game.rtp?.toString() ?? null,
    volatility: game.volatility,
    minBet: game.minBet?.toString() ?? "0",
    maxBet: game.maxBet?.toString() ?? "0",
    isFeatured: game.isFeatured ?? false,
    isNew: game.isNew ?? false,
    isJackpot: game.isJackpot ?? false,
    isExclusive: game.isExclusive ?? false,
    demoEnabled: game.demoEnabled ?? true,
    realEnabled: game.realEnabled ?? true,
    embedType: game.embedType ?? "INTERNAL",
    tags: game.tags ?? [],
    rating: game.rating?.toString() ?? null,
    playCount: game.playCount?.toString() ?? "0",
    category: game.category ? { slug: game.category.slug, name: game.category.name } : null,
    provider: game.provider ? { slug: game.provider.slug, name: game.provider.name, type: game.provider.type ?? "INTERNAL" } : null,
    jackpot: game.jackpot
      ? { amount: game.jackpot.currentAmount.toString(), currency: game.jackpot.currency }
      : null,
  };
}
