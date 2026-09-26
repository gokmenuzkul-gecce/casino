import { describe, expect, it } from "vitest";
import { createSeedPair, applyMultiplier } from "@aurora/shared";
import { resolveGame, GAME_CATALOG, INSTANT_GAMES } from "./index.js";

const STAKE = 10_000n; // 100.00 in minor units

/** Build a distinct-but-reproducible seed for each trial index. */
function seedFor(i: number) {
  return createSeedPair(`trial-${i}`);
}

describe("game determinism", () => {
  it("replays the same outcome for the same seed and params", () => {
    const params: Record<string, Record<string, unknown>> = {
      dice: { target: 50, direction: "OVER" },
      limbo: { targetMultiplier: 2 },
      mines: { mines: 3, picks: [0, 1, 2] },
      plinko: { rows: 12, risk: "MEDIUM" },
      keno: { picks: [1, 2, 3, 4, 5], risk: "MEDIUM" },
      roulette: { bets: [{ type: "RED", amount: 100 }] },
      slots: { lines: 10 },
      blackjack: { actions: ["STAND"] },
    };

    for (const [slug, raw] of Object.entries(params)) {
      const seed = seedFor(7);
      const first = resolveGame(slug, seed, STAKE, raw);
      const second = resolveGame(slug, seed, STAKE, raw);
      expect(second, `${slug} should be deterministic`).toEqual(first);
    }
  });

  it("never returns a negative or malformed multiplier", () => {
    for (const slug of Object.keys(INSTANT_GAMES)) {
      const raw: Record<string, unknown> =
        slug === "dice"
          ? { target: 50, direction: "OVER" }
          : slug === "limbo"
            ? { targetMultiplier: 2 }
            : slug === "mines"
              ? { mines: 3, picks: [] }
              : slug === "plinko"
                ? { rows: 12, risk: "MEDIUM" }
                : slug === "keno"
                  ? { picks: [1, 2, 3], risk: "MEDIUM" }
                  : slug === "roulette"
                    ? { bets: [{ type: "RED", amount: 100 }] }
                    : slug === "slots"
                      ? { lines: 10 }
                      : { actions: ["STAND"] };

      for (let i = 0; i < 50; i++) {
        const outcome = resolveGame(slug, seedFor(i), STAKE, raw);
        const multiplier = Number(outcome.multiplier);
        expect(Number.isFinite(multiplier), `${slug} multiplier finite`).toBe(true);
        expect(multiplier, `${slug} multiplier >= 0`).toBeGreaterThanOrEqual(0);
        expect(outcome.detail, `${slug} has detail`).toBeTypeOf("object");
      }
    }
  });

  it("keeps dice RTP near the advertised 99%", () => {
    const trials = 20_000;
    let returned = 0n;
    for (let i = 0; i < trials; i++) {
      const outcome = resolveGame("dice", seedFor(i), STAKE, { target: 50, direction: "OVER" });
      returned += applyMultiplier(STAKE, outcome.multiplier, "TRY");
    }
    const rtp = Number(returned) / Number(STAKE * BigInt(trials));
    // 99% expected; allow a wide band because the sample is finite.
    expect(rtp).toBeGreaterThan(0.96);
    expect(rtp).toBeLessThan(1.02);
  });

  it("keeps limbo RTP near the advertised 99%", () => {
    const trials = 20_000;
    let returned = 0n;
    for (let i = 0; i < trials; i++) {
      const outcome = resolveGame("limbo", seedFor(i), STAKE, { targetMultiplier: 2 });
      returned += applyMultiplier(STAKE, outcome.multiplier, "TRY");
    }
    const rtp = Number(returned) / Number(STAKE * BigInt(trials));
    expect(rtp).toBeGreaterThan(0.9);
    expect(rtp).toBeLessThan(1.05);
  });

  it("pays limbo targets below 99 at the correct rate, not a guaranteed win", () => {
    // A 1.01x target must win ~98% of the time, not 100%: the old `99 / u`
    // formula returned >= 99 for every float, making every target under 99 a
    // certain win.
    let wins = 0;
    const trials = 5_000;
    for (let i = 0; i < trials; i++) {
      const outcome = resolveGame("limbo", seedFor(i), STAKE, { targetMultiplier: 1.01 });
      if (outcome.multiplier !== "0.0000") wins++;
    }
    const rate = wins / trials;
    expect(rate).toBeGreaterThan(0.94);
    expect(rate).toBeLessThan(0.995);
  });

  it("scales limbo win rate inversely with the target", () => {
    const trials = 20_000;
    const winsAt = (target: number) => {
      let wins = 0;
      for (let i = 0; i < trials; i++) {
        if (resolveGame("limbo", seedFor(i), STAKE, { targetMultiplier: target }).multiplier !== "0.0000") wins++;
      }
      return wins / trials;
    };
    expect(winsAt(2)).toBeGreaterThan(0.45);
    expect(winsAt(2)).toBeLessThan(0.52);
    expect(winsAt(10)).toBeGreaterThan(0.09);
    expect(winsAt(10)).toBeLessThan(0.11);
  });

  it("publishes a catalog entry for every internal game", () => {
    const catalogSlugs = new Set(GAME_CATALOG.map((g) => g.slug));
    for (const slug of Object.keys(INSTANT_GAMES)) {
      expect(catalogSlugs.has(slug), `${slug} missing from catalog`).toBe(true);
    }
  });

  it("keeps the crash bust distribution consistent with the 1% edge", () => {
    // P(crash >= 2) must be ~49.5%, and crash points must never fall below 1.
    let atLeastTwo = 0;
    let minPoint = Infinity;
    const trials = 20_000;
    for (let i = 0; i < trials; i++) {
      const outcome = resolveGame("crash", seedFor(i), STAKE, { autoCashout: 0 });
      const point = Number(outcome.detail.crashPoint);
      minPoint = Math.min(minPoint, point);
      if (point >= 2) atLeastTwo++;
    }
    expect(minPoint).toBeGreaterThanOrEqual(1);
    const rate = atLeastTwo / trials;
    expect(rate).toBeGreaterThan(0.45);
    expect(rate).toBeLessThan(0.54);
  });

  it("rejects unknown games and malformed params", () => {
    expect(() => resolveGame("nope", seedFor(1), STAKE, {})).toThrow();
    expect(() => resolveGame("dice", seedFor(1), STAKE, { target: 500, direction: "OVER" })).toThrow();
    expect(() => resolveGame("dice", seedFor(1), STAKE, { target: 50, direction: "SIDEWAYS" })).toThrow();
    expect(() => resolveGame("limbo", seedFor(1), STAKE, {})).toThrow();
    expect(() => resolveGame("mines", seedFor(1), STAKE, { mines: 3, picks: [1, 1] })).toThrow();
  });
});
