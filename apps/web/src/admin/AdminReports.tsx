import { useEffect, useState } from "react";
import { get, money } from "../lib/api";
import { Pill, Spinner } from "../components/ui";

export function AdminReports() {
  const [data, setData] = useState<{
    deposits: { total: string; count: number; fees: string };
    withdrawals: { total: string; count: number; fees: string };
    gaming: { wagered: string; paid: string; ggr: string; betCount: number; holdPercent: number };
    bonuses: { total: string };
    ngr: string;
    netCash: string;
    byMethod: { method: string; direction: string; _sum: { amount: string | null }; _count: number }[];
    byGame: { gameId: string; _sum: { stake: string | null; payout: string | null }; _count: number }[];
  } | null>(null);
  const [days, setDays] = useState(30);
  const [players, setPlayers] = useState<{ activePlayers: number; newPlayers: number; topPlayers: { username: string; email: string; wagered: string; paid: string; netLoss: string; betCount: number }[] } | null>(null);

  useEffect(() => {
    const from = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    get<typeof data>(`/api/admin/reports/financial?from=${from}`).then(setData).catch(() => undefined);
    get<typeof players>(`/api/admin/reports/players?from=${from}`).then(setPlayers).catch(() => undefined);
  }, [days]);

  if (!data) return <Spinner label="Raporlar hazirlaniyor" />;

  return (
    <div className="page">
      <div className="row-between mb">
        <h1 className="section-title" style={{ margin: 0 }}>📈 Finansal Raporlar</h1>
        <div className="row" style={{ gap: 6 }}>
          {[7, 14, 30, 90].map((value) => (
            <button key={value} className={`btn btn-sm ${days === value ? "btn-primary" : "btn-ghost"}`} onClick={() => setDays(value)}>
              {value} gun
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-4 mb">
        <div className="stat"><div className="stat-label">Yatirim</div><div className="stat-value" style={{ fontSize: 20 }}>{money(data.deposits.total)}</div><div className="tiny faint">{data.deposits.count} islem</div></div>
        <div className="stat"><div className="stat-label">Cekim</div><div className="stat-value" style={{ fontSize: 20 }}>{money(data.withdrawals.total)}</div><div className="tiny faint">{data.withdrawals.count} islem</div></div>
        <div className="stat"><div className="stat-label">Net nakit akisi</div><div className="stat-value" style={{ fontSize: 20, color: Number(data.netCash) >= 0 ? "var(--success)" : "var(--danger)" }}>{money(data.netCash)}</div></div>
        <div className="stat"><div className="stat-label">Bonus maliyeti</div><div className="stat-value" style={{ fontSize: 20 }}>{money(data.bonuses.total)}</div></div>
        <div className="stat"><div className="stat-label">Bahis hacmi</div><div className="stat-value" style={{ fontSize: 20 }}>{money(data.gaming.wagered)}</div><div className="tiny faint">{data.gaming.betCount} bahis</div></div>
        <div className="stat"><div className="stat-label">Oyuncuya odenen</div><div className="stat-value" style={{ fontSize: 20 }}>{money(data.gaming.paid)}</div></div>
        <div className="stat"><div className="stat-label">GGR</div><div className="stat-value" style={{ fontSize: 20, color: "var(--success)" }}>{money(data.gaming.ggr)}</div><div className="tiny faint">hold %{data.gaming.holdPercent}</div></div>
        <div className="stat"><div className="stat-label">NGR</div><div className="stat-value" style={{ fontSize: 20, color: "var(--primary-bright)" }}>{money(data.ngr)}</div></div>
      </div>

      <div className="grid grid-2 mb">
        <div className="card">
          <div className="card-title">Odeme Yontemine Gore</div>
          <table className="table">
            <thead><tr><th>Yontem</th><th>Yon</th><th className="right">Tutar</th><th className="right">Islem</th></tr></thead>
            <tbody>
              {data.byMethod.map((row) => (
                <tr key={`${row.method}-${row.direction}`}>
                  <td className="mono">{row.method}</td>
                  <td><Pill kind={row.direction === "DEPOSIT" ? "success" : "warning"}>{row.direction}</Pill></td>
                  <td className="right mono">{money(row._sum.amount ?? "0")}</td>
                  <td className="right">{row._count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-title">Oyuncu Ozeti</div>
          {players && (
            <>
              <div className="grid grid-2 mb">
                <div className="stat card-tight"><div className="stat-label">Aktif oyuncu</div><div className="stat-value" style={{ fontSize: 19 }}>{players.activePlayers}</div></div>
                <div className="stat card-tight"><div className="stat-label">Yeni kayit</div><div className="stat-value" style={{ fontSize: 19 }}>{players.newPlayers}</div></div>
              </div>
              <table className="table">
                <thead><tr><th>Oyuncu</th><th className="right">Bahis</th><th className="right">Net kayip</th></tr></thead>
                <tbody>
                  {players.topPlayers.slice(0, 10).map((player) => (
                    <tr key={player.email}>
                      <td className="small">{player.username}</td>
                      <td className="right mono">{money(player.wagered)}</td>
                      <td className="right mono" style={{ color: "var(--success)" }}>{money(player.netLoss)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
