import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../store/app";
import { post, money } from "../lib/api";
import { IconStar } from "./icons";

export interface GameCardData {
  slug: string;
  name: string;
  description?: string | null;
  thumbnailUrl?: string | null;
  bannerUrl?: string | null;
  themeColor?: string | null;
  rtp?: string | null;
  volatility?: string | null;
  minBet?: string;
  maxBet?: string;
  isNew?: boolean;
  isFeatured?: boolean;
  isJackpot?: boolean;
  isExclusive?: boolean;
  demoEnabled?: boolean;
  realEnabled?: boolean;
  embedType?: string;
  tags?: string[];
  category?: { slug: string; name: string } | null;
  provider?: { slug: string; name: string } | null;
  jackpot?: { amount: string; currency: string } | null;
}

export const CATEGORY_META: Record<string, { icon: string; color: string; label: string }> = {
  SLOTS: { icon: "🎰", color: "var(--cat-slots)", label: "Slots" },
  LIVE_CASINO: { icon: "🃏", color: "var(--cat-live)", label: "Live Casino" },
  TABLE: { icon: "🎲", color: "var(--cat-table)", label: "Table Games" },
  CRASH: { icon: "📈", color: "var(--cat-crash)", label: "Crash" },
  INSTANT: { icon: "⚡", color: "var(--cat-instant)", label: "Instant Games" },
  JACKPOT: { icon: "💰", color: "var(--cat-jackpot)", label: "Jackpot" },
  LOTTERY: { icon: "🎱", color: "var(--cat-lottery)", label: "Keno & Lottery" },
  FISHING: { icon: "🐟", color: "#0ea5e9", label: "Fishing" },
  VIRTUAL: { icon: "🕹️", color: "#f82441", label: "Virtual" },
  SPORTS: { icon: "⚽", color: "var(--cat-sports)", label: "Sports Betting" },
};

export const categoryMeta = (slug?: string | null) =>
  (slug ? CATEGORY_META[slug] : undefined) ?? { icon: "🎮", color: "var(--primary)", label: "Game" };

/**
 * Cover art for a game.
 *
 * Uses the provider thumbnail when present and falls back to the locally
 * generated SVG keyed off the slug — so a card never renders an empty box even
 * before an aggregator supplies real artwork.
 */
export function gameArt(game: Pick<GameCardData, "slug" | "thumbnailUrl">): string {
  if (game.thumbnailUrl) return game.thumbnailUrl;
  return `/games/${game.slug}.svg`;
}

function useFallbackArt(game: GameCardData) {
  const [failed, setFailed] = useState(false);
  const primary = gameArt(game);
  return {
    src: failed ? "/games/default.svg" : primary,
    onError: () => setFailed(true),
  };
}

export function GameCard({
  game,
  favorite,
  onToggleFavorite,
}: {
  game: GameCardData;
  favorite?: boolean;
  onToggleFavorite?: (slug: string) => void;
}) {
  const navigate = useNavigate();
  const user = useApp((s) => s.user);
  const art = useFallbackArt(game);
  const meta = categoryMeta(game.category?.slug);

  const open = () => navigate(`/play/${game.slug}`);

  const toggleFav = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!user) return;
    try {
      await post(`/api/games/favorites/${game.slug}`);
      onToggleFavorite?.(game.slug);
    } catch {
      /* ignore */
    }
  };

  const badge = game.isJackpot
    ? { text: "Jackpot", cls: "badge-jackpot" }
    : game.isNew
      ? { text: "New", cls: "badge-new" }
      : game.isFeatured
        ? { text: "Popular", cls: "badge-hot" }
        : null;

  return (
    <div
      className="game-tile"
      onClick={open}
      title={game.name}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
    >
      {badge && <span className={`badge ${badge.cls}`}>{badge.text}</span>}

      {user && (
        <button
          className={`fav-btn${favorite ? " on" : ""}`}
          onClick={toggleFav}
          aria-label={favorite ? "Favoriden cikar" : "Favorilere ekle"}
          aria-pressed={favorite}
        >
          <IconStar size={14} filled={favorite} />
        </button>
      )}

      <div className="game-tile-art" style={{ ["--tile-color" as string]: game.themeColor ?? "#e71d3a" }}>
        <img src={art.src} alt={game.name} loading="lazy" decoding="async" onError={art.onError} />
      </div>
      <div className="game-tile-name">{game.name}</div>
      {/* Provider + like count, mirroring the reference card footer. */}
      <div className="game-tile-info">
        <span className="truncate">{game.provider?.name ?? meta.label}</span>
      </div>
    </div>
  );
}

export function GameGrid({
  games,
  favorites,
  onToggleFavorite,
}: {
  games: GameCardData[];
  favorites?: Set<string>;
  onToggleFavorite?: (slug: string) => void;
}) {
  return (
    <div className="grid grid-games">
      {games.map((game) => (
        <GameCard
          key={game.slug}
          game={game}
          favorite={favorites?.has(game.slug)}
          onToggleFavorite={onToggleFavorite}
        />
      ))}
    </div>
  );
}

/**
 * Live-dealer table card.
 *
 * Visually distinct from a slot tile: wider aspect, a live indicator, dealer
 * artwork, and the stake range the table actually accepts.
 */
export function LiveTableCard({ game }: { game: GameCardData }) {
  const navigate = useNavigate();
  const art = useFallbackArt(game);
  const meta = categoryMeta(game.category?.slug);

  return (
    <div
      className="live-card"
      onClick={() => navigate(`/play/${game.slug}`)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          navigate(`/play/${game.slug}`);
        }
      }}
    >
      <div className="live-card-art" style={{ ["--tile-color" as string]: game.themeColor ?? "#7f1d1d" }}>
        <span className="live-badge">
          <span className="live-dot" /> Live
        </span>
        <img src={art.src} alt={game.name} loading="lazy" decoding="async" onError={art.onError} />
      </div>
      <div className="live-card-body">
        <div className="live-card-name">{game.name}</div>
        <div className="live-card-provider">{game.provider?.name ?? meta.label}</div>
        <div className="live-card-meta">
          <div>
            <div className="live-card-meta-label">Min</div>
            <div className="live-card-meta-value">{game.minBet ? money(game.minBet) : "—"}</div>
          </div>
          <div>
            <div className="live-card-meta-label">Max</div>
            <div className="live-card-meta-value">{game.maxBet ? money(game.maxBet) : "—"}</div>
          </div>
          <div style={{ marginLeft: "auto", alignSelf: "center" }}>
            <span className="btn btn-primary btn-sm">Play</span>
          </div>
        </div>
      </div>
    </div>
  );
}
