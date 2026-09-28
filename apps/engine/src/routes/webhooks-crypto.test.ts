import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { databaseAvailable, SKIP_REASON } from "../test-support/infrastructure.js";
import { cryptomusSign, phpJson } from "../providers/cryptomus.js";

/**
 * End-to-end coverage of the Cryptomus deposit callback over HTTP.
 *
 * This is the boundary the provider actually hits. The test drives the real
 * Fastify app with a real signature over the real bytes and then reads the
 * resulting wallet balance from Postgres, because a callback handler that
 * verifies a signature but never credits is indistinguishable from one that
 * does nothing at all.
 *
 * The three things worth proving here are the ones that are expensive to get
 * wrong in production:
 *   1. An unsigned or wrongly-signed body is refused and credits nothing.
 *   2. A final `paid` callback credits exactly once, even if it arrives twice.
 *   3. A `confirm_check` (network not confirmed) must NOT credit.
 */

const prisma = new PrismaClient();

const API_KEY = "cryptomus-test-api-key";
const MERCHANT_ID = "8b03432e-385b-4670-8d06-064591096795";
const runId = Date.now().toString(36);
const username = `crypto_http_${runId}`;

let app: FastifyInstance;
let userId = "";
let walletId = "";

process.env.CRYPTO_PROVIDER = "cryptomus";
process.env.CRYPTO_BASE_URL = "https://api.cryptomus.com";
process.env.CRYPTO_API_KEY = API_KEY;
process.env.CRYPTO_MERCHANT_ID = MERCHANT_ID;

const url = "/webhooks/crypto";

/** Sign exactly as Cryptomus does: md5(base64(json) + apiKey), slashes escaped. */
function signed(payload: Record<string, unknown>): string {
  const { sign: _omit, ...rest } = payload;
  return JSON.stringify({ ...rest, sign: cryptomusSign(phpJson(rest), API_KEY) }).replace(/\//g, "\\/");
}

async function createPendingIntent(reference: string, amount = 25_000n) {
  const intent = await prisma.paymentIntent.create({
    data: {
      reference,
      userId,
      direction: "DEPOSIT",
      method: "CRYPTO",
      provider: "cryptomus",
      amount,
      currency: "TRY",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
    select: { id: true },
  });
  return intent.id;
}

async function balance(): Promise<bigint> {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId }, select: { balance: true } });
  return wallet.balance;
}

const hasDatabase = await databaseAvailable();

