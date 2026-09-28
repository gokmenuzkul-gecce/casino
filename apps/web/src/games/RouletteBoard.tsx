import { useState } from "react";
import { ResultBanner, StakeControl, useBet } from "./shared";
import { useApp } from "../store/app";
import { money } from "../lib/api";

interface RouletteBet {
  type: string;
  numbers: number[];
  amount?: string;
}

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const BLACK = new Set([2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35]);

const OUTSIDE_BETS: { type: string; label: string; numbers: number[] }[] = [
  { type: "RED", label: "Kirmizi", numbers: [] },
  { type: "BLACK", label: "Siyah", numbers: [] },
  { type: "EVEN", label: "Cift", numbers: [] },
  { type: "ODD", label: "Tek", numbers: [] },
  { type: "LOW", label: "1-18", numbers: [] },
  { type: "HIGH", label: "19-36", numbers: [] },
  { type: "DOZEN_1", label: "1. Duzine", numbers: [] },
  { type: "DOZEN_2", label: "2. Duzine", numbers: [] },
  { type: "DOZEN_3", label: "3. Duzine", numbers: [] },
];

/**
 * European roulette with a full felt.
 *
 * Each chip placed is a separate bet object carrying its own stake; the engine
 * sums the staked amount and returns total winnings in one multiplier, so a
 * player can spread chips across the table in a single round.
 */
export default function RouletteBoard({ slug, name }: { slug: string; name: string }) {
  const { wallet, demoMode } = useApp();
  const [unit, setUnit] = useState("10");
  const [variant, setVariant] = useState<"EUROPEAN" | "AMERICAN">("EUROPEAN");
  const [placed, setPlaced] = useState<RouletteBet[]>([]);
  const bet = useBet();

  const detail = (bet.last?.result ?? {}) as { spin?: number; settled?: { type: string; numbers: number[]; won: boolean; payout: string }[]; red?: boolean };
  const spin = detail.spin;

  const max = variant === "AMERICAN" ? 37 : 36;
  const totalStake = placed.reduce((sum, b) => sum + Number(b.amount ?? 0), 0);

  const addChip = (type: string, numbers: number[] = []) => {
    setPlaced((prev) => {
      const index = prev.findIndex((b) => b.type === type && b.numbers.join(",") === numbers.join(","));
      if (index >= 0) {
        const next = [...prev];
        next[index] = { ...next[index]!, amount: (Number(next[index]!.amount ?? 0) + Number(unit)).toString() };
        return next;
      }
      return [...prev, { type, numbers, amount: unit }];
    });
  };

  const clear = () => setPlaced([]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (placed.length === 0) return;
    const result = await bet.place(slug, totalStake.toString(), { variant, bets: placed });
    if (result) setPlaced([]);
  };

  const spinColor = spin === undefined ? null : spin === 0 ? "green" : RED.has(spin) ? "red" : "black";

  return (
    <div className="grid grid-2" style={{ alignItems: "start" }}>
      <div className="card">
        <div className="card-title">
          {name}
          <button className="btn btn-ghost btn-sm" onClick={() => setVariant(variant === "EUROPEAN" ? "AMERICAN" : "EUROPEAN")}>
            {variant === "EUROPEAN" ? "Avrupa (tek sifir)" : "Amerikan (cift sifir)"}
          </button>
        </div>

        {/* winning number display */}
        <div className="center" style={{ marginBottom: 14 }}>
          <div
            style={{
              display: "inline-grid",
              placeItems: "center",
              width: 74,
              height: 74,
              borderRadius: "50%",
              fontSize: 30,
              fontWeight: 900,
              background: spinColor === "red" ? "var(--danger)" : spinColor === "black" ? "#1a1a2e" : spinColor === "green" ? "var(--success)" : "var(--bg-elev-2)",
              border: "3px solid var(--border-bright)",
            }}
          >
            {spin ?? "—"}
          </div>
        </div>

        {/* straight numbers */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(13, 1fr)", gap: 4, marginBottom: 8 }}>
          {Array.from({ length: max + 1 }, (_, n) => (
            <button
              key={n}
              onClick={() => addChip("STRAIGHT", [n])}
              style={{
                aspectRatio: "1",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 800,
                background: n === 0 ? "var(--success)" : RED.has(n) ? "var(--danger)" : "#15152a",
                color: "#fff",
                border: spin === n ? "2px solid var(--gold)" : "1px solid var(--border)",
              }}
            >
              {n}
            </button>
          ))}
        </div>

        {/* outside bets */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          {OUTSIDE_BETS.map((outside) => (
            <button key={outside.type} className="btn btn-ghost btn-sm" onClick={() => addChip(outside.type, outside.numbers)}>
              {outside.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-title">Bet</div>
        {bet.error && <div className="alert alert-error">{bet.error}</div>}
        <ResultBanner result={bet.last} />

        <form onSubmit={submit}>
          <StakeControl amount={unit} setAmount={setUnit} label="Cip degeri" disabled={bet.placing} />

          <div className="card card-tight mb" style={{ maxHeight: 180, overflowY: "auto" }}>
            {placed.length === 0 ? (
              <div className="small faint center">Masaya cip koymak icin sayilara tiklayin</div>
            ) : (
              placed.map((chip, index) => (
                <div key={index} className="row-between small" style={{ padding: "4px 0" }}>
                  <span className="muted">{chip.type}{chip.numbers.length ? ` ${chip.numbers.join(",")}` : ""}</span>
                  <span className="mono">{money(chip.amount ?? "0")}</span>
                </div>
              ))
            )}
          </div>

          <div className="row-between mb small">
            <span className="muted">Total bets</span>
            <span className="bold mono">{money(totalStake.toString())}</span>
          </div>

          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-primary btn-lg" style={{ flex: 1 }} type="submit" disabled={bet.placing || placed.length === 0}>
              {bet.placing ? "Cark donuyor..." : "🎡 Carki Cevir"}
            </button>
            <button className="btn btn-ghost btn-lg" type="button" onClick={clear} disabled={bet.placing}>
              🧹
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
