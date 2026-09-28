/**
 * BetSkilla white-label hub adapter.
 *
 * The operator brand host (e.g. https://xenzora.com) fronts the whole platform:
 * `/api/client-login` opens an operator session, `/api/v3/games?type=slot|live`
 * returns the catalogue, and `/api/games/{router}` mints a real game session URL.
 *
 * Sessions are cookie based, so the adapter keeps one HttpClient whose cookie jar
 * is populated by login and reused for every catalogue/launch call.
 */
import { ProviderHealth } from "./types.js";
import {
  AggregatorGame,
  GameAggregatorAdapter,
  LaunchSessionRequest,
  LaunchSessionResult,
} from "./aggregator.js";
import { Errors } from "@aurora/shared";

interface BetSkillaConfig {
  baseUrl: string;
  login: string;
  password: string;
  currency: string;
}

interface Session {
  cookie: string;
  createdAt: number;
}

type GameType = "slot" | "live";

const SESSION_TTL_MS = 30 * 60 * 1000;

export class BetSkillaAggregator implements GameAggregatorAdapter {
  readonly kind = "gameAggregator" as const;
  readonly name = "betskilla";
  readonly isConfigured: boolean;
  readonly mode: "demo" | "live";
  readonly isInternal = false;

  private session: Session | null = null;

  constructor(private readonly config: BetSkillaConfig) {
    this.isConfigured = Boolean(config.baseUrl && config.login && config.password);
    this.mode = this.isConfigured ? "live" : "demo";
  }

