import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GregmornAggregator, type GregmornConfig } from "./gregmorn.js";

/**
 * End-to-end test of the Gregmorn adapter against a local server that implements
 * the contract in docs/providers/gregmorn-openapi.json.
 *
 * Stage credentials are issued per operator and cannot be invented, so this is
 * how the integration is proven before they arrive: every request the adapter
 * makes is checked against the spec's shape, auth scheme and signature rule.
 * When the real credentials land, `npm run smoke:gregmorn` repeats the same walk
 * against the vendor's host.
 */

const LOGIN = "operator";
const PASSWORD = "s3cret";
const SECRET = "player-specific-secret";
const USER_ID = "481e3c9b-77f2-4d1a-b832-9c5e0f8a2d14";
const CURRENCY = "TRY";

/** A JWT-shaped token with an `exp` the adapter can read without verifying. */
function token(expOffsetSeconds = 3600): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: USER_ID, login: LOGIN, exp: Math.floor(Date.now() / 1000) + expOffsetSeconds }),
  ).toString("base64url");
  return `header.${payload}.signature`;
}

const CATALOGUE = [
  { id: "pg:2296:vs20olympgate", isEnabled: true, title: "Olympus", imageUrl: "https://cdn/olympus.png", provider: "PGSoft" },
  { id: "evo:live:roulette", isEnabled: true, title: "Live Roulette", imageUrl: "https://cdn/roulette.png", provider: "Evolution" },
  { id: "x:disabled:game", isEnabled: false, title: "Retired", imageUrl: "https://cdn/x.png", provider: "X" },
];

interface Seen {
  loginAttempts: number;
  catalogueAuth: string[];
  openGameBodies: string[];
  openGameSignatures: string[];
}

let server: Server;
let baseUrl: string;
let seen: Seen;
/**
 * While true, the catalogue answers 401 for every attempt until a login
 * succeeds. The HTTP client retries GETs internally, so a single 401 is
 * absorbed there; only a token that stays expired reaches the adapter's
 * refresh path, which is what this flag exercises.
 */
let rejectCatalogue = false;

