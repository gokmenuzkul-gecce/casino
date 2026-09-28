import { prisma } from "@aurora/db";
import {
  AuditAction,
  Errors,
  LedgerAccountType,
  LedgerDirection,
  PaymentMethod,
  TxStatus,
  TxType,
  WalletType,
  applyMultiplier,
  fromMinor,
  percentOf,
} from "@aurora/shared";
import { env } from "../lib/env.js";
import { ledger, parseAmount } from "./ledger.js";
import { audit } from "./audit.js";
import { bonusService } from "./bonuses.js";
import type { ProviderRegistry } from "../providers/index.js";
import { parseAmount as parse } from "./ledger.js";

export interface DepositInput {
  userId: string;
  amount: string;
  currency: string;
  method: string;
  bonusCode?: string;
  ip?: string;
  userAgent?: string;
}

export interface WithdrawalInput {
  userId: string;
  amount: string;
  currency: string;
  method: string;
  iban?: string;
  walletAddress?: string;
  ip?: string;
  userAgent?: string;
}

/**
 * Payment orchestration. The flow is identical in demo and live mode; only the
 * adapter behind the registry changes. Deposits credit the player through the
 * ledger, withdrawals lock funds first and only release them on settlement,
 * which keeps the balance honest while a payout is in flight.
 */
export class PaymentService {
  constructor(private readonly providers: ProviderRegistry) {}

  async methodConfigs(currency: string) {
    const rows = await prisma.paymentMethodConfig.findMany({
      where: { enabled: true, currencies: { has: currency } },
      orderBy: { sortOrder: "asc" },
    });
    return rows.map((row) => ({
      method: row.method,
      displayName: row.displayName,
      iconUrl: row.iconUrl,
      minAmount: fromMinor(row.minAmount, currency as never),
      maxAmount: fromMinor(row.maxAmount, currency as never),
      feePercent: row.feePercent.toString(),
      feeFixed: fromMinor(row.feeFixed, currency as never),
      maintenanceMode: row.maintenanceMode,
      instructions: row.instructions,
    }));
  }

