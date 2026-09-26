import { SeedPair } from "@aurora/shared";
import { GameDefinition, GameOutcome, requireEnum, requireNumber, round4 } from "../types.js";
import { FairRandom } from "../random.js";

export interface KenoParams {
  picks: number[];
  risk: "CLASSIC" | "LOW" | "MEDIUM" | "HIGH";
}

const POOL = 40;
const DRAW = 10;

/**
 * Keno: pick up to 10 numbers from 1-40, then 10 are drawn. Payouts follow a
 * standard keno paytable; RTP lands in the 92-96% band depending on risk.
 */
const PAYTABLES: Record<KenoParams["risk"], Record<number, number[]>> = {
  CLASSIC: {
    1: [0, 3.6],
    2: [0, 1.9, 5],
    3: [0, 1.4, 2.8, 16],
    4: [0, 0, 2, 7, 30],
    5: [0, 0, 1.5, 4, 15, 60],
    6: [0, 0, 0, 2.5, 8, 25, 100],
    7: [0, 0, 0, 1.5, 5, 15, 50, 200],
    8: [0, 0, 0, 1, 3, 10, 30, 100, 500],
    9: [0, 0, 0, 0.5, 2.5, 8, 20, 60, 200, 1000],
    10: [0, 0, 0, 0, 2, 6, 15, 40, 120, 400, 2000],
  },
  LOW: {
    1: [0, 3.2],
    2: [0, 1.8, 4.5],
    3: [0, 1.3, 2.6, 15],
    4: [0, 0, 1.9, 6.5, 28],
    5: [0, 0, 1.4, 3.8, 14, 55],
    6: [0, 0, 0, 2.4, 7.5, 24, 95],
    7: [0, 0, 0, 1.4, 4.8, 14, 48, 190],
    8: [0, 0, 0, 0.9, 2.9, 9.5, 29, 95, 480],
    9: [0, 0, 0, 0.4, 2.4, 7.5, 19, 58, 190, 950],
    10: [0, 0, 0, 0, 1.9, 5.8, 14, 38, 115, 380, 1900],
  },
  MEDIUM: {
    1: [0, 4],
    2: [0, 2.1, 5.6],
    3: [0, 1.5, 3.1, 18],
    4: [0, 0, 2.2, 7.8, 34],
    5: [0, 0, 1.6, 4.4, 17, 68],
    6: [0, 0, 0, 2.8, 8.8, 28, 110],
    7: [0, 0, 0, 1.7, 5.6, 17, 56, 220],
    8: [0, 0, 0, 1.1, 3.4, 11, 34, 110, 550],
    9: [0, 0, 0, 0.6, 2.8, 8.8, 22, 68, 220, 1100],
    10: [0, 0, 0, 0, 2.3, 6.8, 16, 44, 130, 440, 2200],
  },
  HIGH: {
    1: [0, 5],
    2: [0, 2.5, 7],
    3: [0, 1.8, 3.8, 22],
    4: [0, 0, 2.7, 9.5, 42],
    5: [0, 0, 2, 5.5, 21, 85],
    6: [0, 0, 0, 3.4, 11, 35, 140],
    7: [0, 0, 0, 2.1, 7, 21, 70, 280],
    8: [0, 0, 0, 1.4, 4.2, 14, 42, 140, 700],
    9: [0, 0, 0, 0.8, 3.5, 11, 28, 85, 280, 1400],
    10: [0, 0, 0, 0, 2.9, 8.5, 20, 55, 165, 550, 2800],
  },
};

export const keno: GameDefinition<KenoParams> = {
  slug: "keno",
  name: "Keno",
  houseEdgePercent: 6,

  parseParams(raw) {
    const picksRaw = raw.picks;
    if (!Array.isArray(picksRaw) || picksRaw.length < 1 || picksRaw.length > DRAW) {
      throw new Error("'picks' 1 ile 10 arasinda sayi icermeli");
    }
    const picks = picksRaw.map((p) => Number(p));
    if (picks.some((p) => !Number.isInteger(p) || p < 1 || p > POOL)) {
      throw new Error(`'picks' 1-${POOL} arasinda olmali`);
    }
    if (new Set(picks).size !== picks.length) throw new Error("'picks' tekrar eden sayi iceremez");
    const risk = requireEnum(raw, "risk", ["CLASSIC", "LOW", "MEDIUM", "HIGH"] as const);
    return { picks: picks.sort((a, b) => a - b), risk };
  },

  validateStake() {
    /* global bounds */
  },

  resolve(seed, _stake, params) {
    const rng = new FairRandom(seed);
    const pool = Array.from({ length: POOL }, (_, i) => i + 1);
    const drawn = rng.shuffle(pool).slice(0, DRAW).sort((a, b) => a - b);
    const drawnSet = new Set(drawn);
    const hits = params.picks.filter((p) => drawnSet.has(p)).length;
    const table = PAYTABLES[params.risk][params.picks.length]!;
    const multiplier = table[hits] ?? 0;
    return {
      multiplier: round4(multiplier),
      detail: { drawn, picks: params.picks, hits, risk: params.risk },
    } satisfies GameOutcome;
  },
};

export function kenoTable(risk: KenoParams["risk"], picks: number): number[] {
  return PAYTABLES[risk][picks] ?? [];
}

export function kenoExpectedRtp(risk: KenoParams["risk"], picks: number): number {
  const table = PAYTABLES[risk][picks];
  if (!table) return 0;
  const n = picks;
  let rtp = 0;
  const comb = (a: number, b: number): number => {
    if (b < 0 || b > a) return 0;
    let r = 1;
    for (let i = 0; i < b; i++) r = (r * (a - i)) / (i + 1);
    return r;
  };
  for (let h = 0; h <= n; h++) {
    const p = (comb(n, h) * comb(POOL - n, DRAW - h)) / comb(POOL, DRAW);
    rtp += p * (table[h] ?? 0);
  }
  return rtp;
}
