import { ProviderAdapter, ProviderHealth } from "./types.js";
import { env } from "../lib/env.js";
import { HttpClient, signHmac, verifyHmac, canonicalize } from "../lib/http.js";
import { Errors } from "@aurora/shared";

/** A game as reported by an external aggregator. */
export interface AggregatorGame {
  externalId: string;
  name: string;
  category: string;
  provider: string;
  thumbnailUrl?: string;
  bannerUrl?: string;
  rtp?: number;
  volatility?: string;
  lines?: number;
  reels?: number;
  minBet?: string;
  maxBet?: string;
  demoSupported?: boolean;
  realSupported?: boolean;
  currencies?: string[];
  jurisdictions?: string[];
  tags?: string[];
  releasedAt?: string;
  /**
   * Provider-side handle needed to open a session (e.g. BetSkilla's session
   * router). Persisted at sync time so launching never has to re-scan the
   * whole catalogue to rediscover it.
   */
  launchRouter?: string;
}

export interface LaunchSessionRequest {
  externalGameId: string;
  playerId: string;
  currency: string;
  locale: string;
  /** Demo sessions never touch the wallet. */
  mode: "demo" | "real";
  returnUrl: string;
  /** Token used by the aggregator to call our seamless-wallet callbacks. */
  sessionToken: string;
  ip?: string;
  userAgent?: string;
  /**
   * Human-readable player login some providers require alongside the user id.
   * Falls back to `playerId` when the provider does not need it.
   */
  playerLogin?: string;
  /** Per-session callback URL override, when the provider supports it. */
  callbackUrlOverride?: string;
  /** Provider-side launch handle persisted at sync time, when known. */
  launchRouter?: string;
}

export interface LaunchSessionResult {
  launchUrl: string;
  sessionId: string;
  expiresAt?: string;
}

/** Seamless-wallet operations the aggregator calls back into us. */
export interface SeamlessWalletRequest {
  playerId: string;
  currency: string;
  amount: string;
  externalTransactionId: string;
  roundId?: string;
  externalGameId: string;
  sessionToken: string;
}

/** Normalised wallet command, independent of a provider's own envelope. */
export type WalletCommand = "BALANCE" | "WRITE_BET" | "ROLLBACK" | "WITHDRAW" | "DEPOSIT";

/** A failure the wallet route detects before it reaches settlement. */
export type WalletFailureReason = "invalid_signature" | "unknown_command" | "player_not_found";

/**
 * A provider wallet callback reduced to the fields the ledger needs. Providers
 * that send bet and win in one message keep both; the route applies the net.
 * Amounts stay as the provider sent them (major units, number or string) and
 * are converted with the currency's precision further down.
 */
export interface ParsedWalletCallback {
  command: WalletCommand;
  /** Provider-side player identity, echoed back in every response. */
  playerLogin: string;
  /** Idempotency key. Empty for a pure balance read. */
  transactionId: string;
  bet?: string;
  win?: string;
  /** For DEPOSIT: the Withdraw this win settles. Rollback addresses it by this id. */
  refTransactionId?: string;
  sessionId?: string;
  gameId?: string;
  roundId?: string;
  roundFinished?: boolean;
  info?: string;
}

export interface GameAggregatorAdapter extends ProviderAdapter {
  readonly kind: "gameAggregator";
  listGames(params: { page?: number; pageSize?: number; category?: string }): Promise<AggregatorGame[]>;
  launchSession(request: LaunchSessionRequest): Promise<LaunchSessionResult>;
  /** Verify an inbound seamless-wallet callback signature. */
  verifyCallback(rawBody: string, headers: Record<string, string | undefined>): boolean;
  /** Demo implementation returns an internal route instead of a provider URL. */
  readonly isInternal: boolean;
  /**
   * Reduce a provider's wallet callback to the normalised shape, or null when
   * the provider uses a different wallet model (transfer instead of seamless).
   */
  parseWalletCallback?(payload: Record<string, unknown>): ParsedWalletCallback | null;
  /** Build this provider's success envelope for a wallet callback reply. */
  walletResponse?(input: { login: string; balance: string; currency: string; transactionId?: string }): Record<string, unknown>;
  /** Build this provider's failure envelope for a wallet callback reply. */
  walletError?(input: { login: string; currency: string; message: string; code?: number }): Record<string, unknown>;
  /**
   * HTTP status a business rejection is sent with. Gregmorn reads a non-200 as
   * "do not start the spin", so it needs 400. The GitSlotPark family documents
   * 200 as the only expected status and treats a non-200 as a failed
   * transaction to be rolled back, so it expects 200 with an error code in the
   * body instead. Defaults to 400 when absent.
   */
  readonly walletErrorStatus?: number;
  /**
   * Provider result code for a failure the route detects before settlement
   * (a bad sign, an unknown command, a missing player). Providers with a result
   * code table map these to their own numbers; providers without one return
   * undefined and only the message is sent.
   */
  walletFailureCode?(reason: WalletFailureReason): number;
  /**
   * Provider result code for a settlement failure. `command` is the operation
   * being answered, because the documented code set differs per operation — a
   * rollback reference that is missing is not the same code as a missing player.
   */
  errorCodeFor?(error: unknown, command?: WalletCommand): number;
  /** Free-spin limits for a game. Present only on providers that support them. */
  freespinsInfo?(input: { gameId: string; currency?: string }): Promise<{
    code: number;
    availableBets: number[];
    maxCount: number;
    message: string;
  }>;
}

