import { useEffect, useState } from "react";
import { get, money, post, del } from "../lib/api";
import { useApp } from "../store/app";
import { Alert, Empty, Modal, Pill, Spinner, statusKind } from "../components/ui";

interface Method {
  method: string;
  displayName: string;
  iconUrl?: string | null;
  minAmount: string;
  maxAmount: string;
  feePercent: string;
  maintenanceMode: boolean;
  instructions?: string | null;
}

interface PaymentRow {
  reference: string;
  amount: string;
  fee: string;
  currency: string;
  method: string;
  status: string;
  createdAt: string;
  completedAt?: string | null;
  failureReason?: string | null;
}

export function WalletPage() {
  const { user, wallet, refreshMe } = useApp();
  const [tab, setTab] = useState<"deposit" | "withdraw" | "history">("deposit");
  const [methods, setMethods] = useState<Method[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [depositForm, setDepositForm] = useState({ amount: "200", method: "PAPARA", bonusCode: "" });
  const [withdrawForm, setWithdrawForm] = useState({ amount: "100", method: "BANK_TRANSFER", iban: "" });

  const [deposits, setDeposits] = useState<PaymentRow[]>([]);
  const [withdrawals, setWithdrawals] = useState<PaymentRow[]>([]);

  useEffect(() => {
    if (!user) return;
    get<{ methods: Method[] }>("/api/wallet/payment-methods")
      .then((result) => {
        setMethods(result.methods);
        const first = result.methods[0];
        if (first) {
          setDepositForm((prev) => ({ ...prev, method: first.method }));
          setWithdrawForm((prev) => ({ ...prev, method: first.method }));
        }
      })
      .catch(() => undefined);
  }, [user]);

  const loadHistory = () => {
    get<{ deposits: PaymentRow[] }>("/api/wallet/deposits").then((r) => setDeposits(r.deposits)).catch(() => undefined);
    get<{ withdrawals: PaymentRow[] }>("/api/wallet/withdrawals").then((r) => setWithdrawals(r.withdrawals)).catch(() => undefined);
  };

  useEffect(() => {
    if (tab === "history") loadHistory();
  }, [tab]);

  const deposit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const result = await post<{ status: string; reference: string; instructions?: string }>("/api/wallet/deposit", depositForm);
      setNotice(
        result.instructions ?? `Yatirim ${result.status === "COMPLETED" ? "tamamlandi" : "isleme alindi"} (${result.reference})`,
      );
      await refreshMe();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Yatirim basarisiz");
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const result = await post<{ reference: string; status: string; requiresReview: boolean }>("/api/wallet/withdraw", withdrawForm);
      setNotice(
        result.requiresReview
          ? `Cekim talebiniz olusturuldu ve manuel onay bekliyor (${result.reference})`
          : `Cekim talebiniz isleme alindi (${result.reference})`,
      );
      await refreshMe();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cekim basarisiz");
    } finally {
      setBusy(false);
    }
  };

  const cancelWithdrawal = async (reference: string) => {
    try {
      await del(`/api/wallet/withdrawals/${reference}`);
      setNotice("Cekim talebi iptal edildi, fonlar serbest birakildi.");
      loadHistory();
      await refreshMe();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Iptal edilemedi");
    }
  };

  if (!user) return <div className="page"><Alert kind="info">Cuzdan icin giris yapmalisiniz.</Alert></div>;

  const currency = wallet?.currency ?? "TRY";

  return (
    <div className="page page-narrow">
      <h1 className="section-title" style={{ marginTop: 0 }}>Cuzdan</h1>

      <div className="balance-hero mb">
        <div className="row-between" style={{ flexWrap: "wrap", gap: 14 }}>
          <div>
            <div className="stat-label">Kullanilabilir bakiye</div>
            <div className="balance-amount">{money(wallet?.available, currency)}</div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-primary" onClick={() => setTab("deposit")}>Para Yatir</button>
            <button className="btn btn-ghost" onClick={() => setTab("withdraw")}>Para Cek</button>
          </div>
        </div>

        <div className="balance-split">
          <div>
            <div className="stat-label">Gercek</div>
            <div className="bold" style={{ fontSize: 17 }}>{money(wallet?.real, currency)}</div>
          </div>
          <div>
            <div className="stat-label">Bonus</div>
            <div className="bold" style={{ fontSize: 17, color: "var(--success)" }}>{money(wallet?.bonus, currency)}</div>
          </div>
          <div>
            <div className="stat-label">Demo</div>
            <div className="bold" style={{ fontSize: 17, color: "var(--accent)" }}>{money(wallet?.demo, currency)}</div>
          </div>
          <div>
            <div className="stat-label">Kilitli</div>
            <div className="bold" style={{ fontSize: 17, color: Number(wallet?.locked ?? 0) > 0 ? "var(--warning)" : undefined }}>
              {money(wallet?.locked, currency)}
            </div>
          </div>
        </div>
      </div>

      <div className="row mb" style={{ gap: 6 }}>
        {(["deposit", "withdraw", "history"] as const).map((key) => (
          <button key={key} className={`btn btn-sm ${tab === key ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab(key)}>
            {key === "deposit" ? "Para Yatir" : key === "withdraw" ? "Para Cek" : "Gecmis"}
          </button>
        ))}
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      {tab === "deposit" && (
        <div className="card">
          <form onSubmit={deposit}>
            <div className="field">
              <label>Odeme yontemi</label>
              <select className="select" value={depositForm.method} onChange={(e) => setDepositForm({ ...depositForm, method: e.target.value })}>
                {methods.map((method) => (
                  <option key={method.method} value={method.method} disabled={method.maintenanceMode}>
                    {method.displayName} (min {money(method.minAmount, currency)}){method.maintenanceMode ? " — bakimda" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Tutar ({currency})</label>
              <input className="input" type="number" min="1" value={depositForm.amount} onChange={(e) => setDepositForm({ ...depositForm, amount: e.target.value })} required />
            </div>
            <div className="field">
              <label>Bonus kodu (opsiyonel)</label>
              <input className="input" value={depositForm.bonusCode} onChange={(e) => setDepositForm({ ...depositForm, bonusCode: e.target.value.toUpperCase() })} placeholder="WELCOME100" />
            </div>
            <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>
              {busy ? "Isleniyor..." : "Yatirim Yap"}
            </button>
          </form>
        </div>
      )}

      {tab === "withdraw" && (
        <div className="card">
          <div className="alert alert-info">
            Kullanilabilir bakiye: <span className="bold">{money(wallet?.available, currency)}</span>
            {Number(wallet?.locked ?? 0) > 0 && <span className="faint"> (kilitli: {money(wallet?.locked, currency)})</span>}
          </div>
          <form onSubmit={withdraw}>
            <div className="field">
              <label>Odeme yontemi</label>
              <select className="select" value={withdrawForm.method} onChange={(e) => setWithdrawForm({ ...withdrawForm, method: e.target.value })}>
                {methods.map((method) => (
                  <option key={method.method} value={method.method} disabled={method.maintenanceMode}>
                    {method.displayName} (min {money(method.minAmount, currency)})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Tutar ({currency})</label>
              <input className="input" type="number" min="1" value={withdrawForm.amount} onChange={(e) => setWithdrawForm({ ...withdrawForm, amount: e.target.value })} required />
            </div>
            <div className="field">
              <label>IBAN / cuzdan adresi</label>
              <input className="input" value={withdrawForm.iban} onChange={(e) => setWithdrawForm({ ...withdrawForm, iban: e.target.value })} placeholder="TR00 0000 0000 0000 0000 0000 00" />
            </div>
            <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>
              {busy ? "Isleniyor..." : "Cekim Talebi Olustur"}
            </button>
          </form>
        </div>
      )}

      {tab === "history" && (
        <div className="col">
          <div className="card">
            <div className="card-title">Yatirimlar</div>
            {deposits.length === 0 ? (
              <Empty icon="📥" title="Yatirim kaydi yok" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Referans</th><th>Yontem</th><th>Tutar</th><th>Durum</th><th>Tarih</th></tr>
                  </thead>
                  <tbody>
                    {deposits.map((row) => (
                      <tr key={row.reference}>
                        <td className="mono truncate">{row.reference}</td>
                        <td>{row.method}</td>
                        <td className="mono">{money(row.amount, row.currency)}</td>
                        <td><Pill kind={statusKind(row.status)}>{row.status}</Pill></td>
                        <td className="faint small">{new Date(row.createdAt).toLocaleString("tr-TR")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-title">Cekimler</div>
            {withdrawals.length === 0 ? (
              <Empty icon="📤" title="Cekim kaydi yok" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Referans</th><th>Yontem</th><th>Tutar</th><th>Durum</th><th></th></tr>
                  </thead>
                  <tbody>
                    {withdrawals.map((row) => (
                      <tr key={row.reference}>
                        <td className="mono truncate">{row.reference}</td>
                        <td>{row.method}</td>
                        <td className="mono">{money(row.amount, row.currency)}</td>
                        <td><Pill kind={statusKind(row.status)}>{row.status}</Pill></td>
                        <td>
                          {row.status === "PENDING" && (
                            <button className="btn btn-ghost btn-sm" onClick={() => cancelWithdrawal(row.reference)}>Iptal</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function PromotionsPage() {
  const { user } = useApp();
  const [bonuses, setBonuses] = useState<
    { id: string; code: string; name: string; type: string; description?: string; percent: string | null; maxBonus: string | null; minDeposit: string | null; wageringMultiplier: string; terms?: string; claimed: boolean }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    get<{ bonuses: typeof bonuses }>("/api/lobby")
      .then((result) => setBonuses(result.bonuses as typeof bonuses))
      .catch(() => undefined);
  };

  useEffect(load, []);

  const claim = async (code: string) => {
    setError(null);
    setNotice(null);
    setBusy(code);
    try {
      const result = await post<{ amount: string; wageringRequired: string }>("/api/wallet/bonuses/claim", { code });
      setNotice(`Bonus alindi: ${result.amount} TRY (cevrim: ${result.wageringRequired} TRY)`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bonus alinamadi");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <h1 className="section-title" style={{ marginTop: 0 }}>Bonuslar ve Promosyonlar</h1>
      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      {bonuses.length === 0 ? (
        <div className="card">
          <Empty icon="🎁" title="Su anda aktif bonus yok" hint="Yeni kampanyalar eklendiginde burada gorunecek." />
        </div>
      ) : (
        <div className="grid grid-2">
          {bonuses.map((bonus) => (
            <div className="card card-hover" key={bonus.id}>
              <div className="row-between mb">
                <div>
                  <div className="bold" style={{ fontSize: 17 }}>{bonus.name}</div>
                  <div className="tiny faint mono">{bonus.code}</div>
                </div>
                {bonus.percent ? (
                  <div style={{ fontSize: 30, fontWeight: 900, color: "var(--gold)", letterSpacing: -1 }}>%{bonus.percent}</div>
                ) : (
                  <Pill kind="vip">{bonus.type}</Pill>
                )}
              </div>
              <p className="small muted mb">{bonus.description}</p>
              <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                {bonus.maxBonus && <Pill kind="info">max {money(bonus.maxBonus)}</Pill>}
                {bonus.minDeposit && <Pill kind="neutral">min {money(bonus.minDeposit)}</Pill>}
                <Pill kind="warning">{bonus.wageringMultiplier}x cevrim</Pill>
              </div>
              {bonus.terms && <div className="tiny faint mb">{bonus.terms}</div>}
              <button
                className="btn btn-primary btn-block"
                onClick={() => claim(bonus.code)}
                disabled={!user || bonus.claimed || busy === bonus.code}
              >
                {bonus.claimed ? "Zaten Alindi" : busy === bonus.code ? "Aliniyor..." : user ? "Bonusu Al" : "Giris Yapin"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
