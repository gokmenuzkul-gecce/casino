import { useEffect, useState } from "react";
import { get, money, post } from "../lib/api";
import { Empty, Pill, Spinner } from "../components/ui";
import type { ToastFn } from "./AdminLayout";

export function AdminAffiliates({ onToast }: { onToast: ToastFn }) {
  const [affiliates, setAffiliates] = useState<
    { id: string; code: string; username: string; email: string; status: string; commissionType: string; revenueSharePercent: string; balance: string; lifetimeEarnings: string; clicks: string; signups: string; depositors: string; totalDeposits: string }[]
  >([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    get<{ affiliates: typeof affiliates }>("/api/admin/affiliates?pageSize=50")
      .then((r) => setAffiliates(r.affiliates))
      .catch((err) => onToast({ message: err.message, kind: "error" }))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const payout = async (id: string) => {
    const amount = prompt("Odenek tutari (bos birakirsaniz tam bakiye):");
    try {
      await post(`/api/admin/affiliates/${id}/payout`, amount ? { amount } : {});
      onToast({ message: "Afiili odemesi yapildi", kind: "success" });
      load();
    } catch (err) {
      onToast({ message: err instanceof Error ? err.message : "Odeme basarisiz", kind: "error" });
    }
  };

  return (
    <div className="page">
      <h1 className="section-title" style={{ marginTop: 0 }}>Afiili Sistemi</h1>
      {loading ? <Spinner /> : affiliates.length === 0 ? <Empty icon="🤝" title="Afiili yok" /> : (
        <div className="card">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Kod</th><th>Afiili</th><th>Model</th><th>Tiklama</th><th>Kayit</th><th>Yatirimci</th><th>Yatirim</th><th>Bakiye</th><th>Kazanc</th><th></th></tr>
              </thead>
              <tbody>
                {affiliates.map((affiliate) => (
                  <tr key={affiliate.id}>
                    <td className="mono bold">{affiliate.code}</td>
                    <td className="small">{affiliate.username}</td>
                    <td><Pill kind="info">{affiliate.commissionType}</Pill><span className="tiny faint"> %{affiliate.revenueSharePercent}</span></td>
                    <td className="mono">{affiliate.clicks}</td>
                    <td className="mono">{affiliate.signups}</td>
                    <td className="mono">{affiliate.depositors}</td>
                    <td className="mono">{money(affiliate.totalDeposits)}</td>
                    <td className="mono bold" style={{ color: "var(--success)" }}>{money(affiliate.balance)}</td>
                    <td className="mono">{money(affiliate.lifetimeEarnings)}</td>
                    <td>
                      {Number(affiliate.balance) > 0 && (
                        <button className="btn btn-primary btn-sm" onClick={() => payout(affiliate.id)}>Ode</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
