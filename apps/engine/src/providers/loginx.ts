/**
 * loginxgamesapi / gitamus adapter — CATALOGUE ONLY.
 *
 * Four separate vendor hosts, each with its own `agentid` / `apitoken` /
 * `secretkey` credential set. Everything the running integration does was
 * measured against the Stage credentials on 2026-09-28; see
 * docs/providers/loginx-games-api.md.
 *
 * WHAT WORKS: `GET /GameList` with `Authorization: Bearer <apitoken>` returns
 * the whole vendor catalogue in one response. That is the only endpoint that
 * answers — every launch-shaped path returns 404 — so this adapter deliberately
 * does not implement `launchSession`.
 *
 * Two traps the next reader will otherwise pay for:
 *  - Cloudflare fronts these hosts and rejects non-browser clients with
 *    `403 Error 1010`. A browser-like User-Agent is mandatory, and bulk
 *    parallel requests trip a rate limit that fakes 403 on every path.
 *  - The paths are single PascalCase segments (`/GameList`), not `/api/v1/...`.
 *
 * WALLET: nothing here touches player money. The vendor's callback contract and
 * its signature scheme are undocumented on our side, and the callback URL they
 * were given points at the Gregmorn HMAC-SHA256 verifier, which will reject an
 * MD5(timestamp+salt) signature. Until that is confirmed in writing this
 * adapter must not be enabled for real play — `healthCheck` says so, and the
 * importer stores every game inactive.
 */
import { ProviderHealth } from "./types.js";
import { AggregatorGame, GameAggregatorAdapter, LaunchSessionRequest, LaunchSessionResult } from "./aggregator.js";
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
}

interface LoginxConfig {
  vendors: LoginxVendor[];
  /** Currency the operator account is provisioned for. */
  currency: string;
}

/** A browser-like UA is required or Cloudflare answers 1010 before the API. */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

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

/**
 * A game we cannot launch still needs to be stored, because the operator paid
 * for the catalogue and will want it on go-live. The adapter reports it as
 * demo/real disabled; the importer keeps the row inactive.
 */
export class LoginxGamesAggregator implements GameAggregatorAdapter {
  readonly kind = "gameAggregator" as const;
  readonly name = "loginx";
  readonly isConfigured: boolean;
  readonly mode: "demo" | "live";
  readonly isInternal = false;

  constructor(private readonly config: LoginxConfig) {
    this.isConfigured = config.vendors.length > 0;
    // Catalogue reads are safe, but no game can open and no wallet is wired, so
    // this is never a live-money provider.
    this.mode = "demo";
  }

  /** The vendor credentials this adapter will talk to, for the admin health view. */
  get vendors(): LoginxVendor[] {
    return this.config.vendors;
  }

  private async getGameList(vendor: LoginxVendor): Promise<RawGame[]> {
    const response = await fetch(`${vendor.baseUrl}/GameList`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${vendor.apiToken}`,
        Accept: "application/json",
        "User-Agent": BROWSER_UA,
      },
    });

    if (!response.ok) {
      throw new Error(`${vendor.vendor} GameList HTTP ${response.status}`);
    }

    const body = (await response.json()) as GameListResponse;
    if (body.code !== 0) {
      throw new Error(`${vendor.vendor} GameList code=${body.code} ${body.message}`);
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
          // The API only carries slots and instant games; there are no live
          // tables in this vendor set, so a flat category is honest.
          category: "slot",
          provider: vendor.vendor,
          thumbnailUrl: game.iconurl3 ?? game.iconurl2 ?? game.iconurl1,
          minBet: game.miniBet !== undefined ? String(game.miniBet) : undefined,
          releasedAt: game.releasedate,
          // Nothing can be launched yet, so nothing is playable yet.
          demoSupported: false,
          realSupported: false,
          currencies: [this.config.currency],
          tags: [vendor.key, game.symbol],
          launchRouter: undefined,
        });
      }
    }

    return games;
  }

  /**
   * Not implemented, on purpose.
   *
   * The vendor has not exposed a launch endpoint: every launch-shaped path
   * returns 404 on all four hosts. Refusing here means a misconfiguration
   * surfaces as a clear error instead of a URL that fails in the player's
   * browser.
   */
  async launchSession(_request: LaunchSessionRequest): Promise<LaunchSessionResult> {
    throw Errors.providerDisabled(
      "loginx: oyun acma (launch) ucu bu API'de bulunamadi. Saglayicidan dokumantasyon bekleniyor.",
    );
  }

  /** No callback contract exists for us to verify, so nothing is accepted. */
  verifyCallback(): boolean {
    return false;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const lines: string[] = [];
    let reachable = false;

    for (const vendor of this.config.vendors) {
      try {
        const games = await this.getGameList(vendor);
        reachable = true;
        lines.push(`${vendor.vendor}: ${games.length} oyun`);
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
      detail: lines.length === 0
        ? "loginx: vendor kimligi girilmedi."
        : `${lines.join(", ")}. SADECE KATALOG: oyun acma ucu ve cuzdan callback sozlesmesi saglayicidan gelmedi; gercek para icin kullanilamaz.`,
    };
  }
}

/**
 * Build the vendor list from the per-vendor env keys.
 *
 * Each vendor's credentials are independent, so a vendor with a missing value
 * is dropped rather than failing the whole adapter — the others still import.
 */
export function loginxVendorsFromEnv(read: (key: string) => string): LoginxVendor[] {
  const definitions: Array<{ key: string; vendor: string; prefix: string; defaultHost: string }> = [
    { key: "pragmatic", vendor: "Pragmatic Play", prefix: "LOGINX_PRAGMATIC", defaultHost: "pk2api.loginxgamesapi.com" },
    { key: "pgsoft", vendor: "PG Soft", prefix: "LOGINX_PGSOFT", defaultHost: "ggapi.loginxgamesapi.com" },
    { key: "amatic", vendor: "Amatic", prefix: "LOGINX_AMATIC", defaultHost: "amapi.loginxgamesapi.com" },
    { key: "amusnet", vendor: "Amusnet", prefix: "LOGINX_AMUSNET", defaultHost: "api.gitamus.net" },
  ];

  const vendors: LoginxVendor[] = [];
  for (const definition of definitions) {
    const apiToken = read(`${definition.prefix}_APITOKEN`);
    if (!apiToken) continue;

    const host = read(`${definition.prefix}_HOST`) || definition.defaultHost;
    vendors.push({
      key: definition.key,
      vendor: definition.vendor,
      baseUrl: host.startsWith("http") ? host : `https://${host}`,
      agentId: read(`${definition.prefix}_AGENTID`),
      apiToken,
      secretKey: read(`${definition.prefix}_SECRETKEY`),
    });
  }
  return vendors;
}
