import { useEffect, useState } from "react";
import { get, patch, put, post } from "../lib/api";
import { Empty, Pill, Spinner, statusKind } from "../components/ui";
import type { ToastFn } from "./AdminLayout";

interface Setting {
  key: string;
  value: unknown;
  category: string;
}

export function AdminSettings({ onToast }: { onToast: ToastFn }) {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [flags, setFlags] = useState<{ key: string; enabled: boolean; description?: string; rolloutPercent: number }[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    get<{ settings: Setting[]; flags: typeof flags }>("/api/admin/settings")
      .then((r) => {
        setSettings(r.settings);
        setFlags(r.flags);
      })
      .catch((err) => onToast({ message: err.message, kind: "error" }))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const save = async (key: string, value: string) => {
    try {
      await put(`/api/admin/settings/${key}`, { value });
      onToast({ message: `${key} kaydedildi`, kind: "success" });
    } catch (err) {
      onToast({ message: err instanceof Error ? err.message : "Kaydedilemedi", kind: "error" });
    }
  };

  const toggleFlag = async (key: string, enabled: boolean) => {
    try {
      await put(`/api/admin/feature-flags/${key}`, { enabled });
      setFlags((prev) => prev.map((f) => (f.key === key ? { ...f, enabled } : f)));
      onToast({ message: `${key} ${enabled ? "acildi" : "kapatildi"}`, kind: "success" });
    } catch (err) {
      onToast({ message: err instanceof Error ? err.message : "Guncellenemedi", kind: "error" });
    }
  };

  if (loading) return <Spinner />;

  const grouped = settings.reduce((acc, setting) => {
    (acc[setting.category] ??= []).push(setting);
    return acc;
  }, {} as Record<string, Setting[]>);

  return (
    <div className="page">
      <h1 className="section-title" style={{ marginTop: 0 }}>Platform Ayarlari</h1>

      <div className="card mb">
        <div className="card-title">🚩 Ozellik Anahtarlari</div>
        <div className="grid grid-2">
          {flags.map((flag) => (
            <div className="row-between card card-tight" key={flag.key}>
              <div>
                <div className="bold small mono">{flag.key}</div>
                <div className="tiny faint">{flag.description}</div>
              </div>
              <button className={`btn btn-sm ${flag.enabled ? "btn-success" : "btn-ghost"}`} onClick={() => toggleFlag(flag.key, !flag.enabled)}>
                {flag.enabled ? "Acik" : "Kapali"}
              </button>
            </div>
          ))}
        </div>
      </div>

      {Object.entries(grouped).map(([category, group]) => (
        <div className="card mb" key={category}>
          <div className="card-title">{category.toUpperCase()}</div>
          {group.map((setting) => (
            <div className="field" key={setting.key}>
              <label className="mono">{setting.key}</label>
              <div className="input-row">
                <input
                  className="input"
                  defaultValue={String(setting.value ?? "")}
                  onKeyDown={(e) => e.key === "Enter" && save(setting.key, (e.target as HTMLInputElement).value)}
                />
                <button
                  className="btn btn-ghost"
                  onClick={(e) => {
                    const input = (e.currentTarget.previousElementSibling as HTMLInputElement);
                    save(setting.key, input.value);
                  }}
                >
                  Kaydet
                </button>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

