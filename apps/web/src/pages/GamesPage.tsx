import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { get, money } from "../lib/api";
import { useApp } from "../store/app";
import { GameCard, categoryMeta, type GameCardData } from "../components/GameCard";
import { Empty, SkeletonGrid } from "../components/ui";
import { IconChevronLeft, IconChevronRight, IconSearch } from "../components/icons";

interface CategoryRow {
  slug: string;
  name: string;
  gameCount: number;
}
interface ProviderRow {
  slug: string;
  name: string;
  gameCount: number;
}

/**
 * Catalogue browser with live filtering.
 *
 * Filter state lives in the URL so a filtered view can be shared or bookmarked,
 * and the server does the paging rather than shipping the whole catalogue.
 */
export function GamesPage() {
  const [params, setParams] = useSearchParams();
  const [games, setGames] = useState<GameCardData[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [searchDraft, setSearchDraft] = useState("");
  const user = useApp((s) => s.user);

  const category = params.get("category") ?? "";
  const provider = params.get("provider") ?? "";
  const search = params.get("search") ?? "";
  const flag = params.get("jackpot") === "true" ? "jackpot" : params.get("new") === "true" ? "new" : "";
  const page = Number(params.get("page") ?? 1);

  useEffect(() => {
    Promise.all([
      get<{ categories: CategoryRow[] }>("/api/games/categories"),
      get<{ providers: ProviderRow[] }>("/api/games/providers"),
    ]).then(([c, p]) => {
      setCategories(c.categories);
      setProviders(p.providers);
    });
  }, []);

  useEffect(() => {
    setLoading(true);
    const query = new URLSearchParams();
    if (category) query.set("category", category);
    if (provider) query.set("provider", provider);
    if (search) query.set("search", search);
    if (flag) query.set(flag, "true");
    query.set("page", String(page));
    query.set("pageSize", "48");

    get<{ games: GameCardData[]; total: number }>(`/api/games?${query}`)
      .then((result) => {
        setGames(result.games);
        setTotal(result.total);
      })
      .finally(() => setLoading(false));
  }, [category, provider, search, flag, page]);

  useEffect(() => {
    if (!user) return;
    get<{ games: GameCardData[] }>("/api/games/favorites/list")
      .then((result) => setFavorites(new Set(result.games.map((g) => g.slug))))
      .catch(() => undefined);
  }, [user]);

  useEffect(() => setSearchDraft(search), [search]);

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    setParams(next);
  };

  const toggleFavorite = (slug: string) =>
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  const pageCount = Math.max(1, Math.ceil(total / 48));

  /** Only surface categories that actually hold games. */
  const activeCategories = useMemo(() => categories.filter((c) => c.gameCount > 0), [categories]);

  const heading = useMemo(() => {
    if (search) return `"${search}" icin sonuclar`;
    if (flag === "jackpot") return "Jackpot Oyunlari";
    if (flag === "new") return "Yeni Oyunlar";
    if (category) return categoryMeta(category).label;
    if (provider) return providers.find((p) => p.slug === provider)?.name ?? "Saglayici";
    return "Oyun Katalogu";
  }, [search, flag, category, provider, providers]);

  return (
    <div className="page">
      <div className="row-between mb" style={{ flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 className="section-title" style={{ margin: 0 }}>{heading}</h1>
          {!loading && <div className="small faint">{total} oyun listeleniyor</div>}
        </div>

        <div className="row" style={{ gap: 8, flex: "0 1 340px" }}>
          <div className="header-search" style={{ flex: 1, display: "flex" }}>
            <span className="header-search-icon">
              <IconSearch size={16} />
            </span>
            <input
              className="header-search-input"
              placeholder="Oyun ara..."
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") update("search", searchDraft);
              }}
              aria-label="Oyun ara"
            />
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => update("search", searchDraft)}>
            Ara
          </button>
        </div>
      </div>

      <div className="col mb" style={{ gap: 8 }}>
        <div className="chip-row">
          <button className={`chip${!category && !flag ? " active" : ""}`} onClick={() => { update("category", ""); update("jackpot", ""); update("new", ""); }}>
            <span className="chip-icon">🔥</span> Tumu
          </button>
          <button className={`chip${flag === "new" ? " active" : ""}`} onClick={() => { update("new", flag === "new" ? "" : "true"); update("category", ""); }}>
            <span className="chip-icon">✨</span> Yeni
          </button>
          <button className={`chip${flag === "jackpot" ? " active" : ""}`} onClick={() => { update("jackpot", flag === "jackpot" ? "" : "true"); update("category", ""); }}>
            <span className="chip-icon">💰</span> Jackpot
          </button>
          {activeCategories.map((c) => {
            const meta = categoryMeta(c.slug);
            return (
              <button
                key={c.slug}
                className={`chip${category === c.slug ? " active" : ""}`}
                onClick={() => { update("category", category === c.slug ? "" : c.slug); update("jackpot", ""); update("new", ""); }}
              >
                <span className="chip-icon">{meta.icon}</span>
                {c.name}
                <span className="chip-count">{c.gameCount}</span>
              </button>
            );
          })}
        </div>

        {providers.length > 0 && (
          <div className="provider-strip">
            <button className={`provider-logo${!provider ? " active" : ""}`} onClick={() => update("provider", "")}>
              Tum Saglayicilar
            </button>
            {providers.map((p) => (
              <button
                key={p.slug}
                className={`provider-logo${provider === p.slug ? " active" : ""}`}
                onClick={() => update("provider", provider === p.slug ? "" : p.slug)}
              >
                <span className="provider-logo-mark">{p.name.slice(0, 1).toUpperCase()}</span>
                {p.name}
                <span className="chip-count">{p.gameCount}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {(category || provider || search || flag) && (
        <div className="row mb" style={{ gap: 8, flexWrap: "wrap" }}>
          <span className="small faint">Aktif filtre:</span>
          {category && <span className="pill pill-neutral">{categoryMeta(category).label}</span>}
          {provider && <span className="pill pill-neutral">{provider}</span>}
          {search && <span className="pill pill-neutral">"{search}"</span>}
          {flag && <span className="pill pill-neutral">{flag === "new" ? "Yeni" : "Jackpot"}</span>}
          <button className="btn btn-ghost btn-sm" onClick={() => setParams(new URLSearchParams())}>
            Temizle
          </button>
        </div>
      )}

      {loading ? (
        <SkeletonGrid count={12} />
      ) : games.length === 0 ? (
        <div className="card">
          <Empty icon="🔍" title="Oyun bulunamadi" hint="Filtreleri degistirmeyi veya aramayi temizlemeyi deneyin." />
        </div>
      ) : (
        <>
          <div className="grid grid-games">
            {games.map((game) => (
              <GameCard key={game.slug} game={game} favorite={favorites.has(game.slug)} onToggleFavorite={toggleFavorite} />
            ))}
          </div>

          {pageCount > 1 && (
            <div className="row mt" style={{ justifyContent: "center", gap: 10 }}>
              <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => update("page", String(page - 1))}>
                <IconChevronLeft size={14} /> Onceki
              </button>
              <span className="small muted nowrap">
                Sayfa {page} / {pageCount}
              </span>
              <button className="btn btn-ghost btn-sm" disabled={page >= pageCount} onClick={() => update("page", String(page + 1))}>
                Sonraki <IconChevronRight size={14} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Game detail / play entry point.
 *
 * Internal games render their own board; aggregator-hosted games (slots, live
 * dealer tables) launch through the provider so the game runs in their
 * environment with a signed session token.
 */
export function PlayPage() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const [game, setGame] = useState<GameCardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<{ game: GameCardData }>(`/api/games/${slug}`)
      .then((result) => setGame(result.game))
      .catch((err) => setError(err instanceof Error ? err.message : "Oyun yuklenemedi"));
  }, [slug]);

  if (error) return <div className="page"><div className="alert alert-error">{error}</div></div>;
  if (!game) return <div className="page"><SkeletonGrid count={2} /></div>;

  if ((game.embedType ?? "INTERNAL") === "INTERNAL") {
    // Crash has its own dedicated route with the live table.
    if (slug === "crash") {
      navigate("/crash", { replace: true });
      return null;
    }
    return <InternalGamePage slug={slug} game={game} />;
  }

  return <ExternalGamePage slug={slug} game={game} />;
}

function InternalGamePage({ slug, game }: { slug: string; game: GameCardData }) {
  const user = useApp((s) => s.user);
  const { default: Board } = useBoardModule(slug);
  const meta = categoryMeta(game.category?.slug);

  return (
    <div className="page">
      <div className="row mb" style={{ gap: 10 }}>
        <Link to="/games" className="btn btn-ghost btn-sm">
          <IconChevronLeft size={14} /> Katalog
        </Link>
        <div className="spacer" />
        <span className="pill pill-neutral">
          {meta.icon} {game.category?.name ?? meta.label}
        </span>
        {game.provider && <span className="pill pill-neutral">{game.provider.name}</span>}
        {game.rtp && <span className="pill pill-info">RTP %{game.rtp}</span>}
      </div>

      <div className="row-between mb" style={{ flexWrap: "wrap", gap: 10 }}>
        <h1 className="section-title" style={{ margin: 0 }}>{game.name}</h1>
      </div>

      {!user && (
        <div className="alert alert-info">
          Demo oynamak icin giris yapin — kayit ucretsiz ve demo bakiyeniz hazir.
        </div>
      )}

      {Board ? <Board slug={slug} name={game.name} /> : <SkeletonGrid count={2} />}
    </div>
  );
}

/** Lazily resolve the board component for each internal game slug. */
function useBoardModule(slug: string): { default: React.ComponentType<{ slug: string; name: string }> | null } {
  const [mod, setMod] = useState<{ default: React.ComponentType<{ slug: string; name: string }> } | null>(null);

  useEffect(() => {
    const boards: Record<string, () => Promise<{ default: React.ComponentType<{ slug: string; name: string }> }>> = {
      dice: () => import("../games/DiceBoard"),
      limbo: () => import("../games/LimboBoard"),
      mines: () => import("../games/MinesBoard"),
      plinko: () => import("../games/PlinkoBoard"),
      keno: () => import("../games/KenoBoard"),
      roulette: () => import("../games/RouletteBoard"),
      blackjack: () => import("../games/BlackjackBoard"),
      slots: () => import("../games/SlotsBoard"),
    };

    const loader = boards[slug];
    if (!loader) return;
    let cancelled = false;
    loader().then((loaded) => {
      if (!cancelled) setMod(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return mod ?? { default: null };
}

/**
 * Aggregator-hosted game.
 *
 * Shows the game's real metadata and launches the provider session. When no
 * aggregator credentials exist the API returns no URL, so we say so plainly
 * instead of pretending the game is playable.
 */
function ExternalGamePage({ slug, game }: { slug: string; game: GameCardData }) {
  const user = useApp((s) => s.user);
  const [mode, setMode] = useState<"real" | "demo">("real");
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = categoryMeta(game.category?.slug);

  const launch = async (chosen: "real" | "demo") => {
    setError(null);
    setLaunching(true);
    setMode(chosen);
    try {
      const { post } = await import("../lib/api");
      const launched = await post<{ url?: string; launchUrl?: string }>(`/api/games/${slug}/launch`, { mode: chosen });
      const url = launched.url ?? launched.launchUrl;
      if (url) window.open(url, "_blank", "noopener");
      else setError("Saglayici oturumu baslatilamadi. Agregator API bilgilerini girin.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Oyun baslatilamadi");
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div className="page page-narrow">
      <Link to="/live" className="btn btn-ghost btn-sm mb">
        <IconChevronLeft size={14} /> Geri
      </Link>

      <div className="live-card" style={{ cursor: "default" }}>
        <div className="live-card-art" style={{ ["--tile-color" as string]: game.themeColor ?? "#7f1d1d" }}>
          <span className="live-badge">
            <span className="live-dot" /> Canli
          </span>
          <img src={game.thumbnailUrl ?? `/games/${game.slug}.svg`} alt={game.name} />
        </div>
        <div className="live-card-body">
          <div className="live-card-name" style={{ fontSize: 18 }}>{game.name}</div>
          <div className="live-card-provider">
            {game.provider?.name ?? meta.label} {game.category ? `· ${game.category.name}` : ""}
          </div>
          <div className="live-card-meta">
            <div>
              <div className="live-card-meta-label">Min bahis</div>
              <div className="live-card-meta-value">{game.minBet ? money(game.minBet) : "—"}</div>
            </div>
            <div>
              <div className="live-card-meta-label">Max bahis</div>
              <div className="live-card-meta-value">{game.maxBet ? money(game.maxBet) : "—"}</div>
            </div>
            {game.rtp && (
              <div>
                <div className="live-card-meta-label">RTP</div>
                <div className="live-card-meta-value">%{game.rtp}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {game.description && <p className="muted small mt">{game.description}</p>}

      {error && <div className="alert alert-error mt">{error}</div>}

      <div className="row mt" style={{ gap: 10, flexWrap: "wrap" }}>
        <button
          className={`btn btn-primary btn-lg${launching && mode === "real" ? " btn-loading" : ""}`}
          onClick={() => launch("real")}
          disabled={launching || !user}
        >
          Gercek Para ile Oyna
        </button>
        <button
          className={`btn btn-ghost btn-lg${launching && mode === "demo" ? " btn-loading" : ""}`}
          onClick={() => launch("demo")}
          disabled={launching}
        >
          Demo Oyna
        </button>
      </div>

      {!user && <div className="small faint mt">Gercek para ile oynamak icin giris yapin.</div>}
    </div>
  );
}

export { money };
export type { GameCardData };
