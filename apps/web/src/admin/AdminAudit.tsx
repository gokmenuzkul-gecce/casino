import { useEffect, useState } from "react";
import { get } from "../lib/api";
import { Empty, Pill, Spinner } from "../components/ui";

export function AdminAudit() {
  const [rows, setRows] = useState<
    { id: string; action: string; entityType?: string | null; entityId?: string | null; severity: string; ip?: string | null; createdAt: string; actor?: { username: string; roles: string[] } | null }[]
  >([]);
  const [severity, setSeverity] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const query = new URLSearchParams({ page: String(page), pageSize: "40" });
    if (severity) query.set("severity", severity);
    get<{ rows: typeof rows; total: number }>(`/api/admin/audit?${query}`)
      .then((r) => {
        setRows(r.rows);
        setTotal(r.total);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [page, severity]);

  return (
    <div className="page">
      <h1 className="section-title" style={{ marginTop: 0 }}>Denetim Izleri</h1>

      <div className="row mb" style={{ gap: 6 }}>
        {["", "INFO", "WARNING", "CRITICAL"].map((value) => (
          <button key={value} className={`btn btn-sm ${severity === value ? "btn-primary" : "btn-ghost"}`} onClick={() => { setPage(1); setSeverity(value); }}>
            {value === "" ? "Tumu" : value}
          </button>
        ))}
      </div>

      <div className="card">
        {loading ? <Spinner /> : rows.length === 0 ? <Empty icon="🔍" title="Kayit yok" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Onem</th><th>Islem</th><th>Aktor</th><th>Varlik</th><th>IP</th><th>Tarih</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td><Pill kind={row.severity === "CRITICAL" ? "danger" : row.severity === "WARNING" ? "warning" : "neutral"}>{row.severity}</Pill></td>
                    <td className="mono small">{row.action}</td>
                    <td className="small">{row.actor?.username ?? <span className="faint">sistem</span>}</td>
                    <td className="tiny faint">{row.entityType} {row.entityId?.slice(0, 8)}</td>
                    <td className="mono tiny">{row.ip ?? "—"}</td>
                    <td className="tiny faint">{new Date(row.createdAt).toLocaleString("tr-TR")}</td>
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

