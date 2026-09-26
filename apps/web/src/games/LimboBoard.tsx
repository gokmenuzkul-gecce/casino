import { useState } from "react";
import { ResultBanner, StakeControl, useBet } from "./shared";
import { useApp } from "../store/app";
import { money } from "../lib/api";

export default function LimboBoard({ slug, name }: { slug: string; name: string }) {
  const { wallet, demoMode } = useApp();
  const [amount, setAmount] = useState("10");
  const [target, setTarget] = useState(2);
  const bet = useBet();

  const result = bet.last?.result?.result as string | undefined;
  const resultNum = result ? Number(result) : null;
  const won = bet.last ? Number(bet.last.profit) > 0 : false;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await bet.place(slug, amount, { targetMultiplier: target });
  };

  return (
    <div className="grid grid-2" style={{ alignItems: "start" }}>
      <div className="card">
        <div className="card-title">{name}</div>

        <div
          className="crash-stage"
          style={{ minHeight: 240, background: "radial-gradient(ellipse at 50% 100%, #0a1e2a, var(--bg-elev))" }}
        >
          <div
            className="crash-multiplier"
            style={{
              fontSize: 56,
              color: resultNum === null ? "var(--text-faint)" : won ? "var(--success)" : "var(--danger)",
            }}
          >
            {resultNum !== null ? `x${resultNum.toFixed(2)}` : "—"}
          </div>
          <div className="crash-status muted">Hedef: x{target.toFixed(2)}</div>
        </div>

        <div className="field mt">
          <label>Hedef katsayi: x{target.toFixed(2)}</label>
          <input
            type="range"
            min="1.01"
            max="100"
            step="0.01"
            value={target}
            onChange={(event) => setTarget(Number(event.target.value))}
            style={{ width: "100%" }}
          />
        </div>

        <div className="stat card-tight">
          <div className="stat-label">Kazanma sansi</div>
          <div className="stat-value" style={{ fontSize: 20 }}>%{(99 / target).toFixed(4)}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Bahis</div>
        {bet.error && <div className="alert alert-error">{bet.error}</div>}
        <ResultBanner result={bet.last} />

        <form onSubmit={submit}>
          <StakeControl amount={amount} setAmount={setAmount} disabled={bet.placing} />
          <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={bet.placing}>
            {bet.placing ? "Hesaplaniyor..." : "🚀 Limbo Calistir"}
          </button>
        </form>

        <div className="divider" />
        <div className="row-between small">
          <span className="muted">{demoMode ? "Demo bakiye" : "Cuzdan"}</span>
          <span className="bold mono">{money(demoMode ? wallet?.demo : wallet?.real)}</span>
        </div>
      </div>
    </div>
  );
}
