import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  LoginxGamesAggregator,
  detectOperation,
  formatSignatureAmount,
  loginxSign,
  loginxVendorsFromEnv,
} from "../providers/loginx.js";

/**
 * The GitSlotPark Seamless Wallet API v2 adapter.
 *
 * The contract is reverse-engineered from the provider's own Postman
 * collections, so the pieces most likely to be wrong are pinned here:
 *
 *  - the signature, against the ONE published test vector the spec contains.
 *    Everything else about signing is inference, so if the vector passes and the
 *    field orders match the spec tables, the rest follows.
 *  - the per-operation field order, which is NOT uniform: Deposit inserts
 *    refTransactionID before transactionID and the others do not.
 *  - the HTTP status of a business rejection: 200 with a code, not 400.
 *
 * HTTP is a real server, not a mocked fetch, so the bytes the vendor receives are
 * what is asserted.
 */

const servers: Server[] = [];

async function startVendor(
  handler: (request: { url?: string; method?: string; headers: Record<string, string | string[] | undefined>; body: string }, send: (status: number, body: unknown) => void) => void,
): Promise<string> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk as Buffer));
    request.on("end", () => {
      const send = (status: number, body: unknown) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
      };
      handler(
        {
          url: request.url,
          method: request.method,
          headers: request.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        },
        send,
      );
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

const catalogue = (vendorid: string, count: number) => ({
  updatetime: "2026-09-13T23:59:03",
  code: 0,
  message: "OK",
  data: Array.from({ length: count }, (_, index) => ({
    vendorid,
    gameid: 2000 + index,
    name: `${vendorid} Game ${index}`,
    symbol: `sym${index}`,
    iconurl1: `https://cdn.example/${vendorid}/${index}.png`,
    miniBet: 1,
    releasedate: "2016-06-01",
  })),
});

const vendor = (baseUrl: string, overrides: Partial<{ agentId: string; apiToken: string; secretKey: string; key: string }> = {}) => ({
  key: overrides.key ?? "pragmatic",
  vendor: "Pragmatic Play",
  baseUrl,
  agentId: overrides.agentId ?? "agent-1",
  apiToken: overrides.apiToken ?? "tok-1",
  secretKey: overrides.secretKey ?? "sec-1",
  signingReady: true,
});

describe("loginx signature", () => {
  /**
   * The spec publishes this exact vector beside the Withdraw operation. If the
   * algorithm or the field order is wrong, this fails — which is the entire
   * reason the signing code is trusted for the four operations the spec does not
   * give a vector for.
   */
  it("reproduces the published test vector for Withdraw", () => {
    const sign = loginxSign("Withdraw", "1234567890", {
      agentID: "Partner01",
      userID: "Player01",
      amount: 12.3,
      transactionID: "474e1a293c2f4e7ab122c52d68423fcb",
      roundID: "ab9c15f2efdd46278e4a56b303127234",
      // Absent on purpose: the spec's own example omits gameID.
    });

    expect(sign).toBe("475D834ACC3AB61D7DF4EA42751C6275387BC1787A098D2D0E091698D9BF2043");
  });

  it("signs amounts to exactly two decimals", () => {
    expect(formatSignatureAmount(12.3)).toBe("12.30");
    expect(formatSignatureAmount(5)).toBe("5.00");
    expect(formatSignatureAmount("0.1")).toBe("0.10");
    expect(formatSignatureAmount(undefined)).toBe("0.00");
  });

  it("orders Deposit's fields with refTransactionID before transactionID", () => {
    const params = {
      agentID: "A",
      userID: "U",
      amount: 1,
      refTransactionID: "REF",
      transactionID: "TXN",
      roundID: "R",
      gameID: 9,
    };
    // Deposit must differ from Withdraw purely by the inserted ref.
    expect(loginxSign("Deposit", "k", params)).not.toBe(loginxSign("Withdraw", "k", params));
    expect(loginxSign("RollbackTransaction", "k", { agentID: "A", userID: "U", refTransactionID: "REF", gameID: 9 })).toMatch(/^[0-9A-F]{64}$/);
  });
});

describe("detectOperation", () => {
  it("distinguishes the five operations from their field shapes", () => {
    expect(detectOperation({ agentID: "a", userID: "u", gameID: 1 })).toBe("GetBalance");
    expect(detectOperation({ agentID: "a", userID: "u", betAmount: 1, winAmount: 0, transactionID: "t", roundID: "r", gameID: 1 })).toBe("BetWin");
    expect(detectOperation({ agentID: "a", userID: "u", amount: 1, transactionID: "t", roundID: "r", gameID: 1 })).toBe("Withdraw");
    expect(detectOperation({ agentID: "a", userID: "u", amount: 1, refTransactionID: "ref", transactionID: "t", roundID: "r", gameID: 1 })).toBe("Deposit");
    // Rollback has a ref but NO transactionID — that absence is what sets it apart.
    expect(detectOperation({ agentID: "a", userID: "u", refTransactionID: "ref", gameID: 1 })).toBe("RollbackTransaction");
  });
});

describe("LoginxGamesAggregator catalogue", () => {
  it("sends the bearer token and reads the GitSlotPark gamelist path", async () => {
    let seen: { headers: Record<string, string | string[] | undefined>; url?: string } | null = null;
    const baseUrl = await startVendor((request, send) => {
      seen = request;
      send(200, catalogue("Pragmatic Play", 3));
    });

    const games = await new LoginxGamesAggregator({ vendors: [vendor(baseUrl)], currency: "TRY" }).listGames();

    expect(seen!.url).toBe("/gamelist");
    expect(seen!.headers.authorization).toBe("Bearer tok-1");
    expect(games).toHaveLength(3);
    expect(games[0]).toMatchObject({
      externalId: "2000",
      provider: "Pragmatic Play",
      category: "slot",
      realSupported: true,
      // Launch needs the vendor key to pick the right host.
      launchRouter: "pragmatic",
    });
  });

  it("keeps importing the healthy vendors when one answers with a non-zero code", async () => {
    const goodUrl = await startVendor((_request, send) => send(200, catalogue("Amatic", 2)));
    const badUrl = await startVendor((_request, send) => send(200, { code: 7, message: "invalid auth token" }));

    const games = await new LoginxGamesAggregator({
      vendors: [vendor(goodUrl, { key: "amatic" }), vendor(badUrl, { key: "pgsoft" })],
      currency: "TRY",
    }).listGames();

    expect(games).toHaveLength(2);
    expect(games.every((game) => game.provider === "Pragmatic Play")).toBe(true);
  });
});

describe("LoginxGamesAggregator launch", () => {
  it("posts userAuth and returns the URL the provider hands back", async () => {
    let seen: { url?: string; headers: Record<string, string | string[] | undefined>; body: string } | null = null;
    const baseUrl = await startVendor((request, send) => {
      seen = request;
      send(200, { code: 0, message: "OK", url: "https://game.gitslotpark.com/open.Game?token=abc" });
    });

    const result = await new LoginxGamesAggregator({ vendors: [vendor(baseUrl)], currency: "TRY" }).launchSession({
      externalGameId: "2001",
      playerId: "player-id",
      playerLogin: "Player01",
      currency: "TRY",
      locale: "tr",
      mode: "real",
      returnUrl: "https://oursite.com/play/some-game",
      sessionToken: "session",
      launchRouter: "pragmatic",
    });

    expect(seen!.url).toBe("/userAuth");
    expect(seen!.headers.authorization).toBe("Bearer tok-1");
    const body = JSON.parse(seen!.body) as Record<string, unknown>;
    // The provider addresses the player by login, and gameid is an integer.
    expect(body).toMatchObject({
      agentID: "agent-1",
      userID: "Player01",
      gameid: 2001,
      isaffiliate: false,
      lobbyUrl: "https://oursite.com/play/some-game",
    });
    expect(result.launchUrl).toBe("https://game.gitslotpark.com/open.Game?token=abc");
  });

  it("refuses to launch while any vendor's signing credentials are incomplete", async () => {
    const adapter = new LoginxGamesAggregator({
      vendors: [{ ...vendor("http://localhost"), agentId: "", signingReady: false }],
      currency: "TRY",
    });
    expect(adapter.isConfigured).toBe(false);

    await expect(
      adapter.launchSession({
        externalGameId: "2001",
        playerId: "p",
        currency: "TRY",
        locale: "tr",
        mode: "real",
        returnUrl: "https://x",
        sessionToken: "s",
      }),
    ).rejects.toThrow(/loginx/);
  });
});

describe("LoginxGamesAggregator callback handling", () => {
  const secret = "1234567890";
  const adapter = () =>
    new LoginxGamesAggregator({
      vendors: [vendor("http://localhost", { secretKey: secret })],
      currency: "TRY",
    });

  it("verifies a callback signed with the per-operation field order", () => {
    const payload = {
      agentID: "agent-1",
      userID: "Player01",
      amount: 12.3,
      transactionID: "t1",
      roundID: "r1",
      gameID: 2001,
    };
    const signed = { ...payload, sign: loginxSign("Withdraw", secret, payload) };
    expect(adapter().verifyCallback(JSON.stringify(signed), {})).toBe(true);
    // A tampered amount must fail.
    expect(adapter().verifyCallback(JSON.stringify({ ...signed, amount: 99 }), {})).toBe(false);
    // An unknown agentID has no secret to check against.
    expect(adapter().verifyCallback(JSON.stringify({ ...signed, agentID: "other" }), {})).toBe(false);
  });

  it("parses each callback into the ledger's command shape", () => {
    const parse = (payload: Record<string, unknown>) => adapter().parseWalletCallback!(payload);

    expect(parse({ agentID: "a", userID: "u", gameID: 1 })).toMatchObject({ command: "BALANCE", playerLogin: "u" });
    expect(parse({ agentID: "a", userID: "u", betAmount: 1, winAmount: 0.5, transactionID: "t", roundID: "r", gameID: 1 })).toMatchObject({
      command: "WRITE_BET",
      transactionId: "t",
      bet: "1.00",
      win: "0.50",
    });
    expect(parse({ agentID: "a", userID: "u", amount: 1, transactionID: "t", roundID: "r", gameID: 1 })).toMatchObject({
      command: "WITHDRAW",
      bet: "1.00",
    });
    expect(parse({ agentID: "a", userID: "u", amount: 3.4, refTransactionID: "REF", transactionID: "t", roundID: "r", gameID: 1 })).toMatchObject({
      command: "DEPOSIT",
      win: "3.40",
      refTransactionId: "REF",
    });
    expect(parse({ agentID: "a", userID: "u", refTransactionID: "REF", gameID: 1 })).toMatchObject({
      command: "ROLLBACK",
      // Rollback is addressed by the original call's transaction id.
      transactionId: "REF",
    });
  });

  it("answers a business failure with HTTP 200 and a result code", () => {
    const instance = adapter();
    // Gregmorn needs 400 to stop a spin; this family documents 200 as the only
    // expected status and reads the failure from the body.
    expect(instance.walletErrorStatus).toBe(200);
    expect(instance.walletError({ message: "insufficient funds", code: 6 })).toEqual({ code: 6, message: "insufficient funds" });
    expect(instance.walletResponse({ balance: "103.40" })).toEqual({ code: 0, message: "", balance: 103.4 });
    // The money-moving operations echo our reference back to the provider.
    expect(instance.walletResponse({ balance: "103.40", transactionId: "txn-1" })).toEqual({
      code: 0,
      message: "",
      balance: 103.4,
      platformTransactionID: "txn-1",
    });
  });

  it("maps pre-settlement failures to the specific result code", () => {
    const instance = adapter();
    // Codes 3, 5 and 2 come from the published examples beside each operation.
    expect(instance.walletFailureCode("invalid_signature")).toBe(3);
    expect(instance.walletFailureCode("player_not_found")).toBe(5);
    expect(instance.walletFailureCode("unknown_command")).toBe(2);
  });

  it("maps internal failures to the provider's documented result codes", () => {
    const instance = adapter();
    const withCode = (code: string) => Object.assign(new Error(code), { code });
    expect(instance.errorCodeFor(withCode("INSUFFICIENT_FUNDS"))).toBe(6);
    expect(instance.errorCodeFor(withCode("VALIDATION"))).toBe(2);
    expect(instance.errorCodeFor(new Error("boom"))).toBe(1);
  });

  it("maps a missing reference to 8 for a deposit and 9 for a rollback", () => {
    // The documented code set is per operation: a rollback has no 8, so an
    // unmatched rollback reference is "already rolled back" (9) instead.
    const instance = adapter();
    const missing = Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    expect(instance.errorCodeFor(missing, "DEPOSIT")).toBe(8);
    expect(instance.errorCodeFor(missing, "ROLLBACK")).toBe(9);
  });
});

describe("loginxVendorsFromEnv", () => {
  it("uses the GitSlotPark-family hosts from the specs, not the edge aliases", () => {
    const values: Record<string, string> = {
      LOGINX_PRAGMATIC_AGENTID: "agent",
      LOGINX_PRAGMATIC_APITOKEN: "token",
      LOGINX_PRAGMATIC_SECRETKEY: "secret",
      LOGINX_PGSOFT_APITOKEN: "t2",
    };

    const vendors = loginxVendorsFromEnv((key) => values[key] ?? "");

    expect(vendors.map((v) => v.baseUrl)).toEqual(["https://apiv2.gitslotpark.com", "https://pgapi.gitslotpark.com"]);
    // A vendor with a token but no agent/secret can read its catalogue but must
    // not be treated as able to settle money.
    expect(vendors[0]!.signingReady).toBe(true);
    expect(vendors[1]!.signingReady).toBe(false);
  });

  it("skips a vendor with no token and honours a host override", () => {
    const values: Record<string, string> = {
      LOGINX_PRAGMATIC_APITOKEN: "token",
      LOGINX_PRAGMATIC_HOST: "https://staging.example.com",
      LOGINX_AMATIC_AGENTID: "agent-only",
    };

    const vendors = loginxVendorsFromEnv((key) => values[key] ?? "");

    expect(vendors).toHaveLength(1);
    expect(vendors[0]!.baseUrl).toBe("https://staging.example.com");
  });
});