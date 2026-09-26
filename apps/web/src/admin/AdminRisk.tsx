import { useEffect, useState } from "react";
import { del, get, money, post } from "../lib/api";
import { Empty, Modal, Pill, Spinner, statusKind } from "../components/ui";
import type { ToastFn } from "./AdminLayout";

interface RiskFlag {
  id: string;
  type: string;
  severity: string;
  status: string;
  title: string;
  detail?: string | null;
  resolution?: string | null;
  createdAt: string;
  user: { id: string; username: string; email: string; riskScore: number };
}

interface BlocklistEntry {
  id: string;
  type: string;
  value: string;
  reason?: string | null;
  isActive: boolean;
  createdAt: string;
}

export function AdminRisk({ onToast }: { onToast: ToastFn }) {
  const [tab, setTab] = useState<"flags" | "blocklist">("flags");
  const [flags, setFlags] = useState<RiskFlag[]>([]);
  const [blocklist, setBlocklist] = useState<BlocklistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [severity, setSeverity] = useState("");
  const [newEntry, setNewEntry] = useState({ type: "IP", value: "", reason: "" });
  const [blockOpen, setBlockOpen] = useState(false);

  const load = () => {
    setLoading(true);
    const query = severity ? `?severity=${severity}` : "";
    get<{ flags: RiskFlag[] }>(`/api/admin/risk${query}`)
      .then((r) => setFlags(r.flags))
      .catch((err) => onToast({ message: err.message, kind: "error" }))
      .finally(() => setLoading(false));
  };

  const loadBlocklist = () => {
    get<{ entries: BlocklistEntry[] }>("/api/admin/blocklist")
      .then((r) => setBlocklist(r.entries))
      .catch(() => undefined);
  };

  useEffect(load, [severity]);
  useEffect(() => {
    if (tab === "blocklist") loadBlocklist();
  }, [tab]);

  const resolve = async (id: string) => {
    const resolution = prompt("Cozum notu:") ?? "Islem tamamlandi";
    try {
      await post(`/api/admin/risk/${id}/resolve`, { resolution });
      onToast({ message: "Risk uyarisi cozuldu", kind: "success" });
      load();
    } catch (err) {
      onToast({ message: err instanceof Error ? err.message : "Cozulemedi", kind: "error" });
    }
  };

  const addBlock = async () => {
    if (!newEntry.value) return;
    try {
      await post("/api/admin/blocklist", newEntry);
      onToast({ message: "Engel listesine eklendi", kind: "success" });
      setNewEntry({ type: "IP", value: "", reason: "" });
      setBlockOpen(false);
      loadBlocklist();
    } catch (err) {
      onToast({ message: err instanceof Error ? err.message : "Eklenemedi", kind: "error" });
    }
  };

  const removeBlock = async (id: string) => {
    try {
      await del(`/api/admin/blocklist/${id}`);
      onToast({ message: "Engel kaldirildi", kind: "success" });
      loadBlocklist();
    } catch (err) {
      onToast({ message: err instanceof Error ? err.message : "Kaldirilamadi", kind: "error" });
    }
  };

  return (
    <div className="page">
      <div className="row-between mb">
        <h1 className="section-title" style={{ margin: 0 }}>🛡️ Risk Yonetimi</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setBlockOpen(true)}>+ Engel Ekle</button>
      </div>

      <div className="row mb" style={{ gap: 6 }}>
        <button className={`btn btn-sm ${tab === "flags" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("flags")}>Uyarilar</button>
        <button className={`btn btn-sm ${tab === "blocklist" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("blocklist")}>Engel Listesi</button>
      </div>

      {tab === "flags" && (
        <>
          <div className="row mb" style={{ gap: 6 }}>
            {["", "CRITICAL", "HIGH", "MEDIUM", "LOW"].map((value) => (
              <button key={value} className={`btn btn-sm ${severity === value ? "btn-primary" : "btn-ghost"}`} onClick={() => setSeverity(value)}>
                {value === "" ? "Tumu" : value}
              </button>
            ))}
          </div>

          {loading ? <Spinner /> : flags.length === 0 ? <Empty icon="🛡️" title="Acik risk uyarisi yok" hint="Sistem temiz" /> : (
            <div className="card">
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Onem</th><th>Oyuncu</th><th>Tur</th><th>Aciklama</th><th>Tarih</th><th></th></tr></thead>
                  <tbody>
                    {flags.map((flag) => (
                      <tr key={flag.id}>
                        <td><Pill kind={flag.severity === "CRITICAL" ? "danger" : flag.severity === "HIGH" ? "danger" : flag.severity === "MEDIUM" ? "warning" : "neutral"}>{flag.severity}</Pill></td>
                        <td>
                          <div className="bold small">{flag.user.username}</div>
                          <div className="tiny faint">risk skoru: {flag.user.riskScore}</div>
                        </td>
                        <td className="mono small">{flag.type}</td>
                        <td>
                          <div className="small">{flag.title}</div>
                          <div className="tiny faint">{flag.detail}</div>
                        </td>
                        <td className="tiny faint">{new Date(flag.createdAt).toLocaleString("tr-TR")}</td>
                        <td><button className="btn btn-ghost btn-sm" onClick={() => resolve(flag.id)}>Coz</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "blocklist" && (
        <div className="card">
          {blocklist.length === 0 ? <Empty icon="🚫" title="Engel listesi bos" /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Tur</th><th>Deger</th><th>Sebep</th><th>Tarih</th><th></th></tr></thead>
                <tbody>
                  {blocklist.map((entry) => (
                    <tr key={entry.id}>
                      <td><Pill kind="warning">{entry.type}</Pill></td>
                      <td className="mono">{entry.value}</td>
                      <td className="small faint">{entry.reason ?? "—"}</td>
                      <td className="tiny faint">{new Date(entry.createdAt).toLocaleDateString("tr-TR")}</td>
                      <td><button className="btn btn-danger btn-sm" onClick={() => removeBlock(entry.id)}>Kaldir</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <Modal open={blockOpen} onClose={() => setBlockOpen(false)} title="Engel Listesine Ekle" subtitle="IP, e-posta, cihaz veya belge numarasi engellenebilir">
        <div className="field">
          <label>Tur</label>
          <select className="select" value={newEntry.type} onChange={(e) => setNewEntry({ ...newEntry, type: e.target.value })}>
            {["IP", "EMAIL", "PHONE", "DEVICE", "DOCUMENT", "CARD", "COUNTRY"].map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Deger</label>
          <input className="input" value={newEntry.value} onChange={(e) => setNewEntry({ ...newEntry, value: e.target.value })} placeholder="or. 185.12.34.56" />
        </div>
        <div className="field">
          <label>Sebep</label>
          <input className="input" value={newEntry.reason} onChange={(e) => setNewEntry({ ...newEntry, reason: e.target.value })} placeholder="or. Bonus suistimali" />
        </div>
        <button className="btn btn-primary btn-block" onClick={addBlock} disabled={!newEntry.value}>Ekle</button>
      </Modal>
    </div>
  );
}