/** Used when no aggregator is configured: internal games only, real content disabled. */
export class DisabledAggregator implements GameAggregatorAdapter {
  readonly kind = "gameAggregator" as const;
  readonly name = "none";
  readonly isConfigured = false;
  readonly mode = "demo" as const;
  readonly isInternal = true;

  async listGames(): Promise<AggregatorGame[]> {
    return [];
  }

  async launchSession(): Promise<LaunchSessionResult> {
    throw Errors.providerDisabled("Oyun agregatoru");
  }

  verifyCallback(): boolean {
    return false;
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      kind: this.kind,
      provider: this.name,
      mode: this.mode,
      configured: false,
      reachable: null,
      checkedAt: new Date().toISOString(),
      detail: "GAME_AGGREGATOR bos. Harici oyunlar devre disi, dahili oyunlar aktif.",
    };
  }
}

/**
 * Generic REST aggregator adapter. Most aggregators expose the same shape:
 * an authenticated game list, a launch endpoint that returns a URL, and
 * signed wallet callbacks. Provider-specific differences are handled by the
 * signature scheme and endpoint paths configured here.
 */
export class RestAggregator implements GameAggregatorAdapter {
  readonly kind = "gameAggregator" as const;
  readonly isConfigured: boolean;
  readonly mode: "demo" | "live";
  readonly isInternal = false;
  readonly name: string;
  private readonly http: HttpClient;

  constructor(
    name: string,
    private readonly config: {
      baseUrl: string;
      apiKey: string;
      secret: string;
      merchantId: string;
      callbackSecret: string;
      authScheme: "bearer" | "header" | "query";
      paths: { games: string; launch: string };
      signatureField?: string;
    },
  ) {
    this.name = name;
    this.isConfigured = Boolean(config.baseUrl && config.apiKey && config.secret);
    this.mode = this.isConfigured && env.platformMode === "live" ? "live" : "demo";
    this.http = new HttpClient(config.baseUrl, this.authHeaders(), name);
  }

  private authHeaders(): Record<string, string> {
    const { apiKey, merchantId, authScheme } = this.config;
    switch (authScheme) {
      case "bearer":
        return { authorization: `Bearer ${apiKey}`, "x-merchant-id": merchantId };
      case "header":
        return { "x-api-key": apiKey, "x-merchant-id": merchantId };
      case "query":
      default:
        return { "x-merchant-id": merchantId };
    }
  }

  async listGames(params: { page?: number; pageSize?: number; category?: string }): Promise<AggregatorGame[]> {
    if (!this.isConfigured) throw Errors.providerDisabled("Oyun agregatoru");
    const response = await this.http.request<{ data?: unknown[]; games?: unknown[]; items?: unknown[] }>({
      path: this.config.paths.games,
      query: {
        merchantId: this.config.merchantId,
        page: params.page ?? 1,
        pageSize: params.pageSize ?? 100,
        category: params.category,
        ...(this.config.authScheme === "query" ? { apiKey: this.config.apiKey } : {}),
      },
    });
    const rows = response.data ?? response.games ?? response.items ?? [];
    return rows.map((row) => this.normalizeGame(row as Record<string, unknown>));
  }

