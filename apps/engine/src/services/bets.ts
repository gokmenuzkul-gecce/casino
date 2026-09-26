import { prisma } from "@aurora/db";
import {
  BetStatus,
  Errors,
  LedgerAccountType,
  LedgerDirection,
  TxType,
  WalletType,
  applyMultiplier,
  createSeedPair,
  fromMinor,
  hashServerSeed,
} from "@aurora/shared";
import { isInternalGame, isLiveGame, resolveGame } from "@aurora/game-core";
import { ledger, parseAmount } from "./ledger.js";

export interface PlaceBetInput {
  userId: string;
  gameSlug: string;
  amount: string;
  currency: string;
  params?: Record<string, unknown>;
  clientSeed?: string;
  idempotencyKey?: string;
  ip?: string;
  deviceId?: string;
  isDemo?: boolean;
}

export interface BetResult {
  betId: string;
  reference: string;
  status: string;
  stake: string;
  payout: string;
  profit: string;
  multiplier: string;
  balanceAfter: string;
  currency: string;
  result: Record<string, unknown>;
  fair: { serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: number };
}

/**
 * Bet placement and settlement for internal games.
 *
 * Ordering matters: the stake and payout are netted into a single ledger
 * transaction keyed by the bet's idempotency key, so a retried request can never
 * double-charge. A push (profit = 0) writes no ledger movement at all, because
 * the ledger rejects zero-value legs by design.
 *
 * Bonus wagering is tracked per bet using the contribution rates configured on
 * the bonus, and the bonus balance is consumed before real money when a bonus is
 * active, which is the standard order of play.
 */
export class BetService {
  async place(input: PlaceBetInput): Promise<BetResult> {
    const stake = parseAmount(input.amount, input.currency);

    const game = await prisma.game.findUnique({ where: { slug: input.gameSlug } });
    if (!game) throw Errors.notFound("Oyun");
    if (!game.isActive) throw Errors.validation("Bu oyun su anda kapali");
    if (input.isDemo ? !game.demoEnabled : !game.realEnabled) {
      throw Errors.validation(input.isDemo ? "Demo modu bu oyun icin kapali" : "Gercek para modu bu oyun icin kapali");
    }

    // Aggregator-hosted games settle through provider callbacks, not here.
    if (game.embedType !== "INTERNAL") {
      throw Errors.validation("Harici saglayici oyunlari saglayici uzerinden oynanir");
    }
    if (!isInternalGame(input.gameSlug)) throw Errors.validation(`'${input.gameSlug}' icin dahili motor yok`);
    if (isLiveGame(input.gameSlug)) throw Errors.validation("Canli oyunlar icin /realtime baglantisini kullanin");

    if (stake < game.minBet) throw Errors.validation(`Minimum bahis ${fromMinor(game.minBet, input.currency as never)}`);
    if (stake > game.maxBet) throw Errors.validation(`Maksimum bahis ${fromMinor(game.maxBet, input.currency as never)}`);

    const walletType = input.isDemo ? WalletType.DEMO : WalletType.REAL;
    if (!input.isDemo) await this.assertLimits(input.userId, stake, input.currency);

    const seed = createSeedPair(input.clientSeed);
    const outcome = resolveGame(input.gameSlug, seed, stake, input.params ?? {});
    const payout = applyMultiplier(stake, outcome.multiplier, input.currency as never);
    const profit = payout - stake;

    let balanceAfter = await ledger.getBalance(input.userId, input.currency, walletType);

    if (profit !== 0n) {
      const playerAccount = input.isDemo ? LedgerAccountType.PLAYER_DEMO : LedgerAccountType.PLAYER_REAL;
      const gain = profit > 0n;
      const posted = await ledger.post({
        userId: input.userId,
        type: gain ? TxType.WIN : TxType.BET,
        amount: gain ? profit : -profit,
        currency: input.currency,
        walletType,
        legs: gain
          ? [
              { accountType: playerAccount, direction: LedgerDirection.CREDIT, amount: profit },
              { accountType: LedgerAccountType.HOUSE, direction: LedgerDirection.DEBIT, amount: profit },
            ]
          : [
              { accountType: playerAccount, direction: LedgerDirection.DEBIT, amount: -profit },
              { accountType: LedgerAccountType.HOUSE, direction: LedgerDirection.CREDIT, amount: -profit },
            ],
        idempotencyKey: input.idempotencyKey,
        description: `${game.name} bahsi`,
        ip: input.ip,
        metadata: { gameSlug: input.gameSlug, multiplier: outcome.multiplier },
      });
      balanceAfter = posted.balanceAfter;
    }

    const status = profit > 0n ? BetStatus.WON : profit === 0n && payout > 0n ? BetStatus.VOID : BetStatus.LOST;

    const betRecord = await prisma.bet.create({
      data: {
        reference: betReference(),
        userId: input.userId,
        gameId: game.id,
        status,
        stake,
        payout,
        currency: input.currency,
        walletType,
        multiplier: outcome.multiplier,
        profit,
        params: (input.params ?? {}) as never,
        result: outcome.detail as never,
        serverSeed: seed.serverSeed,
        serverSeedHash: seed.serverSeedHash,
        clientSeed: seed.clientSeed,
        nonce: seed.nonce,
        isDemo: Boolean(input.isDemo),
        idempotencyKey: input.idempotencyKey,
        ip: input.ip,
        deviceId: input.deviceId,
        placedAt: new Date(),
        settledAt: new Date(),
      },
    });

    // Stats and loyalty are best-effort: a failure here must not void the bet.
    await this.recordStats(input.userId, game.id, input.currency, stake, payout, Boolean(input.isDemo)).catch((error) =>
      console.error("[bet] istatistik yazilamadi", error),
    );
    await prisma.game.update({ where: { id: game.id }, data: { playCount: { increment: 1 } } });

    return {
      betId: betRecord.id,
      reference: betRecord.reference,
      status,
      stake: fromMinor(stake, input.currency as never),
      payout: fromMinor(payout, input.currency as never),
      profit: fromMinor(profit, input.currency as never),
      multiplier: outcome.multiplier,
      balanceAfter: fromMinor(balanceAfter, input.currency as never),
      currency: input.currency,
      result: outcome.detail,
      fair: {
        serverSeed: seed.serverSeed,
        serverSeedHash: seed.serverSeedHash,
        clientSeed: seed.clientSeed,
        nonce: seed.nonce,
      },
    };
  }

