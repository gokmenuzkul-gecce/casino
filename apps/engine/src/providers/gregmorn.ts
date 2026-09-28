import { createHmac } from "node:crypto";
import { Errors } from "@aurora/shared";
import { env } from "../lib/env.js";
import { HttpClient, verifyHmac } from "../lib/http.js";
import type { ProviderHealth } from "./types.js";
import type {
  AggregatorGame,
  GameAggregatorAdapter,
  LaunchSessionRequest,
  LaunchSessionResult,
  ParsedWalletCallback,
} from "./aggregator.js";

/**
 * Gregmorn Hub adapter.
 *
 * Gregmorn speaks a shape no generic REST aggregator does, so it gets its own
 * adapter rather than a profile in the generic one:
 *
 * - two hosts: `office-api` for auth + catalogue, `client-api` for game launch;
 * - auth is a form-encoded login exchanging username/password for a short-lived
 *   bearer token, refreshed on 401 rather than per request;
 * - launch and every wallet callback are signed with HMAC-SHA256 over the exact
 *   raw JSON bytes, using the merchant secret key;
 * - the seamless-wallet callbacks are command-based (`getBalance`, `writeBet`,
 *   `rollback`) and answer in Gregmorn's own envelope, not ours.
 *
 * Stage and prod are separate environments with separate credentials and IP
 * allowlists, so all of the above is configuration, never code.
 */

export interface GregmornConfig {
  /** Host serving /auth/login and the game catalogue. */
  officeBaseUrl: string;
  /** Host serving /games/openGame and /games/freespinsInfo. */
  clientBaseUrl: string;
  /** Operator login issued by Gregmorn. */
  login: string;
  password: string;
  /** Merchant secret key used to sign outbound calls and verify callbacks. */
  secretKey: string;
  /** API user id issued by Gregmorn; travels as `user_id` on launch. */
  userId: string;
  /** Currency whose catalogue and sessions we operate. */
  currency: string;
}

interface TokenState {
  accessToken: string;
  expiresAt: number;
}

/** Catalogue row as Gregmorn returns it. */
interface GregmornGame {
  id: string;
  isEnabled: boolean;
  title: string;
  imageUrl: string;
  provider: string;
}

const TOKEN_SKEW_MS = 30_000;

export class GregmornAggregator implements GameAggregatorAdapter {
  readonly kind = "gameAggregator" as const;
  readonly name = "gregmorn";
  readonly isConfigured: boolean;
  readonly mode: "demo" | "live";
  readonly isInternal = false;

  private readonly office: HttpClient;
  private readonly client: HttpClient;
  private token: TokenState | null = null;
  /** Single in-flight login, so a burst of requests does not stampede /auth/login. */
  private loginPromise: Promise<TokenState> | null = null;

  constructor(private readonly config: GregmornConfig) {
    this.isConfigured = Boolean(
      config.officeBaseUrl && config.clientBaseUrl && config.login && config.password && config.secretKey && config.userId,
    );
    this.mode = this.isConfigured && env.platformMode === "live" ? "live" : "demo";
    this.office = new HttpClient(config.officeBaseUrl, {}, "gregmorn");
    this.client = new HttpClient(config.clientBaseUrl, {}, "gregmorn");
  }

  // ── auth ──────────────────────────────────────────────────────────────

  private async authenticate(): Promise<TokenState> {
    if (!this.isConfigured) throw Errors.providerDisabled("Gregmorn");
    if (this.token && this.token.expiresAt - TOKEN_SKEW_MS > Date.now()) return this.token;
    this.loginPromise ??= this.performLogin().finally(() => {
      this.loginPromise = null;
    });
    return this.loginPromise;
  }

  private async performLogin(): Promise<TokenState> {
    const body = new URLSearchParams({ login: this.config.login, password: this.config.password }).toString();
    const response = await this.office.request<{ accessToken?: string }>({
      method: "POST",
      path: "/auth/login",
      body,
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });

    if (!response.accessToken) throw Errors.providerError(this.name, "Login yanitinda accessToken yok");
    const state: TokenState = { accessToken: response.accessToken, expiresAt: jwtExpiry(response.accessToken) };
    this.token = state;
    return state;
  }

