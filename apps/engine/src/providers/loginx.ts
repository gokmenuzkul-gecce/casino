/**
 * GitSlotPark Seamless Wallet API v2 adapter.
 *
 * Four vendors, four hosts, one protocol. Pragmatic, PG Soft, Amatic and
 * Amusnet all speak the same catalogue/launch/callback contract; only the host
 * and the credentials differ, so a single class serves all four and the vendor
 * list is data.
 *
 * The contract is authoritative from the provider's own Postman collections
 * (see docs/providers/loginx-games-api.md). Two things in it are easy to get
 * wrong and expensive when you do:
 *
 * 1. The signature is HMAC-SHA-256 over a concatenation whose field ORDER
 *    differs per operation. GetBalance signs agentID+userID+gameID; BetWin adds
 *    betAmount+winAmount+transactionID+roundID+gameID; Deposit inserts
 *    refTransactionID before transactionID. The whole thing is verified against
 *    the spec's published test vector in loginx.test.ts, which is the only
 *    reason it is safe to trust.
 * 2. A business failure is still HTTP 200. The spec says so explicitly: a
 *    non-200 makes the provider treat the operation as failed and raise a
 *    rollback, which is not what we want for "insufficient funds" — that is a
 *    normal, expected answer. Hence `walletErrorStatus = 200` and a code in the
 *    body.
 *
 * Wallet model: this provider splits the round. It sends the wager alone
 * (`Withdraw`) and the payout separately (`Deposit`), and — for PG Soft and
 * Amatic — one wager can be followed by SEVERAL payouts sharing the same
 * refTransactionID. Each call carries its own transactionID, so each is applied
 * on its own; rollback addresses a call by its transactionID, not by the ref.
 *
 * Before this can settle real money, `PLATFORM_MODE` must be `live` and every
 * configured vendor must have its agentID, apiToken and secretKey.

 * See docs/providers/loginx-games-api.md for the full spec and its history.
 */
import crypto from "node:crypto";
import { env } from "../lib/env.js";
import { ProviderHealth } from "./types.js";
import {
  AggregatorGame,
  GameAggregatorAdapter,
  LaunchSessionRequest,
  LaunchSessionResult,
  ParsedWalletCallback,
  WalletCommand,
  WalletFailureReason,
} from "./aggregator.js";
import { Errors } from "@aurora/shared";

/** One vendor: a host, a display name and the credentials that authorise it. */
export interface LoginxVendor {
  /** Short key used in provider slugs and admin UI, e.g. "pragmatic". */
  key: string;
  /** Vendor name as the API reports it, used to sanity-check the response. */
  vendor: string;
  baseUrl: string;
  agentId: string;
  apiToken: string;
  secretKey: string;
  /** True when every credential a signed callback needs is present. */
  signingReady: boolean;
}

interface LoginxConfig {
  vendors: LoginxVendor[];
  /** Currency the operator account is provisioned for. */
  currency: string;
}

/**
 * Result codes, shared by all four vendors. 0 is success; the rest are business
 * outcomes that must reach the provider verbatim so it can decide what to do.
 */
export const LoginxResultCode = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  WRONG_PARAMS: 2,
  INVALID_SIGN: 3,
  INVALID_AGENT: 4,
  USER_NOT_FOUND: 5,
  INSUFFICIENT_FUNDS: 6,
  INVALID_API_TOKEN: 7,
  REFERENCE_NOT_FOUND: 8,
  ALREADY_ROLLED_BACK: 9,
  DUPLICATE: 11,
} as const;

interface RawGame {
  vendorid: string;
  gameid: number | string;
  name: string;
  symbol: string;
  iconurl1?: string;
  iconurl2?: string;
  iconurl3?: string;
  miniBet?: number;
  minlevel?: number;
  maxlevel?: number;
  replay?: boolean;
  releasedate?: string;
}

interface GameListResponse {
  updatetime?: string;
  code: number;
  message: string;
  data?: RawGame[];
}

interface UserAuthResponse {
  code: number;
  message: string;
  url?: string;
}

