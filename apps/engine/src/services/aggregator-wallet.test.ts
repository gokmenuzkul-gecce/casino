import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { databaseAvailable } from "../test-support/infrastructure.js";
import { AggregatorWalletService } from "../services/aggregator-wallet.js";
import { GregmornAggregator } from "../providers/gregmorn.js";

/**
 * Seamless-wallet settlement against the real database and the real ledger.
 *
 * These are the paths where a mistake moves real player money, so nothing here
 * is mocked: a real user, a real wallet and the real double-entry ledger are
 * exercised, and every assertion reads the balance back from Postgres.
 */

const prisma = new PrismaClient();

/**
 * Transaction rows survive user deletion (the foreign key is SetNull), so each
 * run namespaces its idempotency keys to stay isolated from previous runs.
 */
const runId = Date.now().toString(36);
const providerName = `gregmorn-test-${runId}`;
const keyPrefix = `agg:${providerName}:`;

let service: AggregatorWalletService;
let userId = "";
const username = `agg_test_${runId}`;

beforeAll(async () => {
  service = new AggregatorWalletService(providerName);
  const user = await prisma.user.create({
    data: {
      email: `${username}@test.local`,
      username,
      passwordHash: "not-a-real-hash",
      currency: "TRY",
      roles: ["PLAYER"],
      status: "ACTIVE",
      wallets: {
        create: [
          // 100.00 TRY, stored in minor units.
          { currency: "TRY", type: "REAL", balance: 10_000n, isPrimary: true },
          { currency: "TRY", type: "DEMO", balance: 0n },
        ],
      },
    },
    select: { id: true },
  });
  userId = user.id;
});

/**
 * Each case starts from a known 100.00 TRY and a clean ledger, so a balance
 * assertion can be read as the outcome of that case alone.
 */
beforeEach(async () => {
  await prisma.ledgerEntry.deleteMany({ where: { wallet: { userId } } });
  await prisma.transaction.deleteMany({ where: { idempotencyKey: { startsWith: keyPrefix } } });
  await prisma.wallet.update({
    where: { userId_currency_type: { userId, currency: "TRY", type: "REAL" } },
    data: { balance: 10_000n },
  });
});

