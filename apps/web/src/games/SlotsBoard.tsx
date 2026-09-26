import { useState } from "react";
import { ResultBanner, StakeControl, useBet } from "./shared";
import { useApp } from "../store/app";
import { money } from "../lib/api";

const SYMBOLS = ["🍒", "🍋", "🔔", "⭐", "💎", "7️⃣", "🍀"];

/**
 * 5-reel slot.
 *
 * The engine resolves the whole spin from the seed and returns a 5x3 grid plus
 * the winning lines. The reels animate to the returned grid, then the line
 * results are highlighted, so what the player sees is what was actually drawn.
 */
export default function SlotsBoard({ slug, name }: { slug: string; name: string }) {
  const { wallet, demoMode } = useApp();
  const [amount, setAmount] = useState("10");
  const [lines, setLines] = useState(20);
  const bet = useBet();
  const [animating, setAnimating] = useState(false);

  // Default display grid before the first spin.
  const [display, setDisplay] = useState<string[][]>([
    ["🍒", "🍋", "🔔", "⭐", "💎"],
    ["🍒", "🍋", "🔔", "⭐", "💎"],
    ["🍒", "🍋", "🔔", "⭐", "💎"],
  ]);

  const detail = (bet.last?.result ?? {}) as {
    grid?: string[][];
    lines?: { line: number; symbols: string[]; payout: number }[];
    totalPayout?: number;
  };

  const spin = async (event: React.FormEvent) => {
    event.preventDefault();
    setAnimating(true);
    const result = await bet.place(slug, amount, { lines, betPerLine: 1 });
    if (result) {
      const grid = result.result?.grid as string[][] | undefined;
      // Brief reel blur, then snap to the server's grid.
      setTimeout(() => {
        if (grid) setDisplay(grid);
        setAnimating(false);
      }, 600);
    } else {
      setAnimating(false);
    }
  };

  return (
    <div className="grid grid-2" style={{ alignItems: "start" }}>
      <div className="card">
        <div className="card-title">{name}</div>

        <div style={{ background: "var(--bg-elev-2)", borderRadius: 14, padding: 14, border: "1px solid var(--border)" }}>
          {display.map((row, rowIndex) => (
            <div key={rowIndex} className="row" style={{ gap: 8, justifyContent: "center", marginBottom: 8 }}>
              {row.map((symbol, reelIndex) => {
                // Highlight cells that belong to a winning line.
                const winning =
                  !animating &&
                  (detail.lines ?? []).some((line) => line.symbols[reelIndex] === symbol && line.payout > 0);
                return (
                  <div
                    key={reelIndex}
                    style={{
                      width: 66,
                      height: 66,
                      borderRadius: 11,
                      display: "grid",
                      placeItems: "center",
                      fontSize: 32,
                      background: winning ? "rgba(251,191,36,0.22)" : "var(--bg-elev-3)",
                      border: `1.5px solid ${winning ? "var(--gold)" : "var(--border)"}`,
                      filter: animating ? "blur(4px)" : "none",
                      transition: "filter 0.15s, border-color 0.2s, background 0.2s",
                    }}
                  >
                    {symbol}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {detail.lines && detail.lines.length > 0 && (
          <div className="mt">
            <div className="small bold mb">Kazanan cizgiler</div>
            {detail.lines.map((line) => (
              <div key={line.line} className="row-between small" style={{ padding: "3px 0" }}>
                <span className="muted">Cizgi #{line.line}</span>
                <span className="mono">{line.symbols.join(" ")}</span>
                <span className="bold" style={{ color: "var(--success)" }}>{line.payout}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">Bahis</div>
        {bet.error && <div className="alert alert-error">{bet.error}</div>}
        <ResultBanner result={bet.last} />

        <form onSubmit={spin}>
          <StakeControl amount={amount} setAmount={setAmount} disabled={bet.placing || animating} />

          <div className="field">
            <label>Odeme cizgisi sayisi: {lines}</label>
            <input
              type="range"
              min="1"
              max="25"
              value={lines}
              onChange={(event) => setLines(Number(event.target.value))}
              disabled={bet.placing || animating}
              style={{ width: "100%" }}
            />
          </div>

          <div className="row-between small mb">
            <span className="muted">Toplam bahis</span>
            <span className="bold mono">{money(amount)}</span>
          </div>

          <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={bet.placing || animating}>
            {animating ? "Makaralar donuyor..." : "🎰 Spin"}
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

export { SYMBOLS };