  /** Run a call with a bearer token, retrying once on 401 with a fresh login. */
  private async authed<T>(run: (token: string) => Promise<T>): Promise<T> {
    const { accessToken } = await this.authenticate();
    try {
      return await run(accessToken);
    } catch (error) {
      if (!isUnauthorized(error)) throw error;
      this.token = null;
      const refreshed = await this.authenticate();
      return run(refreshed.accessToken);
    }
  }

  // ── catalogue ─────────────────────────────────────────────────────────

  async listGames(params: { page?: number; pageSize?: number; category?: string }): Promise<AggregatorGame[]> {
    if (!this.isConfigured) throw Errors.providerDisabled("Gregmorn");
    const currency = this.config.currency || env.currency;

    const rows = await this.authed((token) =>
      this.office.request<GregmornGame[]>({
        path: `/users/${encodeURIComponent(this.config.userId)}/getUserGames/${encodeURIComponent(currency)}`,
        headers: { authorization: `Bearer ${token}` },
      }),
    );

    const enabled = (Array.isArray(rows) ? rows : []).filter((row) => row.isEnabled !== false);
    const filtered = params.category ? enabled.filter((row) => categorize(row).includes(params.category!.toUpperCase())) : enabled;

    return filtered.map((row) => ({
      externalId: row.id,
      name: row.title,
      category: categorize(row),
      provider: row.provider || vendorFromId(row.id),
      thumbnailUrl: row.imageUrl,
      currencies: [currency],
      demoSupported: true,
      realSupported: true,
    }));
  }

  // ── launch ────────────────────────────────────────────────────────────

  async launchSession(request: LaunchSessionRequest): Promise<LaunchSessionResult> {
    if (!this.isConfigured) throw Errors.providerDisabled("Gregmorn");

    const payload = {
      currency: request.currency || this.config.currency,
      demo: request.mode === "demo" ? "1" : "0",
      exitUrl: request.returnUrl,
      gameId: request.externalGameId,
      language: request.locale || "en",
      player_login: request.playerLogin ?? request.playerId,
      user_id: this.config.userId,
      ...(request.ip ? { ip: request.ip } : {}),
      ...(request.callbackUrlOverride ? { callbackUrl: request.callbackUrlOverride } : {}),
    };

    // The signature is over the exact bytes we transmit, so serialise once.
    const rawBody = JSON.stringify(payload);
    const response = await this.client.request<{
      status?: string;
      error?: string;
      message?: string;
      content?: { game?: { url?: string }; gameRes?: { sessionId?: string } };
    }>({
      method: "POST",
      path: "/games/openGame",
      body: rawBody,
      headers: { "content-type": "application/json", "x-signature": this.sign(rawBody) },
    });

    const launchUrl = response.content?.game?.url;
    if (response.status !== "success" || !launchUrl) {
      throw Errors.providerError(this.name, response.message ?? response.error ?? "Oyun oturumu acilamadi");
    }

    return { launchUrl, sessionId: response.content?.gameRes?.sessionId ?? "" };
  }

  /** Free-spin eligibility for a game in our currency. */
  async freespinsInfo(input: { gameId: string; currency?: string }): Promise<{
    code: number;
    availableBets: number[];
    maxCount: number;
    message: string;
  }> {
    if (!this.isConfigured) throw Errors.providerDisabled("Gregmorn");

    const payload = {
      user_id: this.config.userId,
      currency: input.currency || this.config.currency || env.currency,
      gameId: input.gameId,
    };
    const rawBody = JSON.stringify(payload);
    const response = await this.client.request<{
      code?: number;
      availableBets?: number[];
      maxCount?: number;
      message?: string;
    }>({
      method: "POST",
      path: "/games/freespinsInfo",
      body: rawBody,
      headers: { "content-type": "application/json", "x-signature": this.sign(rawBody) },
    });

    return {
      code: typeof response.code === "number" ? response.code : 9,
      availableBets: Array.isArray(response.availableBets) ? response.availableBets : [],
      maxCount: typeof response.maxCount === "number" ? response.maxCount : 0,
      message: response.message ?? "",
    };
  }

  // ── signatures ────────────────────────────────────────────────────────

  private sign(rawBody: string): string {
    return createHmac("sha256", this.config.secretKey).update(rawBody).digest("hex");
  }