  async deposit(input: DepositInput) {
    const amount = parseAmount(input.amount, input.currency);
    const config = await prisma.paymentMethodConfig.findUnique({ where: { method: input.method } });
    if (!config || !config.enabled) throw Errors.validation("Bu odeme yontemi aktif degil");
    if (config.maintenanceMode) throw Errors.validation("Bu odeme yontemi bakimda");
    if (amount < config.minAmount) throw Errors.validation(`Minimum yatirim ${fromMinor(config.minAmount, input.currency as never)}`);
    if (config.maxAmount > 0n && amount > config.maxAmount) {
      throw Errors.validation(`Maksimum yatirim ${fromMinor(config.maxAmount, input.currency as never)}`);
    }

    await this.assertDepositLimits(input.userId, amount, input.currency);

    const reference = ledgerReference("DEP");
    const fee = computeFee(amount, config.feePercent.toString(), config.feeFixed);
    const net = amount - fee;

    const intent = await prisma.paymentIntent.create({
      data: {
        reference,
        userId: input.userId,
        direction: "DEPOSIT",
        method: input.method,
        provider: this.providers.psp.name,
        amount,
        fee,
        currency: input.currency,
        status: "PENDING",
        bonusCode: input.bonusCode,
        ip: input.ip,
        userAgent: input.userAgent,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    // CRYPTO runs on its own adapter: the flow is a hosted payment page rather
    // than a card-form deposit, and only it can be settled by the crypto
    // webhook. Everything else stays on the PSP.
    const useCrypto = input.method === "CRYPTO" && this.providers.crypto.isConfigured;

    let providerResult;
    let redirectUrl: string | undefined;
    let instructions: string | undefined;
    try {
      if (useCrypto) {
        const invoice = await this.providers.crypto.createInvoice({
          reference,
          amount: fromMinor(amount, input.currency as never),
          currency: input.currency,
          callbackUrl: `${env.apiPublicUrl}/webhooks/crypto`,
          returnUrl: `${env.appUrl}/wallet?ref=${reference}`,
        });
        providerResult = { providerRef: invoice.providerRef, status: invoice.status, raw: invoice };
        redirectUrl = invoice.url;
        instructions = invoice.address
          ? `Gonderilecek adres: ${invoice.address}${invoice.amount ? ` (${invoice.amount} ${invoice.currency ?? ""})` : ""}`
          : undefined;
      } else {
        const deposit = await this.providers.psp.createDeposit({
          reference,
          amount: fromMinor(amount, input.currency as never),
          currency: input.currency,
          method: input.method,
          playerId: input.userId,
          returnUrl: `${env.appUrl}/wallet?ref=${reference}`,
          callbackUrl: `${env.apiPublicUrl}/webhooks/psp`,
          ip: input.ip,
          userAgent: input.userAgent,
        });
        providerResult = { providerRef: deposit.providerRef, status: deposit.status, raw: deposit };
        redirectUrl = deposit.redirectUrl;
        instructions = deposit.instructions;
      }
    } catch (error) {
      await prisma.paymentIntent.update({
        where: { id: intent.id },
        data: {
          status: "FAILED",
          failureReason: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }

    await prisma.paymentIntent.update({
      where: { id: intent.id },
      data: {
        providerRef: providerResult.providerRef,
        providerPayload: (providerResult.raw ?? {}) as never,
        status: providerResult.status === "COMPLETED" ? "COMPLETED" : "PENDING",
      },
    });

    // In demo mode the provider settles immediately, so credit right away.
    if (providerResult.status === "COMPLETED") {
      await this.creditDeposit(intent.id);
    }

    const updated = await prisma.paymentIntent.findUnique({ where: { id: intent.id } });
    return {
      reference,
      status: updated?.status ?? "PENDING",
      amount: fromMinor(amount, input.currency as never),
      fee: fromMinor(fee, input.currency as never),
      net: fromMinor(net, input.currency as never),
      currency: input.currency,
      redirectUrl,
      instructions,
      mode: useCrypto ? this.providers.crypto.mode : this.providers.psp.mode,
    };
  }

  /** Credit a settled deposit exactly once. */
  async creditDeposit(paymentIntentId: string) {
    const intent = await prisma.paymentIntent.findUnique({ where: { id: paymentIntentId } });
    if (!intent) throw Errors.notFound("Odeme");
    if (intent.direction !== "DEPOSIT") throw Errors.validation("Yanlis odeme yonu");

    const already = await prisma.transaction.findUnique({
      where: { idempotencyKey: `deposit:${intent.reference}` },
    });
    if (already) return { credited: false, reference: intent.reference };

    const net = intent.amount - intent.fee;

    const posted = await ledger.post({
      userId: intent.userId,
      type: TxType.DEPOSIT,
      amount: net,
      currency: intent.currency,
      walletType: WalletType.REAL,
      legs: [
        { accountType: LedgerAccountType.PLAYER_REAL, direction: LedgerDirection.CREDIT, amount: net },
        { accountType: LedgerAccountType.PSP_CLEARING, direction: LedgerDirection.DEBIT, amount: net },
      ],
      method: intent.method,
      provider: intent.provider ?? undefined,
      providerRef: intent.providerRef ?? undefined,
      idempotencyKey: `deposit:${intent.reference}`,
      description: "Yatirim",
      ip: intent.ip ?? undefined,
      metadata: { paymentIntentId: intent.id },
    });

    await prisma.paymentIntent.update({
      where: { id: intent.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    // Affiliate and VIP side effects run after the money is safely booked.
    await this.onDepositSideEffects(intent.userId, net, intent.currency, intent.id).catch((error) =>
      console.error("[payment] yan etki hatasi", error),
    );

    // Auto-apply a bonus when the player supplied a code or one is flagged.
    const bonusCode = intent.bonusCode;
    if (bonusCode) {
      await bonusService
        .grantByCode({ userId: intent.userId, code: bonusCode, depositAmount: net, currency: intent.currency, triggerTxId: posted.id })
        .catch((error) => console.error("[payment] bonus verilemedi", error));
    } else {
      await bonusService
        .autoApplyDepositBonus({ userId: intent.userId, depositAmount: net, currency: intent.currency, triggerTxId: posted.id })
        .catch((error) => console.error("[payment] otomatik bonus hatasi", error));
    }

    await audit.log({
      actorId: intent.userId,
      action: AuditAction.DEPOSIT_APPROVED,
      entityType: "PaymentIntent",
      entityId: intent.id,
      after: { amount: fromMinor(net, intent.currency as never), currency: intent.currency },
      severity: "INFO",
    });

    return { credited: true, reference: intent.reference, balanceAfter: fromMinor(posted.balanceAfter, intent.currency as never) };
  }

  async withdrawal(input: WithdrawalInput) {
    const amount = parseAmount(input.amount, input.currency);
    const config = await prisma.paymentMethodConfig.findUnique({ where: { method: input.method } });
    if (!config || !config.enabled) throw Errors.validation("Bu odeme yontemi aktif degil");
    if (amount < config.minAmount) throw Errors.validation(`Minimum cekim ${fromMinor(config.minAmount, input.currency as never)}`);

    const user = await prisma.user.findUnique({ where: { id: input.userId }, include: { kyc: true } });
    if (!user) throw Errors.notFound("Kullanici");

    if (env.features.kyc && user.kyc?.status !== "APPROVED") {
      throw Errors.accountBlocked("Cekim icin kimlik dogrulamasi gerekli");
    }

    // Active bonus wagering blocks withdrawal until the requirement is met.
    const activeBonus = await prisma.userBonus.findFirst({
      where: { userId: input.userId, status: "ACTIVE", wageringRemaining: { gt: 0n } },
    });
    if (activeBonus) {
      throw Errors.accountBlocked("Aktif bonusunuzun cevrim sarti tamamlanmadi");
    }

    await this.assertWithdrawalLimits(input.userId, amount, input.currency);

    const reference = ledgerReference("WDR");
    const fee = computeFee(amount, config.feePercent.toString(), config.feeFixed);
    const net = amount - fee;

    // Lock first: the funds stay visible but unusable while the payout is queued.
    await ledger.lockFunds(input.userId, input.currency, amount);

    const intent = await prisma.paymentIntent.create({
      data: {
        reference,
        userId: input.userId,
        direction: "WITHDRAWAL",
        method: input.method,
        provider: this.providers.psp.name,
        amount,
        fee,
        currency: input.currency,
        status: "PENDING",
        iban: input.iban,
        walletAddress: input.walletAddress,
        accountHolder: user.username,
        requiresReview: amount > 100_000n,
        reviewReason: amount > 100_000n ? "Yuksek tutar: manuel onay gerekli" : null,
        ip: input.ip,
        userAgent: input.userAgent,
      },
    });

    await audit.log({
      actorId: input.userId,
      action: "WITHDRAWAL_REQUESTED",
      entityType: "PaymentIntent",
      entityId: intent.id,
      after: { amount: fromMinor(amount, input.currency as never), currency: input.currency },
      ip: input.ip,
    });

    return {
      reference,
      status: intent.status,
      amount: fromMinor(amount, input.currency as never),
      fee: fromMinor(fee, input.currency as never),
      net: fromMinor(net, input.currency as never),
      currency: input.currency,
      requiresReview: intent.requiresReview,
      mode: this.providers.psp.mode,
    };
  }

  /** Operator or automated approval: send the payout and settle the ledger. */
  async approveWithdrawal(paymentIntentId: string, actorId?: string) {
    const intent = await prisma.paymentIntent.findUnique({ where: { id: paymentIntentId } });
    if (!intent) throw Errors.notFound("Odeme");
    if (intent.direction !== "WITHDRAWAL") throw Errors.validation("Yanlis odeme yonu");
    if (intent.status !== "PENDING") throw Errors.validation(`Bu odeme ${intent.status} durumunda`);

    // CRYPTO withdrawals go to the crypto adapter; only it holds the payout key.
    const useCrypto = intent.method === "CRYPTO" && this.providers.crypto.isConfigured;

    const result = useCrypto
      ? await this.providers.crypto.createPayout({
          reference: intent.reference,
          amount: fromMinor(intent.amount, intent.currency as never),
          currency: intent.currency,
          address: intent.walletAddress ?? "",
          callbackUrl: `${env.apiPublicUrl}/webhooks/crypto`,
        })
      : await this.providers.psp.createWithdrawal({
          reference: intent.reference,
          amount: fromMinor(intent.amount, intent.currency as never),
          currency: intent.currency,
          method: intent.method,
          playerId: intent.userId,
          iban: intent.iban ?? undefined,
          walletAddress: intent.walletAddress ?? undefined,
          accountHolder: intent.accountHolder ?? undefined,
          callbackUrl: `${env.apiPublicUrl}/webhooks/psp`,
        });

    if (result.status === "FAILED") {
      await this.failWithdrawal(intent.id, result.providerRef, "Saglayici reddetti");
      throw Errors.providerError(useCrypto ? this.providers.crypto.name : this.providers.psp.name, "Cekim reddedildi");
    }

    await prisma.paymentIntent.update({
      where: { id: intent.id },
      data: {
        status: result.status === "COMPLETED" ? "COMPLETED" : "PROCESSING",
        providerRef: result.providerRef,
        providerPayload: (result.raw ?? {}) as never,
        reviewedById: actorId,
        reviewedAt: new Date(),
        completedAt: result.status === "COMPLETED" ? new Date() : null,
      },
    });

    if (result.status === "COMPLETED") await this.settleWithdrawal(intent.id);

    await audit.log({
      actorId,
      action: AuditAction.WITHDRAWAL_APPROVED,
      entityType: "PaymentIntent",
      entityId: intent.id,
      after: { amount: fromMinor(intent.amount, intent.currency as never), providerRef: result.providerRef },
    });

    return { reference: intent.reference, status: result.status, providerRef: result.providerRef };
  }

  async rejectWithdrawal(paymentIntentId: string, reason: string, actorId?: string) {
    const intent = await prisma.paymentIntent.findUnique({ where: { id: paymentIntentId } });
    if (!intent) throw Errors.notFound("Odeme");
    if (intent.status !== "PENDING") throw Errors.validation(`Bu odeme ${intent.status} durumunda`);

    // Release the lock so the player can use the money again.
    await ledger.unlockFunds(intent.userId, intent.currency, intent.amount);
    await prisma.paymentIntent.update({
      where: { id: intent.id },
      data: { status: "CANCELLED", failureReason: reason, reviewedById: actorId, reviewedAt: new Date() },
    });

    await audit.log({
      actorId,
      action: AuditAction.WITHDRAWAL_REJECTED,
      entityType: "PaymentIntent",
      entityId: intent.id,
      after: { reason },
      severity: "WARNING",
    });

    return { reference: intent.reference, status: "CANCELLED" };
  }

  /** Move the money out of the player balance once the payout has settled. */
  private async settleWithdrawal(paymentIntentId: string) {
    const intent = await prisma.paymentIntent.findUnique({ where: { id: paymentIntentId } });
    if (!intent) throw Errors.notFound("Odeme");

    const already = await prisma.transaction.findUnique({ where: { idempotencyKey: `withdrawal:${intent.reference}` } });
    if (already) return;

    const net = intent.amount - intent.fee;

    await ledger.post({
      userId: intent.userId,
      type: TxType.WITHDRAWAL,
      amount: intent.amount,
      currency: intent.currency,
      walletType: WalletType.REAL,
      legs: [
        { accountType: LedgerAccountType.PLAYER_REAL, direction: LedgerDirection.DEBIT, amount: intent.amount },
        { accountType: LedgerAccountType.PSP_CLEARING, direction: LedgerDirection.CREDIT, amount: net },
        ...(intent.fee > 0n
          ? [{ accountType: LedgerAccountType.HOUSE, direction: LedgerDirection.CREDIT, amount: intent.fee }]
          : []),
      ],
      method: intent.method,
      provider: intent.provider ?? undefined,
      providerRef: intent.providerRef ?? undefined,
      idempotencyKey: `withdrawal:${intent.reference}`,
      description: "Cekim",
      metadata: { paymentIntentId: intent.id },
    });

    // The lock is consumed by the debit above; clear it.
    await ledger.unlockFunds(intent.userId, intent.currency, intent.amount);
  }

  private async failWithdrawal(paymentIntentId: string, providerRef: string, reason: string) {
    const intent = await prisma.paymentIntent.findUnique({ where: { id: paymentIntentId } });
    if (!intent) return;
    await ledger.unlockFunds(intent.userId, intent.currency, intent.amount);
    await prisma.paymentIntent.update({
      where: { id: intent.id },
      data: { status: "FAILED", providerRef, failureReason: reason },
    });
  }

  /** Webhook entry point shared by PSP and crypto providers. */
  async handleProviderCallback(params: {
    provider: string;
    payload: Record<string, unknown>;
    rawBody: string;
    headers: Record<string, string | undefined>;
    eventType: string;
  }) {
    const adapter = params.provider === env.crypto.provider ? this.providers.crypto : this.providers.psp;
    const verified = adapter.verifyWebhook(params.rawBody, params.headers);

    const event = await prisma.webhookEvent.create({
      data: {
        provider: params.provider,
        eventType: params.eventType,
        payload: params.payload as never,
        signature: params.headers["x-signature"] ?? params.headers["signature"],
        verified,
      },
    });

    if (!verified) {
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: { error: "Imza dogrulanamadi", processed: true, processedAt: new Date() },
      });
      throw Errors.forbidden("Webhook imzasi gecersiz");
    }

    const callback =
      adapter === this.providers.crypto
        ? this.providers.crypto.parseWebhook(params.payload)
        : this.providers.psp.parseWebhook(params.payload);
    const intent = await prisma.paymentIntent.findUnique({ where: { reference: callback.reference } });
    if (!intent) {
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: { error: "Eslesen odeme yok", processed: true, processedAt: new Date() },
      });
      return { handled: false, reason: "NOT_FOUND" };
    }

    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { reference: callback.reference },
    });

    if (intent.direction === "DEPOSIT" && callback.status === "COMPLETED") {
      await this.creditDeposit(intent.id);
    } else if (intent.direction === "DEPOSIT" && (callback.status === "FAILED" || callback.status === "CANCELLED") && intent.status === "PENDING") {
      await prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { status: "FAILED", failureReason: callback.failureReason ?? "Saglayici hatasi" },
      });
    } else if (intent.direction === "WITHDRAWAL") {
      if (callback.status === "COMPLETED") {
        await prisma.paymentIntent.update({
          where: { id: intent.id },
          data: { status: "COMPLETED", providerRef: callback.providerRef, completedAt: new Date() },
        });
        await this.settleWithdrawal(intent.id);
      } else if (callback.status === "FAILED" || callback.status === "CANCELLED") {
        await this.failWithdrawal(intent.id, callback.providerRef, callback.failureReason ?? "Saglayici hatasi");
      }
    }

    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { processed: true, processedAt: new Date() },
    });

