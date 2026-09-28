import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { databaseAvailable } from "../test-support/infrastructure.js";

/**
 * End-to-end coverage of the Gregmorn seamless-wallet callback over HTTP.
 *
 * This is the boundary the provider actually hits, so the test drives the real
 * Fastify app with a real signature over the real bytes and reads the resulting
 * balance from Postgres. Signature verification is checked first because it is
 * what stands between an anonymous caller and the player's wallet.
 */

const prisma = new PrismaClient();

const SECRET = "test-secret-key-for-hmac";
const runId = Date.now().toString(36);
const username = `agg_http_${runId}`;
const providerName = "gregmorn";

let app: FastifyInstance;
let userId = "";
const url = "/webhooks/aggregator/gregmorn/wallet";

/** The provider sends credentials through the environment, never through code. */
process.env.GAME_AGGREGATOR = providerName;
process.env.GREG_MORN_OFFICE_URL = "https://office-api-dev.gregmorn.org";
process.env.GREG_MORN_CLIENT_URL = "https://client-api-dev.gregmorn.org";
process.env.GREG_MORN_LOGIN = "test_operator";
process.env.GREG_MORN_PASSWORD = "test_password";
process.env.GREG_MORN_SECRET_KEY = SECRET;
process.env.GREG_MORN_USER_ID = "481e3c9b-77f2-4d1a-b832-9c5e0f8a2d14";
process.env.GREG_MORN_CURRENCY = "TRY";

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: `${username}@test.local`,
      username,
      passwordHash: "not-a-real-hash",
      currency: "TRY",
      roles: ["PLAYER"],
      status: "ACTIVE",
      wallets: { create: [{ currency: "TRY", type: "REAL", balance: 50_000n, isPrimary: true }] },
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

describe.skipIf(!hasDatabase)("gregmorn wallet callback over HTTP", () => {
  it("answers a signed getBalance with the live balance", async () => {
    const response = await call({ cmd: "getBalance", login: username, sessionid: "sess-http-1" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ status: "success", login: username, currency: "TRY", error: "" });
    expect(body.balance).toBe(500);
  });

  it("rejects an unsigned callback with a 400 fail envelope", async () => {
    const before = await balance();
    const response = await call({ cmd: "writeBet", bet: 10, win: 0, login: username, sessionid: "s", transactionId: "forged" }, { signature: null });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ status: "fail", error: "invalid signature" });
    expect(await balance()).toBe(before);
  });

  it("rejects a callback signed with the wrong secret", async () => {
    const before = await balance();
    const rawBody = JSON.stringify({ cmd: "writeBet", bet: 10, win: 0, login: username, sessionid: "s", transactionId: "forged-2" });
    const response = await app.inject({
      method: "POST",
      url,
      payload: rawBody,
      headers: { "content-type": "application/json", "x-signature": createHmac("sha256", "wrong").update(rawBody).digest("hex") },
    });

    expect(response.statusCode).toBe(400);
    expect(await balance()).toBe(before);
  });

  it("settles a signed writeBet and reports the balance after the operation", async () => {
    const before = await balance();
    const response = await call({
      cmd: "writeBet",
      bet: 25,
      win: 0,
      login: username,
      sessionid: "sess-http-2",
      transactionId: `http-bet-${runId}`,
      round_finished: false,
      info: '{"gameType":"slots"}',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().balance).toBe(475);
    expect(await balance()).toBe(before - 2_500n);
  });

  it("rejects an uncovered bet with 400 so the provider does not start the spin", async () => {
    const before = await balance();
    const response = await call({
      cmd: "writeBet",
      bet: 999_999,
      win: 0,
      login: username,
      sessionid: "sess-http-3",
      transactionId: `http-poor-${runId}`,
      round_finished: false,
      info: "{}",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ status: "fail", error: "insufficient funds" });
    expect(await balance()).toBe(before);
  });

  it("rejects a callback for an unknown player without touching any wallet", async () => {
    const response = await call({
      cmd: "writeBet",
      bet: 1,
      win: 0,
      login: "no_such_player_anywhere",
      sessionid: "s",
      transactionId: `http-ghost-${runId}`,
      round_finished: false,
      info: "{}",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ status: "fail", error: "player not found" });
  });

  it("treats a replayed transactionId as already settled", async () => {
    const payload = {
      cmd: "writeBet",
      bet: 5,
      win: 0,
      login: username,
      sessionid: "sess-http-4",
      transactionId: `http-replay-${runId}`,
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

  it("records every callback as a webhook event for audit", async () => {
    const events = await prisma.webhookEvent.count({ where: { provider: providerName } });
    expect(events).toBeGreaterThan(0);
  });
});