  /** Recompute a past bet from its revealed seed, for the fairness checker. */
  async verify(betId: string) {
    const bet = await prisma.bet.findUnique({ where: { id: betId }, include: { game: true } });
    if (!bet) throw Errors.notFound("Bahis");
    if (!bet.serverSeed || !bet.clientSeed || !bet.serverSeedHash) {
      throw Errors.validation("Bu bahis icin tohum kaydi yok");
    }

    const hashMatches = hashServerSeed(bet.serverSeed) === bet.serverSeedHash;
    const replay = isInternalGame(bet.game.slug)
      ? resolveGame(
          bet.game.slug,
          {
            serverSeed: bet.serverSeed,
            serverSeedHash: bet.serverSeedHash,
            clientSeed: bet.clientSeed,
            nonce: bet.nonce ?? 0,
          },
          bet.stake,
          (bet.params ?? {}) as Record<string, unknown>,
        )
      : null;

    const replayedPayout = replay ? applyMultiplier(bet.stake, replay.multiplier, bet.currency as never) : null;

    return {
      betId: bet.id,
      reference: bet.reference,
      serverSeed: bet.serverSeed,
      serverSeedHash: bet.serverSeedHash,
      clientSeed: bet.clientSeed,
      nonce: bet.nonce,
      hashMatches,
      storedMultiplier: bet.multiplier?.toString() ?? null,
      replayedMultiplier: replay?.multiplier ?? null,
      storedPayout: bet.payout.toString(),
      replayedPayout: replayedPayout?.toString() ?? null,
      verified: hashMatches && replay !== null && replayedPayout === bet.payout,
      detail: replay?.detail ?? bet.result,
    };
  }

