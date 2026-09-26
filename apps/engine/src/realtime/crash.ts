import { prisma } from "@aurora/db";
import {
  BetStatus,
  LedgerAccountType,
  LedgerDirection,
  RoundStatus,
  TxType,
  WalletType,
  applyMultiplier,
  createSeedPair,
  fromMinor,
} from "@aurora/shared";
import { crashPointFromSeed, multiplierAt } from "@aurora/game-core";
import { ledger } from "../services/ledger.js";

export interface CrashBetView {
  betId: string;
  userId: string;
  username: string;
  amount: string;
  cashedOutAt: string | null;
  payout: string | null;
}

export interface CrashRoundView {
  roundId: string;
  roundNumber: number;
  status: RoundStatus;
  multiplier: string;
  serverSeedHash: string;
  startedAt: string | null;
  remainingMs: number;
  bets: CrashBetView[];
  history: { roundNumber: number; crashPoint: string }[];
}

type Listener = (event: CrashEvent) => void;

export type CrashEvent =
  | { type: "round:started"; round: CrashRoundView }
  | { type: "round:tick"; roundId: string; multiplier: string; remainingMs: number }
  | { type: "round:crashed"; roundId: string; crashPoint: string; serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: number }
  | { type: "round:settled"; roundId: string; roundNumber: number; crashPoint: string }
  | { type: "bet:placed"; roundId: string; bet: CrashBetView }
  | { type: "bet:cashed"; roundId: string; betId: string; userId: string; multiplier: string; payout: string };

const BETTING_WINDOW_MS = 7_000;
const SETTLE_DELAY_MS = 4_000;
const TICK_INTERVAL_MS = 100;
const HISTORY_SIZE = 20;

/**
 * Crash round manager.
 *
 * A round moves through OPEN (players bet) -> ACTIVE (multiplier climbs) ->
 * SETTLED (busted). The crash point is fixed by the seed before betting opens,
 * and only its hash is published during the round, so the operator cannot
 * change the outcome after seeing the bets. The seed is revealed at bust, which
 * lets any player verify the round.
 *
 * All bets are stored in memory during the round and persisted at settle time;
 * wallet debits happen immediately at placement so funds cannot be double-spent
 * across rounds.
 */
export class CrashEngine {
  private status: RoundStatus = RoundStatus.OPEN;
  private roundId = "";
  private roundNumber = 0;
  private seed = createSeedPair();
  private crashPoint = "1.00";
  private startedAt: Date | null = null;
  private bettingEndsAt = 0;
  private crashAtMs = 0;
  private tickTimer?: NodeJS.Timeout;
  private listeners = new Set<Listener>();
  private history: { roundNumber: number; crashPoint: string }[] = [];
  private bets = new Map<string, CrashBetView & { userId: string; amountMinor: bigint; currency: string; walletType: WalletType }>();

