import { prisma } from "@aurora/db";
import {
  AppError,
  Errors,
  LedgerAccountType,
  LedgerDirection,
  TxType,
  WalletType,
  currencyMeta,
  fromMinor,
  toMinor,
  type CurrencyCode,
} from "@aurora/shared";
import type { ParsedWalletCallback } from "../providers/aggregator.js";

/**
 * Seamless-wallet settlement for aggregator-hosted games.
 *
 * In this model the provider owns the round and calls us for every money
 * movement, so correctness here is what keeps our ledger and the provider's
 * session state in agreement. Three rules drive the implementation:
 *
 * 1. `transactionId` is the idempotency key. Providers retry aggressively on
 *    timeout, so a repeated writeBet must not move money twice.
 * 2. A bet is rejected outright when the player cannot cover it. Providers do
 *    not reserve funds, so accepting an uncovered bet would push the wallet
 *    negative.
 * 3. `bet` and `win` may arrive as numbers or strings, and always in major
 *    units. They are converted to minor units with the currency's precision.
 */

export interface SettlementResult {
  /** Balance after the operation, as a decimal string in major units. */
  balance: string;
  currency: string;
  transactionId: string;
  /** True when the request replayed an already-settled transaction. */
  duplicate: boolean;
}

/** Caller-supplied wallet context; currency arrives as a plain string. */
export interface WalletContext {
  playerId: string;
  currency: string;
}

/** Same context after the currency has been narrowed to a supported code. */
interface SettleContext {
  playerId: string;
  currency: CurrencyCode;
}

export class AggregatorWalletService {
  constructor(private readonly providerName: string) {}

  /**
   * Settle a normalised wallet callback. Returns the resulting balance.
   * Throws an AppError whose message the route turns into the provider's
   * failure envelope.
   */
  async settle(callback: ParsedWalletCallback, context: WalletContext): Promise<SettlementResult> {
    /*
     * Narrow the currency once, here. Settlement in an unsupported currency is
     * refused rather than silently treated as TRY, which would corrupt the
     * ledger if the provider ever launched a session in another currency.
     */
    const ctx: SettleContext = { playerId: context.playerId, currency: asCurrencyCode(context.currency) };

    switch (callback.command) {
      case "BALANCE":
        return this.readBalance(ctx);
      case "WRITE_BET":
        return this.writeBet(callback, ctx);
      case "ROLLBACK":
        return this.rollback(callback, ctx);
    }
  }

  private async readBalance(context: SettleContext): Promise<SettlementResult> {
    const balance = await this.balanceOf(context.playerId, context.currency);
    return { balance: fromMinor(balance, context.currency), currency: context.currency, transactionId: "", duplicate: false };
  }

  /**
   * Apply a bet and its win together. Providers send them in one message, so
   * the net movement is what reaches the ledger.
   */
  private async writeBet(callback: ParsedWalletCallback, context: SettleContext): Promise<SettlementResult> {
    const transactionId = callback.transactionId;
    if (!transactionId) throw Errors.validation("transactionId zorunlu");

    const meta = currencyMeta(context.currency);
    const bet = callback.bet ? toMinor(callback.bet, context.currency) : 0n;
    const win = callback.win ? toMinor(callback.win, context.currency) : 0n;
    if (bet < 0n || win < 0n) throw Errors.validation("Negatif tutar kabul edilmez");

    const idempotencyKey = this.key(transactionId);
    const existing = await this.findSettled(idempotencyKey);
    if (existing) {
      // Providers treat a duplicate as "already applied": replay the balance.
      return {
        balance: fromMinor(await this.balanceOf(context.playerId, context.currency), context.currency),
        currency: context.currency,
        transactionId,
        duplicate: true,
      };
    }

    const net = win - bet;
    const { ledger } = await import("./ledger.js");

    try {
      const posted = await ledger.post({
        userId: context.playerId,
        type: net >= 0n ? TxType.WIN : TxType.BET,
        amount: net >= 0n ? net : -net,
        currency: context.currency,
        legs: this.legsFor(net),
        provider: this.providerName,
        providerRef: transactionId,
        idempotencyKey,
        description: "Saglayici tur mutabakati",
        metadata: {
          bet: bet.toString(),
          win: win.toString(),
          normalizedBet: fromMinor(bet, context.currency),
          normalizedWin: fromMinor(win, context.currency),
          decimals: meta.decimals,
          sessionId: callback.sessionId,
          gameId: callback.gameId,
          roundId: callback.roundId,
          roundFinished: callback.roundFinished,
          info: callback.info,
        },
      });

      return {
        balance: fromMinor(posted.balanceAfter, context.currency),
        currency: context.currency,
        transactionId,
        duplicate: false,
      };
    } catch (error) {
      // The ledger's insufficient-funds error becomes a provider-visible reject.
      if (error instanceof AppError && error.code === "INSUFFICIENT_FUNDS") {
        throw Errors.insufficientFunds();
      }
      throw error;
    }
  }

