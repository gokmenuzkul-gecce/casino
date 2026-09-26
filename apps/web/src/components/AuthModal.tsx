import { useEffect, useState } from "react";
import { Modal, Alert } from "./ui";
import { useApp } from "../store/app";
import { reconnectSocket } from "../lib/socket";

export function AuthModal({
  open,
  onClose,
  initialMode = "login",
}: {
  open: boolean;
  onClose: () => void;
  initialMode?: "login" | "register";
}) {
  const { login, register, loading } = useApp();
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [error, setError] = useState<string | null>(null);
  const [needsTotp, setNeedsTotp] = useState(false);
  const [form, setForm] = useState({
    identifier: "",
    password: "",
    totp: "",
    email: "",
    username: "",
    phone: "",
    referralCode: "",
  });

  // The header can open this modal directly on the register tab.
  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setError(null);
    }
  }, [open, initialMode]);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      if (mode === "login") {
        const result = await login(form.identifier, form.password, needsTotp ? form.totp : undefined);
        if (result.requiresTwoFactor) {
          setNeedsTotp(true);
          setError("Iki adimli dogrulama kodunu girin.");
          return;
        }
        reconnectSocket();
        onClose();
      } else {
        await register({
          email: form.email,
          username: form.username,
          password: form.password,
          phone: form.phone || undefined,
          referralCode: form.referralCode || undefined,
        });
        reconnectSocket();
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Islem basarisiz");
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === "login" ? "Giris Yap" : "Kayit Ol"}
      subtitle={mode === "login" ? "Hesabiniza giris yapin" : "Saniyeler icinde hesap olusturun"}
    >
      {error && <Alert kind={needsTotp ? "info" : "error"}>{error}</Alert>}

      <form onSubmit={submit}>
        {mode === "login" ? (
          <>
            <div className="field">
              <label>E-posta veya kullanici adi</label>
              <input className="input" value={form.identifier} onChange={set("identifier")} autoComplete="username" required />
            </div>
            <div className="field">
              <label>Sifre</label>
              <input className="input" type="password" value={form.password} onChange={set("password")} autoComplete="current-password" required />
            </div>
            {needsTotp && (
              <div className="field">
                <label>2FA kodu</label>
                <input className="input" value={form.totp} onChange={set("totp")} inputMode="numeric" placeholder="000000" />
              </div>
            )}
          </>
        ) : (
          <>
            <div className="field">
              <label>E-posta</label>
              <input className="input" type="email" value={form.email} onChange={set("email")} required />
            </div>
            <div className="field">
              <label>Kullanici adi</label>
              <input className="input" value={form.username} onChange={set("username")} required minLength={3} />
            </div>
            <div className="field">
              <label>Sifre</label>
              <input className="input" type="password" value={form.password} onChange={set("password")} required minLength={8} />
              <span className="tiny faint">En az 8 karakter, buyuk harf ve rakam icermeli.</span>
            </div>
            <div className="field">
              <label>Telefon (opsiyonel)</label>
              <input className="input" value={form.phone} onChange={set("phone")} />
            </div>
            <div className="field">
              <label>Davet kodu (opsiyonel)</label>
              <input className="input" value={form.referralCode} onChange={set("referralCode")} />
            </div>
          </>
        )}

        <button className="btn btn-primary btn-block btn-lg mt" type="submit" disabled={loading}>
          {loading ? "Isleniyor..." : mode === "login" ? "Giris Yap" : "Kayit Ol"}
        </button>
      </form>

      <div className="center mt small muted">
        {mode === "login" ? (
          <>
            Hesabiniz yok mu?{" "}
            <button className="bold" style={{ color: "var(--primary-bright)" }} onClick={() => { setMode("register"); setError(null); }}>
              Kayit olun
            </button>
          </>
        ) : (
          <>
            Zaten hesabiniz var mi?{" "}
            <button className="bold" style={{ color: "var(--primary-bright)" }} onClick={() => { setMode("login"); setError(null); }}>
              Giris yapin
            </button>
          </>
        )}
      </div>

      <div className="center tiny faint mt">
        18 yasindan buyuk oldugunuzu ve kullanim sartlarini kabul ettiginizi onaylarsiniz.
      </div>
    </Modal>
  );
}
