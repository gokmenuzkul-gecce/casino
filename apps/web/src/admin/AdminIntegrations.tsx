import { useEffect, useState } from "react";
import { get, put } from "../lib/api";
import { Pill, Spinner } from "../components/ui";
import type { ToastFn } from "./AdminLayout";

interface ProviderHealth {
  kind: string;
  provider: string;
  mode: string;
  configured: boolean;
  reachable: boolean | null;
  detail?: string;
  checkedAt: string;
}

type SavedConfig = { provider: string; isEnabled: boolean; values: Record<string, string> };

interface Data {
  platformMode: string;
  health: ProviderHealth[];
  saved: Record<string, SavedConfig>;
  requiredEnvKeys: Record<string, string[]>;
  supportedAggregators: string[];
  supportedPsps: string[];
  scheduledTasks: { name: string; cron: string; isActive: boolean; lastRunAt?: string | null; lastStatus?: string | null; runCount: number }[];
}

/** Values that reach the browser only as a mask; leaving them blank keeps them. */
const SECRET_PATTERN = /SECRET|PASSWORD|API_KEY|_KEY$/;

export function AdminIntegrations({ onToast }: { onToast: ToastFn }) {
  const [data, setData] = useState<Data | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<{ provider: string; values: Record<string, string> }>({ provider: "", values: {} });
  const [busy, setBusy] = useState(false);

  const load = () => get<Data>("/api/admin/integrations").then(setData).catch(() => undefined);
  useEffect(() => { load(); }, []);

  const startEdit = (kind: string) => {
    const saved = data?.saved[kind];
    setEditing(kind);
    setForm({
      provider: saved?.provider ?? "",
      values: Object.fromEntries((data?.requiredEnvKeys[kind] ?? []).map((key) => [key, saved?.values[key] ?? ""])),
    });
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await put(`/api/admin/integrations/${editing}`, form);
      onToast({ message: "Saglayici yapilandirmasi kaydedildi", kind: "success" });
      setEditing(null);
      await load();
    } catch (err) {
      onToast({ message: err instanceof Error ? err.message : "Kaydedilemedi", kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <Spinner label="Entegrasyon durumu yukleniyor" />;

  const labels: Record<string, string> = {
    gameAggregator: "Oyun Agregatoru (slot, canli casino, masa oyunlari)",
    psp: "Odeme Saglayicisi (PSP)",
    crypto: "Kripto Odeme",
    kyc: "Kimlik Dogrulama (KYC)",
    risk: "Risk Motoru",
    sms: "SMS Gonderimi",
  };

  return (
    <div className="page">
      <h1 className="section-title" style={{ marginTop: 0 }}>Entegrasyon Yonetimi</h1>

      <div className="alert alert-info mb">
        Asagidaki alanlara kimlik bilgilerini girip <span className="bold">Kaydet</span>'e basin. Bilgiler sifreli olarak saklanir ve
        kaydedildigi anda devreye girer; <span className="mono">.env</span> duzenlemek veya yeniden baslatmak gerekmez.
      </div>

      <div className="grid grid-2 mb">
        {data.health.map((provider) => {
          const saved = data.saved[provider.kind];
          const isEditing = editing === provider.kind;
          return (
            <div className="card" key={provider.kind}>
              <div className="row-between mb">
                <div className="bold">{labels[provider.kind] ?? provider.kind}</div>
                <Pill kind={provider.configured ? "success" : "warning"}>{provider.configured ? "YAPILANDIRILDI" : "BEKLIYOR"}</Pill>
              </div>
              <div className="grid grid-2" style={{ gap: 8 }}>
                <div className="small"><span className="muted">Aktif saglayici: </span><span className="mono">{provider.provider}</span></div>
                <div className="small"><span className="muted">Mod: </span><Pill kind={provider.mode === "live" ? "danger" : "warning"}>{provider.mode}</Pill></div>
              </div>
              {provider.detail && <div className="tiny faint mt">{provider.detail}</div>}

              <div className="divider" style={{ margin: "12px 0" }} />

              {!isEditing ? (
                <div className="row-between">
                  <div className="tiny faint">{saved ? `Kayitli profil: ${saved.provider}` : "Panelden kayitli bilgi yok"}</div>
                  <button className="btn btn-sm" onClick={() => startEdit(provider.kind)}>Kimlik Gir</button>
                </div>
              ) : (
                <div className="col" style={{ gap: 8 }}>
                  <div className="field">
                    <label className="label tiny">Saglayici Profili</label>
                    <input
                      className="input mono"
                      placeholder="gregmorn / betskilla / generic"
                      value={form.provider}
                      onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
                    />
                  </div>
                  {(data.requiredEnvKeys[provider.kind] ?? []).map((key) => (
                    <div className="field" key={key}>
                      <label className="label tiny mono">{key}</label>
                      <input
                        className="input mono"
                        type={SECRET_PATTERN.test(key) ? "password" : "text"}
                        placeholder={SECRET_PATTERN.test(key) ? "kaydetmek icin girin" : ""}
                        value={form.values[key] ?? ""}
                        onChange={(e) => setForm((f) => ({ ...f, values: { ...f.values, [key]: e.target.value } }))}
                      />
                    </div>
                  ))}
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn btn-sm btn-primary" disabled={busy} onClick={save}>
                      {busy ? "Kaydediliyor..." : "Kaydet"}
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setEditing(null)}>Vazgec</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="card mb">
        <div className="card-title">Desteklenen Saglayici Profilleri</div>
        <p className="small muted mb">
          Bilinen agregatorler icin dogru kimlik dogrulama semasi ve uc nokta yollari otomatik secilir. Baska bir saglayici icin
          <span className="mono"> generic </span> profili kullanilir.
        </p>
        <div className="grid grid-2">
          <div>
            <div className="bold small mb">Oyun Agregatorleri</div>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {data.supportedAggregators.map((name) => <Pill key={name} kind="info">{name}</Pill>)}
            </div>
          </div>
          <div>
            <div className="bold small mb">Odeme Saglayicilari</div>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {data.supportedPsps.map((name) => <Pill key={name} kind="info">{name}</Pill>)}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">🔄 Otomatik Gorevler</div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Gorev</th><th>Cron</th><th>Durum</th><th>Son calisma</th><th>Calisma sayisi</th></tr></thead>
            <tbody>
              {data.scheduledTasks.map((task) => (
                <tr key={task.name}>
                  <td className="mono small">{task.name}</td>
                  <td className="mono tiny">{task.cron}</td>
                  <td><Pill kind={task.isActive ? "success" : "neutral"}>{task.isActive ? "Aktif" : "Pasif"}</Pill></td>
                  <td className="tiny faint">{task.lastRunAt ? new Date(task.lastRunAt).toLocaleString("tr-TR") : "—"}</td>
                  <td className="mono">{task.runCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

