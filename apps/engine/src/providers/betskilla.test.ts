import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { BetSkillaAggregator } from "../providers/betskilla.js";

/**
 * Session renewal against the operator host.
 *
 * The vendor does not answer 401/403 for a dead session: it answers 400 with
 * `{"error":true,"code":266,"message":"game is not available"}`. Because the
 * adapter caches one cookie for its lifetime, a server that outlived that
 * cookie failed every launch with that opaque 400 until it was restarted.
 *
 * This runs a real HTTP server that behaves like the vendor, so the re-login
 * path is exercised end to end rather than asserted against a mock.
 */

interface Harness {
  baseUrl: string;
  server: Server;
  /** Invalidate the session the client currently holds, without telling it. */
  expireSessions: () => void;
  /** Reject every launch outright, as an unlaunchable game does. */
  refuseLaunches: () => void;
  logins: () => number;
}

const servers: Server[] = [];

async function startVendor(): Promise<Harness> {
  let validSession = "";
  let sessionSeq = 0;
  let loginCount = 0;
  let refuse = false;

  const server = createServer((request, response) => {
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      const payload = JSON.stringify(body);
      response.writeHead(status, { "content-type": "application/json", ...headers });
      response.end(payload);
    };

    if (request.url === "/api/client-login") {
      request.resume();
      loginCount++;
      validSession = `sid-${++sessionSeq}`;
      send(200, { ok: true }, { "set-cookie": `client.sid=${validSession}; Path=/; HttpOnly` });
      return;
    }

    if (request.url?.startsWith("/api/games/")) {
      request.resume();
      const cookie = request.headers.cookie ?? "";
      const presented = /client\.sid=([^;]+)/.exec(cookie)?.[1] ?? "";
      if (refuse || presented !== validSession) {
        send(400, { error: true, code: 266, message: "game is not available" });
        return;
      }
      send(200, { type: "url", sessionId: "session-1", value: "https://vendor.example/play/session-1" });
      return;
    }

    send(404, { error: true, message: "not found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    server,
    expireSessions: () => {
      validSession = "";
    },
    refuseLaunches: () => {
      refuse = true;
    },
    logins: () => loginCount,
  };
}

function buildAdapter(baseUrl: string): BetSkillaAggregator {
  return new BetSkillaAggregator({ baseUrl, login: "operator", password: "secret", currency: "INR" });
}

const launch = (adapter: BetSkillaAggregator) =>
  adapter.launchSession({
    externalGameId: "1",
    launchRouter: "qt/example-game",
    playerId: "player",
    playerLogin: "player_one",
    currency: "TRY",
    mode: "real",
    returnUrl: "https://aurora.example/play/example",
    sessionToken: "token",
  });

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe("BetSkilla session renewal", () => {
  it("re-authenticates and launches when the cached session has expired", async () => {
    const vendor = await startVendor();
    const adapter = buildAdapter(vendor.baseUrl);

    const first = await launch(adapter);
    expect(first.launchUrl).toBe("https://vendor.example/play/session-1");
    expect(vendor.logins()).toBe(1);

    // The vendor drops the session server-side; the adapter still holds the old
    // cookie and must notice the 400 and log in again.
    vendor.expireSessions();

    const second = await launch(adapter);
    expect(second.launchUrl).toBe("https://vendor.example/play/session-1");
    expect(vendor.logins()).toBe(2);
  });

  it("does not retry a launch the vendor genuinely refuses", async () => {
    const vendor = await startVendor();
    const adapter = buildAdapter(vendor.baseUrl);
    vendor.refuseLaunches();

    await expect(launch(adapter)).rejects.toThrow(/HTTP 400/);
    // A login performed inside this call cannot be stale, so a second attempt
    // would only add latency and hide the real error.
    expect(vendor.logins()).toBe(1);
  });
});