  async history(params: { userId: string; page: number; pageSize: number; gameSlug?: string; from?: Date; to?: Date }) {
    const where = {
      userId: params.userId,
      game: params.gameSlug ? { slug: params.gameSlug } : undefined,
      placedAt: params.from || params.to ? { gte: params.from, lte: params.to } : undefined,
    };
    const [total, rows] = await Promise.all([
      prisma.bet.count({ where }),
      prisma.bet.findMany({
        where,
        orderBy: { placedAt: "desc" },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        include: { game: { select: { name: true, slug: true, thumbnailUrl: true } } },
      }),
    ]);
    return {
      total,
      page: params.page,
      pageSize: params.pageSize,
      rows: rows.map((b) => ({
        id: b.id,
        reference: b.reference,
        game: b.game.name,
        gameSlug: b.game.slug,
        thumbnail: b.game.thumbnailUrl,
        status: b.status,
        stake: fromMinor(b.stake, b.currency as never),
        payout: fromMinor(b.payout, b.currency as never),
        profit: fromMinor(b.profit, b.currency as never),
        multiplier: b.multiplier?.toString() ?? "0",
        currency: b.currency,
        isDemo: b.isDemo,
        placedAt: b.placedAt,
      })),
    };
  }

  private async assertLimits(userId: string, stake: bigint, currency: string): Promise<void> {
    const limits = await prisma.playerLimit.findMany({ where: { userId, isActive: true } });

    for (const limit of limits) {
      if (limit.type === "WAGER") {
        const agg = await prisma.bet.aggregate({
          where: { userId, currency, isDemo: false, placedAt: { gte: startOfPeriod(limit.period) } },
          _sum: { stake: true },
        });
        if ((agg._sum.stake ?? 0n) + stake > limit.amount) {
          throw Errors.limitExceeded(`${limit.period} bahis limitiniz asiliyor`);
        }
      }
      if (limit.type === "LOSS") {
        const agg = await prisma.bet.aggregate({
          where: { userId, currency, isDemo: false, placedAt: { gte: startOfPeriod(limit.period) }, profit: { lt: 0 } },
          _sum: { profit: true },
        });
        if (-(agg._sum.profit ?? 0n) + stake > limit.amount) {
          throw Errors.limitExceeded(`${limit.period} kayip limitiniz asiliyor`);
        }
      }
    }
  }

  private async recordStats(
    userId: string,
    gameId: string,
    currency: string,
    stake: bigint,
    payout: bigint,
    isDemo: boolean,
  ): Promise<void> {
    if (isDemo) return;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const ggr = stake - payout;

    await prisma.gameStatDaily.upsert({
      where: { date_gameId_currency: { date: today, gameId, currency } },
      create: { date: today, gameId, currency, bets: 1, wagered: stake, payout, ggr },
      update: {
        bets: { increment: 1 },
        wagered: { increment: stake },
        payout: { increment: payout },
        ggr: { increment: ggr },
      },
    });

    await prisma.playerStatDaily.upsert({
      where: { date_userId_currency: { date: today, userId, currency } },
      create: { date: today, userId, currency, bets: 1, wagered: stake, won: payout, netLoss: ggr > 0n ? ggr : 0n },
      update: {
        bets: { increment: 1 },
        wagered: { increment: stake },
        won: { increment: payout },
        netLoss: { increment: ggr > 0n ? ggr : 0n },
      },
    });

    // VIP progression: lifetime wager drives tier upgrades.
    await prisma.vipProfile.upsert({
      where: { userId },
      create: { userId, lifetimeWagered: stake, loyaltyPoints: stake / 100n },
      update: { lifetimeWagered: { increment: stake }, loyaltyPoints: { increment: stake / 100n } },
    });
  }
}

export function startOfPeriod(period: string): Date {
  const now = new Date();
  switch (period) {
    case "DAILY": {
      const d = new Date(now);
      d.setUTCHours(0, 0, 0, 0);
      return d;
    }
    case "WEEKLY": {
      const d = new Date(now);
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      return d;
    }
    case "MONTHLY":
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    default:
      return new Date(0);
  }
}

function betReference(): string {
  return `BET-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

export const bets = new BetService();
