import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { get, money, post } from "../lib/api";
import { useApp } from "../store/app";
import { Alert, Empty, Pill, Spinner } from "../components/ui";

export function AccountPage() {
  const { user, refreshMe, logout } = useApp();
  const [sessions, setSessions] = useState<
    { id: string; current: boolean; ip?: string | null; userAgent?: string | null; createdAt: string; lastSeenAt: string }[]
  >([]);
  const [twoFactor, setTwoFactor] = useState<{ secret: string; otpauth: string } | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "" });

  useEffect(() => {
    if (!user) return;
    get<{ sessions: typeof sessions }>("/api/auth/sessions").then((r) => setSessions(r.sessions)).catch(() => undefined);
  }, [user]);

  const setup2fa = async () => {
    setError(null);
    try {
      const result = await post<{ secret: string; otpauth: string }>("/api/auth/2fa/setup");
      setTwoFactor(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "2FA kurulumu baslatilamadi");
    }
  };

  const enable2fa = async () => {
    setError(null);
    try {
      const result = await post<{ backupCodes: string[] }>("/api/auth/2fa/enable", { code });
      setBackupCodes(result.backupCodes);
      setTwoFactor(null);
      setCode("");
      await refreshMe();
    } catch (err) {
      setError(err instanceof Error ? err.message : "2FA etkinlestirilemedi");
    }
  };

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await post("/api/auth/password/change", passwordForm);
      setMessage("Sifreniz degistirildi. Guvenlik icin tum oturumlar kapatildi.");
      setPasswordForm({ currentPassword: "", newPassword: "" });
      await logout();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sifre degistirilemedi");
    }
  };

  if (!user) return <div className="page"><Alert kind="info">Giris yapmalisiniz.</Alert></div>;

  return (
    <div className="page page-narrow">
      <h1 className="section-title" style={{ marginTop: 0 }}>Hesabim</h1>
      {error && <Alert kind="error">{error}</Alert>}
      {message && <Alert kind="success">{message}</Alert>}

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(116px, 1fr))", gap: 10, marginBottom: 18 }}>
        <Link to="/wallet" className="quick-action">
          <span className="quick-action-icon">💳</span>
          <span className="quick-action-label">Cuzdan</span>
        </Link>
        <Link to="/history" className="quick-action">
          <span className="quick-action-icon">📊</span>
          <span className="quick-action-label">Gecmis</span>
        </Link>
        <Link to="/games" className="quick-action">
          <span className="quick-action-icon">⭐</span>
          <span className="quick-action-label">Favoriler</span>
        </Link>
        <Link to="/vip" className="quick-action">
          <span className="quick-action-icon">👑</span>
          <span className="quick-action-label">VIP</span>
        </Link>
        <Link to="/fairness" className="quick-action">
          <span className="quick-action-icon">🔐</span>
          <span className="quick-action-label">Fairness</span>
        </Link>
        <Link to="/kyc" className="quick-action">
          <span className="quick-action-icon">🪪</span>
          <span className="quick-action-label">KYC</span>
        </Link>
      </div>

      <div className="card mb">
        <div className="card-title">Hesap Bilgileri</div>
        <div className="grid grid-2" style={{ gap: 12 }}>
          <div className="row-between small"><span className="muted">Kullanici adi</span><span className="bold">{user.username}</span></div>
          <div className="row-between small"><span className="muted">E-posta</span><span className="bold">{user.email}</span></div>
          <div className="row-between small"><span className="muted">Para birimi</span><span className="bold">{user.currency}</span></div>
          <div className="row-between small"><span className="muted">Durum</span><Pill kind="success">{user.status}</Pill></div>
          <div className="row-between small"><span className="muted">2FA</span><Pill kind={user.twoFactorEnabled ? "success" : "warning"}>{user.twoFactorEnabled ? "Aktif" : "Kapali"}</Pill></div>
          {user.affiliateCode && (
            <div className="row-between small"><span className="muted">Davet kodunuz</span><span className="bold mono">{user.affiliateCode}</span></div>
          )}
        </div>
      </div>

      <div className="card mb">
        <div className="card-title">🔐 Iki Adimli Dogrulama</div>
        {user.twoFactorEnabled ? (
          <div className="small muted">Hesabiniz 2FA ile korunuyor. Kapatmak icin sifre ve kod gerekir.</div>
        ) : twoFactor ? (
          <>
            <div className="alert alert-info">
              Gizli anahtari authenticator uygulamaniza ekleyin, sonra urettigi 6 haneli kodu girin.
            </div>
            <div className="mono small mb" style={{ wordBreak: "break-all" }}>{twoFactor.secret}</div>
            <div className="field">
              <label>Dogrulama kodu</label>
              <input className="input" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" placeholder="000000" />
            </div>
            <button className="btn btn-primary" onClick={enable2fa} disabled={code.length < 6}>Etkinlestir</button>
          </>
        ) : (
          <button className="btn btn-ghost" onClick={setup2fa}>2FA Kur</button>
        )}
        {backupCodes && (
          <div className="mt">
            <div className="small bold mb">Yedek kodlariniz (guvenli bir yerde saklayin):</div>
            <div className="mono small" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 4 }}>
              {backupCodes.map((backup) => <span key={backup}>{backup}</span>)}
            </div>
          </div>
        )}
      </div>

      <div className="card mb">
        <div className="card-title">🔑 Sifre Degistir</div>
        <form onSubmit={changePassword}>
          <div className="field">
            <label>Mevcut sifre</label>
            <input className="input" type="password" value={passwordForm.currentPassword} onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })} required />
          </div>
          <div className="field">
            <label>Yeni sifre</label>
            <input className="input" type="password" value={passwordForm.newPassword} onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })} required minLength={8} />
          </div>
          <button className="btn btn-primary" type="submit">Sifreyi Degistir</button>
        </form>
      </div>

      <div className="card">
        <div className="card-title">🖥️ Aktif Oturumlar</div>
        {sessions.length === 0 ? (
          <Spinner />
        ) : (
          <div className="col" style={{ gap: 8 }}>
            {sessions.map((session) => (
              <div key={session.id} className="row-between small" style={{ padding: "7px 0", borderBottom: "1px solid var(--border)" }}>
                <div>
                  <div className="bold">{session.current ? "Bu cihaz" : session.ip ?? "Bilinmeyen IP"}</div>
                  <div className="tiny faint truncate">{session.userAgent ?? "—"}</div>
                </div>
                <div className="right">
                  <div className="tiny faint">{new Date(session.lastSeenAt).toLocaleString("tr-TR")}</div>
                  {!session.current && (
                    <button
                      className="btn btn-ghost btn-sm mt"
                      onClick={async () => {
                        await import("../lib/api").then((m) => m.del(`/api/auth/sessions/${session.id}`));
                        setSessions((prev) => prev.filter((s) => s.id !== session.id));
                      }}
                    >
                      Kapat
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function KycPage() {
  const { user, refreshMe } = useApp();
  const [profile, setProfile] = useState<{
    status: string;
    level: number;
    rejectionReason?: string | null;
    documents: { id: string; type: string; verified: boolean }[];
  } | null>(null);
  const [form, setForm] = useState({
    fullName: "",
    birthDate: "1990-01-01",
    nationality: "TR",
    documentType: "NATIONAL_ID",
    documentNumber: "",
    address: "",
    city: "",
    postalCode: "",
    country: "TR",
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    get<typeof profile>("/api/kyc").then(setProfile).catch(() => undefined);
  };
  useEffect(load, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const result = await post<{ status: string; reason?: string }>("/api/kyc/submit", form);
      setNotice(result.status === "APPROVED" ? "Kimlik dogrulamaniz onaylandi!" : `Basvurunuz alindi: ${result.status}`);
      load();
      await refreshMe();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Basvuru gonderilemedi");
    } finally {
      setBusy(false);
    }
  };

  if (!user) return <div className="page"><Alert kind="info">Giris yapmalisiniz.</Alert></div>;

  const status = profile?.status ?? "NOT_STARTED";

  return (
    <div className="page page-narrow">
      <h1 className="section-title" style={{ marginTop: 0 }}>Kimlik Dogrulama</h1>
      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <div className="card mb">
        <div className="row-between">
          <span className="muted">Durum</span>
          <Pill kind={status === "APPROVED" ? "success" : status === "REJECTED" ? "danger" : "warning"}>{status}</Pill>
        </div>
        {status === "APPROVED" && <div className="small muted mt">Seviye {profile?.level} — cekim yapabilirsiniz.</div>}
        {profile?.rejectionReason && <div className="small mt" style={{ color: "var(--danger)" }}>{profile.rejectionReason}</div>}
      </div>

      {status !== "APPROVED" && (
        <div className="card">
          <form onSubmit={submit}>
            <div className="field">
              <label>Ad Soyad</label>
              <input className="input" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required />
            </div>
            <div className="field">
              <label>Dogum tarihi</label>
              <input className="input" type="date" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} required />
            </div>
            <div className="field">
              <label>Belge turu</label>
              <select className="select" value={form.documentType} onChange={(e) => setForm({ ...form, documentType: e.target.value })}>
                <option value="NATIONAL_ID">Kimlik karti</option>
                <option value="PASSPORT">Pasaport</option>
                <option value="DRIVERS_LICENSE">Ehliyet</option>
                <option value="RESIDENCE_PERMIT">Oturma izni</option>
              </select>
            </div>
            <div className="field">
              <label>Belge numarasi</label>
              <input className="input" value={form.documentNumber} onChange={(e) => setForm({ ...form, documentNumber: e.target.value })} required />
            </div>
            <div className="field">
              <label>Adres</label>
              <input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} required />
            </div>
            <div className="input-row">
              <div className="field" style={{ flex: 1 }}>
                <label>Sehir</label>
                <input className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} required />
              </div>
              <div className="field" style={{ width: 120 }}>
                <label>Posta kodu</label>
                <input className="input" value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} />
              </div>
            </div>
            <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>
              {busy ? "Gonderiliyor..." : "Basvuruyu Gonder"}
            </button>
            <div className="tiny faint center mt">
              Verileriniz sifreli saklanir ve yalnizca dogrulama amaciyla islenir.
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export function HistoryPage() {
  const { user } = useApp();
  const [tab, setTab] = useState<"bets" | "transactions" | "bonuses">("bets");
  const [bets, setBets] = useState<
    { id: string; reference: string; game: string; status: string; stake: string; payout: string; profit: string; multiplier: string; currency: string; isDemo: boolean; placedAt: string }[]
  >([]);
  const [transactions, setTransactions] = useState<
    { id: string; reference: string; type: string; status: string; amount: string; currency: string; description?: string | null; createdAt: string }[]
  >([]);
  const [bonuses, setBonuses] = useState<
    { id: string; name: string; code: string; status: string; amount: string; remaining: string; wageringRemaining: string; progressPercent: number; expiresAt: string }[]
  >([]);

  useEffect(() => {
    if (!user) return;
    get<{ rows: typeof bets }>("/api/games/bets/history?pageSize=50").then((r) => setBets(r.rows)).catch(() => undefined);
    get<{ transactions: typeof transactions }>("/api/wallet/transactions?pageSize=50").then((r) => setTransactions(r.transactions)).catch(() => undefined);
    get<{ bonuses: typeof bonuses }>("/api/wallet/bonuses").then((r) => setBonuses(r.bonuses)).catch(() => undefined);
  }, [user]);

  if (!user) return <div className="page"><Alert kind="info">Giris yapmalisiniz.</Alert></div>;

  return (
    <div className="page">
      <h1 className="section-title" style={{ marginTop: 0 }}>Islem Gecmisi</h1>

      <div className="row mb" style={{ gap: 6 }}>
        {(["bets", "transactions", "bonuses"] as const).map((key) => (
          <button key={key} className={`btn btn-sm ${tab === key ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab(key)}>
            {key === "bets" ? "Bahisler" : key === "transactions" ? "Para Hareketleri" : "Bonuslar"}
          </button>
        ))}
      </div>

      {tab === "bets" && (
        <div className="card">
          {bets.length === 0 ? <Empty icon="🎲" title="Bahis kaydi yok" /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Referans</th><th>Oyun</th><th>Bahis</th><th>Odeme</th><th>Katsayi</th><th>Sonuc</th><th>Tarih</th></tr></thead>
                <tbody>
                  {bets.map((bet) => (
                    <tr key={bet.id}>
                      <td className="mono truncate">{bet.reference}</td>
                      <td>{bet.game}{bet.isDemo && <span className="tiny faint"> (demo)</span>}</td>
                      <td className="mono">{money(bet.stake, bet.currency)}</td>
                      <td className="mono">{money(bet.payout, bet.currency)}</td>
                      <td className="mono">x{Number(bet.multiplier).toFixed(2)}</td>
                      <td><Pill kind={statusKind(bet.status)}>{bet.status}</Pill></td>
                      <td className="faint small">{new Date(bet.placedAt).toLocaleString("tr-TR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "transactions" && (
        <div className="card">
          {transactions.length === 0 ? <Empty icon="💸" title="Hareket yok" /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Referans</th><th>Tur</th><th>Tutar</th><th>Aciklama</th><th>Durum</th><th>Tarih</th></tr></thead>
                <tbody>
                  {transactions.map((tx) => (
                    <tr key={tx.id}>
                      <td className="mono truncate">{tx.reference}</td>
                      <td>{tx.type}</td>
                      <td className="mono">{money(tx.amount, tx.currency)}</td>
                      <td className="small faint">{tx.description ?? "—"}</td>
                      <td><Pill kind={statusKind(tx.status)}>{tx.status}</Pill></td>
                      <td className="faint small">{new Date(tx.createdAt).toLocaleString("tr-TR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "bonuses" && (
        <div className="grid grid-2">
          {bonuses.length === 0 ? <Empty icon="🎁" title="Bonus yok" /> : bonuses.map((bonus) => (
            <div className="card" key={bonus.id}>
              <div className="row-between mb">
                <div>
                  <div className="bold">{bonus.name}</div>
                  <div className="tiny faint mono">{bonus.code}</div>
                </div>
                <Pill kind={statusKind(bonus.status)}>{bonus.status}</Pill>
              </div>
              <div className="row-between small mb"><span className="muted">Tutar</span><span className="mono">{money(bonus.amount)}</span></div>
              <div className="row-between small mb"><span className="muted">Kalan</span><span className="mono">{money(bonus.remaining)}</span></div>
              <div className="row-between small mb"><span className="muted">Cevrim kalan</span><span className="mono">{money(bonus.wageringRemaining)}</span></div>
              <div style={{ height: 7, background: "var(--bg-elev-3)", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${bonus.progressPercent}%`, height: "100%", background: "linear-gradient(90deg, var(--primary), var(--accent))" }} />
              </div>
              <div className="tiny faint mt right">%{bonus.progressPercent} tamamlandi</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function statusKind(status: string): string {
  const s = status.toUpperCase();
  if (["ACTIVE", "COMPLETED", "APPROVED", "WON", "CASHED_OUT", "PAID"].includes(s)) return "success";
  if (["PENDING", "IN_REVIEW", "PROCESSING", "OPEN"].includes(s)) return "warning";
  if (["FAILED", "REJECTED", "LOST", "CANCELLED", "EXPIRED"].includes(s)) return "danger";
  return "neutral";
}
