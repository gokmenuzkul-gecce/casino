import { SeedPair } from "@aurora/shared";

/** A single bet's outcome, produced purely from the seed pair (deterministic). */
export interface GameOutcome {
  /** Total multiplier applied to the stake (0 = loss, 1 = push, >1 = win). */
  multiplier: string;
  /** Human-readable outcome detail stored on the bet record. */
  detail: Record<string, unknown>;
  /** Set when the game has more steps the player must act on (e.g. Mines). */
  state?: Record<string, unknown>;
}

export interface GameDefinition<P = Record<string, unknown>> {
  slug: string;
  name: string;
  /** Validates and normalises raw params coming from the client. */
  parseParams(raw: Record<string, unknown>): P;
  /** Validates a stake against the game's own rules. */
  validateStake(stake: bigint, params: P): void;
  /** Deterministic resolution from seeds. */
  resolve(seed: SeedPair, stake: bigint, params: P): GameOutcome;
  /** House edge as a percentage, informational. */
  houseEdgePercent: number;
}

export class GameParamError extends Error {}

export function requireNumber(raw: Record<string, unknown>, key: string, min: number, max: number): number {
  const value = raw[key];
  const num = typeof value === "string" ? Number(value) : value;
  if (typeof num !== "number" || !Number.isFinite(num)) {
    throw new GameParamError(`'${key}' sayisal bir deger olmali`);
  }
  if (num < min || num > max) throw new GameParamError(`'${key}' ${min} ile ${max} arasinda olmali`);
  return num;
}

export function optionalNumber(raw: Record<string, unknown>, key: string, fallback: number): number {
  const value = raw[key];
  if (value === undefined || value === null || value === "") return fallback;
  const num = typeof value === "string" ? Number(value) : value;
  if (typeof num !== "number" || !Number.isFinite(num)) throw new GameParamError(`'${key}' sayisal bir deger olmali`);
  return num;
}

export function requireEnum<T extends string>(raw: Record<string, unknown>, key: string, allowed: readonly T[]): T {
  const value = raw[key];
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new GameParamError(`'${key}' su degerlerden biri olmali: ${allowed.join(", ")}`);
  }
  return value as T;
}

/** House-edge-aware rounding: keeps multipliers to 4 decimals. */
export function round4(value: number): string {
  return (Math.round(value * 10000) / 10000).toFixed(4);
}
