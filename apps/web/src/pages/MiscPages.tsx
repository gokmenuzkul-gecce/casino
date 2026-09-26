import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { get, money, post } from "../lib/api";
import { useApp } from "../store/app";
import { Alert, Empty, Pill, SkeletonShelf, Spinner } from "../components/ui";
import { GameGrid, LiveTableCard, type GameCardData } from "../components/GameCard";

export function VipPage() {
  const { user } = useApp();
  const [data, setData] = useState<{
    current: { tier: string; level: number; loyaltyPoints: string; lifetimeWagered: string; cashbackBalance: string } | null;
    next: { tier: string; name: string; minWagered: string; remaining: string } | null;
    tiers: { tier: string; name: string; level: number; minWagered: string; cashbackPercent: string; weeklyBonus: string; monthlyBonus: string; rakebackPercent: string; benefits: string[]; color: string }[];
  } | null>(null);

  useEffect(() => {
    if (!user) return;
    get<typeof data>("/api/vip").then(setData).catch(() => undefined);
  }, [user]);

  if (!user) return <div className="page"><Alert kind="info">VIP programi icin giris yapmalisiniz.</Alert></div>;
  if (!data) return <div className="page"><Spinner /></div>;

  return (
    <div className="page">
      <h1 className="section-title" style={{ marginTop: 0 }}>VIP Programi</h1>

      {data.current && (
        <div className="card mb" style={{ background: "linear-gradient(120deg, rgba(251,191,36,0.18), transparent), var(--bg-elev)" }}>
          <div className="row-between" style={{ flexWrap: "wrap", gap: 16 }}>
            <div>
              <div className="tiny faint">Mevcut seviyeniz</div>
              <div style={{ fontSize: 30, fontWeight: 900 }}>{data.current.tier}</div>
            </div>
            <div>
              <div className="tiny faint">Toplam bahis</div>
              <div className="bold" style={{ fontSize: 20 }}>{money(data.current.lifetimeWagered)}</div>
            </div>
            <div>
              <div className="tiny faint">Sadakat puani</div>
              <div className="bold" style={{ fontSize: 20 }}>{Number(data.current.loyaltyPoints).toLocaleString("tr-TR")}</div>
            </div>
            <div>
              <div className="tiny faint">Cashback bakiyesi</div>
              <div className="bold" style={{ fontSize: 20, color: "var(--success)" }}>{money(data.current.cashbackBalance)}</div>
            </div>
          </div>
          {data.next && (
            <div className="mt">
              <div className="small muted mb">Sonraki seviye {data.next.name} icin kalan: <span className="bold">{money(data.next.remaining)}</span></div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-3">
        {data.tiers.map((tier) => (
          <div
            key={tier.tier}
            className="card"
            style={{
              borderColor: data.current?.tier === tier.tier ? "var(--gold)" : "var(--border)",
              background: data.current?.tier === tier.tier ? "linear-gradient(160deg, rgba(251,191,36,0.12), var(--bg-elev))" : "var(--bg-elev)",
            }}
          >
            <div className="row-between mb">
              <div className="bold" style={{ fontSize: 17, color: tier.color }}>{tier.name}</div>
              {data.current?.tier === tier.tier && <Pill kind="vip">SIZIN SEVIYENIZ</Pill>}
            </div>
            <div className="small muted mb">Min bahis: {money(tier.minWagered)}</div>
            <div className="col" style={{ gap: 5 }}>
              <div className="row-between small"><span className="muted">Cashback</span><span className="bold">%{tier.cashbackPercent}</span></div>
              <div className="row-between small"><span className="muted">Haftalik</span><span className="bold">{money(tier.weeklyBonus)}</span></div>
              <div className="row-between small"><span className="muted">Aylik</span><span className="bold">{money(tier.monthlyBonus)}</span></div>
              <div className="row-between small"><span className="muted">Rakeback</span><span className="bold">%{tier.rakebackPercent}</span></div>
            </div>
            <div className="divider" style={{ margin: "12px 0" }} />
            <div className="col" style={{ gap: 4 }}>
              {tier.benefits.map((benefit) => (
                <div key={benefit} className="small">✓ {benefit}</div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LeaderboardPage() {
  const [period, setPeriod] = useState<"DAILY" | "WEEKLY" | "MONTHLY">("DAILY");
  const [metric, setMetric] = useState<"WAGERED" | "WON">("WAGERED");
  const [leaders, setLeaders] = useState<{ rank: number; username: string; vipTier: string | null; value: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    get<{ leaders: typeof leaders }>(`/api/leaderboard?period=${period}&metric=${metric}`)
      .then((r) => setLeaders(r.leaders))
      .finally(() => setLoading(false));
  }, [period, metric]);

  return (
    <div className="page page-narrow">
      <h1 className="section-title" style={{ marginTop: 0 }}>Liderlik Tablosu</h1>

      <div className="row mb" style={{ gap: 6, flexWrap: "wrap" }}>
        {(["DAILY", "WEEKLY", "MONTHLY"] as const).map((key) => (
          <button key={key} className={`btn btn-sm ${period === key ? "btn-primary" : "btn-ghost"}`} onClick={() => setPeriod(key)}>
            {key === "DAILY" ? "Gunluk" : key === "WEEKLY" ? "Haftalik" : "Aylik"}
          </button>
        ))}
        <div className="spacer" />
        {(["WAGERED", "WON"] as const).map((key) => (
          <button key={key} className={`btn btn-sm ${metric === key ? "btn-primary" : "btn-ghost"}`} onClick={() => setMetric(key)}>
            {key === "WAGERED" ? "Bahis hacmi" : "Kazanc"}
          </button>
        ))}
      </div>

      <div className="card">
        {loading ? <Spinner /> : leaders.length === 0 ? <Empty icon="🏆" title="Bu donemde kayit yok" /> : (
          <table className="table">
            <thead><tr><th>#</th><th>Oyuncu</th><th>VIP</th><th className="right">{metric === "WAGERED" ? "Bahis" : "Kazanc"}</th></tr></thead>
            <tbody>
              {leaders.map((leader) => (
                <tr key={leader.rank}>
                  <td className="bold" style={{ color: leader.rank <= 3 ? "var(--gold)" : "var(--text-dim)" }}>
                    {leader.rank <= 3 ? ["🥇", "🥈", "🥉"][leader.rank - 1] : leader.rank}
                  </td>
                  <td>{leader.username}</td>
                  <td>{leader.vipTier ? <Pill kind="vip">{leader.vipTier}</Pill> : <span className="faint">—</span>}</td>
                  <td className="right mono bold">{money(leader.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function TournamentsPage() {
  const [tournaments, setTournaments] = useState<
    { slug: string; name: string; description?: string; type: string; status: string; metric: string; prizePool: string; currency: string; startAt: string; endAt: string }[]
  >([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ leaderboard: { rank: number; username: string; score: string; prize: string }[] } | null>(null);

  useEffect(() => {
    get<{ tournaments: typeof tournaments }>("/api/tournaments").then((r) => setTournaments(r.tournaments)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!selected) return;
    get<{ leaderboard: typeof detail extends null ? never : { rank: number; username: string; score: string; prize: string }[] }>(`/api/tournaments/${selected}`)
      .then((r) => setDetail({ leaderboard: r.leaderboard }))
      .catch(() => undefined);
  }, [selected]);

  return (
    <div className="page">
      <h1 className="section-title" style={{ marginTop: 0 }}>Turnuvalar</h1>

      {tournaments.length === 0 ? (
        <Empty icon="🎯" title="Su anda aktif turnuva yok" hint="Yakin zamanda yeni turnuvalar eklenecek" />
      ) : (
        <div className="grid grid-2">
          {tournaments.map((tournament) => (
            <div className="card" key={tournament.slug}>
              <div className="row-between mb">
                <div className="bold" style={{ fontSize: 17 }}>{tournament.name}</div>
                <Pill kind={tournament.status === "ACTIVE" ? "success" : "warning"}>{tournament.status}</Pill>
              </div>
              <p className="small muted mb">{tournament.description}</p>
              <div className="grid grid-2" style={{ gap: 10 }}>
                <div className="stat card-tight">
                  <div className="stat-label">Odul havuzu</div>
                  <div className="stat-value" style={{ fontSize: 19, color: "var(--gold)" }}>{money(tournament.prizePool, tournament.currency)}</div>
                </div>
                <div className="stat card-tight">
                  <div className="stat-label">Olcu</div>
                  <div className="stat-value" style={{ fontSize: 19 }}>{tournament.metric}</div>
                </div>
              </div>
              <button className="btn btn-ghost btn-block mt" onClick={() => setSelected(tournament.slug)}>Liderlik Tablosu</button>
            </div>
          ))}
        </div>
      )}

      {selected && detail && (
        <div className="card mt">
          <div className="card-title">Siralama <button className="btn btn-ghost btn-sm" onClick={() => setSelected(null)}>Kapat</button></div>
          {detail.leaderboard.length === 0 ? (
            <Empty icon="📋" title="Henuz katilim yok" />
          ) : (
            <table className="table">
              <thead><tr><th>#</th><th>Oyuncu</th><th className="right">Skor</th><th className="right">Odul</th></tr></thead>
              <tbody>
                {detail.leaderboard.map((entry) => (
                  <tr key={entry.rank}>
                    <td className="bold">{entry.rank}</td>
                    <td>{entry.username}</td>
                    <td className="right mono">{entry.score}</td>
                    <td className="right mono bold" style={{ color: "var(--gold)" }}>{money(entry.prize)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

/** Live-casino lobby: aggregated dealer tables and game shows. */
export function LivePage() {
  const [games, setGames] = useState<GameCardData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    get<{ games: GameCardData[] }>("/api/games?category=LIVE_CASINO&pageSize=60")
      .then((r) => setGames(r.games))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  /** Group tables the way a live lobby does, without inventing categories. */
  const groups = useMemo(() => {
    const buckets: { key: string; label: string; icon: string; match: (g: GameCardData) => boolean }[] = [
      { key: "blackjack", label: "Live Blackjack", icon: "🃏", match: (g) => /blackjack|black jack|21/i.test(`${g.slug} ${g.name}`) },
      { key: "roulette", label: "Live Roulette", icon: "🎡", match: (g) => /roulette|rulet/i.test(`${g.slug} ${g.name}`) },
      { key: "baccarat", label: "Live Baccarat", icon: "🀄", match: (g) => /baccarat|bakara/i.test(`${g.slug} ${g.name}`) },
      { key: "show", label: "Game Shows", icon: "🎪", match: (g) => /show|wheel|monopoly|deal|mega|fun/i.test(`${g.slug} ${g.name}`) },
    ];
    const claimed = new Set<string>();
    const result = buckets
      .map((bucket) => {
        const rows = games.filter((g) => !claimed.has(g.slug) && bucket.match(g));
        rows.forEach((g) => claimed.add(g.slug));
        return { ...bucket, rows };
      })
      .filter((bucket) => bucket.rows.length > 0);
    const rest = games.filter((g) => !claimed.has(g.slug));
    if (rest.length > 0) result.push({ key: "other", label: "Diger Masalar", icon: "🎲", match: () => true, rows: rest });
    return result;
  }, [games]);

  return (
    <div className="page">
      <section className="hero" style={{ minHeight: 220 }}>
        <div className="hero-bg">
          <img src="/banners/live.svg" alt="" aria-hidden />
        </div>
        <div className="hero-overlay" />
        <div className="hero-content" style={{ padding: "32px 34px" }}>
          <span className="hero-eyebrow">
            <span className="live-dot" /> GERCEK KRUPIYELER
          </span>
          <h1 className="hero-title" style={{ fontSize: "clamp(26px, 3.4vw, 40px)" }}>
            Canli Casino
          </h1>
          <p className="hero-sub" style={{ marginBottom: 0, maxWidth: 620 }}>
            Gercek masalar, gercek krupiyeler. Oyun agregatoru API bilgileri girildiginde canli rulet, blackjack, baccarat
            ve game show masalari bu bolumde otomatik olarak listelenir.
          </p>
        </div>
      </section>

      {loading ? (
        <SkeletonShelf count={4} />
      ) : games.length === 0 ? (
        <div className="card">
          <Empty
            icon="🎥"
            title="Canli masa listesi henuz bos"
            hint="Agregator entegrasyonu yapilandirildiginda canli masalar burada otomatik gorunur."
          />
          <div className="center mt">
            <Link to="/games" className="btn btn-primary">Dahili Oyunlara Goz At</Link>
          </div>
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.key}>
            <div className="section-title">
              {group.icon} {group.label}
              <span className="count">{group.rows.length} masa</span>
            </div>
            <div className="live-grid">
              {group.rows.map((game) => (
                <LiveTableCard key={game.slug} game={game} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export function FairnessPage() {
  const { user } = useApp();
  const [betId, setBetId] = useState("");
  const [result, setResult] = useState<{
    reference: string;
    serverSeed: string;
    serverSeedHash: string;
    clientSeed: string;
    nonce: number;
    hashMatches: boolean;
    storedMultiplier: string | null;
    replayedMultiplier: string | null;
    verified: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bets, setBets] = useState<{ id: string; reference: string; game: string }[]>([]);

  useEffect(() => {
    if (!user) return;
    get<{ rows: { id: string; reference: string; game: string }[] }>("/api/games/bets/history?pageSize=20")
      .then((r) => setBets(r.rows))
      .catch(() => undefined);
  }, [user]);

  const verify = async (target: string) => {
    setError(null);
    setResult(null);
    try {
      const data = await get<typeof result>(`/api/games/bets/${target}/verify`);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dogrulama basarisiz");
    }
  };

  return (
    <div className="page page-narrow">
      <h1 className="section-title" style={{ marginTop: 0 }}>Provably Fair Dogrulama</h1>

      <div className="card mb">
        <p className="small muted">
          Her tur icin sunucu tohumunun SHA-256 ozeti tur basinda yayinlanir. Tur bittiginde tohum aciklanir; bu araç ayni
          sonucu bagimsiz olarak yeniden hesaplar ve kayitli sonucla karsilastirir.
        </p>
      </div>

      <div className="card mb">
        <div className="field">
          <label>Bahis ID veya referans</label>
          <div className="input-row">
            <input className="input" value={betId} onChange={(e) => setBetId(e.target.value)} placeholder="Bahis referansini girin" />
            <button className="btn btn-primary" onClick={() => verify(betId)} disabled={!betId}>Dogrula</button>
          </div>
        </div>

        {error && <Alert kind="error">{error}</Alert>}

        {result && (
          <div className="col" style={{ gap: 10 }}>
            <div className={`alert ${result.verified ? "alert-success" : "alert-error"}`}>
              {result.verified ? "✓ Sonuc dogrulandi — bahis degistirilmemis" : "✗ Dogrulama basarisiz"}
            </div>
            <div className="grid grid-2" style={{ gap: 10 }}>
              <div className="stat card-tight">
                <div className="stat-label">Tohum ozeti eslesmesi</div>
                <div className="stat-value" style={{ fontSize: 18 }}>{result.hashMatches ? "✓ Evet" : "✗ Hayir"}</div>
              </div>
              <div className="stat card-tight">
                <div className="stat-label">Katsayi karsilastirmasi</div>
                <div className="stat-value" style={{ fontSize: 18 }}>
                  x{result.storedMultiplier} / x{result.replayedMultiplier}
                </div>
              </div>
            </div>
            <div className="card card-tight">
              <div className="field"><label>Sunucu tohumu (aciklanan)</label><div className="mono small" style={{ wordBreak: "break-all" }}>{result.serverSeed}</div></div>
              <div className="field"><label>Yayinlanan ozet (SHA-256)</label><div className="mono small" style={{ wordBreak: "break-all" }}>{result.serverSeedHash}</div></div>
              <div className="field"><label>Istemci tohumu</label><div className="mono small" style={{ wordBreak: "break-all" }}>{result.clientSeed}</div></div>
              <div className="row-between small"><span className="muted">Nonce</span><span className="mono">{result.nonce}</span></div>
            </div>
          </div>
        )}
      </div>

      {bets.length > 0 && (
        <div className="card">
          <div className="card-title">Son Bahisleriniz</div>
          <div className="col" style={{ gap: 6 }}>
            {bets.map((bet) => (
              <div key={bet.id} className="row-between small" style={{ padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                <span className="mono truncate">{bet.reference}</span>
                <span className="faint">{bet.game}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => { setBetId(bet.id); verify(bet.id); }}>Dogrula</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
