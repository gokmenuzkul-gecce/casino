import { GameDefinition, GameOutcome, requireEnum, round4 } from "../types.js";
import { FairRandom } from "../random.js";

export interface RouletteParams {
  bets: RouletteBet[];
  variant: "EUROPEAN" | "AMERICAN";
}

export interface RouletteBet {
  type:
    | "STRAIGHT"
    | "SPLIT"
    | "STREET"
    | "CORNER"
    | "SIX_LINE"
    | "COLUMN"
    | "DOZEN"
    | "RED"
    | "BLACK"
    | "ODD"
    | "EVEN"
    | "LOW"
    | "HIGH";
  numbers: number[];
  amount?: string;
}

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

const PAYOUTS: Record<RouletteBet["type"], number> = {
  STRAIGHT: 36,
  SPLIT: 18,
  STREET: 12,
  CORNER: 9,
  SIX_LINE: 6,
  COLUMN: 3,
  DOZEN: 3,
  RED: 2,
  BLACK: 2,
  ODD: 2,
  EVEN: 2,
  LOW: 2,
  HIGH: 2,
};

function betWins(bet: RouletteBet, spin: number): boolean {
  switch (bet.type) {
    case "STRAIGHT":
      return bet.numbers.includes(spin);
    case "SPLIT":
    case "STREET":
    case "CORNER":
    case "SIX_LINE":
      return bet.numbers.includes(spin);
    case "COLUMN": {
      const col = bet.numbers[0];
      return spin !== 0 && (spin - 1) % 3 === (col ?? 0);
    }
    case "DOZEN": {
      const dozen = bet.numbers[0];
      return spin !== 0 && Math.ceil(spin / 12) === dozen;
    }
    case "RED":
      return RED.has(spin);
    case "BLACK":
      return spin !== 0 && !RED.has(spin);
    case "ODD":
      return spin !== 0 && spin % 2 === 1;
    case "EVEN":
      return spin !== 0 && spin % 2 === 0;
    case "LOW":
      return spin >= 1 && spin <= 18;
    case "HIGH":
      return spin >= 19 && spin <= 36;
    default:
      return false;
  }
}

/**
 * Roulette. European wheel (single zero, 2.7% edge) or American (double zero,
 * 5.26% edge). Multiplier is the aggregate return across all placed bets
 * divided by the total staked, so the caller can treat it as one number.
 */
export const roulette: GameDefinition<RouletteParams> = {
  slug: "roulette",
  name: "Roulette",
  houseEdgePercent: 2.7,

  parseParams(raw) {
    const variant = raw.variant === "AMERICAN" ? "AMERICAN" : "EUROPEAN";
    const betsRaw = raw.bets;
    if (!Array.isArray(betsRaw) || betsRaw.length === 0) throw new Error("En az bir bahis gerekli");
    if (betsRaw.length > 50) throw new Error("En fazla 50 bahis konabilir");
    const bets: RouletteBet[] = betsRaw.map((b) => {
      const bet = b as RouletteBet;
      const type = requireEnum({ type: bet.type }, "type", Object.keys(PAYOUTS) as (keyof typeof PAYOUTS)[]);
      const numbers = Array.isArray(bet.numbers) ? bet.numbers.map(Number) : [];
      const max = variant === "AMERICAN" ? 37 : 36;
      if (numbers.some((n) => !Number.isInteger(n) || n < 0 || n > max)) {
        throw new Error(`Bahis numaralari 0-${max} arasinda olmali`);
      }
      return { type, numbers, amount: bet.amount };
    });
    return { bets, variant };
  },

  validateStake() {
    /* global bounds */
  },

  resolve(seed, _stake, params) {
    const rng = new FairRandom(seed);
    const max = params.variant === "AMERICAN" ? 37 : 36;
    const spin = rng.int(0, max);

    let staked = 0n;
    let returned = 0n;
    const settled = params.bets.map((bet) => {
      const amount = bet.amount ? BigInt(bet.amount) : 0n;
      staked += amount;
      const won = betWins(bet, spin);
      const payout = won ? amount * BigInt(PAYOUTS[bet.type]) : 0n;
      returned += payout;
      return { ...bet, won, payout: payout.toString() };
    });

    const multiplier = staked > 0n ? Number(returned) / Number(staked) : 0;
    return {
      multiplier: round4(multiplier),
      detail: { spin, variant: params.variant, settled, red: RED.has(spin) },
    } satisfies GameOutcome;
  },
};

export function rouletteColor(n: number): "RED" | "BLACK" | "GREEN" {
  if (n === 0 || n === 37) return "GREEN";
  return RED.has(n) ? "RED" : "BLACK";
}
