import { useState } from "react";
import { ResultBanner, StakeControl, useBet } from "./shared";
import { useApp } from "../store/app";
import { money } from "../lib/api";

export default function DiceBoard({ slug, name }: { slug: string; name: string }) {
  const { wallet, demoMode } = useApp();
  const [amount, setAmount] = useState("10");
  const [target, setTarget] = useState(50);
  const [direction, setDirection] = useState<"OVER" | "UNDER">("OVER");
  const bet = useBet();

  const winChance = direction === "OVER" ? 100 - target : target;
  const multiplier = winChance > 0 ? (99 / winChance).toFixed(4) : "0";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await bet.place(slug, amount, { target, direction });
  };

  const roll = bet.last?.result?.roll as string | undefined;
  const rollNum = roll ? Number(roll) : null;

  return (
    <div className="grid grid-2" style={{ alignItems: "start" }}>
      <div className="card">
        <div className="card-title">{name}</div>

        {/* roll track: a marker shows the last roll against the target zone */}
        <div style={{ position: "relative", height: 44, background: "var(--bg-elev-2)", borderRadius: 12, overflow: "hidden", marginBottom: 14 }}>
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: direction === "OVER" ? `${target}%` : 0,
              right: direction === "OVER" ? 0 : `${100 - target}%`,
              background: "linear-gradient(90deg, rgba(16,185,129,0.35), rgba(16,185,129,0.12))",
            }}
          />
          {rollNum !== null && (
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: `${rollNum}%`,
                width: 3,
                background: "var(--text)",
                boxShadow: "0 0 12px var(--text)",
              }}
            />
          )}
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 17, fontVariantNumeric: "tabular-nums" }}>
            {rollNum !== null ? rollNum.toFixed(2) : "—"}
          </div>
        </div>

        <div className="field">
          <label>Hedef deger: {target}</label>
          <input
            type="range"
            min="2"
            max="98"
            value={target}
            onChange={(event) => setTarget(Number(event.target.value))}
            style={{ width: "100%" }}
          />
        </div>

        <div className="row" style={{ gap: 8, marginBottom: 14 }}>
          <button
            className={`btn btn-sm ${direction === "OVER" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setDirection("OVER")}
          >
            Üstünde (OVER)
          </button>
          <button
            className={`btn btn-sm ${direction === "UNDER" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setDirection("UNDER")}
          >
            Altinda (UNDER)
          </button>
        </div>

        <div className="grid grid-2" style={{ gap: 10 }}>
          <div className="stat card-tight">
            <div className="stat-label">Win chance</div>
            <div className="stat-value" style={{ fontSize: 20 }}>%{winChance.toFixed(2)}</div>
          </div>
          <div className="stat card-tight">
            <div className="stat-label">Katsayi</div>
            <div className="stat-value" style={{ fontSize: 20, color: "var(--success)" }}>x{multiplier}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Bet</div>
        {bet.error && <div className="alert alert-error">{bet.error}</div>}
        <ResultBanner result={bet.last} />

        <form onSubmit={submit}>
          <StakeControl amount={amount} setAmount={setAmount} disabled={bet.placing} />
          <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={bet.placing}>
            {bet.placing ? "Yuvarlaniyor..." : "🎲 Zar At"}
          </button>
        </form>

        <div className="divider" />
        <div className="row-between small">
          <span className="muted">{demoMode ? "Demo bakiye" : "Wallet"}</span>
          <span className="bold mono">{money(demoMode ? wallet?.demo : wallet?.real)}</span>
        </div>
        {!demoMode && Number(wallet?.bonus ?? 0) > 0 && (
          <div className="row-between small mt">
            <span className="muted">Bonus</span>
            <span className="bold mono" style={{ color: "var(--success)" }}>{money(wallet?.bonus)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
