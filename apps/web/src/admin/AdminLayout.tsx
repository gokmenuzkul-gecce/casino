import { useEffect, useState } from "react";
import { Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { isStaffUser, useApp } from "../store/app";
import { money } from "../lib/api";
import { socket } from "../lib/socket";
import { AdminDashboard } from "./AdminDashboard";
import { AdminUsers } from "./AdminUsers";
import { AdminPayments } from "./AdminPayments";
import { AdminKyc } from "./AdminKyc";
import { AdminRisk } from "./AdminRisk";
import { AdminGames } from "./AdminGames";
import { AdminBonuses } from "./AdminBonuses";
import { AdminReports } from "./AdminReports";
import { AdminSettings } from "./AdminSettings";
import { AdminIntegrations } from "./AdminIntegrations";
import { AdminAudit } from "./AdminAudit";
import { AdminCms } from "./AdminCms";
import { AdminAffiliates } from "./AdminAffiliates";
import { Toast, Spinner } from "../components/ui";
import { LogoMark } from "../components/Header";

interface Metrics {
  onlinePlayers: number;
  depositsToday: string;
  withdrawalsToday: string;
  ggr: string;
  pendingWithdrawals: number;
  pendingKyc: number;
  openRiskFlags: number;
  signupsToday: number;
}

const NAV = [
  { to: "/admin", label: "Panel", icon: "📊", end: true },
  { to: "/admin/users", label: "Oyuncular", icon: "👥" },
  { to: "/admin/payments", label: "Odemeler", icon: "💰" },
  { to: "/admin/kyc", label: "KYC", icon: "🪪" },
  { to: "/admin/risk", label: "Risk", icon: "🛡️" },
  { to: "/admin/games", label: "Oyunlar", icon: "🎮" },
  { to: "/admin/bonuses", label: "Bonuslar", icon: "🎁" },
  { to: "/admin/affiliates", label: "Afiili", icon: "🤝" },
  { to: "/admin/reports", label: "Raporlar", icon: "📈" },
  { to: "/admin/cms", label: "Icerik", icon: "📝" },
  { to: "/admin/audit", label: "Denetim Izl", icon: "🔍" },
  { to: "/admin/integrations", label: "Entegrasyon", icon: "🔌" },
  { to: "/admin/settings", label: "Ayarlar", icon: "⚙️" },
];

/**
 * Staff back office shell.
 *
 * Access is decided from the user's roles; the API enforces permissions again on
 * every call, so hiding a nav item is a convenience, not the security boundary.
 * Live metrics arrive over the admin socket room.
 */
export function AdminLayout() {
  const { user, booted } = useApp();
  const navigate = useNavigate();
  const [live, setLive] = useState<Metrics | null>(null);
  const [toast, setToast] = useState<{ message: string; kind: "success" | "error" } | null>(null);

  useEffect(() => {
    const onMetrics = (payload: Metrics) => setLive(payload);
    const onAlert = (payload: { message?: string }) => {
      if (payload.message) setToast({ message: payload.message, kind: "error" });
    };
    socket.on("admin:metrics", onMetrics);
    socket.on("admin:alert", onAlert);
    return () => {
      socket.off("admin:metrics", onMetrics);
      socket.off("admin:alert", onAlert);
    };
  }, []);

  if (!booted) return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}><Spinner /></div>;
  if (!user) return <Navigate to="/" replace />;
  if (!isStaffUser(user)) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <div className="card center" style={{ maxWidth: 400 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🚫</div>
          <div className="bold mb">Yetkisiz erisim</div>
          <div className="small muted mb">Bu alan yalnizca yetkili personele aciktir.</div>
          <button className="btn btn-primary" onClick={() => navigate("/")}>Ana Sayfaya Don</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="header">
        <div className="header-inner">
          <NavLink to="/admin" className="logo">
            <span className="logo-mark"><LogoMark /></span> Aurora <span className="pill pill-warning" style={{ marginLeft: 6 }}>ADMIN</span>
          </NavLink>

          <div className="spacer" />

          {live && (
            <div className="row" style={{ gap: 14 }}>
              <div className="row small"><span className="live-dot" /><span className="bold">{live.onlinePlayers}</span><span className="faint">cevrimici</span></div>
              {live.pendingWithdrawals > 0 && (
                <NavLink to="/admin/payments" className="pill pill-warning">{live.pendingWithdrawals} bekleyen cekim</NavLink>
              )}
              {live.pendingKyc > 0 && (
                <NavLink to="/admin/kyc" className="pill pill-info">{live.pendingKyc} KYC</NavLink>
              )}
              {live.openRiskFlags > 0 && (
                <NavLink to="/admin/risk" className="pill pill-danger">{live.openRiskFlags} risk</NavLink>
              )}
            </div>
          )}

          <div className="spacer" />

          <NavLink to="/" className="btn btn-ghost btn-sm">← Siteye Don</NavLink>
          <span className="small muted">{user.username}</span>
        </div>
      </header>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <aside className="admin-side">
          <nav className="side-nav">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `side-nav-item${isActive ? " active" : ""}`}
              >
                <span>{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </nav>

          {live && (
            <div className="card card-tight mt" style={{ fontSize: 12 }}>
              <div className="tiny faint bold mb">CANLI</div>
              <div className="row-between small"><span className="muted">Yatirim</span><span className="mono">{money(live.depositsToday)}</span></div>
              <div className="row-between small"><span className="muted">Cekim</span><span className="mono">{money(live.withdrawalsToday)}</span></div>
              <div className="row-between small"><span className="muted">GGR</span><span className="mono">{money(live.ggr)}</span></div>
              <div className="row-between small"><span className="muted">Kayit</span><span className="mono">{live.signupsToday}</span></div>
            </div>
          )}
        </aside>

        <main style={{ flex: 1, overflowY: "auto", background: "var(--bg)", minWidth: 0 }}>
          <Routes>
            <Route index element={<AdminDashboard />} />
            <Route path="users" element={<AdminUsers onToast={setToast} />} />
            <Route path="payments" element={<AdminPayments onToast={setToast} />} />
            <Route path="kyc" element={<AdminKyc onToast={setToast} />} />
            <Route path="risk" element={<AdminRisk onToast={setToast} />} />
            <Route path="games" element={<AdminGames onToast={setToast} />} />
            <Route path="bonuses" element={<AdminBonuses onToast={setToast} />} />
            <Route path="affiliates" element={<AdminAffiliates onToast={setToast} />} />
            <Route path="reports" element={<AdminReports />} />
            <Route path="cms" element={<AdminCms onToast={setToast} />} />
            <Route path="audit" element={<AdminAudit />} />
            <Route path="integrations" element={<AdminIntegrations />} />
            <Route path="settings" element={<AdminSettings onToast={setToast} />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </main>
      </div>

      {toast && <Toast message={toast.message} kind={toast.kind} onDone={() => setToast(null)} />}
    </div>
  );
}

export type ToastFn = (toast: { message: string; kind: "success" | "error" }) => void;