  private async login(): Promise<string> {
    const response = await fetch(`${this.config.baseUrl}/api/client-login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        origin: this.config.baseUrl,
        referer: `${this.config.baseUrl}/`,
      },
      body: JSON.stringify({ login: this.config.login, password: this.config.password }),
    });
    if (!response.ok) {
      throw Errors.providerError(this.name, `Operator girisi basarisiz (HTTP ${response.status})`);
    }
    const raw = response.headers.getSetCookie?.() ?? [];
    const cookie = raw.map((c) => c.split(";")[0]).join("; ");
    if (!cookie) throw Errors.providerError(this.name, "Operator oturum cerezi alinamadi");
    this.session = { cookie, createdAt: Date.now() };
    return cookie;
  }

  private async cookie(): Promise<string> {
    if (this.session && Date.now() - this.session.createdAt < SESSION_TTL_MS) return this.session.cookie;
    return this.login();
  }

  /** Runs an API call with session cookies, re-authenticating once on expiry. */
  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const doFetch = async (cookie: string) => {
      return fetch(`${this.config.baseUrl}${path}`, {
        ...init,
        headers: {
          accept: "application/json",
          cookie,
          origin: this.config.baseUrl,
          referer: `${this.config.baseUrl}/`,
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...(init.headers as Record<string, string> | undefined),
        },
      });
    };

    // A cached session that fails may simply have aged out, so drop it and try
    // once more with a fresh login. A login performed *within* this call cannot
    // be stale, so its failure is a genuine game error and is not retried.
    const hadSession = this.session !== null;
    let response = await doFetch(await this.cookie());
    if (hadSession && this.sessionExpired(response.status)) {
      this.session = null;
      response = await doFetch(await this.cookie());
    }
    return response;
  }

  /**
   * The operator host does not answer 401/403 for a dead session. It answers
   * 400 with `{"error":true,"code":266,"message":"game is not available"}`.
   * Once the in-memory cookie ages out, every launch fails forever because
   * nothing else triggers a re-login — so 400 has to count as an expiry too.
   */
  private sessionExpired(status: number): boolean {
    return status === 401 || status === 403 || status === 400;
  }

  /** Runs an API call, throwing on failure. */
  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.request(path, init);
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw Errors.providerError(this.name, `HTTP ${response.status}: ${detail.slice(0, 200)}`);
    }
    return (await response.json()) as T;
  }

  /**
   * Checks whether a session can actually be minted for a game.
   *
   * The catalogue lists some entries whose upstream launch answers 404 (whole
   * providers in some cases), so publishing a game without probing it produces
   * tiles that are guaranteed to fail when a player clicks them. A throwaway
   * demo session is the cheapest reliable signal.
   */
  async isPlayable(router: string): Promise<boolean> {
    if (!this.isConfigured || !router) return false;
    try {
      const response = await this.request(`/api/games/${encodeURIComponent(router)}`, {
        method: "POST",
        body: JSON.stringify({
          demo: true,
          currency: this.config.currency,
          returnUrl: `${this.config.baseUrl}/`,
        }),
      });
      if (response.ok) {
        await response.arrayBuffer().catch(() => undefined);
        return true;
      }
      await response.body?.cancel().catch(() => undefined);
      return false;
    } catch {
      return false;
    }
  }

  async listGames(params: {
    page?: number;
    pageSize?: number;
    category?: string;
  }): Promise<AggregatorGame[]> {
    if (!this.isConfigured) throw Errors.providerDisabled("Oyun agregatoru");
    const types: GameType[] = params.category === "live" ? ["live"] : params.category === "slot" ? ["slot"] : ["slot", "live"];
    const out: AggregatorGame[] = [];

    for (const type of types) {
      const pageSize = Math.min(params.pageSize ?? 50, 200);
      const page = params.page ?? 1;
      const data = await this.call<{ count: number; data: RawGame[] }>(
        `/api/v3/games?type=${type}&size=${pageSize}&page=${page}`,
      );
      for (const raw of data.data ?? []) out.push(this.normalizeGame(raw, type));
    }
    return out;
  }

  private normalizeGame(raw: RawGame, type: GameType): AggregatorGame {
    return {
      externalId: String(raw.id),
      name: raw.name ?? "Unnamed",
      category: type === "live" ? "LIVE" : "SLOTS",
      provider: raw.provider?.label ?? this.name,
      thumbnailUrl: raw.imgUrl ?? raw.provider?.images?.smallLight,
      demoSupported: raw.demoSupport ?? false,
      realSupported: true,
      currencies: [this.config.currency],
      tags: [type, raw.provider?.label ?? ""].filter(Boolean),
      launchRouter: raw.gameSessionRouter,
    };
  }

  async launchSession(request: LaunchSessionRequest): Promise<LaunchSessionResult> {
    if (!this.isConfigured) throw Errors.providerDisabled("Oyun agregatoru");

    // Prefer the router we stored at sync time; only fall back to a catalogue
    // scan when it is missing (e.g. rows imported before this field existed).
    let router = request.launchRouter;
    if (!router) {
      const game = await this.findGame(request.externalGameId);
      router = game?.gameSessionRouter;
    }
    if (!router) throw Errors.providerError(this.name, `Oyun yonlendiricisi bulunamadi: ${request.externalGameId}`);

    const response = await this.call<{ type: string; sessionId: string; value: string }>(
      `/api/games/${router}`,
      {
        method: "POST",
        body: JSON.stringify({
          demo: request.mode === "demo",
          currency: request.currency || this.config.currency,
          returnUrl: request.returnUrl,
        }),
      },
    );

    if (response.type !== "url" || !response.value) {
      throw Errors.providerError(this.name, "Oyun baslatma yaniti gecersiz");
    }

    return { launchUrl: response.value, sessionId: response.sessionId };
  }

  /** Session routers are not part of the numeric id, so resolve from the catalogue. */
  private async findGame(externalId: string): Promise<RawGame | null> {
    for (const type of ["slot", "live"] as GameType[]) {
      const limit = 200;
      for (let page = 1; page <= 60; page++) {
        const data = await this.call<{ count: number; data: RawGame[] }>(
          `/api/v3/games?type=${type}&size=${limit}&page=${page}`,
        );
        const hit = (data.data ?? []).find((g) => String(g.id) === String(externalId));
        if (hit) return hit;
        if (!data.data?.length || page * limit >= data.count) break;
      }
    }
    return null;
  }

  verifyCallback(): boolean {
    // Sessions are opened and settled inside the operator platform, so there is
    // no inbound signed wallet callback for us to verify.
    return false;
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
        detail: "BETSKILLA_BASE_URL bos. Harici oyunlar devre disi.",
      };
    }
    try {
      await this.cookie();
      const data = await this.call<{ count: number }>("/api/v3/games?type=slot&limit=1");
      return {
        kind: this.kind,
        provider: this.name,
        mode: this.mode,
        configured: true,
        reachable: true,
        checkedAt: new Date().toISOString(),
        detail: `Operator oturumu aktif, katalogda ${data.count} slot oyunu.`,
      };
    } catch (error) {
      return {
        kind: this.kind,
        provider: this.name,
        mode: this.mode,
        configured: true,
        reachable: false,
        checkedAt: new Date().toISOString(),
        detail: error instanceof Error ? error.message : "Bilinmeyen hata",
      };
    }
  }
}

interface RawGame {
  id: number | string;
  name: string;
  imgUrl?: string;
  thumbnailBgColorHex?: string;
  demoSupport?: boolean;
  gameSessionRouter?: string;
  provider?: {
    id?: number;
    label?: string;
    images?: { smallLight?: string; smallDark?: string };
  };
}
