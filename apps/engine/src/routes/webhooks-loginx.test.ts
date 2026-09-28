import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { databaseAvailable } from "../test-support/infrastructure.js";

/**
 * End-to-end coverage of the GitSlotPark (loginx) wallet callbacks over HTTP.
 *
 * This is the boundary the four vendors actually hit. Three things are asserted
 * that the unit tests cannot: the five callback PATHS are registered verbatim as
 * the provider expects, the signature is checked over the real bytes the
 * provider sends, and a business failure comes back as HTTP 200 with a result
 * code rather than a 4xx.
 *
 * The `loginxSign` helper is imported dynamically inside `beforeAll`, not at the
 * top: importing it hoists the `env` module, which snapshots GAME_AGGREGATOR
 * before the assignments below can take effect, and the app would then be built
 * from the repo's own .env instead of this test's.
 */

const prisma = new PrismaClient();

const SECRET = "git-slot-park-secret";
const AGENT = "partner-agent";
const runId = Date.now().toString(36);
const username = `loginx_http_${runId}`;
const providerName = "loginx";

let app: FastifyInstance;
let userId = "";
let sign: (operation: string, secret: string, params: Record<string, unknown>) => string;
const base = "/webhooks/callback";

/** Credentials reach the adapter through the environment, never through code. */
process.env.GAME_AGGREGATOR = providerName;
process.env.LOGINX_PRAGMATIC_AGENTID = AGENT;
process.env.LOGINX_PRAGMATIC_APITOKEN = "api-token";
process.env.LOGINX_PRAGMATIC_SECRETKEY = SECRET;

beforeAll(async () => {
  sign = (await import("../providers/loginx.js")).loginxSign as typeof sign;

  const user = await prisma.user.create({
    data: {
      email: `${username}@test.local`,
      username,
      passwordHash: "not-a-real-hash",
      currency: "TRY",
      roles: ["PLAYER"],
      status: "ACTIVE",
      // 100.00 TRY, in minor units.
      wallets: { create: [{ currency: "TRY", type: "REAL", balance: 10_000n, isPrimary: true }] },
    },
    select: { id: true },
  });
  userId = user.id;

  const { buildServer } = await import("../server.js");
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await prisma.transaction.deleteMany({ where: { idempotencyKey: { startsWith: `agg:${providerName}:` } } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

/**
 * Every case starts from the same 100.00 TRY and a clean ledger so a balance
 * assertion reads as the outcome of that case alone, not of whatever ran before.
 */
beforeEach(async () => {
  await prisma.ledgerEntry.deleteMany({ where: { wallet: { userId } } });
  await prisma.transaction.deleteMany({ where: { idempotencyKey: { startsWith: `agg:${providerName}:` } } });
  await prisma.wallet.update({
    where: { userId_currency_type: { userId, currency: "TRY", type: "REAL" } },
    data: { balance: 10_000n },
  });
});

async function balance(): Promise<bigint> {
  const wallet = await prisma.wallet.findUnique({
    where: { userId_currency_type: { userId, currency: "TRY", type: "REAL" } },
    select: { balance: true },
  });
  return wallet?.balance ?? 0n;
}

/**
 * Sign a callback with the operation-appropriate field order and post it, the
 * way the provider's own client does.
 */
async function post(operation: "GetBalance" | "BetWin" | "Withdraw" | "Deposit" | "RollbackTransaction", fields: Record<string, unknown>) {
  const payload = { agentID: AGENT, userID: username, ...fields };
  const signed = { ...payload, sign: sign(operation, SECRET, payload) };
  return app.inject({ method: "POST", url: `${base}/${operation}`, payload: signed });
}

const hasDatabase = await databaseAvailable();

describe.skipIf(!hasDatabase)("loginx wallet callbacks over HTTP", () => {
  it("answers GetBalance with the live balance and code 0", async () => {
    const response = await post("GetBalance", { gameID: 2001 });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 0, balance: 100 });
    expect(await balance()).toBe(10_000n);
  });

  it("signs each of the five paths, rejecting a bad sign on any of them", async () => {
    // All five are registered; an unsigned request must never reach the ledger.
    for (const operation of ["GetBalance", "BetWin", "Withdraw", "Deposit", "RollbackTransaction"] as const) {
      const response = await app.inject({
        method: "POST",
        url: `${base}/${operation}`,
        payload: { agentID: AGENT, userID: username, transactionID: "x", sign: "DEADBEEF" },
      });
      // The family reads failures from the body, so the status stays 200.
      expect(response.statusCode).toBe(200);
      expect(response.json().code).not.toBe(0);
    }
    expect(await balance()).toBe(10_000n);
  });

  it("settles a BetWin and returns platform-independent balance and code 0", async () => {
    const start = await balance();
    const response = await post("BetWin", {
      betAmount: 25,
      winAmount: 0,
      transactionID: `bet-${randomUUID()}`,
      roundID: "round-1",
      gameID: 2001,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 0, balance: 75 });
    expect(await balance()).toBe(start - 2_500n);
  });

  it("settles a split round: Withdraw then Deposit", async () => {
    const start = await balance();
    const withdrawTxn = `wd-${randomUUID()}`;

    const debit = await post("Withdraw", { amount: 20, transactionID: withdrawTxn, roundID: "round-2", gameID: 2001 });
    expect(debit.json()).toMatchObject({ code: 0, balance: 80 });

    const credit = await post("Deposit", {
      amount: 45.5,
      refTransactionID: withdrawTxn,
      transactionID: `dp-${randomUUID()}`,
      roundID: "round-2",
      gameID: 2001,
    });
    expect(credit.json()).toMatchObject({ code: 0, balance: 125.5 });

    expect(await balance()).toBe(start - 2_000n + 4_550n);
  });

  it("rolls a Withdraw back by its refTransactionID", async () => {
    const start = await balance();
    const withdrawTxn = `wd-${randomUUID()}`;

    await post("Withdraw", { amount: 30, transactionID: withdrawTxn, roundID: "round-3", gameID: 2001 });
    expect(await balance()).toBe(start - 3_000n);

    const rolled = await post("RollbackTransaction", { refTransactionID: withdrawTxn, gameID: 2001 });
    expect(rolled.json()).toMatchObject({ code: 0, balance: 100 });
    expect(await balance()).toBe(start);

    // A repeat must not move money again.
    const again = await post("RollbackTransaction", { refTransactionID: withdrawTxn, gameID: 2001 });
    expect(again.statusCode).toBe(200);
    expect(await balance()).toBe(start);
  });

  it("reports insufficient funds as code 6 with HTTP 200, not a 4xx", async () => {
    const start = await balance();
    const response = await post("Withdraw", {
      amount: 5000,
      transactionID: `wd-${randomUUID()}`,
      roundID: "round-4",
      gameID: 2001,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().code).toBe(6);
    expect(await balance()).toBe(start);
  });

  it("reports an unknown rollback reference as code 9", async () => {
    // A rollback answers only 0,1,2,3,4,5,9 per the spec — there is no
    // "reference not found" (8) — so an unmatched rollback is 9.
    const response = await post("RollbackTransaction", { refTransactionID: `missing-${randomUUID()}`, gameID: 2001 });

    expect(response.statusCode).toBe(200);
    expect(response.json().code).toBe(9);
  });

  it("reports an unknown player as code 5", async () => {
    const payload = { agentID: AGENT, userID: "no-such-player", gameID: 2001 };
    const response = await app.inject({
      method: "POST",
      url: `${base}/GetBalance`,
      payload: { ...payload, sign: sign("GetBalance", SECRET, payload) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().code).toBe(5);
  });
});
