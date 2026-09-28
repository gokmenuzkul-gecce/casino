import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { databaseAvailable } from "../test-support/infrastructure.js";

/**
 * End-to-end coverage of the BetSkilla seamless-wallet callback over HTTP.
 *
 * This is the bridge that makes a game's balance follow the player's wallet:
 * the hub owns the round and calls us for every money movement. Before it
 * existed the adapter returned `false` from `verifyCallback`, so every request
 * was answered with "invalid signature" and games ran on the hub's own balance
 * instead of the player's. The test therefore asserts the balance actually
 * moves in Postgres, not just that a 200 came back.
 */

const prisma = new PrismaClient();

const SECRET = "betskilla-callback-secret-for-hmac";
const runId = Date.now().toString(36);
const username = `bs_http_${runId}`;
const providerName = "betskilla";

let app: FastifyInstance;
let userId = "";
const url = "/webhooks/aggregator/betskilla/wallet";

/** Credentials live in the environment, never in code. */
process.env.GAME_AGGREGATOR = providerName;
process.env.BETSKILLA_BASE_URL = "https://xenzora.example";
process.env.BETSKILLA_LOGIN = "test_operator";
process.env.BETSKILLA_PASSWORD = "test_password";
process.env.BETSKILLA_CURRENCY = "TRY";
process.env.BETSKILLA_CALLBACK_SECRET = SECRET;

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: `${username}@test.local`,
      username,
      passwordHash: "not-a-real-hash",
      currency: "TRY",
      roles: ["PLAYER"],
      status: "ACTIVE",
      wallets: { create: [{ currency: "TRY", type: "REAL", balance: 20_000n, isPrimary: true }] },
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

async function balance(): Promise<bigint> {
  const wallet = await prisma.wallet.findUnique({
    where: { userId_currency_type: { userId, currency: "TRY", type: "REAL" } },
    select: { balance: true },
  });
  return wallet?.balance ?? 0n;
}

function sign(rawBody: string): string {
  return createHmac("sha256", SECRET).update(rawBody).digest("hex");
}

async function call(payload: Record<string, unknown>, options: { signature?: string | null } = {}) {
  const rawBody = JSON.stringify(payload);
  const signature = options.signature === undefined ? sign(rawBody) : options.signature;
  return app.inject({
    method: "POST",
    url,
    payload: rawBody,
    headers: {
      "content-type": "application/json",
      ...(signature ? { "x-signature": signature } : {}),
    },
  });
}

const hasDatabase = await databaseAvailable();

describe.skipIf(!hasDatabase)("betskilla wallet callback over HTTP", () => {
  it("answers a signed getBalance with the player's own balance", async () => {
    const response = await call({ cmd: "getBalance", login: username, sessionid: "sess-bs-1" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "success", login: username, currency: "TRY", error: "" });
    // 20_000 minor units => 200.00 major units in the reply.
    expect(response.json().balance).toBe(200);
  });

  it("rejects an unsigned callback without moving money", async () => {
    const before = await balance();
    const response = await call(
      { cmd: "writeBet", bet: 10, win: 0, login: username, sessionid: "s", transactionId: "forged" },
      { signature: null },
    );

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ status: "fail", error: "invalid signature" });
    expect(await balance()).toBe(before);
  });

  it("settles a signed bet by debiting the same wallet the site shows", async () => {
    const before = await balance();
    const response = await call({
      cmd: "writeBet",
      bet: 30,
      win: 0,
      login: username,
      sessionid: "sess-bs-2",
      transactionId: `bs-bet-${runId}`,
      round_finished: false,
      info: '{"gameType":"slots"}',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().balance).toBe(170);
    // 30.00 major units => 3_000 minor units removed from the shared wallet.
    expect(await balance()).toBe(before - 3_000n);
  });

  it("credits a win back to the same wallet", async () => {
    const before = await balance();
    const response = await call({
      cmd: "writeBet",
      bet: 10,
      win: 25,
      login: username,
      sessionid: "sess-bs-3",
      transactionId: `bs-win-${runId}`,
      round_finished: true,
      info: "{}",
    });

    expect(response.statusCode).toBe(200);
    // Net +15.00 major units.
    expect(await balance()).toBe(before + 1_500n);
  });

  it("rejects an uncovered bet so the hub does not start the spin", async () => {
    const before = await balance();
    const response = await call({
      cmd: "writeBet",
      bet: 999_999,
      win: 0,
      login: username,
      sessionid: "sess-bs-4",
      transactionId: `bs-poor-${runId}`,
      round_finished: false,
      info: "{}",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ status: "fail", error: "insufficient funds" });
    expect(await balance()).toBe(before);
  });

  it("reverses a settled bet exactly once on rollback", async () => {
    const before = await balance();
    const transactionId = `bs-rollback-${runId}`;

    await call({
      cmd: "writeBet",
      bet: 40,
      win: 0,
      login: username,
      sessionid: "sess-bs-5",
      transactionId,
      round_finished: false,
      info: "{}",
    });
    const afterBet = await balance();
    expect(afterBet).toBe(before - 4_000n);

    const rollback = await call({ cmd: "rollback", login: username, sessionid: "sess-bs-5", transactionId });
    expect(rollback.statusCode).toBe(200);
    expect(await balance()).toBe(before);

    // The hub retries on timeout; a replay must not refund a second time.
    const replay = await call({ cmd: "rollback", login: username, sessionid: "sess-bs-5", transactionId });
    expect(replay.statusCode).toBe(200);
    expect(await balance()).toBe(before);
  });

  it("treats a replayed bet transactionId as already settled", async () => {
    const payload = {
      cmd: "writeBet",
      bet: 5,
      win: 0,
      login: username,
      sessionid: "sess-bs-6",
      transactionId: `bs-replay-${runId}`,
      round_finished: false,
      info: "{}",
    };

    const first = await call(payload);
    const afterFirst = await balance();
    const second = await call(payload);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().balance).toBe(first.json().balance);
    expect(await balance()).toBe(afterFirst);
  });

  it("rejects a callback for an unknown player without touching any wallet", async () => {
    const response = await call({
      cmd: "writeBet",
      bet: 1,
      win: 0,
      login: "no_such_player_anywhere",
      sessionid: "s",
      transactionId: `bs-ghost-${runId}`,
      round_finished: false,
      info: "{}",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ status: "fail", error: "player not found" });
  });

  it("records every callback as a webhook event for audit", async () => {
    const events = await prisma.webhookEvent.count({ where: { provider: providerName } });
    expect(events).toBeGreaterThan(0);
  });
});
