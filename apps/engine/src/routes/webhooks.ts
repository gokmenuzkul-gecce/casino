import type { FastifyInstance } from "fastify";
import { AppError, Errors } from "@aurora/shared";
import { prisma } from "@aurora/db";
import { env } from "../lib/env.js";
import { bonusService } from "../services/bonuses.js";
import { AggregatorWalletService } from "../services/aggregator-wallet.js";

/**
 * Inbound webhooks.
 *
 * Every provider callback is stored verbatim before processing, so a disputed
 * settlement can always be reconstructed from what the provider actually sent.
 * Signature verification happens before any state change.
 */
export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  /** PSP deposit/withdrawal settlement callbacks. */
  app.post("/webhooks/psp", async (request, reply) => {
    const rawBody = typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {});
    const payload = (typeof request.body === "object" && request.body !== null ? request.body : {}) as Record<string, unknown>;
    const headers = request.headers as Record<string, string | undefined>;

    const result = await app.payments.handleProviderCallback({
      provider: app.providers.psp.name,
      payload,
      rawBody,
      headers,
      eventType: String(payload.event ?? payload.type ?? "payment.updated"),
    });

    return reply.send({ received: true, ...result });
  });

  /** Crypto payment confirmations. */
  app.post("/webhooks/crypto", async (request, reply) => {
    const rawBody = typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {});
    const payload = (typeof request.body === "object" && request.body !== null ? request.body : {}) as Record<string, unknown>;
    const headers = request.headers as Record<string, string | undefined>;

    const verified = app.providers.crypto.verifyWebhook(rawBody, headers);
    const event = await prisma.webhookEvent.create({
      data: {
        provider: app.providers.crypto.name,
        eventType: String(payload.event ?? payload.status ?? "crypto.updated"),
        payload: payload as never,
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

    const reference = String(payload.order_id ?? payload.reference ?? "");
    const status = String(payload.payment_status ?? payload.status ?? "").toLowerCase();
    const intent = await prisma.paymentIntent.findUnique({ where: { reference } });

    if (intent && ["confirmed", "finished", "complete", "completed"].includes(status)) {
      await app.payments.creditDeposit(intent.id);
    }

    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { reference, processed: true, processedAt: new Date() },
    });

    return reply.send({ received: true });
  });

  /** KYC decision callbacks. */
  app.post("/webhooks/kyc", async (request, reply) => {
    const rawBody = typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {});
    const payload = (typeof request.body === "object" && request.body !== null ? request.body : {}) as Record<string, unknown>;
    const headers = request.headers as Record<string, string | undefined>;

    const verified = app.providers.kyc.verifyWebhook(rawBody, headers);
    const event = await prisma.webhookEvent.create({
      data: {
        provider: app.providers.kyc.name,
        eventType: String(payload.event ?? payload.status ?? "kyc.updated"),
        payload: payload as never,
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

    const reference = String(payload.reference ?? payload.applicantId ?? payload.id ?? "");
    const status = String(payload.status ?? "").toUpperCase();
    const profile = await prisma.kycProfile.findFirst({
      where: { OR: [{ id: reference }, { providerRef: reference }] },
    });

    if (profile) {
      const approved = status.includes("APPROV");
      const rejected = status.includes("REJECT") || status.includes("DECLIN");
      await prisma.kycProfile.update({
        where: { id: profile.id },
        data: {
          status: approved ? "APPROVED" : rejected ? "REJECTED" : "IN_REVIEW",
          level: approved ? 1 : profile.level,
          providerResult: payload as never,
          reviewedAt: approved || rejected ? new Date() : null,
          rejectionReason: rejected ? String(payload.reason ?? "Saglayici reddetti") : null,
        },
      });

      if (approved) {
        await prisma.user.update({
          where: { id: profile.userId },
          data: { status: "ACTIVE", emailVerifiedAt: new Date() },
        });
      }
    }

    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { reference, processed: true, processedAt: new Date() },
    });

    return reply.send({ received: true });
  });

  /**
   * Seamless-wallet callbacks from the game aggregator.
   *
   * The aggregator owns the round outcome; our job is to debit/credit the
   * player's wallet and answer with the resulting balance. Responses follow the
   * common { balance, currency, transactionId } shape so the provider can keep
   * its own session state in sync.
   */
  app.post("/webhooks/aggregator/wallet", async (request, reply) => {
    const rawBody = typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {});
    const payload = (typeof request.body === "object" && request.body !== null ? request.body : {}) as Record<string, unknown>;
    const headers = request.headers as Record<string, string | undefined>;

    const verified = app.providers.gameAggregator.verifyCallback(rawBody, headers);
    const event = await prisma.webhookEvent.create({
      data: {
        provider: app.providers.gameAggregator.name,
        eventType: String(payload.action ?? payload.type ?? "wallet"),
        reference: String(payload.transactionId ?? payload.externalTransactionId ?? ""),
        payload: payload as never,
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

    const action = String(payload.action ?? payload.type ?? "").toUpperCase();
    const playerId = String(payload.playerId ?? payload.userId ?? "");
    const currency = String(payload.currency ?? "TRY");
    const amount = BigInt(String(payload.amount ?? "0"));
    const externalTransactionId = String(payload.transactionId ?? payload.externalTransactionId ?? "");

    const user = await prisma.user.findUnique({ where: { id: playerId }, select: { id: true } });
    if (!user) throw Errors.notFound("Oyuncu");

    const { ledger } = await import("../services/ledger.js");
    const { LedgerAccountType, LedgerDirection, TxType } = await import("@aurora/shared");

    let result;
    if (action === "BET" || action === "DEBIT") {
      result = await ledger.post({
        userId: playerId,
        type: TxType.BET,
        amount,
        currency,
        legs: [
          { accountType: LedgerAccountType.PLAYER_REAL, direction: LedgerDirection.DEBIT, amount },
          { accountType: LedgerAccountType.HOUSE, direction: LedgerDirection.CREDIT, amount },
        ],
        provider: app.providers.gameAggregator.name,
        providerRef: externalTransactionId,
        idempotencyKey: `agg:${externalTransactionId}`,
        description: "Saglayici bahsi",
        metadata: payload,
      });
    } else if (action === "WIN" || action === "CREDIT") {
      result = await ledger.post({
        userId: playerId,
        type: TxType.WIN,
        amount,
        currency,
        legs: [
          { accountType: LedgerAccountType.PLAYER_REAL, direction: LedgerDirection.CREDIT, amount },
          { accountType: LedgerAccountType.HOUSE, direction: LedgerDirection.DEBIT, amount },
        ],
        provider: app.providers.gameAggregator.name,
        providerRef: externalTransactionId,
        idempotencyKey: `agg:${externalTransactionId}`,
        description: "Saglayici kazanci",
        metadata: payload,
      });
    } else if (action === "ROLLBACK" || action === "REFUND") {
      result = await ledger.post({
        userId: playerId,
        type: TxType.REFUND,
        amount,
        currency,
        legs: [
          { accountType: LedgerAccountType.PLAYER_REAL, direction: LedgerDirection.CREDIT, amount },
          { accountType: LedgerAccountType.HOUSE, direction: LedgerDirection.DEBIT, amount },
        ],
        provider: app.providers.gameAggregator.name,
        providerRef: externalTransactionId,
        idempotencyKey: `agg:${externalTransactionId}`,
        description: "Saglayici iadesi",
        metadata: payload,
      });
    } else if (action === "BALANCE") {
      const balance = await ledger.getBalance(playerId, currency);
      result = { balanceAfter: balance, reference: externalTransactionId, id: externalTransactionId, status: "OK" };
    } else {
      throw Errors.validation(`Bilinmeyen cuzdan aksiyonu: ${action}`);
    }

    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { processed: true, processedAt: new Date() },
    });

    return reply.send({
      balance: result.balanceAfter.toString(),
      currency,
      transactionId: externalTransactionId,
      reference: result.reference,
    });
  });

  /**
   * Seamless-wallet callbacks in the Gregmorn command envelope.
   *
   * The provider owns the round and asks us to move money. The reply must be
   * the provider's own shape, and a business rejection must arrive as HTTP 400
   * with `status: "fail"`: the provider reads that as "do not start the spin".
   * Anything we cannot settle is therefore an explicit 400, never a 500.
   */
  app.post("/webhooks/aggregator/gregmorn/wallet", async (request, reply) => {
    const rawBody = typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {});
    const payload = (typeof request.body === "object" && request.body !== null ? request.body : {}) as Record<string, unknown>;
    const headers = request.headers as Record<string, string | undefined>;

    const aggregator = app.providers.gameAggregator;
    const verified = aggregator.verifyCallback(rawBody, headers);

    const callback = aggregator.parseWalletCallback?.(payload) ?? null;
    const login = callback?.playerLogin ?? String(payload.login ?? "");
    const currency = String(payload.currency ?? env.currency);

    const event = await prisma.webhookEvent.create({
      data: {
        provider: aggregator.name,
        eventType: String(payload.cmd ?? "wallet"),
        reference: callback?.transactionId ?? "",
        payload: payload as never,
        verified,
      },
    });

    const finish = async (processed: boolean, error?: string) => {
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: { processed, processedAt: new Date(), error: error ?? null },
      });
    };

    // Signature first: an unauthenticated caller must not reach the ledger.
    if (!verified) {
      await finish(true, "Imza dogrulanamadi");
      return reply
        .code(400)
        .send(aggregator.walletError?.({ login, currency, message: "invalid signature" }) ?? { status: "fail" });
    }

    if (!callback) {
      await finish(true, "Desteklenmeyen komut");
      return reply
        .code(400)
        .send(aggregator.walletError?.({ login, currency, message: "unknown command" }) ?? { status: "fail" });
    }

    const user = await resolvePlayer(login);
    if (!user) {
      await finish(true, "Oyuncu bulunamadi");
      return reply
        .code(400)
        .send(aggregator.walletError?.({ login, currency, message: "player not found" }) ?? { status: "fail" });
    }

    try {
      const settled = await new AggregatorWalletService(aggregator.name).settle(callback, {
        playerId: user.id,
        // The wallet the provider plays against follows the player's own currency
        // so a session in the wrong currency cannot silently move real money.
        currency: user.currency || currency,
      });

      await finish(true);
      return reply.send(
        aggregator.walletResponse?.({ login, balance: settled.balance, currency: settled.currency }) ?? settled,
      );
    } catch (error) {
      const message = error instanceof AppError ? error.message : "settlement failed";
      const insufficient = error instanceof AppError && error.code === "INSUFFICIENT_FUNDS";
      await finish(true, message);
      return reply
        .code(400)
        .send(
          aggregator.walletError?.({ login, currency, message: insufficient ? "insufficient funds" : message }) ?? {
            status: "fail",
          },
        );
    }
  });

  /** Affiliate postback: records a click and attributes the visitor. */
  app.get("/webhooks/affiliate/:code", async (request, reply) => {
    const { code } = request.params as { code: string };
    const affiliate = await prisma.affiliate.findUnique({ where: { code } });
    if (!affiliate) return reply.redirect("/");

    await Promise.all([
      prisma.affiliate.update({ where: { id: affiliate.id }, data: { clicks: { increment: 1 } } }),
      prisma.affiliateClick.create({
        data: {
          affiliateId: affiliate.id,
          ip: request.ip,
          userAgent: request.headers["user-agent"],
          country: (request.headers["cf-ipcountry"] as string | undefined) ?? null,
          landingPage: (request.query as { landing?: string }).landing,
        },
      }),
    ]);

    reply.setCookie("affiliate_code", code, {
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
      httpOnly: true,
      sameSite: "lax",
    });

    return reply.redirect((request.query as { landing?: string }).landing ?? "/");
  });

  /** Provider health probe, used by the admin integrations page. */
  app.get("/webhooks/health", async () => {
    const { registryHealth } = await import("../providers/index.js");
    return { providers: await registryHealth(app.providers) };
  });

  /** Internal endpoint for the bonus expiry job to call. */
  app.post("/internal/bonuses/expire", async (request) => {
    const secret = request.headers["x-internal-secret"];
    if (secret !== process.env.INTERNAL_JOB_SECRET && process.env.NODE_ENV === "production") {
      throw Errors.forbidden();
    }
    const expired = await prisma.userBonus.findMany({
      where: { status: "ACTIVE", expiresAt: { lt: new Date() } },
      select: { id: true },
      take: 500,
    });
    for (const bonus of expired) {
      await bonusService.expireBonus(bonus.id).catch((error) => console.error("[bonus] expire hatasi", error));
    }
    return { expired: expired.length };
  });
}

/**
 * Map the provider's `player_login` back to a local account.
 *
 * We register the player's username as `player_login` at launch time, so that
 * is the identity to resolve. Falling back to the id keeps sessions launched
 * before a username existed working.
 */
async function resolvePlayer(login: string): Promise<{ id: string; currency: string } | null> {
  if (!login) return null;
  return prisma.user.findFirst({
    where: { OR: [{ username: login }, { id: login }] },
    select: { id: true, currency: true },
  });
}