  constructor(private readonly gameSlug = "crash") {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: CrashEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("[crash] dinleyici hatasi", error);
      }
    }
  }

  currentView(): CrashRoundView {
    return {
      roundId: this.roundId,
      roundNumber: this.roundNumber,
      status: this.status,
      multiplier: this.status === RoundStatus.ACTIVE ? multiplierAt(Date.now() - this.crashAtMs).toFixed(4) : "1.0000",
      serverSeedHash: this.seed.serverSeedHash,
      startedAt: this.startedAt?.toISOString() ?? null,
      remainingMs: this.status === RoundStatus.OPEN ? Math.max(0, this.bettingEndsAt - Date.now()) : 0,
      bets: [...this.bets.values()].map(({ betId, userId, username, amount, cashedOutAt, payout }) => ({
        betId,
        userId,
        username,
        amount,
        cashedOutAt,
        payout,
      })),
      history: this.history.slice(-HISTORY_SIZE),
    };
  }

  /** Open the first round and keep the loop running. */
  async start(): Promise<void> {
    const game = await prisma.game.findUnique({ where: { slug: this.gameSlug }, select: { id: true } });
    if (!game) {
      console.warn(`[crash] '${this.gameSlug}' oyunu bulunamadi, canli dongu baslatilmadi`);
      return;
    }
    const last = await prisma.gameRound.findFirst({
      where: { gameId: game.id },
      orderBy: { roundNumber: "desc" },
      select: { roundNumber: true },
    });
    this.roundNumber = last?.roundNumber ?? 0;
    await this.openRound();
  }

  private async openRound(): Promise<void> {
    const game = await prisma.game.findUnique({ where: { slug: this.gameSlug }, select: { id: true } });
    if (!game) return;

    this.roundNumber += 1;
    this.seed = createSeedPair();
    this.crashPoint = crashPointFromSeed(this.seed);
    this.status = RoundStatus.OPEN;
    this.bets.clear();
    this.bettingEndsAt = Date.now() + BETTING_WINDOW_MS;

    const round = await prisma.gameRound.create({
      data: {
        gameId: game.id,
        roundNumber: this.roundNumber,
        status: RoundStatus.OPEN,
        serverSeed: this.seed.serverSeed,
        serverSeedHash: this.seed.serverSeedHash,
        clientSeed: this.seed.clientSeed,
        nonce: this.seed.nonce,
        crashPoint: this.crashPoint,
      },
    });
    this.roundId = round.id;
    this.startedAt = new Date();

    this.emit({ type: "round:started", round: this.currentView() });

    setTimeout(() => void this.startRunning(), BETTING_WINDOW_MS);
    this.tickTimer = setInterval(() => this.tick(), TICK_INTERVAL_MS);
  }

  private async startRunning(): Promise<void> {
    if (this.status !== RoundStatus.OPEN) return;
    this.status = RoundStatus.ACTIVE;
    this.crashAtMs = Date.now();

    await prisma.gameRound.update({
      where: { id: this.roundId },
      data: { status: RoundStatus.ACTIVE, startedAt: new Date() },
    });

    const crashMs = timeToReach(Number(this.crashPoint));
    setTimeout(() => void this.bust(), crashMs);
  }

  private tick(): void {
    if (this.status === RoundStatus.OPEN) {
      this.emit({
        type: "round:tick",
        roundId: this.roundId,
        multiplier: "1.0000",
        remainingMs: Math.max(0, this.bettingEndsAt - Date.now()),
      });
      return;
    }
    if (this.status === RoundStatus.ACTIVE) {
      const multiplier = multiplierAt(Date.now() - this.crashAtMs);
      if (multiplier >= Number(this.crashPoint)) return; // bust timer handles the end
      this.emit({ type: "round:tick", roundId: this.roundId, multiplier: multiplier.toFixed(4), remainingMs: 0 });
      // Auto-cashout for players who set a target.
      for (const bet of this.bets.values()) {
        if (bet.cashedOutAt) continue;
        const auto = this.autoCashouts.get(bet.betId);
        if (auto !== undefined && multiplier >= auto) {
          void this.cashOut(bet.betId, auto).catch((error) => console.error("[crash] otomatik cashout hatasi", error));
        }
      }
    }
  }

  private autoCashouts = new Map<string, number>();

  private async bust(): Promise<void> {
    if (this.status !== RoundStatus.ACTIVE) return;
    this.status = RoundStatus.SETTLED;
    clearInterval(this.tickTimer);

    const crashPoint = this.crashPoint;

    this.emit({
      type: "round:crashed",
      roundId: this.roundId,
      crashPoint,
      serverSeed: this.seed.serverSeed,
      serverSeedHash: this.seed.serverSeedHash,
      clientSeed: this.seed.clientSeed,
      nonce: this.seed.nonce,
    });

    // Losing bets are persisted here; winners were already settled at cashout.
    let totalWagered = 0n;
    let totalPayout = 0n;

    for (const bet of this.bets.values()) {
      totalWagered += bet.amountMinor;
      if (bet.payout) totalPayout += BigInt(Math.round(Number(bet.payout) * 100));
      if (bet.cashedOutAt) continue;

      await prisma.bet
        .update({
          where: { id: bet.betId },
          data: { status: BetStatus.LOST, settledAt: new Date(), multiplier: "0", payout: 0n, profit: -bet.amountMinor },
        })
        .catch((error) => console.error("[crash] kayip bahis guncellenemedi", error));
    }

    await prisma.gameRound.update({
      where: { id: this.roundId },
      data: {
        status: RoundStatus.SETTLED,
        settledAt: new Date(),
        totalBets: this.bets.size,
        totalWagered,
        totalPayout,
        result: { crashPoint } as never,
      },
    });

    this.history.push({ roundNumber: this.roundNumber, crashPoint });
    if (this.history.length > HISTORY_SIZE) this.history.shift();

    this.emit({ type: "round:settled", roundId: this.roundId, roundNumber: this.roundNumber, crashPoint });

    setTimeout(() => void this.openRound(), SETTLE_DELAY_MS);
  }

  /** Debit the stake and register the bet for this round. */
  async placeBet(params: {
    userId: string;
    username: string;
    amount: bigint;
    currency: string;
    autoCashout?: number;
    idempotencyKey?: string;
    isDemo?: boolean;
  }): Promise<CrashBetView> {
    if (this.status !== RoundStatus.OPEN) {
      throw new Error("Bahis penceresi kapandi, sonraki turu bekleyin");
    }

    const walletType = params.isDemo ? WalletType.DEMO : WalletType.REAL;

    const posted = await ledger.post({
      userId: params.userId,
      type: TxType.BET,
      amount: params.amount,
      currency: params.currency,
      walletType,
      legs: [
        {
          accountType: params.isDemo ? LedgerAccountType.PLAYER_DEMO : LedgerAccountType.PLAYER_REAL,
          direction: LedgerDirection.DEBIT,
          amount: params.amount,
        },
        { accountType: LedgerAccountType.HOUSE, direction: LedgerDirection.CREDIT, amount: params.amount },
      ],
      idempotencyKey: params.idempotencyKey,
      description: "Crash bahsi",
      metadata: { roundId: this.roundId, roundNumber: this.roundNumber },
    });

    const game = await prisma.game.findUnique({ where: { slug: this.gameSlug }, select: { id: true } });
    if (!game) throw new Error("Oyun bulunamadi");

    const betRecord = await prisma.bet.create({
      data: {
        reference: `CRS-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        userId: params.userId,
        gameId: game.id,
        roundId: this.roundId,
        status: BetStatus.ACTIVE,
        stake: params.amount,
        currency: params.currency,
        walletType,
        serverSeedHash: this.seed.serverSeedHash,
        clientSeed: this.seed.clientSeed,
        nonce: this.seed.nonce,
        isDemo: Boolean(params.isDemo),
        params: { autoCashout: params.autoCashout ?? 0 } as never,
        idempotencyKey: params.idempotencyKey,
      },
    });

    const view: CrashBetView & { userId: string; amountMinor: bigint; currency: string; walletType: WalletType } = {
      betId: betRecord.id,
      userId: params.userId,
      username: params.username,
      amount: fromMinor(params.amount, params.currency as never),
      cashedOutAt: null,
      payout: null,
      amountMinor: params.amount,
      currency: params.currency,
      walletType,
    };
    this.bets.set(betRecord.id, view);
    if (params.autoCashout && params.autoCashout > 1) this.autoCashouts.set(betRecord.id, params.autoCashout);

    this.emit({
      type: "bet:placed",
      roundId: this.roundId,
      bet: { betId: view.betId, userId: view.userId, username: view.username, amount: view.amount, cashedOutAt: null, payout: null },
    });

    // Balance change must reach the player immediately.
    void posted;
    return view;
  }

  /** Cash out at the given (or current) multiplier. */
  async cashOut(betId: string, atMultiplier?: number): Promise<{ multiplier: string; payout: string }> {
    const bet = this.bets.get(betId);
    if (!bet) throw new Error("Bahis bulunamadi");
    if (bet.cashedOutAt) throw new Error("Zaten cekildi");
    if (this.status !== RoundStatus.ACTIVE) throw new Error("Tur aktif degil");

    const current = multiplierAt(Date.now() - this.crashAtMs);
    const target = atMultiplier ?? current;
    if (target >= Number(this.crashPoint)) throw new Error("Tur patladi");
    const multiplier = Math.min(target, current);

    const payout = applyMultiplier(bet.amountMinor, multiplier, bet.currency as never);

    await ledger.post({
      userId: bet.userId,
      type: TxType.WIN,
      amount: payout,
      currency: bet.currency,
      walletType: bet.walletType,
      legs: [
        {
          accountType: bet.walletType === WalletType.DEMO ? LedgerAccountType.PLAYER_DEMO : LedgerAccountType.PLAYER_REAL,
          direction: LedgerDirection.CREDIT,
          amount: payout,
        },
        { accountType: LedgerAccountType.HOUSE, direction: LedgerDirection.DEBIT, amount: payout },
      ],
      relatedBetId: bet.betId,
      idempotencyKey: `crash-cashout:${bet.betId}`,
      description: `Crash kazanci x${multiplier.toFixed(4)}`,
      metadata: { roundId: this.roundId, multiplier },
    });

    await prisma.bet.update({
      where: { id: bet.betId },
      data: {
        status: BetStatus.CASHED_OUT,
        multiplier: multiplier.toFixed(6),
        payout,
        profit: payout - bet.amountMinor,
        settledAt: new Date(),
        serverSeed: this.seed.serverSeed,
        result: { cashoutMultiplier: multiplier, crashPoint: this.crashPoint } as never,
      },
    });

    const view = this.bets.get(betId)!;
    view.cashedOutAt = multiplier.toFixed(4);
    view.payout = fromMinor(payout, bet.currency as never);
    this.autoCashouts.delete(betId);

    this.emit({
      type: "bet:cashed",
      roundId: this.roundId,
      betId,
      userId: bet.userId,
      multiplier: multiplier.toFixed(4),
      payout: view.payout,
    });

    return { multiplier: multiplier.toFixed(4), payout: view.payout };
  }

  stop(): void {
    clearInterval(this.tickTimer);
  }
}

/** Inverse of multiplierAt: ms needed for the multiplier to reach `target`. */
function timeToReach(target: number): number {
  if (target <= 1) return 0;
  return Math.log(target) / 0.0000693;
}

export const crashEngine = new CrashEngine();