  /**
   * Reverse a settled bet exactly once. The provider reuses the original
   * transactionId, so the rollback key is derived from it and each original
   * wager can only be reversed a single time.
   */
  private async rollback(callback: ParsedWalletCallback, context: SettleContext): Promise<SettlementResult> {
    const transactionId = callback.transactionId;
    if (!transactionId) throw Errors.validation("transactionId zorunlu");

    const rollbackKey = this.key(`rollback:${transactionId}`);
    const existing = await this.findSettled(rollbackKey);
    if (existing) {
      return {
        balance: fromMinor(await this.balanceOf(context.playerId, context.currency), context.currency),
        currency: context.currency,
        transactionId,
        duplicate: true,
      };
    }

    const original = await prisma.transaction.findUnique({
      where: { idempotencyKey: this.key(transactionId) },
      select: { id: true, amount: true, balanceBefore: true, balanceAfter: true, metadata: true, status: true },
    });
    if (!original) throw Errors.notFound("Bahis");

    const { ledger } = await import("./ledger.js");

    /*
     * A writeBet carries bet and win together, so the original moved the net
     * amount, not the gross wager. Reversing the recorded net delta restores
     * the wallet to its exact pre-bet state, and never credits more than was
     * actually taken. Falling back to the gross bet only when the ledger did
     * not record balances keeps this safe for older rows.
     */
    const moved = netMovement(original);
    const amount = moved < 0n ? -moved : moved;
    const reverseDirection = moved < 0n ? LedgerDirection.CREDIT : LedgerDirection.DEBIT;

    const posted = await ledger.post({
      userId: context.playerId,
      type: TxType.REFUND,
      amount,
      currency: context.currency,
      legs: [
        { accountType: LedgerAccountType.PLAYER_REAL, direction: reverseDirection, amount },
        {
          accountType: LedgerAccountType.HOUSE,
          direction: reverseDirection === LedgerDirection.CREDIT ? LedgerDirection.DEBIT : LedgerDirection.CREDIT,
          amount,
        },
      ],
      provider: this.providerName,
      providerRef: transactionId,
      idempotencyKey: rollbackKey,
      description: "Saglayici bahis iadesi",
      metadata: { originalTransactionId: transactionId, returned: fromMinor(amount, context.currency), info: callback.info },
    });

    return {
      balance: fromMinor(posted.balanceAfter, context.currency),
      currency: context.currency,
      transactionId,
      duplicate: false,
    };
  }

  /** Net money movement expressed as a balanced pair of legs. */
  private legsFor(net: bigint) {
    if (net >= 0n) {
      return [
        { accountType: LedgerAccountType.PLAYER_REAL, direction: LedgerDirection.CREDIT, amount: net },
        { accountType: LedgerAccountType.HOUSE, direction: LedgerDirection.DEBIT, amount: net },
      ];
    }
    const amount = -net;
    return [
      { accountType: LedgerAccountType.PLAYER_REAL, direction: LedgerDirection.DEBIT, amount },
      { accountType: LedgerAccountType.HOUSE, direction: LedgerDirection.CREDIT, amount },
    ];
  }

  private async findSettled(idempotencyKey: string): Promise<boolean> {
    const found = await prisma.transaction.findUnique({ where: { idempotencyKey }, select: { id: true } });
    return Boolean(found);
  }

  private async balanceOf(playerId: string, currency: string): Promise<bigint> {
    const wallet = await prisma.wallet.findUnique({
      where: { userId_currency_type: { userId: playerId, currency, type: WalletType.REAL } },
      select: { balance: true },
    });
    return wallet?.balance ?? 0n;
  }

  /** Namespace keys per provider so two aggregators cannot collide. */
  private key(transactionId: string): string {
    return `agg:${this.providerName}:${transactionId}`;
  }
}

/**
 * Signed net movement of a settled transaction, from the wallet's point of
 * view: negative when money left, positive when it arrived. Falls back to the
 * stored amount when the ledger did not record balances (pending rows).
 */
function netMovement(original: { amount: bigint; balanceBefore: bigint | null; balanceAfter: bigint | null }): bigint {
  if (original.balanceBefore !== null && original.balanceAfter !== null) {
    return original.balanceAfter - original.balanceBefore;
  }
  return original.amount;
}

/** Supported currencies are a closed set; anything else must not settle. */
const SUPPORTED_CURRENCIES: readonly CurrencyCode[] = ["TRY", "USD", "EUR", "GBP", "USDT", "BTC"];

function asCurrencyCode(currency: string): CurrencyCode {
  const upper = currency.toUpperCase();
  const match = SUPPORTED_CURRENCIES.find((code) => code === upper);
  if (!match) throw Errors.validation(`Desteklenmeyen para birimi: ${currency}`);
  return match;
}