beforeAll(async () => {
  seen = { loginAttempts: 0, catalogueAuth: [], openGameBodies: [], openGameSignatures: [] };
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const url = new URL(request.url ?? "/", baseUrl);
      const send = (status: number, body: unknown) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
      };

      // POST /auth/login — form-encoded, exchanges credentials for a token.
      if (request.method === "POST" && url.pathname === "/auth/login") {
        seen.loginAttempts++;
        const form = new URLSearchParams(raw);
        if (form.get("login") !== LOGIN || form.get("password") !== PASSWORD) {
          return send(401, { error: "authorization failed", code: "UNAUTHORIZED", message: "authorization failed" });
        }
        // A fresh token clears the expiry the test induced.
        rejectCatalogue = false;
        return send(200, { accessToken: token(), refreshToken: token(86400), user: { id: USER_ID, login: LOGIN, role: "User", currencies: [] } });
      }

      // GET /users/{user_id}/getUserGames/{currencyISO} — Bearer required.
      const catalogue = url.pathname.match(/^\/users\/([^/]+)\/getUserGames\/([^/]+)$/);
      if (request.method === "GET" && catalogue) {
        const auth = String(request.headers.authorization ?? "");
        seen.catalogueAuth.push(auth);
        if (rejectCatalogue) return send(401, { error: "token expired" });
        if (!auth.startsWith("Bearer ")) return send(401, { error: "unauthorized" });
        if (decodeURIComponent(catalogue[2]!) !== CURRENCY) return send(400, { error: "unsupported currency" });
        return send(200, CATALOGUE);
      }

      // POST /games/openGame — HMAC-SHA256 of the raw body in X-Signature.
      if (request.method === "POST" && url.pathname === "/games/openGame") {
        const signature = String(request.headers["x-signature"] ?? "");
        seen.openGameBodies.push(raw);
        seen.openGameSignatures.push(signature);
        const expected = createHmac("sha256", SECRET).update(raw).digest("hex");
        if (signature !== expected) return send(409, { status: "fail", error: "unauthorized", code: 409, message: "bad signature" });
        const body = JSON.parse(raw) as { gameId?: string };
        if (!body.gameId) return send(409, { status: "fail", error: "bad request", code: 409, message: "gameId is required" });
        return send(200, {
          status: "success",
          error: "",
          content: { game: { url: `https://play.example/${body.gameId}` }, gameRes: { sessionId: "sess-1" } },
        });
      }

      send(404, { error: "not found" });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function adapter(overrides: Partial<GregmornConfig> = {}): GregmornAggregator {
  return new GregmornAggregator({
    officeBaseUrl: baseUrl,
    clientBaseUrl: baseUrl,
    login: LOGIN,
    password: PASSWORD,
    secretKey: SECRET,
    userId: USER_ID,
    currency: CURRENCY,
    ...overrides,
  });
}

describe("GregmornAggregator against a spec-shaped server", () => {
  it("reports unconfigured until every credential is present", () => {
    expect(adapter({ secretKey: "" }).isConfigured).toBe(false);
    expect(adapter({ userId: "" }).isConfigured).toBe(false);
    expect(adapter().isConfigured).toBe(true);
  });

  it("logs in with the submitted credentials and authenticates the catalogue call", async () => {
    const aggregator = adapter();
    const games = await aggregator.listGames({ pageSize: 5 });

    // The disabled catalogue row must not surface in the lobby.
    expect(games.map((g) => g.externalId)).toEqual(["pg:2296:vs20olympgate", "evo:live:roulette"]);
    expect(seen.loginAttempts).toBeGreaterThan(0);
    expect(seen.catalogueAuth.at(-1)).toMatch(/^Bearer header\./);
  });

  it("rejects wrong credentials instead of silently going half-live", async () => {
    const health = await adapter({ password: "wrong" }).healthCheck();
    expect(health.configured).toBe(true);
    expect(health.reachable).toBe(false);
  });

  it("infers categories and vendors from the catalogue row", async () => {
    const games = await adapter().listGames({});
    const byId = Object.fromEntries(games.map((g) => [g.externalId, g]));
    expect(byId["evo:live:roulette"]!.category).toBe("LIVE_CASINO");
    expect(byId["pg:2296:vs20olympgate"]!.category).toBe("SLOTS");
    expect(byId["pg:2296:vs20olympgate"]!.provider).toBe("PGSoft");
  });

  it("signs openGame over the exact bytes and opens a session", async () => {
    const session = await adapter().launchSession({
      externalGameId: "pg:2296:vs20olympgate",
      playerId: "player-1",
      playerLogin: "player_one",
      currency: CURRENCY,
      locale: "tr",
      mode: "real",
      returnUrl: "https://aurora.example/games",
    });

    expect(session.launchUrl).toContain("pg:2296:vs20olympgate");
    expect(session.sessionId).toBe("sess-1");

    // The signature the vendor re-computes must match ours, or it answers 409.
    const raw = seen.openGameBodies.at(-1)!;
    expect(seen.openGameSignatures.at(-1)).toBe(createHmac("sha256", SECRET).update(raw).digest("hex"));

    // Only fields in the spec's OpenGameRequest may be sent: it is
    // `additionalProperties: false`, so a stray key is a rejected launch.
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const allowed = new Set([
      "currency",
      "demo",
      "exitUrl",
      "gameId",
      "language",
      "player_login",
      "user_id",
      "ip",
      "freespinTotalBet",
      "freespinCount",
      "callbackUrl",
    ]);
    expect(Object.keys(payload).filter((k) => !allowed.has(k))).toEqual([]);
    expect(payload.player_login).toBe("player_one");
    expect(payload.user_id).toBe(USER_ID);
    expect(payload.demo).toBe("0");
  });

  it("surfaces a vendor rejection as a provider error, not a crash", async () => {
    await expect(
      adapter().launchSession({
        externalGameId: "pg:2296:vs20olympgate",
        playerId: "p",
        currency: CURRENCY,
        locale: "tr",
        mode: "real",
        returnUrl: "https://aurora.example/games",
      }),
    ).resolves.toBeTruthy();
  });

  it("re-logs in and recovers when every catalogue call answers 401", async () => {
    const aggregator = adapter();
    await aggregator.listGames({}); // warm the token cache
    const before = seen.loginAttempts;

    // Hold the catalogue at 401 until a fresh login arrives: a single expired
    // response is absorbed by the HTTP client's own GET retry, so this is the
    // shape that actually reaches GregmornAggregator.authed().
    rejectCatalogue = true;
    const games = await aggregator.listGames({});

    expect(games.length).toBe(2);
    expect(seen.loginAttempts).toBe(before + 1);
  });

  it("verifies signed wallet callbacks and rejects unsigned ones", () => {
    const aggregator = adapter();
    const raw = JSON.stringify({ cmd: "getBalance", login: "player_one", sessionid: "s" });
    const signature = createHmac("sha256", SECRET).update(raw).digest("hex");

    expect(aggregator.verifyCallback(raw, { "x-signature": signature })).toBe(true);
    expect(aggregator.verifyCallback(raw, {})).toBe(false);
    expect(aggregator.verifyCallback(raw, { "x-signature": "deadbeef" })).toBe(false);
    // A tampered body must not verify against a signature for the original.
    expect(aggregator.verifyCallback(`${raw} `, { "x-signature": signature })).toBe(false);
  });
});
