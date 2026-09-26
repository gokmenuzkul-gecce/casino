import { useState } from "react";
import { ResultBanner, StakeControl, useBet } from "./shared";
import { useApp } from "../store/app";
import { money } from "../lib/api";

const GRID = 25;

/**
 * Mines.
 *
 * The engine resolves a whole round from one seed, so the player builds a
 * selection of tiles first and submits once. The multiplier preview uses the
 * same survival-probability formula as the server, so the number shown before
 * the bet is the number that settles.
 */
export default function MinesBoard({ slug, name }: { slug: string; name: string }) {
  const { wallet, demoMode } = useApp();
  const [amount, setAmount] = useState("10");
  const [mines, setMines] = useState(3);
  const [picks, setPicks] = useState<number[]>([]);
  const bet = useBet();

  const maxPicks = GRID - mines;
  const multiplier = picks.length === 0 ? 1 : survival(GRID, mines, picks.length);
  const payout = (Number(amount) * multiplier).toFixed(2);

  const detail = (bet.last?.result ?? {}) as { hitMine?: boolean; mineTiles?: number[]; picks?: number[] };
  const revealedMines = detail.mineTiles ?? [];
  const revealedPicks = detail.picks ?? [];
  const settled = bet.last !== null;

  const toggle = (index: number) => {
    setPicks((prev) => {
      if (prev.includes(index)) return prev.filter((p) => p !== index);
      if (prev.length >= maxPicks) return prev;
      return [...prev, index];
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await bet.place(slug, amount, { mines, picks });
    if (!result) return;
    setPicks([]);
  };

  const reset = () => {
    setPicks([]);
    setMines(3);
    bet.clearError();
  };

  return (
    <div className="grid grid-2" style={{ alignItems: "start" }}>
      <div className="card">
        <div className="card-title">
          {name}
          <span className="small faint">{picks.length}/{maxPicks} secili</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, maxWidth: 440 }}>
          {Array.from({ length: GRID }, (_, index) => {
            const wasRevealed = settled && revealedPicks.includes(index);
            const isMine = settled && revealedMines.includes(index);
            const selected = picks.includes(index);
            return (
              <button
                key={index}
                onClick={() => (settled ? undefined : toggle(index))}
                disabled={settled}
                style={{
                  aspectRatio: "1",
                  borderRadius: 11,
                  background: isMine
                    ? "rgba(244,63,94,0.32)"
                    : wasRevealed
                      ? "rgba(16,185,129,0.28)"
                      : selected
                        ? "rgba(124,58,237,0.3)"
                        : "var(--bg-elev-2)",
                  border: `1.5px solid ${
                    isMine ? "var(--danger)" : wasRevealed ? "var(--success)" : selected ? "var(--primary)" : "var(--border)"
                  }`,
                  fontSize: 21,
                  transition: "all 0.12s",
                }}
              >
                {isMine ? "💣" : wasRevealed ? "💎" : ""}
              </button>
            );
          })}
        </div>

        <div className="grid grid-2 mt" style={{ gap: 10 }}>
          <div className="stat card-tight">
            <div className="stat-label">Katsayi</div>
            <div className="stat-value" style={{ fontSize: 20, color: "var(--success)" }}>x{multiplier.toFixed(4)}</div>
          </div>
          <div className="stat card-tight">
            <div className="stat-label">Potansiyel odeme</div>
            <div className="stat-value" style={{ fontSize: 20 }}>{money(payout)}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Bahis</div>
        {bet.error && <div className="alert alert-error">{bet.error}</div>}
        <ResultBanner result={bet.last} />

        <form onSubmit={submit}>
          <StakeControl amount={amount} setAmount={setAmount} disabled={bet.placing} />

          <div className="field">
            <label>Mayin sayisi: {mines}</label>
            <input
              type="range"
              min="1"
              max="24"
              value={mines}
              onChange={(event) => {
                setMines(Number(event.target.value));
                setPicks([]);
              }}
              disabled={bet.placing}
              style={{ width: "100%" }}
            />
          </div>

          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-primary btn-lg" style={{ flex: 1 }} type="submit" disabled={bet.placing || picks.length === 0}>
              {bet.placing ? "Oynaniyor..." : `💣 ${picks.length} Kare Sec`}
            </button>
            <button className="btn btn-ghost btn-lg" type="button" onClick={reset} disabled={bet.placing}>
              ↺
            </button>
          </div>
          {picks.length === 0 && <div className="tiny faint center mt">Once kareleri secin, sonra bahsi gonderin</div>}
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

/** Hypergeometric survival probability, inverted with the 1% house edge. */
function survival(total: number, mines: number, picks: number): number {
  let probability = 1;
  for (let i = 0; i < picks; i++) {
    probability *= (total - mines - i) / (total - i);
  }
  if (probability <= 0) return 0;
  return 0.99 / probability;
}
