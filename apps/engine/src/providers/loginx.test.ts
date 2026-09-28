import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { LoginxGamesAggregator, loginxVendorsFromEnv } from "../providers/loginx.js";

/**
 * The loginxgamesapi catalogue read, against a real HTTP server.
 *
 * Three things are worth pinning down, each measured against the live API first:
 *  - `Authorization: Bearer <apitoken>` is the auth header; the agent id and
 *    secret key do not authenticate a catalogue read.
 *  - One non-zero `code` vendor must not stop the other vendors importing.
 *  - A browser-like User-Agent is mandatory (Cloudflare answers 1010 otherwise),
 *    and launch is refused rather than guessed.
 *
 * A real server is used rather than a mocked fetch so the request shape the
 * vendor actually receives is what is asserted.
 */

const servers: Server[] = [];

async function startVendor(
  handler: (request: { url?: string; headers: Record<string, string | string[] | undefined> }, send: (status: number, body: unknown) => void) => void,
): Promise<string> {
  const server = createServer((request, response) => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    request.resume();
    handler({ url: request.url, headers: request.headers }, send);
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

describe("LoginxGamesAggregator", () => {
  it("sends the bearer token and a browser user-agent, and normalises the catalogue", async () => {
    let seen: { headers: Record<string, string | string[] | undefined>; url?: string } | null = null;
    const baseUrl = await startVendor((request, send) => {
      seen = request;
      send(200, catalogue("Pragmatic Play", 3));
    });

    const adapter = new LoginxGamesAggregator({
      vendors: [{ key: "pragmatic", vendor: "Pragmatic Play", baseUrl, agentId: "agent-1", apiToken: "tok-1", secretKey: "sec-1" }],
      currency: "TRY",
    });

    const games = await adapter.listGames();

    expect(seen!.url).toBe("/GameList");
    expect(seen!.headers.authorization).toBe("Bearer tok-1");
    // Cloudflare 1010 rejects a missing/AT-AT user agent before the API is reached.
    expect(String(seen!.headers["user-agent"])).toContain("Mozilla/5.0");

    expect(games).toHaveLength(3);
    expect(games[0]).toMatchObject({
      externalId: "2000",
      name: "Pragmatic Play Game 0",
      category: "slot",
      provider: "Pragmatic Play",
      thumbnailUrl: "https://cdn.example/Pragmatic Play/0.png",
      currencies: ["TRY"],
      // Nothing can be launched, so nothing is advertised as playable.
      demoSupported: false,
      realSupported: false,
    });
  });

  it("keeps importing the healthy vendors when one answers with a non-zero code", async () => {
    const goodUrl = await startVendor((_request, send) => send(200, catalogue("Amatic", 2)));
    const badUrl = await startVendor((_request, send) => send(200, { code: 7, message: "invalid auth token" }));

    const adapter = new LoginxGamesAggregator({
      vendors: [
        { key: "amatic", vendor: "Amatic", baseUrl: goodUrl, agentId: "a", apiToken: "t", secretKey: "s" },
        { key: "pgsoft", vendor: "PG Soft", baseUrl: badUrl, agentId: "a", apiToken: "bad", secretKey: "s" },
      ],
      currency: "TRY",
    });

    const games = await adapter.listGames();

    expect(games).toHaveLength(2);
    expect(games.every((game) => game.provider === "Amatic")).toBe(true);
  });

  it("refuses to launch instead of returning a URL that cannot open", async () => {
    const baseUrl = await startVendor((_request, send) => send(200, catalogue("Pragmatic Play", 1)));
    const adapter = new LoginxGamesAggregator({
      vendors: [{ key: "pragmatic", vendor: "Pragmatic Play", baseUrl, agentId: "a", apiToken: "t", secretKey: "s" }],
      currency: "TRY",
    });

    await expect(
      adapter.launchSession({
        externalGameId: "2000",
        playerId: "p1",
        currency: "TRY",
        locale: "tr",
        mode: "real",
        returnUrl: "https://example.com",
        sessionToken: "session",
      }),
    ).rejects.toThrow(/launch/i);
  });

  it("reports each vendor and the catalogue-only limit in its health detail", async () => {
    const url = await startVendor((_request, send) => send(200, catalogue("Pragmatic Play", 5)));
    const adapter = new LoginxGamesAggregator({
      vendors: [{ key: "pragmatic", vendor: "Pragmatic Play", baseUrl: url, agentId: "a", apiToken: "t", secretKey: "s" }],
      currency: "TRY",
    });

    const health = await adapter.healthCheck();

    expect(health.configured).toBe(true);
    expect(health.reachable).toBe(true);
    expect(health.detail).toContain("Pragmatic Play: 5 oyun");
    expect(health.detail).toMatch(/SADECE KATALOG/);
    // It can never be a live-money provider while launch and wallet are missing.
    expect(health.mode).toBe("demo");
  });
});

describe("loginxVendorsFromEnv", () => {
  it("builds a vendor per configured token and defaults the host", () => {
    const values: Record<string, string> = {
      LOGINX_PRAGMATIC_AGENTID: "agent",
      LOGINX_PRAGMATIC_APITOKEN: "token",
      LOGINX_PRAGMATIC_SECRETKEY: "secret",
    };

    const vendors = loginxVendorsFromEnv((key) => values[key] ?? "");

    expect(vendors).toHaveLength(1);
    expect(vendors[0]).toMatchObject({
      key: "pragmatic",
      vendor: "Pragmatic Play",
      baseUrl: "https://pk2api.loginxgamesapi.com",
      apiToken: "token",
    });
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
