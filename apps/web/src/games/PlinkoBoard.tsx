import { useState } from "react";
import { ResultBanner, StakeControl, useBet } from "./shared";
import { useApp } from "../store/app";
import { money } from "../lib/api";

const ROWS = 12;
const BUCKETS = 13;

/** Plinko: a ball drops through pegs into a multiplier bucket. */
export default function PlinkoBoard({ slug, name }: { slug: string; name: string }) {
  const { wallet, demoMode } = useApp();
  const [amount, setAmount] = useState("10");
  const [risk, setRisk] = useState<"LOW" | "MEDIUM" | "HIGH">("MEDIUM");
  const [ballPath, setBallPath] = useState<string | null>(null);
  const bet = useBet();

  const payouts = PAYOUTS[risk];
  const lastBucket = bet.last?.result?.bucket as number | undefined;

  const drop = async (event: React.FormEvent) => {
    event.preventDefault();
    setBallPath(null);
    const result = await bet.place(slug, amount, { risk, rows: ROWS });
    if (result) {
      const path = (result.result?.path as string | undefined) ?? "";
      setBallPath(path);
    }
  };

  return (
    <div className="grid grid-2" style={{ alignItems: "start" }}>
      <div className="card">
        <div className="card-title">{name}</div>

        {/* peg board rendered as rows of triangles converging to buckets */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "10px 0" }}>
          {Array.from({ length: ROWS }, (_, row) => (
            <div key={row} className="row" style={{ gap: 14, justifyContent: "center" }}>
              {Array.from({ length: row + 3 }, (_, peg) => (
                <div
                  key={peg}
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "var(--border-bright)",
                    opacity: 0.8,
                  }}
                />
              ))}
            </div>
          ))}
        </div>

        <div className="row" style={{ gap: 4, justifyContent: "center", flexWrap: "wrap", marginTop: 12 }}>
          {payouts.map((payout, index) => (
            <div
              key={index}
              style={{
                padding: "6px 9px",
                borderRadius: 7,
                fontSize: 11.5,
                fontWeight: 800,
                background: lastBucket === index ? "var(--primary)" : bucketColor(payout),
                color: payout >= 1 ? "#04140e" : "#fff",
                minWidth: 46,
                textAlign: "center",
                transition: "transform 0.2s",
                transform: lastBucket === index ? "scale(1.2)" : "scale(1)",
              }}
            >
              x{payout}
            </div>
          ))}
        </div>

        {ballPath && (
          <div className="center small faint mt mono">yol: {ballPath.split("").join(" → ")}</div>
        )}
      </div>

      <div className="card">
        <div className="card-title">Bet</div>
        {bet.error && <div className="alert alert-error">{bet.error}</div>}
        <ResultBanner result={bet.last} />

        <form onSubmit={drop}>
          <StakeControl amount={amount} setAmount={setAmount} disabled={bet.placing} />
          <div className="field">
            <label>Risk seviyesi</label>
            <div className="row" style={{ gap: 6 }}>
              {(["LOW", "MEDIUM", "HIGH"] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  className={`btn btn-sm ${risk === level ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setRisk(level)}
                >
                  {level === "LOW" ? "Dusuk" : level === "MEDIUM" ? "Orta" : "Yuksek"}
                </button>
              ))}
            </div>
          </div>
          <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={bet.placing}>
            {bet.placing ? "Top dusuyor..." : "🎯 Topu Birak"}
          </button>
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

const PAYOUTS: Record<"LOW" | "MEDIUM" | "HIGH", number[]> = {
  LOW: [3, 1.6, 1.4, 1.1, 1, 0.5, 0.3, 0.5, 1, 1.1, 1.4, 1.6, 3],
  MEDIUM: [13, 3, 1.3, 0.7, 0.4, 0.2, 0.2, 0.2, 0.4, 0.7, 1.3, 3, 13],
  HIGH: [76, 9, 2, 0.6, 0.2, 0.2, 0.2, 0.2, 0.2, 0.6, 2, 9, 76],
};

function bucketColor(payout: number): string {
  if (payout >= 10) return "var(--danger)";
  if (payout >= 3) return "var(--warning)";
  if (payout >= 1) return "var(--success)";
  return "var(--bg-elev-3)";
}