afterAll(async () => {
  await prisma.transaction.deleteMany({ where: { idempotencyKey: { startsWith: keyPrefix } } });
  // Cascades remove the wallet and ledger entries.
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

function writeBet(overrides: Record<string, unknown> = {}) {
  return {
    cmd: "writeBet",
    bet: 25,
    win: 0,
    login: username,
    sessionid: "session-1",
    transactionId: randomUUID(),
    round_finished: false,
    info: "{}",
    ...overrides,
  } as never;
}

function parse(payload: Record<string, unknown>) {
  const aggregator = new GregmornAggregator({
    officeBaseUrl: "http://localhost",
    clientBaseUrl: "http://localhost",
    login: "x",
    password: "x",
    secretKey: "secret",
    userId: "u",
    currency: "TRY",
  });
  return aggregator.parseWalletCallback!(payload);
}

const hasDatabase = await databaseAvailable();

describe.skipIf(!hasDatabase)("aggregator seamless wallet", () => {
  it("reports the live balance without moving money", async () => {
    const before = await balance();
    const result = await service.settle(parse({ cmd: "getBalance", login: username, sessionid: "s" })!, {
      playerId: userId,
      currency: "TRY",
    });

    expect(result.balance).toBe("100.00");
    expect(await balance()).toBe(before);
  });

  it("debits a losing bet and returns the balance after the operation", async () => {
    const before = await balance();
    const payload = writeBet({ bet: 25, win: 0 }) as unknown as Record<string, unknown>;

    const result = await service.settle(parse(payload)!, { playerId: userId, currency: "TRY" });

    expect(result.balance).toBe("75.00");
    expect(await balance()).toBe(before - 2_500n);
  });

  it("applies bet and win in one message as a single net movement", async () => {
    const before = await balance();
    const payload = writeBet({ bet: 10, win: 50 }) as unknown as Record<string, unknown>;

    const result = await service.settle(parse(payload)!, { playerId: userId, currency: "TRY" });

    // win 50.00 - bet 10.00 = +40.00, so 100.00 becomes 140.00.
    expect(result.balance).toBe("140.00");
    expect(await balance()).toBe(before + 4_000n);
  });

  it("treats a repeated transactionId as already settled", async () => {
    const payload = writeBet({ bet: 5, win: 0, transactionId: "fixed-txn-1" }) as unknown as Record<string, unknown>;

    const first = await service.settle(parse(payload)!, { playerId: userId, currency: "TRY" });
    const afterFirst = await balance();

    // Providers retry on timeout: the replay must not move money again.
    const second = await service.settle(parse(payload)!, { playerId: userId, currency: "TRY" });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.balance).toBe(first.balance);
    expect(await balance()).toBe(afterFirst);
  });

  it("accepts bet and win sent as strings, as some vendors do", async () => {
    const before = await balance();
    const payload = writeBet({ bet: "12.50", win: "2.50" }) as unknown as Record<string, unknown>;

    const result = await service.settle(parse(payload)!, { playerId: userId, currency: "TRY" });

    // win 2.50 - bet 12.50 = -10.00, so 100.00 becomes 90.00.
    expect(result.balance).toBe("90.00");
    expect(await balance()).toBe(before - 1_000n);
  });

  it("rejects a bet the player cannot cover instead of overdrawing", async () => {
    const before = await balance();
    const payload = writeBet({ bet: 999_999, win: 0 }) as unknown as Record<string, unknown>;

    await expect(service.settle(parse(payload)!, { playerId: userId, currency: "TRY" })).rejects.toThrow(
      /Yetersiz bakiye/,
    );
    expect(await balance()).toBe(before);
  });

  it("restores the exact pre-bet balance on rollback, only once", async () => {
    const start = await balance();
    const transactionId = `rollback-${randomUUID()}`;
    const payload = writeBet({ bet: 30, win: 0, transactionId }) as unknown as Record<string, unknown>;

    await service.settle(parse(payload)!, { playerId: userId, currency: "TRY" });
    const afterBet = await balance();
    expect(afterBet).toBe(start - 3_000n);

    const rollbackPayload = {
      cmd: "rollback",
      bet: 30,
      win: 0,
      login: username,
      sessionid: "session-1",
      transactionId,
      round_finished: true,
      info: "{}",
      gameId: "integration_a:provider_a:game_001",
    } as unknown as Record<string, unknown>;

    const rolled = await service.settle(parse(rollbackPayload)!, { playerId: userId, currency: "TRY" });
    expect(rolled.balance).toBe("100.00");
    expect(await balance()).toBe(start);

    // A second rollback for the same wager must be a no-op.
    const again = await service.settle(parse(rollbackPayload)!, { playerId: userId, currency: "TRY" });
    expect(again.duplicate).toBe(true);
    expect(await balance()).toBe(start);
  });

  it("refuses to settle in a currency the platform does not support", async () => {
    const payload = writeBet({ bet: 1, win: 0 }) as unknown as Record<string, unknown>;

    await expect(service.settle(parse(payload)!, { playerId: userId, currency: "XYZ" })).rejects.toThrow(
      /Desteklenmeyen para birimi/,
    );
  });

  /**
   * The GitSlotPark family splits the round: a wager arrives as `Withdraw` and
   * the payout later as one or more `Deposit`s. These cases exercise that
   * sequence end to end, because it is the shape the new providers actually use.
   */
  describe("split round (withdraw then deposit)", () => {
    it("debits a withdraw and credits a matching deposit", async () => {
      const start = await balance();
      const withdrawTxn = `wd-${randomUUID()}`;

      const debited = await service.settle(
        { command: "WITHDRAW", playerLogin: username, transactionId: withdrawTxn, bet: "20.00", gameId: "2001", roundId: "r1" },
        { playerId: userId, currency: "TRY" },
      );
      expect(debited.balance).toBe("80.00");
      expect(await balance()).toBe(start - 2_000n);

      const credited = await service.settle(
        {
          command: "DEPOSIT",
          playerLogin: username,
          transactionId: `dp-${randomUUID()}`,
          win: "45.50",
          refTransactionId: withdrawTxn,
          gameId: "2001",
        },
        { playerId: userId, currency: "TRY" },
      );
      expect(credited.balance).toBe("125.50");
      expect(await balance()).toBe(start - 2_000n + 4_550n);
    });

    it("applies SEVERAL deposits that share one refTransactionID", async () => {
      // PG Soft and Amatic pay a free-spin round out in pieces: each piece has
      // its own transactionID but the same ref, so keying on the ref would drop
      // all but the first. This is the case that proves it does not.
      const start = await balance();
      const withdrawTxn = `wd-${randomUUID()}`;

      await service.settle(
        { command: "WITHDRAW", playerLogin: username, transactionId: withdrawTxn, bet: "10.00" },
        { playerId: userId, currency: "TRY" },
      );

      for (const amount of ["5.00", "7.50", "2.25"]) {
        await service.settle(
          { command: "DEPOSIT", playerLogin: username, transactionId: `dp-${randomUUID()}`, win: amount, refTransactionId: withdrawTxn },
          { playerId: userId, currency: "TRY" },
        );
      }

      // 100 - 10 + 5 + 7.50 + 2.25 = 104.75
      expect(await balance()).toBe(start - 1_000n + 500n + 750n + 225n);
    });

    it("rolls back a withdraw by its own transactionID", async () => {
      const start = await balance();
      const withdrawTxn = `wd-${randomUUID()}`;

      await service.settle(
        { command: "WITHDRAW", playerLogin: username, transactionId: withdrawTxn, bet: "30.00" },
        { playerId: userId, currency: "TRY" },
      );
      expect(await balance()).toBe(start - 3_000n);

      const rolled = await service.settle(
        { command: "ROLLBACK", playerLogin: username, transactionId: withdrawTxn },
        { playerId: userId, currency: "TRY" },
      );

      expect(rolled.balance).toBe("100.00");
      expect(await balance()).toBe(start);

      const again = await service.settle(
        { command: "ROLLBACK", playerLogin: username, transactionId: withdrawTxn },
        { playerId: userId, currency: "TRY" },
      );
      expect(again.duplicate).toBe(true);
      expect(await balance()).toBe(start);
    });

    it("records a 0.00 win without moving money, and can still roll it back", async () => {
      const start = await balance();
      const depositTxn = `dp-${randomUUID()}`;

      const credited = await service.settle(
        { command: "DEPOSIT", playerLogin: username, transactionId: depositTxn, win: "0.00", refTransactionId: "ref-zero" },
        { playerId: userId, currency: "TRY" },
      );

      // The provider still expects a real balance back, not 0.00.
      expect(credited.balance).toBe("100.00");
      expect(await balance()).toBe(start);

      const rolled = await service.settle(
        { command: "ROLLBACK", playerLogin: username, transactionId: depositTxn },
        { playerId: userId, currency: "TRY" },
      );
      expect(rolled.duplicate).toBe(false);
      expect(await balance()).toBe(start);
    });

    it("rejects a withdraw larger than the balance", async () => {
      const start = await balance();

      await expect(
        service.settle(
          { command: "WITHDRAW", playerLogin: username, transactionId: `wd-${randomUUID()}`, bet: "5000.00" },
          { playerId: userId, currency: "TRY" },
        ),
      ).rejects.toThrow(/Yetersiz bakiye/);

      expect(await balance()).toBe(start);
    });
  });
});