  private normalizeGame(raw: Record<string, unknown>): AggregatorGame {
    const pick = (...keys: string[]): unknown => keys.map((k) => raw[k]).find((v) => v !== undefined && v !== null);
    return {
      externalId: String(pick("id", "gameId", "game_id", "code") ?? ""),
      name: String(pick("name", "title", "gameName") ?? "Unnamed"),
      category: String(pick("category", "type", "gameType") ?? "SLOTS").toUpperCase(),
      provider: String(pick("provider", "providerName", "vendor") ?? this.name),
      thumbnailUrl: str(pick("thumbnail", "thumbnailUrl", "image", "imageUrl", "cover")),
      bannerUrl: str(pick("banner", "bannerUrl")),
      rtp: numeric(pick("rtp", "payout")),
      volatility: str(pick("volatility")),
      lines: numeric(pick("lines")),
      reels: numeric(pick("reels", "reelsCount")),
      minBet: str(pick("minBet", "min_bet")),
      maxBet: str(pick("maxBet", "max_bet")),
      demoSupported: boolish(pick("demoSupported", "hasDemo", "demo")) ?? true,
      realSupported: boolish(pick("realSupported", "hasReal", "real")) ?? true,
      currencies: arr(pick("currencies", "supportedCurrencies")),
      jurisdictions: arr(pick("jurisdictions", "countries")),
      tags: arr(pick("tags", "keywords")),
      releasedAt: str(pick("releasedAt", "releaseDate", "launchDate")),
    };
  }

  async launchSession(request: LaunchSessionRequest): Promise<LaunchSessionResult> {
    if (!this.isConfigured) throw Errors.providerDisabled("Oyun agregatoru");
    const timestamp = Date.now().toString();
    const payload = {
      merchantId: this.config.merchantId,
      gameId: request.externalGameId,
      playerId: request.playerId,
      currency: request.currency,
      locale: request.locale,
      mode: request.mode,
      returnUrl: request.returnUrl,
      sessionToken: request.sessionToken,
      ip: request.ip,
      userAgent: request.userAgent,
      timestamp,
    };

    const signature = signHmac(this.config.secret, `${timestamp}${canonicalize(payload)}`);

    const response = await this.http.request<Record<string, unknown>>({
      method: "POST",
      path: this.config.paths.launch,
      body: payload,
      headers: { "x-signature": signature, "x-timestamp": timestamp },
    });

    const launchUrl = str(response.url ?? response.launchUrl ?? response.gameUrl ?? response.link);
    if (!launchUrl) throw Errors.providerError(this.name, "Launch yanitinda URL yok");

    return {
      launchUrl,
      sessionId: String(response.sessionId ?? response.token ?? ""),
      expiresAt: str(response.expiresAt),
    };
  }

  /**
   * Providers sign callbacks differently. We accept the common conventions:
   * an HMAC over the canonical body, or over the raw body, both hex encoded.
   */
  verifyCallback(rawBody: string, headers: Record<string, string | undefined>): boolean {
    if (!this.config.callbackSecret) return false;
    const signature =
      headers["x-signature"] ?? headers["x-callback-signature"] ?? headers["signature"] ?? headers["x-sign"];
    if (!signature) return false;
    const candidates: string[] = [rawBody];
    try {
      candidates.push(canonicalize(JSON.parse(rawBody) as Record<string, unknown>));
    } catch {
      /* raw body only */
    }
    return candidates.some((payload) => verifyHmac(this.config.callbackSecret, payload, signature));
  }

  async healthCheck(): Promise<ProviderHealth> {
    if (!this.isConfigured) {
      return {
        kind: this.kind,
        provider: this.name,
        mode: this.mode,
        configured: false,
        reachable: null,
        checkedAt: new Date().toISOString(),
        detail: "Kimlik bilgileri eksik",
      };
    }
    try {
      await this.listGames({ page: 1, pageSize: 1 });
      return {
        kind: this.kind,
        provider: this.name,
        mode: this.mode,
        configured: true,
        reachable: true,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        kind: this.kind,
        provider: this.name,
        mode: this.mode,
        configured: true,
        reachable: false,
        checkedAt: new Date().toISOString(),
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

function str(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : String(value);
}
function numeric(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
function boolish(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes"].includes(String(value).toLowerCase());
}
function arr(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.length > 0) return value.split(",").map((s) => s.trim());
  return undefined;
}