/**
 * Operations and the exact field order their signature is built from.
 *
 * The order is not alphabetical and not uniform: it comes straight from each
 * operation's spec table. Deposit is the odd one out — it squeezes
 * `refTransactionID` in before `transactionID`.
 */
const SIGN_FIELDS = {
  GetBalance: ["agentID", "userID", "gameID"],
  BetWin: ["agentID", "userID", "betAmount", "winAmount", "transactionID", "roundID", "gameID"],
  Withdraw: ["agentID", "userID", "amount", "transactionID", "roundID", "gameID"],
  Deposit: ["agentID", "userID", "amount", "refTransactionID", "transactionID", "roundID", "gameID"],
  RollbackTransaction: ["agentID", "userID", "refTransactionID", "gameID"],
} as const;

type SignOperation = keyof typeof SIGN_FIELDS;

/** Fields that carry a money amount and therefore always sign as 2 decimals. */
const AMOUNT_FIELDS = new Set(["amount", "betAmount", "winAmount"]);

/**
 * An amount as it enters a signature: always exactly two decimals.
 *
 * `12.3` must sign as `12.30` and `5` as `5.00` — the spec states it and the
 * published test vector confirms it. Getting this wrong silently produces an
 * invalid signature (code 3) on every call where the amount happens to need
 * padding, which is most of them.
 */
export function formatSignatureAmount(value: unknown): string {
  if (value === undefined || value === null || value === "") return "0.00";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return numeric.toFixed(2);
}

/** A scalar as it enters a signature: numbers become their string form. */
function formatSignatureField(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value);
}

/**
 * Build the sign for one operation exactly as the provider defines it.
 *
 * Exported because it is the piece most likely to regress and the test vector
 * only covers one operation, so the others are pinned by tests too.
 */
export function loginxSign(operation: SignOperation, secretKey: string, params: Record<string, unknown>): string {
  const message = SIGN_FIELDS[operation]
    .map((field) => (AMOUNT_FIELDS.has(field) ? formatSignatureAmount(params[field]) : formatSignatureField(params[field])))
    .join("");
  return crypto.createHmac("sha256", Buffer.from(secretKey, "utf8")).update(Buffer.from(message, "utf8")).digest("hex").toUpperCase();
}

