import { SeedPair } from "@aurora/shared";
import { GameDefinition, GameOutcome, requireNumber, round4 } from "../types.js";
import { FairRandom } from "../random.js";

export interface CrashParams {
  /** Multiplier the player wants to auto-cash-out at. 0 = manual. */
  autoCashout: number;
}

export const CRASH_HOUSE_EDGE = 0.01;

/**
 * Crash: a multiplier rises over time until it busts. Survival function is
 * P(crash >= m) = (1 - edge) / m, so the house edge is a flat 1% and the
 * distribution is verifiable: crash = max(1, floor(99 / u) / 100).
 */
export function crashPointFromSeed(seed: SeedPair): string {
  const rng = new FairRandom(seed);
  const u = rng.next();
  const raw = 99 / Math.max(u, 1e-12);
  const crash = Math.max(1, Math.floor(raw) / 100);
  return crash.toFixed(2);
}

/** Multiplier at a given elapsed time, doubling roughly every 10 seconds. */
export function multiplierAt(elapsedMs: number): number {
  return Math.exp(0.0000693 * elapsedMs);
}

export const crash: GameDefinition<CrashParams> = {
  slug: "crash",
  name: "Crash",
  houseEdgePercent: 1,

  parseParams(raw) {
    const autoCashout = raw.autoCashout === undefined ? 0 : requireNumber(raw, "autoCashout", 0, 1000000);
    return { autoCashout };
  },

  validateStake() {
    /* handled by the round manager */
  },

  resolve(seed, _stake, params) {
    const crashPoint = crashPointFromSeed(seed);
    const point = Number(crashPoint);
    const cashed = params.autoCashout > 0 && params.autoCashout <= point;
    const multiplier = cashed ? round4(params.autoCashout) : "0.0000";
    return {
      multiplier,
      detail: { crashPoint, autoCashout: params.autoCashout, cashedOut: cashed },
    } satisfies GameOutcome;
  },
};
