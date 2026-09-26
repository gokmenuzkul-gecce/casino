import { useEffect, useState } from "react";
import { del, get, money, patch, post } from "../lib/api";
import { Empty, Modal, Pill, Spinner, statusKind } from "../components/ui";
import type { ToastFn } from "./AdminLayout";

interface AdminUser {
  id: string;
  email: string;
  username: string;
  roles: string[];
  status: string;
  currency: string;
  phone?: string | null;
  vipTier: string | null;
  kycStatus: string;
  balance: string;
  locked: string;
  betCount: number;
  lastLoginAt?: string | null;
  lastLoginIp?: string | null;
  createdAt: string;
}

const STAFF_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPPORT", "FINANCE", "RISK", "COMPLIANCE", "CONTENT_MANAGER", "AFFILIATE_MANAGER"];

/** Player administration: search, inspect, adjust, suspend, assign roles. */
export function AdminUsers({ onToast }: { onToast: ToastFn }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [balanceForm, setBalanceForm] = useState({ amount: "", reason: "" });

  const load = () => {
    setLoading(true);
    const query = new URLSearchParams({ page: String(page), pageSize: "30" });
    if (search) query.set("search", search);
    if (status) query.set("status", status);
    get<{ users: AdminUser[]; total: number }>(`/api/admin/users?${query}`)
      .then((r) => {
        setUsers(r.users);
        setTotal(r.total);
      })
      .catch((err) => onToast({ message: err.message, kind: "error" }))
      .finally(() => setLoading(false));
  };

  useEffect(load, [page, status]);

  const openDetail = async (id: string) => {
    setSelected(id);
    const data = await get<Record<string, unknown>>(`/api/admin/users/${id}`).catch(() => null);
    setDetail(data);
  };

  const adjustBalance = async () => {
    if (!selected || !balanceForm.amount || !balanceForm.reason) return;
    try {
      await post(`/api/admin/users/${selected}/balance`, balanceForm);
      onToast({ message: "Bakiye duzeltildi ve deftere kaydedildi", kind: "success" });
      setBalanceForm({ amount: "", reason: "" });
      openDetail(selected);
      load();
    } catch (err) {
      onToast({ message: err instanceof Error ? err.message : "Duzeltme basarisiz", kind: "error" });
    }
  };

  const setUserStatus = async (id: string, nextStatus: string) => {
    const reason = nextStatus === "ACTIVE" ? undefined : prompt(`${nextStatus} sebebi:`) ?? "Yonetici karari";
    try {
      await post(`/api/admin/users/${id}/status`, { status: nextStatus, reason });
      onToast({ message: `Durum guncellendi: ${nextStatus}`, kind: "success" });
      load();
      if (selected === id) openDetail(id);
    } catch (err) {
      onToast({ message: err instanceof Error ? err.message : "Guncellenemedi", kind: "error" });
    }
  };

  const assignRoles = async (id: string, roles: string[]) => {
    try {
      await post(`/api/admin/users/${id}/roles`, { roles });
      onToast({ message: "Roller guncellendi", kind: "success" });
      load();
      if (selected === id) openDetail(id);
    } catch (err) {
      onToast({ message: err instanceof Error ? err.message : "Roller guncellenemedi", kind: "error" });
    }
  };

  const resetPassword = async (id: string) => {
    try {
      const result = await post<{ temporaryPassword?: string }>(`/api/admin/users/${id}/reset-password`, {});
      onToast({
        message: result.temporaryPassword ? `Gecici sifre: ${result.temporaryPassword}` : "Sifre sifirlandi",
        kind: "success",
      });
    } catch (err) {
      onToast({ message: err instanceof Error ? err.message : "Sifirlanamadi", kind: "error" });
    }
  };

  const user = detail?.user as Record<string, unknown> | undefined;
  const stats = detail?.stats as Record<string, string | number> | undefined;

  return (
    <div className="page">
      <div className="row-between mb">
        <h1 className="section-title" style={{ margin: 0 }}>👥 Oyuncular <span className="count">{total}</span></h1>
      </div>

      <div className="card mb">
        <div className="input-row">
          <input
            className="input"
            placeholder="Kullanici adi, e-posta, telefon veya ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (setPage(1), load())}
          />
          <select className="select" style={{ width: 180 }} value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
            <option value="">Tum durumlar</option>
            <option value="ACTIVE">Aktif</option>
            <option value="PENDING_VERIFICATION">Dogrulama bekliyor</option>
            <option value="SUSPENDED">Askiya alindi</option>
            <option value="BANNED">Yasakli</option>
            <option value="SELF_EXCLUDED">Kendini disladi</option>
          </select>
          <button className="btn btn-primary" onClick={() => { setPage(1); load(); }}>Ara</button>
        </div>
      </div>

      <div className="card">
        {loading ? <Spinner /> : users.length === 0 ? <Empty icon="👥" title="Kullanici bulunamadi" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Oyuncu</th><th>Roller</th><th>VIP</th><th>KYC</th><th>Bakiye</th><th>Bahis</th><th>Durum</th><th>Son giris</th><th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="bold">{row.username}</div>
                      <div className="tiny faint">{row.email}</div>
                    </td>
                    <td>{row.roles.includes("PLAYER") ? <span className="faint tiny">PLAYER</span> : <Pill kind="warning">{row.roles[0]}</Pill>}</td>
                    <td>{row.vipTier ? <Pill kind="vip">{row.vipTier}</Pill> : <span className="faint">—</span>}</td>
                    <td><Pill kind={statusKind(row.kycStatus)}>{row.kycStatus}</Pill></td>
                    <td className="mono">{money(row.balance, row.currency)}</td>
                    <td className="mono">{row.betCount}</td>
                    <td><Pill kind={statusKind(row.status)}>{row.status}</Pill></td>
                    <td className="tiny faint">{row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleDateString("tr-TR") : "—"}</td>
                    <td><button className="btn btn-ghost btn-sm" onClick={() => openDetail(row.id)}>Detay</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > 30 && (
          <div className="row mt" style={{ justifyContent: "center" }}>
            <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Onceki</button>
            <span className="small muted">Sayfa {page} / {Math.ceil(total / 30)}</span>
            <button className="btn btn-ghost btn-sm" disabled={page >= Math.ceil(total / 30)} onClick={() => setPage((p) => p + 1)}>Sonraki →</button>
          </div>
        )}
      </div>

      <Modal
        open={selected !== null}
        onClose={() => { setSelected(null); setDetail(null); }}
        title={user ? String(user.username) : "Yukleniyor"}
        subtitle={user ? String(user.email) : undefined}
        wide
      >
        {!user || !stats ? <Spinner /> : (
          <>
            <div className="grid grid-4 mb">
              <div className="stat card-tight"><div className="stat-label">Bakiye</div><div className="stat-value" style={{ fontSize: 17 }}>{money(String(user.balance ?? "0"))}</div></div>
              <div className="stat card-tight"><div className="stat-label">Toplam bahis</div><div className="stat-value" style={{ fontSize: 17 }}>{money(String(stats.totalWagered))}</div></div>
              <div className="stat card-tight"><div className="stat-label">Net kayip</div><div className="stat-value" style={{ fontSize: 17, color: "var(--success)" }}>{money(String(stats.netLoss))}</div></div>
              <div className="stat card-tight"><div className="stat-label">Yatirim</div><div className="stat-value" style={{ fontSize: 17 }}>{money(String(stats.totalDeposits))}</div></div>
            </div>

            <div className="row mb" style={{ gap: 6, flexWrap: "wrap" }}>
              {user.status !== "ACTIVE" && <button className="btn btn-success btn-sm" onClick={() => setUserStatus(selected!, "ACTIVE")}>Aktiflestir</button>}
              {user.status !== "SUSPENDED" && <button className="btn btn-ghost btn-sm" onClick={() => setUserStatus(selected!, "SUSPENDED")}>Askiya Al</button>}
              {user.status !== "BANNED" && <button className="btn btn-danger btn-sm" onClick={() => setUserStatus(selected!, "BANNED")}>Yasakla</button>}
              <button className="btn btn-ghost btn-sm" onClick={() => resetPassword(selected!)}>Sifre Sifirla</button>
            </div>

            <div className="card card-tight mb">
              <div className="card-title" style={{ fontSize: 13 }}>Rol Atama</div>
              <div className="row" style={{ gap: 5, flexWrap: "wrap" }}>
                {STAFF_ROLES.map((role) => {
                  const has = (user.roles as string[])?.includes(role);
                  return (
                    <button
                      key={role}
                      className={`btn btn-sm ${has ? "btn-primary" : "btn-ghost"}`}
                      onClick={() => {
                        const current = (user.roles as string[]) ?? [];
                        const next = has ? current.filter((r) => r !== role) : [...current.filter((r) => r !== "PLAYER"), role];
                        assignRoles(selected!, next.length > 0 ? next : ["PLAYER"]);
                      }}
                    >
                      {role}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="card card-tight mb">
              <div className="card-title" style={{ fontSize: 13 }}>Bakiye Duzeltmesi (denetlenir)</div>
              <div className="input-row">
                <input
                  className="input"
                  placeholder="Tutar (eksi ile dusurun, or. -100)"
                  value={balanceForm.amount}
                  onChange={(e) => setBalanceForm({ ...balanceForm, amount: e.target.value })}
                />
                <input
                  className="input"
                  placeholder="Sebep (zorunlu)"
                  value={balanceForm.reason}
                  onChange={(e) => setBalanceForm({ ...balanceForm, reason: e.target.value })}
                />
                <button className="btn btn-primary" onClick={adjustBalance} disabled={!balanceForm.amount || !balanceForm.reason}>Uygula</button>
              </div>
            </div>

            <div className="grid grid-2">
              <div className="card card-tight">
                <div className="card-title" style={{ fontSize: 13 }}>Son Bahisler</div>
                <div className="col" style={{ gap: 5, maxHeight: 200, overflowY: "auto" }}>
                  {((detail?.recentBets as { id: string; stake: string; payout: string; currency: string; status: string }[]) ?? []).map((bet) => (
                    <div key={bet.id} className="row-between small">
                      <span className="mono">{money(bet.stake, bet.currency)}</span>
                      <Pill kind={statusKind(bet.status)}>{bet.status}</Pill>
                      <span className="mono">{money(bet.payout, bet.currency)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card card-tight">
                <div className="card-title" style={{ fontSize: 13 }}>Son Islemler</div>
                <div className="col" style={{ gap: 5, maxHeight: 200, overflowY: "auto" }}>
                  {((detail?.recentTransactions as { id: string; type: string; amount: string; currency: string }[]) ?? []).map((tx) => (
                    <div key={tx.id} className="row-between small">
                      <span className="faint">{tx.type}</span>
                      <span className="mono">{money(tx.amount, tx.currency)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