/** Timing-safe comparison, so a wrong sign cannot be found byte by byte. */
function signatureMatches(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** A browser-like UA is required by the catalogue hosts' edge protection. */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export class LoginxGamesAggregator implements GameAggregatorAdapter {
  readonly kind = "gameAggregator" as const;
  readonly name = "loginx";
  readonly isConfigured: boolean;
  readonly mode: "demo" | "live";
  readonly isInternal = false;
  /** Business rejections are HTTP 200 for this family; see the class comment. */
  readonly walletErrorStatus = 200;

  constructor(private readonly config: LoginxConfig) {
    // Every vendor needs a full credential set to settle money. A half-filled
    // vendor still reads its catalogue but cannot be a live-money provider.
    this.isConfigured = config.vendors.length > 0 && config.vendors.every((vendor) => vendor.signingReady);
    this.mode = this.isConfigured && env.platformMode === "live" ? "live" : "demo";
  }

  /** The vendor credentials this adapter will talk to, for the admin health view. */
  get vendors(): LoginxVendor[] {
    return this.config.vendors;
  }

  /** The vendor whose credentials match an inbound callback's agentID. */
  private vendorForAgent(agentId: unknown): LoginxVendor | undefined {
    return this.config.vendors.find((vendor) => vendor.agentId && vendor.agentId === String(agentId));
  }

  private async getGameList(vendor: LoginxVendor): Promise<RawGame[]> {
    const response = await fetch(`${vendor.baseUrl}/gamelist`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${vendor.apiToken}`,
        Accept: "application/json",
        "User-Agent": BROWSER_UA,
      },
    });

    if (!response.ok) {
      throw new Error(`${vendor.vendor} gamelist HTTP ${response.status}`);
    }

    const body = (await response.json()) as GameListResponse;
    if (body.code !== LoginxResultCode.SUCCESS) {
      throw new Error(`${vendor.vendor} gamelist code=${body.code} ${body.message}`);
    }
    return body.data ?? [];
  }

  /**
   * The whole catalogue across every configured vendor.
   *
   * The API returns the full list in one response and ignores paging query
   * parameters, so `page`/`category` are accepted for interface compatibility
   * and ignored. Missing a vendor's response is not fatal: the others still
   * import, and the failure is reported through healthCheck.
   */
  async listGames(): Promise<AggregatorGame[]> {
    const games: AggregatorGame[] = [];

    for (const vendor of this.config.vendors) {
      let raw: RawGame[];
      try {
        raw = await this.getGameList(vendor);
      } catch (error) {
        console.error(`[loginx] ${vendor.vendor} katalog okunamadi:`, error);
        continue;
      }

      for (const game of raw) {
        games.push({
          externalId: String(game.gameid),
          name: game.name,
          // This vendor set carries slots and instant games only; there are no
          // live tables in it, so a flat category is honest.
          category: "slot",
          provider: vendor.vendor,
          thumbnailUrl: game.iconurl3 ?? game.iconurl2 ?? game.iconurl1,
          minBet: game.miniBet !== undefined ? String(game.miniBet) : undefined,
          releasedAt: game.releasedate,
          demoSupported: false,
          realSupported: true,
          currencies: [this.config.currency],
          tags: [vendor.key, game.symbol],
          // The launch call needs to know which host and agent to use.
          launchRouter: vendor.key,
        });
      }
    }

    return games;
  }

  /**
   * Open a game: POST /userAuth returns the URL to send the player to.
   *
   * The spec offers embed, redirect or new tab; we hand the URL back and let the
   * caller decide. `lobbyUrl` is where the game's Home button goes, so it points
   * at our play page rather than the provider's own lobby.
   */
  async launchSession(request: LaunchSessionRequest): Promise<LaunchSessionResult> {
    if (!this.isConfigured) throw Errors.providerDisabled("loginx");

    const vendor = this.config.vendors.find((candidate) => candidate.key === request.launchRouter) ?? this.config.vendors[0];
    if (!vendor) throw Errors.providerDisabled("loginx");

    const body = {
      agentID: vendor.agentId,
      userID: request.playerLogin ?? request.playerId,
      isaffiliate: false,
      lang: request.locale || "tr",
      gameid: Number(request.externalGameId),
      lobbyUrl: request.returnUrl,
    };

    const response = await fetch(`${vendor.baseUrl}/userAuth`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${vendor.apiToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": BROWSER_UA,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) throw Errors.providerError(this.name, `userAuth HTTP ${response.status}`);

    const payload = (await response.json()) as UserAuthResponse;
    if (payload.code !== LoginxResultCode.SUCCESS || !payload.url) {
      throw Errors.providerError(this.name, `userAuth code=${payload.code} ${payload.message}`);
    }

    return { launchUrl: payload.url, sessionId: `${vendor.key}:${request.playerId}:${request.externalGameId}` };
  }

  /**
   * Verify an inbound callback's sign.
   *
   * Which operation it is comes from the payload shape, because the signature
   * field order depends on it. An unknown shape is rejected rather than guessed
   * at: a wrong order would reject valid calls and accept none.
   */
  verifyCallback(rawBody: string, _headers: Record<string, string | undefined>): boolean {
    let payload: Record<string, unknown>;
    try {
      payload = asRecord(JSON.parse(rawBody));
    } catch {
      return false;
    }

    const operation = detectOperation(payload);
    if (!operation) return false;

    const vendor = this.vendorForAgent(payload.agentID);
    if (!vendor || !vendor.secretKey) return false;

    const provided = String(payload.sign ?? "");
    if (!provided) return false;

    return signatureMatches(loginxSign(operation, vendor.secretKey, payload), provided);
  }

  /**
   * Reduce a callback to the ledger's shape.
   *
   * The provider does not put a command name in the body, so the operation is
   * inferred from which fields are present — the same shape check the signature
   * uses, so the two can never disagree.
   */
  parseWalletCallback(payload: Record<string, unknown>): ParsedWalletCallback | null {
    const operation = detectOperation(payload);
    if (!operation) return null;

    const common = {
      playerLogin: formatSignatureField(payload.userID),
      gameId: formatSignatureField(payload.gameID) || undefined,
      roundId: formatSignatureField(payload.roundID) || undefined,
    };

    switch (operation) {
      case "GetBalance":
        return { command: "BALANCE", transactionId: "", ...common };
      case "BetWin":
        return {
          command: "WRITE_BET",
          transactionId: formatSignatureField(payload.transactionID),
          bet: formatSignatureAmount(payload.betAmount),
          win: formatSignatureAmount(payload.winAmount),
          ...common,
        };
      case "Withdraw":
        return {
          command: "WITHDRAW",
          transactionId: formatSignatureField(payload.transactionID),
          bet: formatSignatureAmount(payload.amount),
          ...common,
        };
      case "Deposit":
        return {
          command: "DEPOSIT",
          transactionId: formatSignatureField(payload.transactionID),
          win: formatSignatureAmount(payload.amount),
          refTransactionId: formatSignatureField(payload.refTransactionID) || undefined,
          ...common,
        };
      case "RollbackTransaction":
        return {
          command: "ROLLBACK",
          // Rollback addresses the original call by its own transactionID, which
          // is what the ledger keyed that call on.
          transactionId: formatSignatureField(payload.refTransactionID),
          ...common,
        };
    }
  }

  /**
   * Success envelope: code 0 plus the resulting balance.
   *
   * BetWin, Withdraw and Deposit responses also carry `platformTransactionID`,
   * which the provider stores as our side's reference for the movement; the
   * balance-only operations leave it out.
   */
  walletResponse(input: { balance: string; transactionId?: string }): Record<string, unknown> {
    const envelope: Record<string, unknown> = { code: LoginxResultCode.SUCCESS, message: "", balance: Number(input.balance) };
    if (input.transactionId) envelope.platformTransactionID = input.transactionId;
    return envelope;
  }

  /**
   * Failure envelope. The message carries the human-readable reason; the code is
   * what the provider acts on, so well-known cases map to their defined codes
   * instead of a generic 1.
   */
  walletError(input: { message: string; code?: number }): Record<string, unknown> {
    return { code: input.code ?? LoginxResultCode.GENERAL_ERROR, message: input.message };
  }

  /**
   * Result code for a failure the route detects before settlement.
   *
   * The provider distinguishes "invalid sign" (3), "wrong params" (2) and
   * "cannot find user" (5); answering with the specific code is what lets the
   * vendor's own retry logic behave.
   */
  walletFailureCode(reason: WalletFailureReason): number {
    switch (reason) {
      case "invalid_signature":
        return LoginxResultCode.INVALID_SIGN;
      case "player_not_found":
        return LoginxResultCode.USER_NOT_FOUND;
      case "unknown_command":
      default:
        return LoginxResultCode.WRONG_PARAMS;
    }
  }

  /**
   * Map an internal failure to this provider's result code.
   *
   * The documented code set is per operation: a rollback answers only
   * 0,1,2,3,4,5,9 — there is no "reference not found" (8) — so a rollback whose
   * reference cannot be found ("already rolled back" or never applied) is
   * reported as 9, while the same failure on a player lookup is 5.
   */
  errorCodeFor(error: unknown, command?: WalletCommand): number {
    // Duck-typed rather than `instanceof AppError`: the code is all that is
    // read, and a plain error carrying one should still map correctly.
    const raw = error instanceof Error ? (error as unknown as { code?: unknown }).code : undefined;
    const code = typeof raw === "string" ? raw : undefined;
    if (code === "INSUFFICIENT_FUNDS") return LoginxResultCode.INSUFFICIENT_FUNDS;
    if (code === "NOT_FOUND") {
      return command === "ROLLBACK" ? LoginxResultCode.ALREADY_ROLLED_BACK : LoginxResultCode.REFERENCE_NOT_FOUND;
    }
    if (code === "VALIDATION") return LoginxResultCode.WRONG_PARAMS;
    if (code === "UNAUTHORIZED") return LoginxResultCode.INVALID_AGENT;
    return LoginxResultCode.GENERAL_ERROR;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const lines: string[] = [];
    let reachable = false;

    for (const vendor of this.config.vendors) {
      try {
        const games = await this.getGameList(vendor);
        reachable = true;
        const signing = vendor.signingReady ? "imza hazir" : "IMZA EKSIK (agentID/secretKey)";
        lines.push(`${vendor.vendor}: ${games.length} oyun, ${signing}`);
      } catch (error) {
        lines.push(`${vendor.vendor}: ULASILAMADI (${error instanceof Error ? error.message : "hata"})`);
      }
    }

    return {
      kind: this.kind,
      provider: this.name,
      mode: this.mode,
      configured: this.isConfigured,
      reachable: this.config.vendors.length === 0 ? null : reachable,
      checkedAt: new Date().toISOString(),
      detail:
        lines.length === 0
          ? "loginx: vendor kimligi girilmedi."
          : `${lines.join(", ")}. Katalog, oyun acma (userAuth) ve 5 cuzdan callback'i hazir; gercek para icin PLATFORM_MODE=live ve tam kimlik gerekir.`,
    };
  }
}

