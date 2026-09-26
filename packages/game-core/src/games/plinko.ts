import { SeedPair } from "@aurora/shared";
import { GameDefinition, GameOutcome, requireEnum, round4 } from "../types.js";
import { FairRandom } from "../random.js";

export interface PlinkoParams {
  rows: number;
  risk: "LOW" | "MEDIUM" | "HIGH";
}

/**
 * Plinko: a ball drops through `rows` rows of pegs, each step left or right
 * with 50/50 odds. The final bucket determines the payout from a risk table
 * tuned so the RTP sits just under 99%.
 */
const PAYOUTS: Record<PlinkoParams["risk"], Record<number, number[]>> = {
  LOW: {
    8: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6],
    12: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
    16: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
  },
  MEDIUM: {
    8: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
    12: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
    16: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
  },
  HIGH: {
    8: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
    12: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
    16: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000],
  },
};

export const plinko: GameDefinition<PlinkoParams> = {
  slug: "plinko",
  name: "Plinko",
  houseEdgePercent: 1,

  parseParams(raw) {
    const rows = Number(raw.rows ?? 16);
    if (![8, 12, 16].includes(rows)) throw new Error("'rows' 8, 12 veya 16 olmali");
    const risk = requireEnum(raw, "risk", ["LOW", "MEDIUM", "HIGH"] as const);
    return { rows, risk };
  },

  validateStake() {
    /* global bounds */
  },

  resolve(seed, _stake, params) {
    const rng = new FairRandom(seed);
    const path: ("L" | "R")[] = [];
    let position = 0;
    for (let i = 0; i < params.rows; i++) {
      const right = rng.chance(0.5);
      path.push(right ? "R" : "L");
      if (right) position++;
    }
    const table = PAYOUTS[params.risk][params.rows]!;
    const multiplier = table[position] ?? 0;
    return {
      multiplier: round4(multiplier),
      detail: { path: path.join(""), bucket: position, rows: params.rows, risk: params.risk },
    } satisfies GameOutcome;
  },
};

export function plinkoTable(risk: PlinkoParams["risk"], rows: number): number[] {
  return PAYOUTS[risk][rows] ?? [];
}