  /**
   * Gregmorn signs wallet callbacks with HMAC-SHA256 over the raw body bytes
   * using the merchant secret key. Anything else is rejected, so the raw body
   * captured by the server is what gets verified here.
   */
  verifyCallback(rawBody: string, headers: Record<string, string | undefined>): boolean {
    if (!this.config.secretKey) return false;
    const signature = headers["x-signature"] ?? headers["X-Signature"];
    if (!signature) return false;
    return verifyHmac(this.config.secretKey, rawBody, signature);
  }

  /**
   * Map a Gregmorn wallet callback to the normalised shape. `bet` and `win`
   * may arrive as numbers or strings depending on the underlying vendor, so
   * they are stringified here.
   */
  parseWalletCallback(payload: Record<string, unknown>): ParsedWalletCallback | null {
    const cmd = String(payload.cmd ?? "");
    const command =
      cmd === "getBalance" ? "BALANCE" : cmd === "writeBet" ? "WRITE_BET" : cmd === "rollback" ? "ROLLBACK" : null;
    if (!command) return null;

    return {
      command,
      playerLogin: String(payload.login ?? ""),
      transactionId: String(payload.transactionId ?? ""),
      bet: optionalAmount(payload.bet),
      win: optionalAmount(payload.win),
      sessionId: payload.sessionid === undefined ? undefined : String(payload.sessionid),
      gameId: payload.gameId === undefined ? undefined : String(payload.gameId),
      roundId: payload.roundId === undefined ? undefined : String(payload.roundId),
      roundFinished: typeof payload.round_finished === "boolean" ? payload.round_finished : undefined,
      info: payload.info === undefined ? undefined : String(payload.info),
    };
  }

  walletResponse(input: { login: string; balance: string; currency: string }): Record<string, unknown> {
    return { balance: Number(input.balance), currency: input.currency, error: "", login: input.login, status: "success" };
  }

  walletError(input: { login: string; currency: string; message: string }): Record<string, unknown> {
    return { balance: 0, currency: input.currency, error: input.message, login: input.login, status: "fail" };
  }

  async healthCheck(): Promise<ProviderHealth> {
    const base = {
      kind: this.kind,
      provider: this.name,
      mode: this.mode,
      checkedAt: new Date().toISOString(),
    } as const;

    if (!this.isConfigured) {
      return { ...base, configured: false, reachable: null, detail: "Gregmorn kimlik bilgileri eksik" };
    }
    try {
      await this.authenticate();
      return { ...base, configured: true, reachable: true, detail: "Auth ve katalog erisimi dogrulandi" };
    } catch (error) {
      return {
        ...base,
        configured: true,
        reachable: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/** Bet/win amounts arrive as number or string by vendor; normalise to string. */
function optionalAmount(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : undefined;
  const text = String(value).trim();
  return text === "" ? undefined : text;
}

/** Read `exp` out of a JWT without verifying it: we only need a refresh hint. */
function jwtExpiry(token: string): number {
  try {
    const payload = token.split(".")[1];
    if (!payload) return Date.now() + 600_000;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: number };
    return decoded.exp ? decoded.exp * 1000 : Date.now() + 600_000;
  } catch {
    return Date.now() + 600_000;
  }
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof Error && /HTTP 401/.test(error.message);
}

/** Game ids are `integration:provider:game`, so the vendor survives without a field. */
function vendorFromId(id: string): string {
  const parts = id.split(":");
  return parts.length >= 2 ? parts[1]! : "Gregmorn";
}

/**
 * Gregmorn's catalogue carries no category, so infer one from the vendor/title.
 * Everything unmatched lands in the slots bucket, which is the safe default.
 */
function categorize(game: { provider?: string; title?: string }): string {
  const haystack = `${game.provider ?? ""} ${game.title ?? ""}`.toLowerCase();
  if (/(evolution|live|dealer|roulette|blackjack|baccarat|poker)/.test(haystack)) return "LIVE_CASINO";
  if (/(crash|aviator|jet|mines|plinko|dice|limbo|keno)/.test(haystack)) return "INSTANT";
  if (/(lottery|bingo)/.test(haystack)) return "LOTTERY";
  return "SLOTS";
}
