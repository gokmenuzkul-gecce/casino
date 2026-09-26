import { prisma, Prisma } from "@aurora/db";
import {
  AppError,
  Errors,
  LedgerAccountType,
  LedgerDirection,
  TxStatus,
  TxType,
  WalletType,
  currencyMeta,
  fromMinor,
  toMinor,
} from "@aurora/shared";
import { nanoid } from "nanoid";

export interface LedgerLeg {
  accountType: LedgerAccountType;
  direction: LedgerDirection;
  amount: bigint;
  walletId?: string;
}

export interface PostTransactionInput {
  userId: string;
  type: TxType;
  amount: bigint;
  currency: string;
  walletType?: WalletType;
  legs: LedgerLeg[];
  method?: string;
  provider?: string;
  providerRef?: string;
  providerPayload?: Record<string, unknown>;
  idempotencyKey?: string;
  relatedBetId?: string;
  relatedBonusId?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  status?: TxStatus;
  ip?: string;
  /** Set false for pending flows where money has not moved yet. */
  applyBalance?: boolean;
}

export interface PostedTransaction {
  id: string;
  reference: string;
  status: string;
  balanceBefore: bigint;
  balanceAfter: bigint;
}

/**
 * Money movement is expressed as a balanced set of ledger legs. Every posted
 * transaction must have debits equal to credits in minor units, and the player
 * wallet balance is updated inside the same database transaction so the ledger
 * and the balance can never disagree.
 *
 * Concurrency: the wallet row is locked with SELECT ... FOR UPDATE before the
 * balance is read, so parallel bets on the same wallet serialise instead of
 * double-spending. The `version` column increments on every write for
 * optimistic auditing.
 */
export class LedgerService {
  static reference(prefix: string): string {
    return `${prefix}-${Date.now().toString(36).toUpperCase()}-${nanoid(8).toUpperCase()}`;
  }

  /** Ensure the three wallets a player can hold in a currency exist. */
  async ensureWallets(userId: string, currency: string): Promise<void> {
    const types = [WalletType.REAL, WalletType.BONUS, WalletType.DEMO];
    await prisma.$transaction(
      types.map((type) =>
        prisma.wallet.upsert({
          where: { userId_currency_type: { userId, currency, type } },
          create: { userId, currency, type, isPrimary: type === WalletType.REAL },
          update: {},
        }),
      ),
    );
  }

  async getWallets(userId: string, currency: string) {
    const wallets = await prisma.wallet.findMany({ where: { userId, currency } });
    if (wallets.length === 0) {
      await this.ensureWallets(userId, currency);
      return prisma.wallet.findMany({ where: { userId, currency } });
    }
    return wallets;
  }

  async getBalance(userId: string, currency: string, type: WalletType = WalletType.REAL): Promise<bigint> {
    const wallet = await prisma.wallet.findUnique({
      where: { userId_currency_type: { userId, currency, type } },
      select: { balance: true },
    });
    return wallet?.balance ?? 0n;
  }

