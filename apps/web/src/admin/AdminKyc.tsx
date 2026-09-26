import { useEffect, useState } from "react";
import { get, money, post } from "../lib/api";
import { Empty, Pill, Spinner, statusKind } from "../components/ui";
import type { ToastFn } from "./AdminLayout";

interface KycSubmission {
  id: string;
  status: string;
  fullName?: string | null;
  birthDate?: string | null;
  nationality?: string | null;
  documentType?: string | null;
  documentNumber?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  pepMatch?: boolean;
  sanctionsMatch?: boolean;
  riskLevel?: string | null;
  submittedAt?: string | null;
  rejectionReason?: string | null;
  user: { id: string; username: string; email: string; createdAt: string };
  documents: { id: string; type: string; fileUrl: string; verified: boolean }[];
}

export function AdminKyc({ onToast }: { onToast: ToastFn }) {
  const [rows, setRows] = useState<KycSubmission[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    const query = status ? `?status=${status}` : "";
    get<{ submissions: KycSubmission[] }>(`/api/admin/kyc${query}`)
      .then((r) => setRows(r.submissions))
      .catch((err) => onToast({ message: err.message, kind: "error" }))
      .finally(() => setLoading(false));
  };

  useEffect(load, [status]);

  const review = async (id: string, decision: "APPROVE" | "REJECT") => {
    const reason = decision === "REJECT" ? prompt("Red sebebi:") ?? "Belgeler yetersiz" : undefined;
    try {
      await post(`/api/admin/kyc/${id}/review`, { decision, reason, level: 1 });
      onToast({ message: decision === "APPROVE" ? "KYC onaylandi" : "KYC reddedildi", kind: "success" });
      load();
    } catch (err) {
      onToast({ message: err instanceof Error ? err.message : "Islem basarisiz", kind: "error" });
    }
  };

  return (
    <div className="page">
      <h1 className="section-title" style={{ marginTop: 0 }}>KYC Inceleme</h1>

      <div className="row mb" style={{ gap: 6 }}>
        {["", "PENDING", "IN_REVIEW", "APPROVED", "REJECTED"].map((value) => (
          <button key={value} className={`btn btn-sm ${status === value ? "btn-primary" : "btn-ghost"}`} onClick={() => setStatus(value)}>
            {value === "" ? "Tumu" : value}
          </button>
        ))}
      </div>

      {loading ? <Spinner /> : rows.length === 0 ? <Empty icon="🪪" title="Basvuru yok" /> : (
        <div className="grid grid-2">
          {rows.map((row) => (
            <div className="card" key={row.id}>
              <div className="row-between mb">
                <div>
                  <div className="bold">{row.user.username}</div>
                  <div className="tiny faint">{row.user.email}</div>
                </div>
                <Pill kind={statusKind(row.status)}>{row.status}</Pill>
              </div>

              <div className="grid grid-2" style={{ gap: 6 }}>
                <div className="small"><span className="muted">Ad: </span>{row.fullName ?? "—"}</div>
                <div className="small"><span className="muted">Dogum: </span>{row.birthDate ? new Date(row.birthDate).toLocaleDateString("tr-TR") : "—"}</div>
                <div className="small"><span className="muted">Belge: </span>{row.documentType ?? "—"}</div>
                <div className="small"><span className="muted">No: </span><span className="mono">{row.documentNumber ?? "—"}</span></div>
                <div className="small"><span className="muted">Ulke: </span>{row.country ?? "—"}</div>
                <div className="small"><span className="muted">Sehir: </span>{row.city ?? "—"}</div>
              </div>

              <div className="row mt" style={{ gap: 6, flexWrap: "wrap" }}>
                {row.pepMatch && <Pill kind="danger">PEP eslesmesi</Pill>}
                {row.sanctionsMatch && <Pill kind="danger">Yaptirim eslesmesi</Pill>}
                {row.riskLevel && <Pill kind="warning">Risk: {row.riskLevel}</Pill>}
                <Pill kind="neutral">{row.documents.length} belge</Pill>
              </div>

              {row.rejectionReason && <div className="small mt" style={{ color: "var(--danger)" }}>{row.rejectionReason}</div>}

              {(row.status === "PENDING" || row.status === "IN_REVIEW") && (
                <div className="row mt" style={{ gap: 8 }}>
                  <button className="btn btn-success" style={{ flex: 1 }} onClick={() => review(row.id, "APPROVE")}>Onayla</button>
                  <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => review(row.id, "REJECT")}>Reddet</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