/**
 * Which operation a callback body represents.
 *
 * The provider sends no command name, so this reads the presence of the fields
 * that distinguish the five operations. Order matters: BetWin and Deposit both
 * carry transactionID, so the more specific shape is tested first.
 */
export function detectOperation(payload: Record<string, unknown>): SignOperation | null {
  const has = (field: string) => payload[field] !== undefined && payload[field] !== null && payload[field] !== "";
  if (has("refTransactionID") && !has("transactionID")) return "RollbackTransaction";
  if (has("betAmount") || has("winAmount")) return "BetWin";
  if (has("refTransactionID")) return "Deposit";
  if (has("amount") && has("transactionID")) return "Withdraw";
  if (has("amount")) return "Deposit";
  if (has("userID")) return "GetBalance";
  return null;
}

/**
 * Build the vendor list from the per-vendor env keys.
 *
 * Each vendor's credentials are independent, so a vendor with a missing value
 * is dropped rather than failing the whole adapter — the others still import.
 * The hosts are the ones the provider's own specs name; the edge-protected
 * aliases we first probed are not the API hosts.
 */
export function loginxVendorsFromEnv(read: (key: string) => string): LoginxVendor[] {
  const definitions: Array<{ key: string; vendor: string; prefix: string; defaultHost: string }> = [
    { key: "pragmatic", vendor: "Pragmatic Play", prefix: "LOGINX_PRAGMATIC", defaultHost: "https://apiv2.gitslotpark.com" },
    { key: "pgsoft", vendor: "PG Soft", prefix: "LOGINX_PGSOFT", defaultHost: "https://pgapi.gitslotpark.com" },
    { key: "amatic", vendor: "Amatic", prefix: "LOGINX_AMATIC", defaultHost: "https://api.amaticgame.net" },
    { key: "amusnet", vendor: "Amusnet", prefix: "LOGINX_AMUSNET", defaultHost: "https://apiv2.apilx.com" },
  ];

  const vendors: LoginxVendor[] = [];
  for (const definition of definitions) {
    const apiToken = read(`${definition.prefix}_APITOKEN`);
    if (!apiToken) continue;

    const host = read(`${definition.prefix}_HOST`) || definition.defaultHost;
    const agentId = read(`${definition.prefix}_AGENTID`);
    const secretKey = read(`${definition.prefix}_SECRETKEY`);
    vendors.push({
      key: definition.key,
      vendor: definition.vendor,
      baseUrl: host.startsWith("http") ? host : `https://${host}`,
      agentId,
      apiToken,
      secretKey,
      // Derived here so it cannot drift from the fields it summarises.
      signingReady: Boolean(agentId && apiToken && secretKey),
    });
  }
  return vendors;
}
