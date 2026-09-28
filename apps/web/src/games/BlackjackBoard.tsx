import { useState } from "react";
import { ResultBanner, StakeControl, useBet } from "./shared";
import { useApp } from "../store/app";
import { money } from "../lib/api";

interface CardView {
  rank: string;
  suit: string;
}

const SUIT_ICON: Record<string, string> = { H: "♥", D: "♦", C: "♣", S: "♠" };

/**
 * Blackjack.
 *
 * The engine deals the whole hand from the seed once the action list is
 * submitted. The player builds a basic-strategy sequence (HIT / STAND / DOUBLE)
 * against the visible dealer upcard and the round settles atomically.
 */
export default function BlackjackBoard({ slug, name }: { slug: string; name: string }) {
  const { wallet, demoMode } = useApp();
  const [amount, setAmount] = useState("10");
  const [actions, setActions] = useState<("HIT" | "STAND" | "DOUBLE")[]>([]);
  const bet = useBet();

  const detail = (bet.last?.result ?? {}) as {
    player?: CardView[];
    dealer?: CardView[];
    playerValue?: number;
    dealerValue?: number;
    natural?: boolean;
    push?: boolean;
    busted?: boolean;
    dealerBusted?: boolean;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const chosen = actions.length > 0 ? actions : ["STAND"];
    await bet.place(slug, amount, { actions: chosen });
  };

  const reset = () => {
    setActions([]);
    bet.clearError();
  };

  const addAction = (action: "HIT" | "STAND" | "DOUBLE") => {
    if (action === "STAND" || action === "DOUBLE") {
      setActions((prev) => [...prev, action]);
    } else {
      setActions((prev) => [...prev, action]);
    }
  };

  return (
    <div className="grid grid-2" style={{ alignItems: "start" }}>
      <div className="card">
        <div className="card-title">{name}</div>

        <div className="felt" style={{ marginBottom: 14 }}>
          <div className="mb">
            <div className="small" style={{ color: "rgba(255,255,255,0.65)", marginBottom: 6 }}>
              Satici {detail.dealerValue !== undefined && `(${detail.dealerValue})`}
            </div>
            <div className="row" style={{ gap: 6 }}>
              {(detail.dealer ?? [{ rank: "?", suit: "S" }, { rank: "?", suit: "S" }]).map((card, index) => (
                <PlayingCard key={index} card={card} hidden={detail.dealer === undefined && index === 1} />
              ))}
            </div>
          </div>

          <div style={{ borderTop: "1px dashed rgba(255,255,255,0.2)", paddingTop: 14 }}>
            <div className="small" style={{ color: "rgba(255,255,255,0.65)", marginBottom: 6 }}>
              Siz {detail.playerValue !== undefined && `(${detail.playerValue})`}
            </div>
            <div className="row" style={{ gap: 6 }}>
              {(detail.player ?? [{ rank: "?", suit: "S" }, { rank: "?", suit: "S" }]).map((card, index) => (
                <PlayingCard key={index} card={card} />
              ))}
            </div>
          </div>
        </div>

        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <button className="btn btn-ghost btn-sm" onClick={() => addAction("HIT")} disabled={bet.placing}>
            + Kart Cek (HIT)
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => addAction("STAND")} disabled={bet.placing}>
            Dur (STAND)
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => addAction("DOUBLE")} disabled={bet.placing}>
            2x Bahis (DOUBLE)
          </button>
          <button className="btn btn-ghost btn-sm" onClick={reset} disabled={bet.placing}>
            ↺ Temizle
          </button>
        </div>

        {actions.length > 0 && <div className="small faint mt mono">aksiyonlar: {actions.join(" → ")}</div>}
      </div>

      <div className="card">
        <div className="card-title">Bet</div>
        {bet.error && <div className="alert alert-error">{bet.error}</div>}
        <ResultBanner result={bet.last} />

        <form onSubmit={submit}>
          <StakeControl amount={amount} setAmount={setAmount} disabled={bet.placing} />
          <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={bet.placing}>
            {bet.placing ? "Dagitiliyor..." : "🃏 El Dagit"}
          </button>
          <div className="tiny faint center mt">
            Aksiyon secmezseniz satici 17'de durur kuralina gore oynanir.
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

function PlayingCard({ card, hidden }: { card: CardView; hidden?: boolean }) {
  const red = card.suit === "H" || card.suit === "D";
  if (hidden) {
    return (
      <div
        style={{
          width: 52,
          height: 74,
          borderRadius: 8,
          background: "repeating-linear-gradient(45deg, #7a0740, #7a0740 6px, #a20c25 6px, #a20c25 12px)",
          border: "2px solid rgba(255,255,255,0.2)",
        }}
      />
    );
  }
  return (
    <div
      style={{
        width: 52,
        height: 74,
        borderRadius: 8,
        background: "#f8f8fc",
        color: red ? "#dc2626" : "#111827",
        border: "2px solid rgba(255,255,255,0.3)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 900,
        fontSize: 17,
      }}
    >
      <div>{card.rank}</div>
      <div style={{ fontSize: 20 }}>{SUIT_ICON[card.suit] ?? "?"}</div>
    </div>
  );
}
