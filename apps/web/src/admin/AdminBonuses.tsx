import { useEffect, useState } from "react";
import { get, money, patch, post, put } from "../lib/api";
import { Empty, Modal, Pill, Spinner, statusKind } from "../components/ui";
import type { ToastFn } from "./AdminLayout";

interface BonusRow {
  id: string;
  code: string;
  name: string;
  type: string;
  status: string;
  percent: string | null;
  fixedAmount: string | null;
  maxBonus: string | null;
  minDeposit: string | null;
  wageringMultiplier: string;
  grantedCount: number;
  validUntil?: string | null;
  usedBudget: string;
  totalBudget?: string | null;
  isAutoApply: boolean;
}

export function AdminBonuses({ onToast }: { onToast: ToastFn }) {
  const [bonuses, setBonuses] = useState<BonusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    code: "",
    name: "",
    description: "",
    type: "DEPOSIT_MATCH",
    percent: "100",
    maxBonus: "5000",
    minDeposit: "100",
    wageringMultiplier: "30",
    perUserLimit: "1",
    newPlayersOnly: false,
    isAutoApply: true,
  });

  const load = () => {
    setLoading(true);
    get<{ bonuses: BonusRow[] }>("/api/admin/bonuses")
      .then((r) => setBonuses(r.bonuses))
      .catch((err) => onToast({ message: err.message, kind: "error" }))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const create = async () => {
    try {
      await post("/api/admin/bonuses", {
        ...form,
        percent: Number(form.percent),
        wageringMultiplier: Number(form.wageringMultiplier),
        perUserLimit: Number(form.perUserLimit),
      });
      onToast({ message: "Bonus olusturuldu", kind: "success" });
      setModalOpen(false);
      load();
    } catch (err) {
      onToast({ message: err instanceof Error ? err.message : "Olusturulamadi", kind: "error" });
    }
  };

  const toggleStatus = async (id: string, current: string) => {
    const next = current === "ACTIVE" ? "PAUSED" : "ACTIVE";
    try {
      await patch(`/api/admin/bonuses/${id}`, { status: next });
      onToast({ message: `Bonus ${next === "ACTIVE" ? "aktif" : "duraklatildi"}`, kind: "success" });
      setBonuses((prev) => prev.map((b) => (b.id === id ? { ...b, status: next } : b)));
    } catch (err) {
      onToast({ message: err instanceof Error ? err.message : "Guncellenemedi", kind: "error" });
    }
  };

  return (
    <div className="page">
      <div className="row-between mb">
        <h1 className="section-title" style={{ margin: 0 }}>🎁 Bonuslar</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setModalOpen(true)}>+ Bonus Olustur</button>
      </div>

      {loading ? <Spinner /> : bonuses.length === 0 ? <Empty icon="🎁" title="Bonus yok" /> : (
        <div className="card">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Kod</th><th>Ad</th><th>Tur</th><th>Deger</th><th>Cevrim</th><th>Kullanim</th><th>Durum</th><th></th></tr>
              </thead>
              <tbody>
                {bonuses.map((bonus) => (
                  <tr key={bonus.id}>
                    <td className="mono bold">{bonus.code}</td>
                    <td className="small">{bonus.name}</td>
                    <td><Pill kind="info">{bonus.type}</Pill></td>
                    <td className="mono small">
                      {bonus.percent ? `%${bonus.percent}` : money(bonus.fixedAmount ?? "0")}
                      {bonus.maxBonus && <span className="tiny faint"> (max {money(bonus.maxBonus)})</span>}
                    </td>
                    <td className="mono">{bonus.wageringMultiplier}x</td>
                    <td className="small">{bonus.grantedCount} kez</td>
                    <td><Pill kind={statusKind(bonus.status)}>{bonus.status}</Pill></td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => toggleStatus(bonus.id, bonus.status)}>
                        {bonus.status === "ACTIVE" ? "Duraklat" : "Aktiflestir"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Yeni Bonus" subtitle="Bonus degeri, cevrim sarti ve uygunluk kurallarini tanimlayin" wide>
        <div className="grid grid-2">
          <div className="field">
            <label>Bonus kodu</label>
            <input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="WELCOME200" />
          </div>
          <div className="field">
            <label>Bonus adi</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field">
            <label>Tur</label>
            <select className="select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {["WELCOME", "DEPOSIT_MATCH", "RELOAD", "FREE_SPINS", "CASHBACK", "RAKEBACK", "LOYALTY", "TOURNAMENT"].map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Yuzde (%)</label>
            <input className="input" type="number" value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value })} />
          </div>
          <div className="field">
            <label>Maksimum bonus</label>
            <input className="input" type="number" value={form.maxBonus} onChange={(e) => setForm({ ...form, maxBonus: e.target.value })} />
          </div>
          <div className="field">
            <label>Minimum yatirim</label>
            <input className="input" type="number" value={form.minDeposit} onChange={(e) => setForm({ ...form, minDeposit: e.target.value })} />
          </div>
          <div className="field">
            <label>Cevrim carpani</label>
            <input className="input" type="number" value={form.wageringMultiplier} onChange={(e) => setForm({ ...form, wageringMultiplier: e.target.value })} />
          </div>
          <div className="field">
            <label>Kisi basi limit</label>
            <input className="input" type="number" value={form.perUserLimit} onChange={(e) => setForm({ ...form, perUserLimit: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label>Aciklama</label>
          <textarea className="textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="row mb" style={{ gap: 16 }}>
          <label className="row small" style={{ gap: 6 }}>
            <input type="checkbox" checked={form.newPlayersOnly} onChange={(e) => setForm({ ...form, newPlayersOnly: e.target.checked })} />
            Sadece yeni oyuncular
          </label>
          <label className="row small" style={{ gap: 6 }}>
            <input type="checkbox" checked={form.isAutoApply} onChange={(e) => setForm({ ...form, isAutoApply: e.target.checked })} />
            Otomatik uygula
          </label>
        </div>
        <button className="btn btn-primary btn-block" onClick={create} disabled={!form.code || !form.name}>Bonus Olustur</button>
      </Modal>
    </div>
  );
}