    return { handled: true, reference: callback.reference, status: callback.status };
  }

  private async onDepositSideEffects(userId: string, amount: bigint, currency: string, paymentIntentId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { referredBy: { include: { affiliate: true } } },
    });

    await prisma.vipProfile.upsert({
      where: { userId },
      create: { userId, lifetimeDeposits: amount },
      update: { lifetimeDeposits: { increment: amount } },
    });

    // Affiliate CPA/revshare is computed by a scheduled job from settled data,
    // but the depositor counter updates immediately for live reporting.
    if (user?.referredBy?.affiliate) {
      await prisma.affiliate.update({
        where: { id: user.referredBy.affiliate.id },
        data: {
          depositors: { increment: 1 },
          totalDeposits: { increment: amount },
        },
      });
    }

    await prisma.transaction.updateMany({
      where: { idempotencyKey: `deposit:${paymentIntentId}` },
      data: {},
    });
  }

  private async assertDepositLimits(userId: string, amount: bigint, currency: string) {
    const limits = await prisma.playerLimit.findMany({ where: { userId, isActive: true, type: "DEPOSIT" } });
    for (const limit of limits) {
      const since = periodStart(limit.period);
      const agg = await prisma.paymentIntent.aggregate({
        where: { userId, currency, direction: "DEPOSIT", status: "COMPLETED", createdAt: { gte: since } },
        _sum: { amount: true },
      });
      if ((agg._sum.amount ?? 0n) + amount > limit.amount) {
        throw Errors.limitExceeded(`${limit.period} yatirim limitiniz asiliyor`);
      }
    }
  }

  private async assertWithdrawalLimits(userId: string, amount: bigint, currency: string) {
    const limits = await prisma.playerLimit.findMany({ where: { userId, isActive: true, type: "DEPOSIT" } });
    const withdrawalLimit = limits.find((l) => l.period === "MONTHLY");
    if (withdrawalLimit) {
      const agg = await prisma.paymentIntent.aggregate({
        where: {
          userId,
          currency,
          direction: "WITHDRAWAL",
          status: { in: ["PENDING", "PROCESSING", "COMPLETED"] },
          createdAt: { gte: periodStart("MONTHLY") },
        },
        _sum: { amount: true },
      });
      if ((agg._sum.amount ?? 0n) + amount > withdrawalLimit.amount * 5n) {
        throw Errors.limitExceeded("Aylik cekim limitiniz asiliyor");
      }
    }
  }
}

function computeFee(amount: bigint, percent: string, fixed: bigint): bigint {
  const variable = percentOf(amount, Number(percent), "TRY");
  return variable + fixed;
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
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function ledgerReference(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export const PAYMENT_METHODS = Object.values(PaymentMethod);