  /**
   * Post a balanced transaction. Returns the player's balance before and after
   * for the wallet that was credited/debited.
   */
  async post(input: PostTransactionInput): Promise<PostedTransaction> {
    this.assertBalanced(input.legs, input.currency);

    if (input.idempotencyKey) {
      const existing = await prisma.transaction.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true, reference: true, status: true, balanceBefore: true, balanceAfter: true },
      });
      if (existing) {
        return {
          id: existing.id,
          reference: existing.reference,
          status: existing.status,
          balanceBefore: existing.balanceBefore ?? 0n,
          balanceAfter: existing.balanceAfter ?? 0n,
        };
      }
    }

    const walletType = input.walletType ?? WalletType.REAL;
    const applyBalance = input.applyBalance ?? true;
    const playerLeg = input.legs.find((leg) => leg.accountType.startsWith("PLAYER_"));

    return prisma.$transaction(async (tx) => {
      let balanceBefore = 0n;
      let balanceAfter = 0n;
      let walletId = playerLeg?.walletId;

      if (applyBalance && playerLeg) {
        const wallet = await tx.wallet.findUnique({
          where: { userId_currency_type: { userId: input.userId, currency: input.currency, type: walletType } },
        });
        if (!wallet) throw Errors.notFound("Cuzdan");
        walletId = wallet.id;

        // Row lock: serialises concurrent writers on the same wallet.
        const [locked] = await tx.$queryRaw<{ balance: bigint; locked: bigint; version: number }[]>`
          SELECT balance, locked, version FROM wallets WHERE id = ${wallet.id} FOR UPDATE
        `;
        if (!locked) throw Errors.notFound("Cuzdan");

        balanceBefore = locked.balance;

        const delta =
          playerLeg.direction === LedgerDirection.CREDIT ? playerLeg.amount : -playerLeg.amount;

        if (delta < 0n) {
          const available = locked.balance - locked.locked;
          if (available < -delta) {
            throw Errors.insufficientFunds();
          }
        }

        balanceAfter = locked.balance + delta;

        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: balanceAfter, version: { increment: 1 } },
        });
      }

      const transaction = await tx.transaction.create({
        data: {
          reference: LedgerService.reference(prefixFor(input.type)),
          userId: input.userId,
          type: input.type,
          status: input.status ?? TxStatus.COMPLETED,
          amount: input.amount,
          currency: input.currency,
          balanceBefore: applyBalance && playerLeg ? balanceBefore : null,
          balanceAfter: applyBalance && playerLeg ? balanceAfter : null,
          walletType,
          method: input.method,
          provider: input.provider,
          providerRef: input.providerRef,
          providerPayload: toJson(input.providerPayload),
          idempotencyKey: input.idempotencyKey,
          relatedBetId: input.relatedBetId,
          relatedBonusId: input.relatedBonusId,
          description: input.description,
          metadata: toJson(input.metadata),
          ip: input.ip,
          completedAt: (input.status ?? TxStatus.COMPLETED) === TxStatus.COMPLETED ? new Date() : null,
        },
      });

      for (const leg of input.legs) {
        await tx.ledgerEntry.create({
          data: {
            transactionId: transaction.id,
            walletId: leg.accountType.startsWith("PLAYER_") ? (leg.walletId ?? walletId) : null,
            accountType: leg.accountType,
            direction: leg.direction,
            amount: leg.amount,
            balanceAfter: leg.accountType.startsWith("PLAYER_") ? balanceAfter : null,
            currency: input.currency,
          },
        });
      }

      return {
        id: transaction.id,
        reference: transaction.reference,
        status: transaction.status,
        balanceBefore,
        balanceAfter,
      };
    });
  }

  /** Freeze funds for a pending withdrawal without removing them from balance. */
  async lockFunds(userId: string, currency: string, amount: bigint, type: WalletType = WalletType.REAL): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({
        where: { userId_currency_type: { userId, currency, type } },
      });
      if (!wallet) throw Errors.notFound("Cuzdan");
      const [locked] = await tx.$queryRaw<{ balance: bigint; locked: bigint }[]>`
        SELECT balance, locked FROM wallets WHERE id = ${wallet.id} FOR UPDATE
      `;
      if (!locked) throw Errors.notFound("Cuzdan");
      if (locked.balance - locked.locked < amount) throw Errors.insufficientFunds();
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { locked: locked.locked + amount, version: { increment: 1 } },
      });
    });
  }

  async unlockFunds(userId: string, currency: string, amount: bigint, type: WalletType = WalletType.REAL): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({
        where: { userId_currency_type: { userId, currency, type } },
      });
      if (!wallet) throw Errors.notFound("Cuzdan");
      const [locked] = await tx.$queryRaw<{ locked: bigint }[]>`
        SELECT locked FROM wallets WHERE id = ${wallet.id} FOR UPDATE
      `;
      const current = locked?.locked ?? 0n;
      const next = current - amount < 0n ? 0n : current - amount;
      await tx.wallet.update({ where: { id: wallet.id }, data: { locked: next, version: { increment: 1 } } });
    });
  }

  /** Player-visible balance summary. */
  async summary(userId: string, currency: string) {
    const wallets = await this.getWallets(userId, currency);
    const find = (type: WalletType) => wallets.find((w) => w.type === type);
    const real = find(WalletType.REAL);
    const bonus = find(WalletType.BONUS);
    const demo = find(WalletType.DEMO);
    return {
      currency,
      real: fromMinor(real?.balance ?? 0n, currency as never),
      bonus: fromMinor(bonus?.balance ?? 0n, currency as never),
      demo: fromMinor(demo?.balance ?? 0n, currency as never),
      locked: fromMinor(real?.locked ?? 0n, currency as never),
      available: fromMinor((real?.balance ?? 0n) - (real?.locked ?? 0n), currency as never),
    };
  }

  /** Credit the house side of a bet (stake in, payout out). */
  async settleBet(params: {
    userId: string;
    currency: string;
    stake: bigint;
    payout: bigint;
    betId: string;
    walletType?: WalletType;
    isDemo?: boolean;
    idempotencyKey?: string;
  }): Promise<{ profit: bigint; balanceAfter: bigint }> {
    const walletType = params.walletType ?? WalletType.REAL;
    const playerAccount = params.isDemo
      ? LedgerAccountType.PLAYER_DEMO
      : walletType === WalletType.BONUS
        ? LedgerAccountType.PLAYER_BONUS
        : LedgerAccountType.PLAYER_REAL;

    // Net movement in one transaction: stake leaves, payout returns.
    const net = params.payout - params.stake;
    const legs: LedgerLeg[] = [];
    if (net >= 0n) {
      legs.push({ accountType: playerAccount, direction: LedgerDirection.CREDIT, amount: net });
      legs.push({ accountType: LedgerAccountType.HOUSE, direction: LedgerDirection.DEBIT, amount: net });
    } else {
      legs.push({ accountType: playerAccount, direction: LedgerDirection.DEBIT, amount: -net });
      legs.push({ accountType: LedgerAccountType.HOUSE, direction: LedgerDirection.CREDIT, amount: -net });
    }

    const posted = await this.post({
      userId: params.userId,
      type: params.payout > 0n ? TxType.WIN : TxType.BET,
      amount: net < 0n ? -net : net,
      currency: params.currency,
      walletType,
      legs,
      relatedBetId: params.betId,
      idempotencyKey: params.idempotencyKey,
      description: params.payout > 0n ? "Bahis kazanci" : "Bahis",
    });

    return { profit: net, balanceAfter: posted.balanceAfter };
  }

  private assertBalanced(legs: LedgerLeg[], currency: string): void {
    if (legs.length === 0) throw Errors.internal("Ledger bacagi bos olamaz");
    let debit = 0n;
    let credit = 0n;
    for (const leg of legs) {
      if (leg.amount <= 0n) throw Errors.internal("Ledger tutari pozitif olmali");
      if (leg.direction === LedgerDirection.DEBIT) debit += leg.amount;
      else credit += leg.amount;
    }
    if (debit !== credit) {
      throw Errors.internal(
        `Dengesiz ledger: borc=${fromMinor(debit, currency as never)} alacak=${fromMinor(credit, currency as never)}`,
      );
    }
  }

  /** Recompute a wallet balance from the ledger; used by reconciliation jobs. */
  async reconcile(userId: string, currency: string, type: WalletType = WalletType.REAL) {
    const wallet = await prisma.wallet.findUnique({
      where: { userId_currency_type: { userId, currency, type } },
    });
    if (!wallet) throw Errors.notFound("Cuzdan");

    const entries = await prisma.ledgerEntry.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: "asc" },
    });

    let computed = 0n;
    for (const entry of entries) {
      computed += entry.direction === LedgerDirection.CREDIT ? entry.amount : -entry.amount;
    }

    return {
      walletId: wallet.id,
      stored: wallet.balance,
      computed,
      matches: computed === wallet.balance,
      entryCount: entries.length,
    };
  }
}

