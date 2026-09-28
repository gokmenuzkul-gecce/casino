import { useEffect, useState } from "react";
import { get, patch, post } from "../lib/api";
import { Empty, Pill, Spinner } from "../components/ui";
import type { ToastFn } from "./AdminLayout";

interface AdminGame {
  slug: string;
  name: string;
  rtp: string | null;
  volatility: string;
  isActive: boolean;
  isFeatured: boolean;
  isNew: boolean;
  demoEnabled: boolean;
  realEnabled: boolean;
  embedType: string;
  minBet: string;
  maxBet: string;
  playCount: string;
  category?: { slug: string; name: string } | null;
  provider?: { slug: string; name: string } | null;
  _count?: { bets: number };
}

export function AdminGames({ onToast }: { onToast: ToastFn }) {
  const [games, setGames] = useState<AdminGame[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncingLoginx, setSyncingLoginx] = useState(false);
  /**
   * Which slice of the catalogue to show. `loginx` narrows to the vendor family
   * imported from loginxgamesapi; `inactive` surfaces the not-yet-published
   * rows, which is where that whole family currently sits.
   */
  const [source, setSource] = useState<"all" | "loginx" | "inactive">("all");

  const load = () => {
    setLoading(true);
    const query = new URLSearchParams({ page: String(page), pageSize: "40" });
    if (search) query.set("search", search);
    if (source === "loginx") query.set("providerPrefix", "loginx-");
    if (source === "inactive") query.set("active", "false");
    get<{ games: AdminGame[]; total: number }>(`/api/admin/games?${query}`)
      .then((r) => {
        setGames(r.games);
        setTotal(r.total);
      })
      .catch((err) => onToast({ message: err.message, kind: "error" }))
      .finally(() => setLoading(false));
  };

  useEffect(load, [page, source]);

  const update = async (slug: string, changes: Record<string, unknown>) => {
    try {
      await patch(`/api/admin/games/${slug}`, changes);
      onToast({ message: "Oyun guncellendi", kind: "success" });
      setGames((prev) => prev.map((g) => (g.slug === slug ? { ...g, ...changes } as AdminGame : g)));
    } catch (err) {
      onToast({ message: err instanceof Error ? err.message : "Guncellenemedi", kind: "error" });
    }
  };

  /** Pull the aggregator catalogue into the local game list. */
  const sync = async () => {
    setSyncing(true);
    try {
      const result = await post<{ created: number; updated: number; total: number; provider: string }>("/api/admin/games/sync", { pageSize: 200 });
      onToast({
        message: `${result.provider}: ${result.created} yeni, ${result.updated} guncellenen (${result.total} oyun)`,
        kind: "success",
      });
      load();
    } catch (err) {
      onToast({ message: err instanceof Error ? err.message : "Senkronizasyon basarisiz", kind: "error" });
    } finally {
      setSyncing(false);
    }
  };

  /**
   * Import the loginxgamesapi catalogue. Games arrive inactive, so this only
   * stages content until the vendor supplies a launch endpoint.
   */
  const syncLoginx = async () => {
    setSyncingLoginx(true);
    try {
      const result = await post<{ created: number; updated: number; total: number; vendors: string[] }>("/api/admin/games/sync-loginx", {});
      onToast({
        message: `loginx (${result.vendors.join(", ")}): ${result.created} yeni, ${result.updated} guncellenen (${result.total} oyun, hepsi pasif)`,
        kind: "success",
      });
      setSource("loginx");
      setPage(1);
      load();
    } catch (err) {
      onToast({ message: err instanceof Error ? err.message : "loginx senkronizasyonu basarisiz", kind: "error" });
    } finally {
      setSyncingLoginx(false);
    }
  };

  return (
    <div className="page">
      <div className="row-between mb">
        <h1 className="section-title" style={{ margin: 0 }}>🎮 Oyun Yonetimi <span className="count">{total}</span></h1>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={syncLoginx} disabled={syncingLoginx}>
            {syncingLoginx ? "Ice aktariliyor..." : "📥 loginx API'den Ice Aktar"}
          </button>
          <button className="btn btn-primary btn-sm" onClick={sync} disabled={syncing}>
            {syncing ? "Senkronize ediliyor..." : "🔌 Saglayicidan Ice Aktar"}
          </button>
        </div>
      </div>

      <div className="card mb">
        <div className="row mb" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className={`btn btn-sm ${source === "all" ? "btn-primary" : "btn-ghost"}`} onClick={() => { setSource("all"); setPage(1); }}>
            Tum Oyunlar
          </button>
          <button className={`btn btn-sm ${source === "loginx" ? "btn-primary" : "btn-ghost"}`} onClick={() => { setSource("loginx"); setPage(1); }}>
            loginx API
          </button>
          <button className={`btn btn-sm ${source === "inactive" ? "btn-primary" : "btn-ghost"}`} onClick={() => { setSource("inactive"); setPage(1); }}>
            Pasif Oyunlar
          </button>
        </div>
        <div className="input-row">
          <input className="input" placeholder="Oyun adi veya slug ara" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (setPage(1), load())} />
          <button className="btn btn-primary" onClick={() => { setPage(1); load(); }}>Ara</button>
        </div>
        {source === "loginx" && (
          <div className="alert alert-info mt">
            loginxgamesapi katalogu (<span className="mono">loginx-*</span>). Bu oyunlar <span className="bold">pasif</span> olarak
            ice aktarilir: saglayici henuz oyun acma (launch) ucu ve cuzdan callback sozlesmesini paylasmadi, bu yuzden
            yayina alinmalari tiklandiginda hata verir. Dokumantasyon gelince ayni ice aktarma bu satirlari aktive eder.
          </div>
        )}
      </div>

      <div className="card">
        {loading ? <Spinner /> : games.length === 0 ? <Empty icon="🎮" title="Oyun bulunamadi" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Oyun</th><th>Kategori</th><th>Saglayici</th><th>Tip</th><th>RTP</th><th>Oynanma</th><th>Aktif</th><th>One Cikan</th><th>Demo</th></tr>
              </thead>
              <tbody>
                {games.map((game) => (
                  <tr key={game.slug}>
                    <td>
                      <div className="bold small">{game.name}</div>
                      <div className="tiny faint mono">{game.slug}</div>
                    </td>
                    <td className="small">{game.category?.name ?? "—"}</td>
                    <td className="small">{game.provider?.name ?? "—"}</td>
                    <td><Pill kind={game.embedType === "INTERNAL" ? "info" : "neutral"}>{game.embedType}</Pill></td>
                    <td>
                      <input
                        className="input"
                        style={{ width: 70, padding: "4px 8px" }}
                        defaultValue={game.rtp ?? "96"}
                        onBlur={(e) => update(game.slug, { rtp: Number(e.target.value) })}
                      />
                    </td>
                    <td className="mono small">{game._count?.bets ?? 0}</td>
                    <td>
                      <button className={`btn btn-sm ${game.isActive ? "btn-success" : "btn-ghost"}`} onClick={() => update(game.slug, { isActive: !game.isActive })}>
                        {game.isActive ? "Acik" : "Kapali"}
                      </button>
                    </td>
                    <td>
                      <button className={`btn btn-sm ${game.isFeatured ? "btn-primary" : "btn-ghost"}`} onClick={() => update(game.slug, { isFeatured: !game.isFeatured })}>
                        {game.isFeatured ? "★" : "☆"}
                      </button>
                    </td>
                    <td>
                      <button className={`btn btn-sm ${game.demoEnabled ? "btn-ghost" : "btn-ghost"}`} onClick={() => update(game.slug, { demoEnabled: !game.demoEnabled })}>
                        {game.demoEnabled ? "Acik" : "Kapali"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > 40 && (
          <div className="row mt" style={{ justifyContent: "center" }}>
            <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Onceki</button>
            <span className="small muted">Sayfa {page} / {Math.ceil(total / 40)}</span>
            <button className="btn btn-ghost btn-sm" disabled={page >= Math.ceil(total / 40)} onClick={() => setPage((p) => p + 1)}>Sonraki →</button>
          </div>
        )}
      </div>
    </div>
  );
}
