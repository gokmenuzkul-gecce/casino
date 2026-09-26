import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { get, money } from "../lib/api";
import { Spinner, Stat, Pill } from "../components/ui";

interface DashboardData {
  metrics: {
    onlinePlayers: number;
    totalPlayers: number;
    newPlayersToday: number;
    depositsToday: string;
    depositCountToday: number;
    withdrawalsToday: string;
    withdrawalCountToday: number;
    wageredToday: string;
    paidToday: string;
    ggrToday: string;
    ggrYesterday: string;
    betsToday: number;
    pendingWithdrawals: number;
    pendingKyc: number;
    openRiskFlags: number;
    activeBonuses: number;
    activeTournaments: number;
  };
  providers: { kind: string; provider: string; mode: string; configured: boolean; detail?: string }[];
  platformMode: string;
  features: Record<string, boolean>;
}

export function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [chart, setChart] = useState<{ date: string; deposits: string; ggr: string; wagered: string; newPlayers: number }[]>([]);

  useEffect(() => {
    get<DashboardData>("/api/admin/dashboard").then(setData).catch(() => undefined);
    get<{ series: typeof chart }>("/api/admin/dashboard/chart?days=14").then((r) => setChart(r.series)).catch(() => undefined);
  }, []);

  if (!data) return <Spinner label="Panel yukleniyor" />;
  const m = data.metrics;
  const ggrDelta = Number(m.ggrToday) - Number(m.ggrYesterday);

  const chartData = chart.map((row) => ({
    date: row.date.slice(5),
    deposits: Number(row.deposits),
    ggr: Number(row.ggr),
    wagered: Number(row.wagered),
    newPlayers: row.newPlayers,
  }));

  return (
    <div className="page">
      <div className="row-between mb">
        <h1 className="section-title" style={{ margin: 0 }}>Kontrol Paneli</h1>
        <Pill kind={data.platformMode === "live" ? "danger" : "warning"}>
          {data.platformMode === "live" ? "CANLI MOD" : "DEMO MOD"}
        </Pill>
      </div>

      <div className="grid grid-4 mb">
        <Stat label="Cevrimici" value={m.onlinePlayers} />
        <Stat label="Bugun yatirim" value={money(m.depositsToday)} delta={`${m.depositCountToday} islem`} deltaUp />
        <Stat label="Bugun cekim" value={money(m.withdrawalsToday)} delta={`${m.withdrawalCountToday} islem`} />
        <Stat
          label="GGR (bugun)"
          value={money(m.ggrToday)}
          delta={`${ggrDelta >= 0 ? "+" : ""}${money(ggrDelta)} dun`}
          deltaUp={ggrDelta >= 0}
        />
        <Stat label="Bahis hacmi" value={money(m.wageredToday)} delta={`${m.betsToday} bahis`} />
        <Stat label="Toplam oyuncu" value={m.totalPlayers} delta={`+${m.newPlayersToday} bugun`} deltaUp />
        <Stat label="Aktif bonus" value={m.activeBonuses} />
        <Stat label="Bekleyen cekim" value={m.pendingWithdrawals} delta={m.pendingWithdrawals > 0 ? "islem gerekli" : "temiz"} deltaUp={m.pendingWithdrawals === 0} />
      </div>

      <div className="grid grid-2 mb">
        <div className="card">
          <div className="card-title">Yatirim ve GGR (14 gun)</div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#232936" />
              <XAxis dataKey="date" stroke="#67708a" fontSize={11} />
              <YAxis stroke="#67708a" fontSize={11} tickFormatter={(v) => `${(Number(v) / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ background: "#10131a", border: "1px solid #232936", borderRadius: 10, fontSize: 12 }}
                formatter={(value: number) => money(value.toString())}
              />
              <Line type="monotone" dataKey="deposits" stroke="#d6a84f" strokeWidth={2.5} dot={false} name="Yatirim" />
              <Line type="monotone" dataKey="ggr" stroke="#10b981" strokeWidth={2.5} dot={false} name="GGR" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div className="card-title">Bahis Hacmi (14 gun)</div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#232936" />
              <XAxis dataKey="date" stroke="#67708a" fontSize={11} />
              <YAxis stroke="#67708a" fontSize={11} tickFormatter={(v) => `${(Number(v) / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ background: "#10131a", border: "1px solid #232936", borderRadius: 10, fontSize: 12 }}
                formatter={(value: number) => money(value.toString())}
              />
              <Line type="monotone" dataKey="wagered" stroke="#8b5cf6" strokeWidth={2.5} dot={false} name="Bahis" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-title">🔌 Saglayici Durumu</div>
          <table className="table">
            <thead><tr><th>Tur</th><th>Saglayici</th><th>Mod</th><th>Durum</th></tr></thead>
            <tbody>
              {data.providers.map((provider) => (
                <tr key={provider.kind}>
                  <td className="bold">{provider.kind}</td>
                  <td className="mono">{provider.provider}</td>
                  <td><Pill kind={provider.mode === "live" ? "danger" : "warning"}>{provider.mode}</Pill></td>
                  <td>
                    {provider.configured ? (
                      <Pill kind="success">Bagli</Pill>
                    ) : (
                      <Link to="/admin/integrations" className="pill pill-neutral">Yapilandirilmadi</Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-title">⚡ Islem Gerektirenler</div>
          <div className="col" style={{ gap: 10 }}>
            <Link to="/admin/payments" className="row-between card card-tight">
              <span>💰 Bekleyen cekimler</span>
              <Pill kind={m.pendingWithdrawals > 0 ? "warning" : "success"}>{m.pendingWithdrawals}</Pill>
            </Link>
            <Link to="/admin/kyc" className="row-between card card-tight">
              <span>🪪 KYC incelemesi</span>
              <Pill kind={m.pendingKyc > 0 ? "info" : "success"}>{m.pendingKyc}</Pill>
            </Link>
            <Link to="/admin/risk" className="row-between card card-tight">
              <span>🛡️ Acik risk uyarilari</span>
              <Pill kind={m.openRiskFlags > 0 ? "danger" : "success"}>{m.openRiskFlags}</Pill>
            </Link>
            <Link to="/admin/integrations" className="row-between card card-tight">
              <span>🔌 Saglayici entegrasyonlari</span>
              <Pill kind="neutral">{data.providers.filter((p) => !p.configured).length} eksik</Pill>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
