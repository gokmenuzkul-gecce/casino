import { useState } from "react";
import { post } from "../lib/api";
import { useApp } from "../store/app";

export interface BetResponse {
  betId: string;
  reference: string;
  status: string;
  stake: string;
  payout: string;
  profit: string;
  multiplier: string;
  balanceAfter: string;
  currency: string;
  result: Record<string, unknown>;
  fair: { serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: number };
}

export interface BetState {
  placing: boolean;
  error: string | null;
  last: BetResponse | null;
  place: (slug: string, amount: string, params: Record<string, unknown>) => Promise<BetResponse | null>;
  clearError: () => void;
}

/**
 * Shared betting hook for every internal game board.
 *
 * The wallet balance always comes from the server response, never from local
 * arithmetic, so concurrent games in other tabs cannot desync the display.
 */
export function useBet(onSettled?: (result: BetResponse) => void): BetState {
  const { demoMode, setWallet, refreshMe } = useApp();
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<BetResponse | null>(null);

  const place = async (slug: string, amount: string, params: Record<string, unknown>): Promise<BetResponse | null> => {
    setError(null);
    setPlacing(true);
    try {
      const path = demoMode ? "/api/games/demo/bet" : "/api/games/bet";
      const result = await post<BetResponse>(path, {
        gameSlug: slug,
        amount,
        params,
        idempotencyKey: `${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      });
      setLast(result);
      onSettled?.(result);
      await refreshMe().catch(() => undefined);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Bahis basarisiz";
      setError(message);
      return null;
    } finally {
      setPlacing(false);
    }
  };

  return { placing, error, last, place, clearError: () => setError(null) };
}

/** Standard stake control shared by all boards. */
export function StakeControl({
  amount,
  setAmount,
  disabled,
  label = "Bahis tutari",
}: {
  amount: string;
  setAmount: (value: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const presets = ["10", "25", "50", "100", "250", "500"];
  return (
    <div className="field">
      <label>{label}</label>
      <input
        className="input"
        type="number"
        min="1"
        step="1"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        disabled={disabled}
      />
      <div className="row" style={{ gap: 5, flexWrap: "wrap", marginTop: 6 }}>
        {presets.map((preset) => (
          <button key={preset} type="button" className="btn btn-ghost btn-sm" onClick={() => setAmount(preset)} disabled={disabled}>
            {preset}
          </button>
        ))}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setAmount((Number(amount) * 2).toString())}
          disabled={disabled}
        >
          2x
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAmount("10")} disabled={disabled}>
          Sifirla
        </button>
      </div>
    </div>
  );
}

export function ResultBanner({ result }: { result: BetResponse | null }) {
  if (!result) return null;
  const won = Number(result.profit) > 0;
  const pushed = Number(result.profit) === 0;
  return (
    <div className={`alert ${pushed ? "alert-info" : won ? "alert-success" : "alert-error"}`}>
      <div className="row-between">
        <span className="bold">
          {pushed ? "Berabere" : won ? "Kazandiniz!" : "Kaybettiniz"}
        </span>
        <span className="mono">
          x{result.multiplier} · {won ? "+" : ""}{result.profit}
        </span>
      </div>
    </div>
  );
}
