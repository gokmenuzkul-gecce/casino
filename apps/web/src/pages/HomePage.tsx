import { SocketEvents } from "../lib/events";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { get, money } from "../lib/api";
import { socket } from "../lib/socket";
import { useApp } from "../store/app";
import { GameCard, LiveTableCard, categoryMeta, type GameCardData } from "../components/GameCard";
import { Carousel, Empty, SkeletonGrid, SkeletonShelf, Spinner } from "../components/ui";
import { IconChevronRight } from "../components/icons";

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
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    get<LobbyData>("/api/lobby")
      .then((result) => {
        setData(result);
        setOnline(result.stats.onlinePlayers);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load"));

    // Live tables are a separate catalogue from the lobby payload.
    get<{ games: GameCardData[] }>("/api/games?category=LIVE_CASINO&pageSize=8")
      .then((r) => setLiveGames(r.games))
      .catch(() => setLiveGames([]));

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
  const banners = data?.banners ?? [];

  /** Rotate the banner carousel; `step` is +1/-1 and wraps around. */
  const go = (step: number) =>
    setSlide((current) => {
      const count = banners.length;
      return count === 0 ? 0 : (current + step + count) % count;
    });

  /** Winner names arrive masked from the API; show a placeholder until then. */
  const lastWinner = (_id: string) => "********";

  useEffect(() => {
    if (banners.length < 2) return;
    const timer = setInterval(() => setSlide((current) => (current + 1) % banners.length), 6000);
    return () => clearInterval(timer);
  }, [banners.length]);

  /**
   * Only categories that actually contain games. The catalogue ships empty
   * categories (SPORTS, FISHING, VIRTUAL) which would otherwise lead to a
   * dead-end page; they appear automatically once games are assigned.
   */
  const populatedCategories = data?.categories ?? [];

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
      {/* ── hero banner carousel ───────────────────────────── */}
      {banners.length > 0 && (
        <section className="hero-slider">
          {banners.map((banner, index) => (
            <Link
              key={banner.id}
              to={banner.linkUrl || "/promotions"}
              className={`hero-slide${index === slide ? " on" : ""}`}
              aria-hidden={index !== slide}
            >
              <img src={banner.imageUrl} alt={banner.title} />
            </Link>
          ))}
          <button className="hero-slide-nav prev" onClick={() => go(-1)} aria-label="Previous slide">
            <span style={{ display: "grid", transform: "rotate(180deg)" }}>
              <IconChevronRight size={16} />
            </span>
          </button>
          <button className="hero-slide-nav next" onClick={() => go(1)} aria-label="Next slide">
            <IconChevronRight size={16} />
          </button>
          <div className="hero-slide-dots">
            {banners.map((banner, index) => (
              <button
                key={banner.id}
                className={`hero-slide-dot${index === slide ? " on" : ""}`}
                onClick={() => setSlide(index)}
                aria-label={`Go to slide ${index + 1}`}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── jackpot row ────────────────────────────────────── */}
      {data.jackpots.length > 0 && (
        <section className="jackpot-row">
          {data.jackpots.slice(0, 3).map((jackpot, index) => (
            <div key={jackpot.id} className={`jackpot-card tier-${["gold", "silver", "bronze"][index] ?? "bronze"}`}>
              <div className="jackpot-card-amount">
                {money(jackpots[jackpot.id] ?? jackpot.amount, jackpot.currency)}
              </div>
              <div className="jackpot-card-tier">{jackpot.name}</div>
              <div className="jackpot-card-winner">
                Last Winner: <span className="mono">{lastWinner(jackpot.id)}</span>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* ── casino games ───────────────────────────────────── */}
      <div className="carousel-head">
        <div className="section-title" style={{ margin: 0 }}>
          Casino Games
        </div>
        <Link to="/games" className="btn btn-ghost btn-sm">
          All games <IconChevronRight size={14} />
        </Link>
      </div>
      <Carousel>
        {data.featured.map((game) => (
          <div className="carousel-item" key={game.slug}>
            <GameCard game={game} favorite={favorites.has(game.slug)} onToggleFavorite={toggleFavorite} />
          </div>
        ))}
      </Carousel>

      {/* ── promotions ─────────────────────────────────────── */}
      {data.bonuses.length > 0 && (
        <>
          <div className="carousel-head">
            <div className="section-title" style={{ margin: 0 }}>
              Promotions
            </div>
            <Link to="/promotions" className="btn btn-ghost btn-sm">
              Show All <IconChevronRight size={14} />
            </Link>
          </div>
          <div className="promo-grid promo-grid-3">
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
                    {bonus.percent ? `%${bonus.percent} rate` : bonus.fixedAmount ? money(bonus.fixedAmount) : bonus.description}
                    {bonus.maxBonus ? ` · max ${money(bonus.maxBonus)}` : ""}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      {/* ── live games ─────────────────────────────────────── */}
      <div className="carousel-head">
        <div className="section-title" style={{ margin: 0 }}>
          Live Games
        </div>
        <Link to="/live" className="btn btn-ghost btn-sm">
          All games <IconChevronRight size={14} />
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
        <Carousel>
          {liveGames.slice(0, 8).map((game) => (
            <div className="carousel-item carousel-item-wide" key={game.slug}>
              <LiveTableCard game={game} />
            </div>
          ))}
        </Carousel>
      )}
    </div>
  );
}

export { Spinner, SkeletonGrid };
