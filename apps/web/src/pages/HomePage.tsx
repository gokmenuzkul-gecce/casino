import { SocketEvents } from "../lib/events";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { get, money } from "../lib/api";
import { socket } from "../lib/socket";
import { useApp } from "../store/app";
import { GameCard, LiveTableCard, categoryMeta, type GameCardData } from "../components/GameCard";
import { Carousel, Empty, SkeletonGrid, SkeletonShelf, Spinner } from "../components/ui";
import { IconChevronRight, IconFlame, IconGift, IconLive, IconSparkle, IconStar, IconTrophy } from "../components/icons";

interface LobbyData {
  featured: GameCardData[];
  newest: GameCardData[];
  popular: GameCardData[];
  categories: { slug: string; name: string; iconUrl?: string | null }[];
  jackpots: { id: string; name: string; amount: string; currency: string }[];
  bonuses: {
    id: string;
    code: string;
    name: string;
    type: string;
    description?: string | null;
    percent: string | null;
    fixedAmount: string | null;
    maxBonus: string | null;
    minDeposit: string | null;
    wageringMultiplier: string | null;
    claimed: boolean;
  }[];
  banners: { id: string; title: string; imageUrl: string; linkUrl?: string | null }[];
  announcements: { id: string; title: string; body?: string }[];
  stats: { onlinePlayers: number; totalBetsToday: number; totalWageredToday: string; totalPaidToday: string };
  bigWins: { id: string; username: string; gameName: string; gameSlug: string; payout: string; currency: string; multiplier: string }[];
}

