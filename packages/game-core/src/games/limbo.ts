import { GameDefinition, GameOutcome, requireNumber, round4 } from "../types.js";
import { FairRandom } from "../random.js";

export interface LimboParams {
  targetMultiplier: number;
}

/**
 * Limbo: choose a target multiplier. Win probability is exactly
 * (1 - edge) / target, so expected value is constant for every target.
 * result = 0.99 / u, win when result >= target.
 */
export const limbo: GameDefinition<LimboParams> = {
  slug: "limbo",
  name: "Limbo",
  houseEdgePercent: 1,

  parseParams(raw) {
    return { targetMultiplier: requireNumber(raw, "targetMultiplier", 1.01, 1000000) };
  },

  validateStake() {
    /* global bounds */
  },

  resolve(seed, _stake, params) {
    const rng = new FairRandom(seed);
    const u = rng.next();
    // The 0.99 numerator carries the house edge: scaling by 99 instead would
    // make every target below 99 a guaranteed win.
    const result = 0.99 / Math.max(u, 1e-12);
    const win = result >= params.targetMultiplier;
    return {
      multiplier: win ? round4(params.targetMultiplier) : "0.0000",
      detail: {
        result: result.toFixed(4),
        targetMultiplier: params.targetMultiplier,
        win,
        winChance: round4(99 / params.targetMultiplier),
      },
    } satisfies GameOutcome;
  },
};