describe.skipIf(!hasDatabase)("Cryptomus deposit callback over HTTP", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `${username}@test.local`,
        username,
        passwordHash: "not-a-real-hash",
        currency: "TRY",
        roles: ["PLAYER"],
        status: "ACTIVE",
        wallets: { create: [{ currency: "TRY", type: "REAL", balance: 500_000n, isPrimary: true }] },
      },
      select: { id: true, wallets: { select: { id: true } } },
    });
    userId = user.id;
    walletId = user.wallets[0]!.id;

    const { buildServer } = await import("../server.js");
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await prisma.transaction.deleteMany({ where: { idempotencyKey: { startsWith: "deposit:" } } });
    await prisma.webhookEvent.deleteMany({ where: { provider: "cryptomus", payload: { path: ["order_id"], string_starts_with: "CRY" } } });
    await prisma.paymentIntent.deleteMany({ where: { userId, method: "CRYPTO" } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("refuses an unsigned callback and credits nothing", async () => {
    const reference = `CRY-unsigned-${runId}`;
    await createPendingIntent(reference);

    const before = await balance();
    const response = await app.inject({
      method: "POST",
      url,
      payload: { type: "payment", order_id: reference, status: "paid" },
    });

    expect(response.statusCode).toBe(403);
    expect(await balance()).toBe(before);
  });

  it("credits exactly once on a final paid callback", async () => {
    const reference = `CRY-paid-${runId}`;
    await createPendingIntent(reference, 25_000n);

    const body = signed({
      type: "payment",
      uuid: "62f88b36-a9d5-4fa6-aa26-e040c3dbf26d",
      order_id: reference,
      status: "paid",
      is_final: true,
      payment_amount: "25.00",
      payer_currency: "TRY",
    });

    const before = await balance();
    const response = await app.inject({ method: "POST", url, payload: body, headers: { "content-type": "application/json" } });
    expect(response.statusCode).toBe(200);
    expect(await balance()).toBe(before + 25_000n);

    const intent = await prisma.paymentIntent.findUniqueOrThrow({ where: { reference }, select: { status: true } });
    expect(intent.status).toBe("COMPLETED");
  });

  it("does not credit a second time when the same callback is replayed", async () => {
    const reference = `CRY-replay-${runId}`;
    await createPendingIntent(reference, 10_000n);

    const body = signed({
      type: "payment",
      uuid: "62f88b36-a9d5-4fa6-aa26-e040c3dbf26d",
      order_id: reference,
      status: "paid",
      is_final: true,
    });

    const before = await balance();
    await app.inject({ method: "POST", url, payload: body, headers: { "content-type": "application/json" } });
    expect(await balance()).toBe(before + 10_000n);

    // Same callback again: idempotent, no second credit.
    await app.inject({ method: "POST", url, payload: body, headers: { "content-type": "application/json" } });
    expect(await balance()).toBe(before + 10_000n);
  });

  it("does not credit while the network has only confirmed the invoice", async () => {
    const reference = `CRY-confirm-${runId}`;
    await createPendingIntent(reference, 50_000n);

    const body = signed({ type: "payment", order_id: reference, status: "confirm_check", is_final: false });
    const before = await balance();
    const response = await app.inject({ method: "POST", url, payload: body, headers: { "content-type": "application/json" } });

    expect(response.statusCode).toBe(200);
    expect(await balance()).toBe(before);
    const intent = await prisma.paymentIntent.findUniqueOrThrow({ where: { reference }, select: { status: true } });
    expect(intent.status).toBe("PENDING");
  });

  it("marks a failed payment as FAILED without touching the balance", async () => {
    const reference = `CRY-fail-${runId}`;
    await createPendingIntent(reference, 5_000n);

    const body = signed({ type: "payment", order_id: reference, status: "wrong_amount", is_final: true });
    const before = await balance();
    await app.inject({ method: "POST", url, payload: body, headers: { "content-type": "application/json" } });

    expect(await balance()).toBe(before);
    const intent = await prisma.paymentIntent.findUniqueOrThrow({
      where: { reference },
      select: { status: true, failureReason: true },
    });
    expect(intent.status).toBe("FAILED");
    expect(intent.failureReason).toContain("wrong_amount");
  });

  it("records every callback in webhook_events before processing", async () => {
    const reference = `CRY-audit-${runId}`;
    await createPendingIntent(reference, 1_000n);
    const body = signed({ type: "payment", order_id: reference, status: "confirm_check", is_final: false });
    await app.inject({ method: "POST", url, payload: body, headers: { "content-type": "application/json" } });

    const event = await prisma.webhookEvent.findFirst({
      where: { provider: "cryptomus", payload: { path: ["order_id"], equals: reference } },
      select: { verified: true, processed: true, reference: true },
    });
    expect(event).toMatchObject({ verified: true, processed: true, reference });
  });

  it("settles a crypto withdrawal on the payout callback and releases the hold", async () => {
    const reference = `CRY-payout-${runId}`;
    const amount = 40_000n;
    const balanceBefore = await balance();

    // Withdrawals lock rather than debit: the funds stay on the wallet but
    // unusable until the payout settles. Mirror that with the real ledger call.
    const { ledger } = await import("../services/ledger.js");
    await ledger.lockFunds(userId, "TRY", amount);
    await prisma.paymentIntent.create({
      data: {
        reference,
        userId,
        direction: "WITHDRAWAL",
        method: "CRYPTO",
        provider: "cryptomus",
        amount,
        currency: "TRY",
        status: "PROCESSING",
        walletAddress: "TXk9examplewalletaddress000000000000",
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    const body = signed({ type: "payout", order_id: reference, status: "paid", is_final: true });
    const response = await app.inject({ method: "POST", url, payload: body, headers: { "content-type": "application/json" } });

    expect(response.statusCode).toBe(200);
    const intent = await prisma.paymentIntent.findUniqueOrThrow({
      where: { reference },
      select: { status: true, fee: true },
    });
    expect(intent.status).toBe("COMPLETED");

    // Settlement moves the amount out for good and the lock is gone.
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId }, select: { balance: true, locked: true } });
    expect(wallet.balance).toBe(balanceBefore - amount);
    expect(wallet.locked).toBe(0n);
  });

  it("returns the held funds when a payout fails", async () => {
    const reference = `CRY-payoutfail-${runId}`;
    const amount = 15_000n;
    const balanceBefore = await balance();

    const { ledger } = await import("../services/ledger.js");
    await ledger.lockFunds(userId, "TRY", amount);
    await prisma.paymentIntent.create({
      data: {
        reference,
        userId,
        direction: "WITHDRAWAL",
        method: "CRYPTO",
        provider: "cryptomus",
        amount,
        currency: "TRY",
        status: "PROCESSING",
        walletAddress: "TXk9examplewalletaddress000000000000",
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    const body = signed({ type: "payout", order_id: reference, status: "fail", is_final: true });
    const response = await app.inject({ method: "POST", url, payload: body, headers: { "content-type": "application/json" } });

    expect(response.statusCode).toBe(200);
    const intent = await prisma.paymentIntent.findUniqueOrThrow({ where: { reference }, select: { status: true } });
    expect(intent.status).toBe("FAILED");

    // A failed payout must unlock the hold so the player can spend again.
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId }, select: { balance: true, locked: true } });
    expect(wallet.balance).toBe(balanceBefore);
    expect(wallet.locked).toBe(0n);
  });
});

if (!hasDatabase) {
  describe("infrastructure", () => {
    it.skip(SKIP_REASON, () => {});
  });
}
