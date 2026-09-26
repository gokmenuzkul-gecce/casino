import { GameDefinition, GameOutcome } from "./types.js";
import { SeedPair } from "@aurora/shared";
import { dice } from "./games/dice.js";
import { crash } from "./games/crash.js";
import { limbo } from "./games/limbo.js";
import { mines } from "./games/mines.js";
import { plinko } from "./games/plinko.js";
import { keno } from "./games/keno.js";
import { roulette } from "./games/roulette.js";
import { slots } from "./games/slots.js";
import { blackjack } from "./games/blackjack.js";

/** Games that resolve instantly in a single request. */
export const INSTANT_GAMES = {
  dice,
  limbo,
  mines,
  plinko,
  keno,
  roulette,
  slots,
  blackjack,
} as const;

/** Games driven by a live server loop (Socket.IO) rather than a single call. */
export const LIVE_GAMES = {
  crash,
} as const;

export type InstantGameSlug = keyof typeof INSTANT_GAMES;
export type LiveGameSlug = keyof typeof LIVE_GAMES;
export type InternalGameSlug = InstantGameSlug | LiveGameSlug;

/**
 * Games register their own param type, but the registry erases it: each
 * definition validates its input in parseParams, so the lookup layer only needs
 * the common shape. The cast is confined to this one line.
 */
export const ALL_INTERNAL_GAMES = { ...INSTANT_GAMES, ...LIVE_GAMES } as unknown as Record<
  string,
  GameDefinition<Record<string, unknown>>
>;

export function getGame(slug: string): GameDefinition<Record<string, unknown>> | undefined {
  return ALL_INTERNAL_GAMES[slug];
}

export function isInternalGame(slug: string): slug is InternalGameSlug {
  return slug in ALL_INTERNAL_GAMES;
}

export function isLiveGame(slug: string): slug is LiveGameSlug {
  return slug in LIVE_GAMES;
}

/**
 * Resolve any internal game by slug. Params are untyped at this boundary by
 * design: each definition validates its own shape in parseParams, so the cast
 * is confined here rather than leaking into callers.
 */
export function resolveGame(slug: string, seed: SeedPair, stake: bigint, rawParams: Record<string, unknown>): GameOutcome {
  const game = getGame(slug);
  if (!game) throw new Error(`Bilinmeyen oyun: ${slug}`);
  const params = game.parseParams(rawParams);
  game.validateStake(stake, params);
  return game.resolve(seed, stake, params);
}

export const GAME_CATALOG = [
  { slug: "slots", name: "Aurora Fortune", category: "SLOTS", houseEdge: 4 },
  { slug: "crash", name: "Crash", category: "CRASH", houseEdge: 1 },
  { slug: "mines", name: "Mines", category: "INSTANT", houseEdge: 1 },
  { slug: "plinko", name: "Plinko", category: "INSTANT", houseEdge: 1 },
  { slug: "dice", name: "Dice", category: "INSTANT", houseEdge: 1 },
  { slug: "limbo", name: "Limbo", category: "INSTANT", houseEdge: 1 },
  { slug: "keno", name: "Keno", category: "LOTTERY", houseEdge: 6 },
  { slug: "roulette", name: "Roulette", category: "TABLE", houseEdge: 2.7 },
  { slug: "blackjack", name: "Blackjack", category: "TABLE", houseEdge: 0.5 },
] as const;

export * from "./types.js";
export * from "./random.js";
export * from "./games/index.js";
