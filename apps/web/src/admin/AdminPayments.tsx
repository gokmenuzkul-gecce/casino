import { useEffect, useState } from "react";
import { get, money, patch, post } from "../lib/api";
import { Empty, Pill, Spinner, statusKind } from "../components/ui";
import type { ToastFn } from "./AdminLayout";

interface PaymentRow {
  id: string;
  reference: string;
  userId: string;
  username: string;
  email: string;
  kycStatus: string;
  direction: string;
  method: string;
  provider?: string | null;
  amount: string;
  fee: string;
  currency: string;
  status: string;
  requiresReview: boolean;
  reviewReason?: string | null;
  iban?: string | null;
  createdAt: string;
  completedAt?: string | null;
  failureReason?: string | null;
}

interface MethodConfig {
  method: string;
  displayName: string;
  enabled: boolean;
  maintenanceMode: boolean;
  minAmount: string;
  maxAmount: string;
  feePercent: string;
  feeFixed: string;
  currencies: string[];
}

export function AdminPayments({ onToast }: { onToast: ToastFn }) {
  const [tab, setTab] = useState<"intents" | "methods">("intents");
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [summary, setSummary] = useState<{ direction: string; status: string; count: number; amount: string }[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [direction, setDirection] = useState("WITHDRAWAL");
  const [status, setStatus] = useState("PENDING");
  const [loading, setLoading] = useState(true);
  const [methods, setMethods] = useState<MethodConfig[]>([]);

  const load = () => {
    setLoading(true);
    const query = new URLSearchParams({ page: String(page), pageSize: "30" });
    if (direction) query.set("direction", direction);
    if (status) query.set("status", status);
    get<{ payments: PaymentRow[]; total: number; summary: typeof summary }>(`/api/admin/payments?${query}`)
      .then((r) => {
        setPayments(r.payments);
        setTotal(r.total);
        setSummary(r.summary);
      })
      .catch((err) => onToast({ message: err.message, kind: "error" }))
      .finally(() => setLoading(false));
  };

  useEffect(load, [page, direction, status]);

  useEffect(() => {
    if (tab !== "methods") return;
    get<{ methods: MethodConfig[] }>("/api/admin/payment-methods")
      .then((r) => setMethods(r.methods))
      .catch(() => undefined);
  }, [tab]);

  const approve = async (id: string) => {
    try {
      const result = await post<{ status: string; providerRef?: string }>(`/api/admin/payments/${id}/approve`, {});
      onToast({ message: `Cekim onaylandi: ${result.status}`, kind: "success" });
      load();
    } catch (err) {
      onToast({ message: err instanceof Error ? err.message : "Onaylanamadi", kind: "error" });
    }
  };

  const reject = async (id: string) => {
    const reason = prompt("Red sebebi:") ?? "Yonetici reddi";
    try {
      await post(`/api/admin/payments/${id}/reject`, { reason });
      onToast({ message: "Cekim reddedildi, fonlar serbest birakildi", kind: "success" });
      load();
    } catch (err) {
      onToast({ message: err instanceof Error ? err.message : "Reddedilemedi", kind: "error" });
    }
  };

  const updateMethod = async (method: string, changes: Record<string, unknown>) => {
    try {
      await patch(`/api/admin/payment-methods/${method}`, changes);
      onToast({ message: "Odeme yontemi guncellendi", kind: "success" });
      setMethods((prev) => prev.map((m) => (m.method === method ? { ...m, ...changes } : m)));
    } catch (err) {
      onToast({ message: err instanceof Error ? err.message : "Guncellenemedi", kind: "error" });
    }
  };

  return (
    <div className="page">
      <h1 className="section-title" style={{ marginTop: 0 }}>Odemeler</h1>

      <div className="row mb" style={{ gap: 6 }}>
        <button className={`btn btn-sm ${tab === "intents" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("intents")}>Islemler</button>
        <button className={`btn btn-sm ${tab === "methods" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("methods")}>Yontem Yapilandirmasi</button>
      </div>

      {summary.length > 0 && tab === "intents" && (
        <div className="grid grid-4 mb">
          {summary.map((row) => (
            <div className="stat card-tight" key={`${row.direction}-${row.status}`}>
              <div className="stat-label">{row.direction} / {row.status}</div>
              <div className="stat-value" style={{ fontSize: 18 }}>{money(row.amount)}</div>
              <div className="tiny faint">{row.count} islem</div>
            </div>
          ))}
        </div>
      )}

      {tab === "intents" && (
        <>
          <div className="card mb">
            <div className="input-row">
              <select className="select" value={direction} onChange={(e) => { setPage(1); setDirection(e.target.value); }}>
                <option value="">Tum yonler</option>
                <option value="DEPOSIT">Yatirim</option>
                <option value="WITHDRAWAL">Cekim</option>
              </select>
              <select className="select" value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
                <option value="">Tum durumlar</option>
                <option value="PENDING">Bekleyen</option>
                <option value="PROCESSING">Isleniyor</option>
                <option value="COMPLETED">Tamamlandi</option>
                <option value="FAILED">Basarisiz</option>
                <option value="CANCELLED">Iptal</option>
              </select>
              <button className="btn btn-primary" onClick={load}>Filtrele</button>
            </div>
          </div>

          <div className="card">
            {loading ? <Spinner /> : payments.length === 0 ? <Empty icon="💰" title="Odeme bulunamadi" /> : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Referans</th><th>Oyuncu</th><th>KYC</th><th>Yon</th><th>Yontem</th><th>Tutar</th><th>Durum</th><th>Tarih</th><th></th></tr>
                  </thead>
                  <tbody>
                    {payments.map((row) => (
                      <tr key={row.id}>
                        <td className="mono truncate">{row.reference}</td>
                        <td>
                          <div className="bold small">{row.username}</div>
                          <div className="tiny faint">{row.email}</div>
                        </td>
                        <td><Pill kind={statusKind(row.kycStatus)}>{row.kycStatus}</Pill></td>
                        <td><Pill kind={row.direction === "DEPOSIT" ? "success" : "warning"}>{row.direction}</Pill></td>
                        <td>{row.method}</td>
                        <td className="mono bold">{money(row.amount, row.currency)}</td>
                        <td>
                          <Pill kind={statusKind(row.status)}>{row.status}</Pill>
                          {row.requiresReview && <div className="tiny faint">{row.reviewReason}</div>}
                        </td>
                        <td className="tiny faint">{new Date(row.createdAt).toLocaleString("tr-TR")}</td>
                        <td>
                          {row.direction === "WITHDRAWAL" && row.status === "PENDING" && (
                            <div className="row" style={{ gap: 4 }}>
                              <button className="btn btn-success btn-sm" onClick={() => approve(row.id)}>Onayla</button>
                              <button className="btn btn-danger btn-sm" onClick={() => reject(row.id)}>Reddet</button>
                            </div>
                          )}
                        </td>
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
        </>
      )}

      {tab === "methods" && (
        <div className="card">
          {methods.length === 0 ? <Spinner /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Yontem</th><th>Gorunen ad</th><th>Min</th><th>Max</th><th>Komisyon %</th><th>Aktif</th><th>Bakim</th></tr></thead>
                <tbody>
                  {methods.map((method) => (
                    <tr key={method.method}>
                      <td className="mono bold">{method.method}</td>
                      <td>{method.displayName}</td>
                      <td className="mono">{money(method.minAmount)}</td>
                      <td className="mono">{money(method.maxAmount)}</td>
                      <td className="mono">
                        <input
                          className="input"
                          style={{ width: 80, padding: "4px 8px" }}
                          defaultValue={method.feePercent}
                          onBlur={(e) => updateMethod(method.method, { feePercent: e.target.value })}
                        />
                      </td>
                      <td>
                        <button
                          className={`btn btn-sm ${method.enabled ? "btn-success" : "btn-ghost"}`}
                          onClick={() => updateMethod(method.method, { enabled: !method.enabled })}
                        >
                          {method.enabled ? "Acik" : "Kapali"}
                        </button>
                      </td>
                      <td>
                        <button
                          className={`btn btn-sm ${method.maintenanceMode ? "btn-danger" : "btn-ghost"}`}
                          onClick={() => updateMethod(method.method, { maintenanceMode: !method.maintenanceMode })}
                        >
                          {method.maintenanceMode ? "Bakimda" : "Normal"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

