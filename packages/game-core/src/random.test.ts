import { describe, expect, it } from "vitest";
import { createSeedPair, hmacDigest, floatsFromDigest } from "@aurora/shared";
import { FairRandom } from "./random.js";

/** Independent re-implementation of the documented verification recipe. */
function referenceFloats(seed: { serverSeed: string; clientSeed: string; nonce: number }, count: number): number[] {
  const out: number[] = [];
  for (let cursor = 0; out.length < count; cursor++) {
    out.push(...floatsFromDigest(hmacDigest(seed.serverSeed, seed.clientSeed, seed.nonce, cursor), 8));
  }
  return out.slice(0, count);
}

describe("FairRandom", () => {
  it("is deterministic for the same seed pair and call sequence", () => {
    const seed = createSeedPair("client-seed");
    const a = new FairRandom(seed);
    const b = new FairRandom(seed);
    const left = Array.from({ length: 64 }, () => a.next());
    const right = Array.from({ length: 64 }, () => b.next());
    expect(left).toEqual(right);
  });

  it("matches an independent verifier across the precompute boundary", () => {
    // 600 draws force three refills past the 256-float precompute window.
    const seed = createSeedPair("boundary-seed");
    const rng = new FairRandom(seed);
    const drawn = Array.from({ length: 600 }, () => rng.next());
    expect(drawn).toEqual(referenceFloats(seed, 600));
  });

  it("keeps the nonce fixed while extending the stream", () => {
    const seed = createSeedPair("nonce-seed");
    const rng = new FairRandom(seed);
    for (let i = 0; i < 300; i++) rng.next();
    // A verifier replays with the original nonce, so the 300th float must
    // equal the reference value at that offset — not a fresh nonce stream.
    const reference = referenceFloats(seed, 301);
    const fresh = new FairRandom(seed);
    for (let i = 0; i < 300; i++) fresh.next();
    expect(fresh.next()).toBe(reference[300]);
  });

  it("stays within the documented ranges for helpers", () => {
    const rng = new FairRandom(createSeedPair("range-seed"));
    for (let i = 0; i < 200; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    for (let i = 0; i < 200; i++) {
      const n = rng.int(1, 6);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(6);
    }
  });

  it("samples distinct indices without repeats", () => {
    const rng = new FairRandom(createSeedPair("sample-seed"));
    const indices = rng.sampleIndices(40, 10);
    expect(indices).toHaveLength(10);
    expect(new Set(indices).size).toBe(10);
    expect(indices.every((i) => i >= 0 && i < 40)).toBe(true);
  });
});
