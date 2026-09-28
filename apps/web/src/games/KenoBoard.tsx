import { useState } from "react";
import { ResultBanner, StakeControl, useBet } from "./shared";
import { useApp } from "../store/app";
import { money } from "../lib/api";

const POOL = 40;
const DRAW = 10;

/** Keno: pick up to 10 numbers from 40, 10 are drawn. */
export default function KenoBoard({ slug, name }: { slug: string; name: string }) {
  const { wallet, demoMode } = useApp();
  const [amount, setAmount] = useState("10");
  const [risk, setRisk] = useState<"CLASSIC" | "LOW" | "MEDIUM" | "HIGH">("MEDIUM");
  const [picks, setPicks] = useState<number[]>([]);
  const bet = useBet();

  const drawn = (bet.last?.result?.drawn as number[] | undefined) ?? [];
  const matches = picks.filter((p) => drawn.includes(p)).length;

  const toggle = (n: number) => {
    setPicks((prev) => {
      if (prev.includes(n)) return prev.filter((p) => p !== n);
      if (prev.length >= DRAW) return prev;
      return [...prev, n];
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (picks.length === 0) return;
    await bet.place(slug, amount, { picks: picks.sort((a, b) => a - b), risk });
  };

  const quickPick = () => {
    const set = new Set<number>();
    while (set.size < 10) set.add(Math.floor(Math.random() * POOL) + 1);
    setPicks([...set].sort((a, b) => a - b));
  };

  return (
    <div className="grid grid-2" style={{ alignItems: "start" }}>
      <div className="card">
        <div className="card-title">
          {name}
          <span className="small faint">{picks.length}/{DRAW} secili</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 6 }}>
          {Array.from({ length: POOL }, (_, i) => i + 1).map((n) => {
            const selected = picks.includes(n);
            const isDrawn = drawn.includes(n);
            const hit = selected && isDrawn;
            return (
              <button
                key={n}
                onClick={() => toggle(n)}
                style={{
                  aspectRatio: "1",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 700,
                  background: hit ? "var(--success)" : isDrawn ? "rgba(34,211,238,0.25)" : selected ? "var(--primary)" : "var(--bg-elev-2)",
                  color: hit ? "#04140e" : isDrawn ? "var(--accent)" : selected ? "#fff" : "var(--text-dim)",
                  border: `1px solid ${hit ? "var(--success)" : isDrawn ? "var(--accent)" : selected ? "var(--primary)" : "var(--border)"}`,
                  transition: "all 0.1s",
                }}
              >
                {n}
              </button>
            );
          })}
        </div>

        {drawn.length > 0 && (
          <div className="center mt small">
            <span className="muted">Eslesme: </span>
            <span className="bold" style={{ color: matches > 0 ? "var(--success)" : "var(--danger)" }}>{matches}</span>
            <span className="muted"> / {picks.length}</span>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">Bet</div>
        {bet.error && <div className="alert alert-error">{bet.error}</div>}
        <ResultBanner result={bet.last} />

        <form onSubmit={submit}>
          <StakeControl amount={amount} setAmount={setAmount} disabled={bet.placing} />

          <div className="field">
            <label>Risk modu</label>
            <div className="row" style={{ gap: 5, flexWrap: "wrap" }}>
              {(["CLASSIC", "LOW", "MEDIUM", "HIGH"] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  className={`btn btn-sm ${risk === level ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setRisk(level)}
                >
                  {level === "CLASSIC" ? "Klasik" : level === "LOW" ? "Dusuk" : level === "MEDIUM" ? "Orta" : "Yuksek"}
                </button>
              ))}
            </div>
          </div>

          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-primary btn-lg" style={{ flex: 1 }} type="submit" disabled={bet.placing || picks.length === 0}>
              {bet.placing ? "Drawing..." : "🎱 Draw"}
            </button>
            <button className="btn btn-ghost btn-lg" type="button" onClick={quickPick} disabled={bet.placing}>
              🎲 Rastgele
            </button>
          </div>
        </form>

        <div className="divider" />
        <div className="row-between small">
          <span className="muted">{demoMode ? "Demo bakiye" : "Wallet"}</span>
          <span className="bold mono">{money(demoMode ? wallet?.demo : wallet?.real)}</span>
        </div>
      </div>
    </div>
  );
}