export function HomePage() {
  const user = useApp((s) => s.user);
  const [data, setData] = useState<LobbyData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [jackpots, setJackpots] = useState<Record<string, string>>({});
  const [online, setOnline] = useState(0);
  const [liveGames, setLiveGames] = useState<GameCardData[] | null>(null);
  const [providers, setProviders] = useState<{ slug: string; name: string; gameCount: number }[]>([]);
  const [catCounts, setCatCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    get<LobbyData>("/api/lobby")
      .then((result) => {
        setData(result);
        setOnline(result.stats.onlinePlayers);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load"));

    // Live tables, providers and per-category counts are separate catalogues.
    get<{ games: GameCardData[] }>("/api/games?category=LIVE_CASINO&pageSize=8")
      .then((r) => setLiveGames(r.games))
      .catch(() => setLiveGames([]));
    get<{ providers: { slug: string; name: string; gameCount: number }[] }>("/api/games/providers")
      .then((r) => setProviders(r.providers))
      .catch(() => undefined);
    get<{ categories: { slug: string; gameCount: number }[] }>("/api/games/categories")
      .then((r) => setCatCounts(Object.fromEntries(r.categories.map((c) => [c.slug, c.gameCount]))))
      .catch(() => undefined);

    if (user) {
      get<{ games: GameCardData[] }>("/api/games/favorites/list")
        .then((result) => setFavorites(new Set(result.games.map((g) => g.slug))))
        .catch(() => undefined);
    }
  }, [user]);

  useEffect(() => {
    const onJackpot = (payload: { jackpots: { id: string; amount: string }[] }) => {
      setJackpots(Object.fromEntries(payload.jackpots.map((j) => [j.id, j.amount])));
    };
    const onStats = (payload: { onlinePlayers: number }) => setOnline(payload.onlinePlayers);
    socket.on(SocketEvents.JACKPOT_TICK, onJackpot);
    socket.on(SocketEvents.LOBBY_STATS, onStats);
    return () => {
      socket.off(SocketEvents.JACKPOT_TICK, onJackpot);
      socket.off(SocketEvents.LOBBY_STATS, onStats);
    };
  }, []);

  const toggleFavorite = (slug: string) =>
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  const heroGame = data?.featured[0] ?? data?.popular[0] ?? null;
  const primaryJackpot = data?.jackpots[0] ?? null;
  const jackpotAmount = primaryJackpot ? (jackpots[primaryJackpot.id] ?? primaryJackpot.amount) : null;

  /**
   * Only categories that actually contain games. The catalogue ships empty
   * categories (SPORTS, FISHING, VIRTUAL) which would otherwise lead to a
   * dead-end page; they appear automatically once games are assigned.
   *
   * Until the counts arrive every category is shown, so the chip row does not
   * visibly shrink once the request resolves.
   */
  const countsLoaded = Object.keys(catCounts).length > 0;
  const populatedCategories = useMemo(
    () => (data?.categories ?? []).filter((c) => !countsLoaded || (catCounts[c.slug] ?? 0) > 0),
    [data, catCounts, countsLoaded],
  );

  if (error) return <div className="page"><div className="alert alert-error">{error}</div></div>;
  if (!data) {
    return (
      <div className="page">
        <div className="skeleton skeleton-hero" />
        <SkeletonShelf />
        <SkeletonShelf />
      </div>
    );
  }

  return (
    <div className="page">
      {/* ── hero ───────────────────────────────────────────── */}
      <section className="hero">
        <div className="hero-bg">
          <img src="/banners/welcome.svg" alt="" aria-hidden />
        </div>
        <div className="hero-overlay" />

        <div className="hero-art" aria-hidden>
          {(data.featured.slice(1, 4).length ? data.featured.slice(1, 4) : data.popular.slice(0, 3)).map((game) => (
            <div className="hero-art-card" key={game.slug}>
              <img src={game.thumbnailUrl ?? `/games/${game.slug}.svg`} alt="" loading="lazy" />
            </div>
          ))}
        </div>

        <div className="hero-content">
          <span className="hero-eyebrow">
            <IconSparkle size={14} /> PROVABLY FAIR OYUN MOTORU
          </span>
          <h1 className="hero-title">
            Her tur dogrulanabilir.
            <br />
            <span className="grad">Transparent winnings.</span>
          </h1>
          <p className="hero-sub">
            Sunucu tohumunun ozeti tur baslamadan yayinlanir; sonucu kendi cihazinizdan bagimsiz olarak dogrulayabilirsiniz.
            Dahili oyunlar, canli masalar ve anlik oyunlar tek hesapta.
          </p>

          <div className="hero-cta">
            {user ? (
              <>
                <Link to={heroGame ? `/play/${heroGame.slug}` : "/games"} className="btn btn-primary btn-lg">
                  Oynamaya Basla
                </Link>
                <Link to="/wallet" className="btn btn-ghost btn-lg">
                  Para Yatir
                </Link>
              </>
            ) : (
              <>
                <Link to="/games" className="btn btn-primary btn-lg">
                  Oyunlari Kesfet
                </Link>
                <Link to="/live" className="btn btn-ghost btn-lg">
                  Canli Casino
                </Link>
              </>
            )}
          </div>

          <div className="hero-stats">
            <div>
              <div className="hero-stat-label">Online</div>
              <div className="hero-stat-value">
                <span className="live-dot" style={{ display: "inline-block", marginRight: 7 }} />
                {online.toLocaleString("tr-TR")}
              </div>
            </div>
            <div>
              <div className="hero-stat-label">Played today</div>
              <div className="hero-stat-value">{data.stats.totalBetsToday.toLocaleString("tr-TR")}</div>
            </div>
            <div>
              <div className="hero-stat-label">Paid out today</div>
              <div className="hero-stat-value" style={{ color: "var(--success)" }}>{money(data.stats.totalPaidToday)}</div>
            </div>
            <div>
              <div className="hero-stat-label">Game</div>
              <div className="hero-stat-value">{data.featured.length + data.newest.length + data.popular.length}</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── jackpot ticker ─────────────────────────────────── */}
      {primaryJackpot && jackpotAmount && (
        <section className="jackpot-bar">
          <span className="jackpot-label">
            <IconFlame size={16} /> {primaryJackpot.name}
          </span>
          <span className="jackpot-amount">{money(jackpotAmount, primaryJackpot.currency)}</span>
          <span className="spacer" />
          <Link to="/games?jackpot=true" className="btn btn-primary btn-sm">
            Jackpot Oyunlari
          </Link>
        </section>
      )}

      {/* ── category chips ─────────────────────────────────── */}
      {populatedCategories.length > 0 && (
        <div className="chip-row" style={{ marginBottom: 4 }}>
          <Link to="/games" className="chip active">
            <span className="chip-icon">🔥</span> Hepsi
          </Link>
          {populatedCategories.map((category) => {
            const meta = categoryMeta(category.slug);
            return (
              <Link key={category.slug} to={`/games?category=${category.slug}`} className="chip">
                <span className="chip-icon">{meta.icon}</span>
                {category.name}
              </Link>
            );
          })}
        </div>
      )}

      {/* ── shelves ────────────────────────────────────────── */}
      <Shelf title="Featured" icon={<IconStar size={17} filled />} games={data.featured} favorites={favorites} onToggle={toggleFavorite} />
      <Shelf title="New Games" icon={<IconSparkle size={17} />} games={data.newest} favorites={favorites} onToggle={toggleFavorite} />

      {/* ── live casino ────────────────────────────────────── */}
      <div className="carousel-head">
        <div className="section-title" style={{ margin: 0 }}>
          <IconLive size={18} /> Canli Casino
          {liveGames && liveGames.length > 0 && <span className="count">{liveGames.length} masa</span>}
        </div>
        <Link to="/live" className="btn btn-ghost btn-sm">
          Tumu <IconChevronRight size={14} />
        </Link>
      </div>
      {liveGames === null ? (
        <SkeletonShelf count={4} />
      ) : liveGames.length === 0 ? (
        <div className="card">
          <Empty
            icon="🎥"
            title="Live tables are not connected yet"
            hint="Real dealer tables appear here automatically once the aggregator API credentials are entered."
          />
        </div>
      ) : (
        <div className="live-grid">
          {liveGames.slice(0, 8).map((game) => (
            <LiveTableCard key={game.slug} game={game} />
          ))}
        </div>
      )}

      {/* ── popular shelf ──────────────────────────────────── */}
      <Shelf title="Most Played" icon={<IconFlame size={17} />} games={data.popular} favorites={favorites} onToggle={toggleFavorite} />

      {/* ── promotions ─────────────────────────────────────── */}
      {data.bonuses.length > 0 && (
        <>
          <div className="carousel-head">
            <div className="section-title" style={{ margin: 0 }}>
              <IconGift size={18} /> Bonuslar ve Kampanyalar
              <span className="count">{data.bonuses.length} aktif</span>
            </div>
            <Link to="/promotions" className="btn btn-ghost btn-sm">
              Tumu <IconChevronRight size={14} />
            </Link>
          </div>
          <div className="promo-grid">
            {data.bonuses.slice(0, 3).map((bonus) => (
              <Link key={bonus.id} to="/promotions" className="promo-card" style={{ display: "block" }}>
                <div className="promo-card-art">
                  <img src={bonus.type === "CASHBACK" ? "/banners/crash.svg" : "/banners/welcome.svg"} alt="" loading="lazy" />
                </div>
                <div className="promo-card-veil" />
                <div className="promo-card-body">
                  <div className="promo-card-kicker">{bonus.type}</div>
                  <div className="promo-card-title">{bonus.name}</div>
                  <div className="promo-card-sub">
                    {bonus.percent ? `%${bonus.percent} oran` : bonus.fixedAmount ? money(bonus.fixedAmount) : bonus.description}
                    {bonus.maxBonus ? ` · max ${money(bonus.maxBonus)}` : ""}
                  </div>
                  <span className="promo-card-code">{bonus.code}</span>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      {/* ── providers ──────────────────────────────────────── */}
      {providers.length > 0 && (
        <>
          <div className="section-title">Game Providers</div>
          <div className="provider-strip">
            {providers.map((provider) => (
              <Link key={provider.slug} to={`/games?provider=${provider.slug}`} className="provider-logo">
                <span className="provider-logo-mark">{provider.name.slice(0, 1).toUpperCase()}</span>
                {provider.name}
                <span className="chip-count">{provider.gameCount}</span>
              </Link>
            ))}
          </div>
        </>
      )}

      {/* ── big wins + categories ──────────────────────────── */}
      <div className="grid grid-2 mt">
        <div className="card">
          <div className="card-title">
            <span className="row" style={{ gap: 8 }}>
              <IconTrophy size={17} /> Son Buyuk Kazanclar
            </span>
          </div>
          {data.bigWins.length === 0 ? (
            <Empty icon="🏆" title="No records yet" hint="Be the first to hit a big win!" />
          ) : (
            <div className="col" style={{ gap: 0 }}>
              {data.bigWins.slice(0, 8).map((win) => (
                <div key={win.id} className="win-row">
                  <Link to={`/play/${win.gameSlug}`} className="muted truncate" style={{ flex: "1 1 auto" }}>
                    {win.username}
                  </Link>
                  <span className="faint small nowrap">{win.gameName}</span>
                  <span className="win-amount nowrap">
                    {money(win.payout, win.currency)}
                    <span className="tiny faint"> x{Number(win.multiplier).toFixed(2)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title">Categories</div>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))", gap: 10 }}>
            {populatedCategories.map((category) => {
              const meta = categoryMeta(category.slug);
              return (
                <Link
                  key={category.slug}
                  to={`/games?category=${category.slug}`}
                  className="cat-tile"
                  style={{ ["--cat-color" as string]: meta.color }}
                >
                  <span className="cat-tile-icon">{meta.icon}</span>
                  <span className="cat-tile-name">{category.name}</span>
                  <span className="cat-tile-count">Kesfet</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** One horizontal shelf of games. Renders nothing when it has no games. */
function Shelf({
  title,
  icon,
  games,
  favorites,
  onToggle,
}: {
  title: string;
  icon: React.ReactNode;
  games: GameCardData[];
  favorites: Set<string>;
  onToggle: (slug: string) => void;
}) {
  if (games.length === 0) return null;
  return (
    <>
      <div className="carousel-head">
        <div className="section-title" style={{ margin: 0 }}>
          {icon} {title}
          <span className="count">{games.length} oyun</span>
        </div>
      </div>
      <Carousel>
        {games.map((game) => (
          <div className="carousel-item" key={game.slug}>
            <GameCard game={game} favorite={favorites.has(game.slug)} onToggleFavorite={onToggle} />
          </div>
        ))}
      </Carousel>
    </>
  );
}

export { Spinner, SkeletonGrid };
