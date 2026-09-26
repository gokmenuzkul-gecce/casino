import { SeedPair } from "@aurora/shared";
import { GameDefinition, GameOutcome, GameParamError, requireNumber, round4 } from "../types.js";
import { FairRandom } from "../random.js";

export interface DiceParams {
  target: number;
  direction: "OVER" | "UNDER";
}

/**
 * Dice: roll a value in [0, 100) with two decimals. Win when the roll lands
 * strictly above/below the target. Payout is the fair multiplier reduced by a
 * 1% house edge, so RTP is a constant 99% regardless of the chosen target.
 */
export const dice: GameDefinition<DiceParams> = {
  slug: "dice",
  name: "Dice",
  houseEdgePercent: 1,

  parseParams(raw) {
    const target = requireNumber(raw, "target", 2, 98);
    const direction = raw.direction === "UNDER" ? "UNDER" : raw.direction === "OVER" ? "OVER" : null;
    if (!direction) throw new GameParamError("'direction' OVER veya UNDER olmali");
    return { target, direction };
  },

  validateStake() {
    /* stake bounds are enforced globally */
  },

  resolve(seed, _stake, params) {
    const rng = new FairRandom(seed);
    const roll = Math.round(rng.range(0, 100) * 100) / 100;

    const winChance = params.direction === "OVER" ? (100 - params.target) / 100 : params.target / 100;
    const win = params.direction === "OVER" ? roll > params.target : roll < params.target;
    const multiplier = win ? round4((1 - 0.01) / winChance) : "0.0000";

    const detail = { roll: roll.toFixed(2), target: params.target, direction: params.direction, win };
    return { multiplier, detail } satisfies GameOutcome;
  },
};