function prefixFor(type: TxType): string {
  const map: Record<string, string> = {
    [TxType.DEPOSIT]: "DEP",
    [TxType.WITHDRAWAL]: "WDR",
    [TxType.BET]: "BET",
    [TxType.WIN]: "WIN",
    [TxType.REFUND]: "REF",
    [TxType.BONUS_CREDIT]: "BNS",
    [TxType.BONUS_WAGER]: "BWG",
    [TxType.BONUS_FORFEIT]: "BFT",
    [TxType.ADJUSTMENT]: "ADJ",
    [TxType.CASHBACK]: "CBK",
    [TxType.RAKEBACK]: "RBK",
    [TxType.JACKPOT]: "JPW",
    [TxType.FEE]: "FEE",
    [TxType.TIP]: "TIP",
    [TxType.TOURNAMENT_PRIZE]: "TNP",
  };
  return map[type] ?? "TX";
}

function toJson(value: Record<string, unknown> | undefined): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : (value as Prisma.InputJsonValue);
}

export const ledger = new LedgerService();

/** Parse a client amount string into minor units, surfacing a clean error. */
export function parseAmount(value: string, currency: string): bigint {
  try {
    const meta = currencyMeta(currency);
    const amount = toMinor(value, meta.code);
    if (amount <= 0n) throw Errors.validation("Tutar pozitif olmali");
    return amount;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw Errors.validation("Gecersiz tutar");
  }
}
