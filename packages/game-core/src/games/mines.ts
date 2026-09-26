import { SeedPair } from "@aurora/shared";
import { GameDefinition, GameOutcome, requireNumber, round4 } from "../types.js";
import { FairRandom } from "../random.js";

export interface MinesParams {
  mines: number;
  /** Tile indices the player revealed before cashing out. */
  picks: number[];
  /** True when the player hit a mine and busted. */
  hitMine?: boolean;
}

const GRID = 25;

/** Probability of surviving k picks with m mines on a 25-tile grid. */
export function survivalProbability(mines: number, picks: number): number {
  let p = 1;
  for (let i = 0; i < picks; i++) p *= (GRID - mines - i) / (GRID - i);
  return p;
}

export const mines: GameDefinition<MinesParams> = {
  slug: "mines",
  name: "Mines",
  houseEdgePercent: 1,

  parseParams(raw) {
    const minesCount = requireNumber(raw, "mines", 1, 24);
    const picksRaw = raw.picks;
    const picks = Array.isArray(picksRaw) ? picksRaw.map((p) => Number(p)) : [];
    if (picks.some((p) => !Number.isInteger(p) || p < 0 || p >= GRID)) {
      throw new Error("'picks' 0-24 arasinda tekil kare indeksleri olmali");
    }
    if (new Set(picks).size !== picks.length) throw new Error("'picks' tekrar eden kare iceremez");
    return { mines: minesCount, picks, hitMine: raw.hitMine === true };
  },

  validateStake() {
    /* global bounds */
  },

  /**
   * The mine layout is fixed by the seed. A pick that lands on a mine busts the
   * bet; otherwise the payout follows the exact survival probability with a 1%
   * edge, so every reveal step has identical expected value.
   */
  resolve(seed, _stake, params) {
    const rng = new FairRandom(seed);
    const mineTiles = rng.sampleIndices(GRID, params.mines);
    const mineSet = new Set(mineTiles);
    const hitMine = params.picks.some((p) => mineSet.has(p));

    if (hitMine || params.hitMine) {
      return {
        multiplier: "0.0000",
        detail: { mineTiles, picks: params.picks, hitMine: true, mines: params.mines },
      } satisfies GameOutcome;
    }

    const steps = params.picks.length;
    const multiplier = steps === 0 ? "1.0000" : round4((1 - 0.01) / survivalProbability(params.mines, steps));
    return {
      multiplier,
      detail: { mineTiles, picks: params.picks, hitMine: false, mines: params.mines, steps },
    } satisfies GameOutcome;
  },
};

/** Live multiplier while the round is in progress (before cashing out). */
export function minesMultiplier(minesCount: number, revealed: number): string {
  if (revealed <= 0) return "1.0000";
  return round4((1 - 0.01) / survivalProbability(minesCount, revealed));
}
