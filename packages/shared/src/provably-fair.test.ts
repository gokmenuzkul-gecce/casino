import { describe, expect, it } from "vitest";
import {
  createSeedPair,
  hashServerSeed,
  hmacDigest,
  floatsFromDigest,
  generateFloats,
  generateFloatsFrom,
  floatToInt,
  weightedPick,
  verifyServerSeed,
} from "./provably-fair.js";

describe("seed commitment", () => {
  it("verifies a revealed seed against its published hash", () => {
    const seed = createSeedPair();
    expect(seed.serverSeedHash).toBe(hashServerSeed(seed.serverSeed));
    expect(verifyServerSeed(seed.serverSeed, seed.serverSeedHash)).toBe(true);
  });

  it("rejects a tampered seed or hash", () => {
    const seed = createSeedPair();
    expect(verifyServerSeed(seed.serverSeed, hashServerSeed("other"))).toBe(false);
    expect(verifyServerSeed("00".repeat(32), seed.serverSeedHash)).toBe(false);
  });

  it("treats a mismatched-length hash as invalid instead of throwing", () => {
    // timingSafeEqual throws on unequal lengths; the guard must catch it first.
    expect(verifyServerSeed("ab".repeat(32), "abcd")).toBe(false);
  });
});

describe("float derivation", () => {
  it("produces values in [0, 1) from a digest", () => {
    const floats = floatsFromDigest(hmacDigest("s", "c", 0, 0), 8);
    expect(floats).toHaveLength(8);
    for (const value of floats) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("changes with nonce and cursor so streams do not repeat", () => {
    expect(hmacDigest("s", "c", 0, 0)).not.toBe(hmacDigest("s", "c", 1, 0));
    expect(hmacDigest("s", "c", 0, 0)).not.toBe(hmacDigest("s", "c", 0, 1));
  });

  it("extends a stream by advancing the digest cursor, keeping the nonce fixed", () => {
    const seed = { serverSeed: "s".repeat(64), serverSeedHash: "", clientSeed: "c", nonce: 3 };
    // startCursor is a digest index: digest 2 begins at float offset 16.
    const second = generateFloatsFrom(seed, 2, 40);
    expect(second).toEqual(generateFloats(seed, 56).slice(16, 56));
    expect(generateFloats(seed, 40)[16]).toBe(second[0]);
  });
});

describe("mapping helpers", () => {
  it("maps floats to inclusive integer ranges", () => {
    expect(floatToInt(0, 1, 6)).toBe(1);
    expect(floatToInt(0.999999, 1, 6)).toBe(6);
  });

  it("picks from a weighted table by cumulative weight", () => {
    const table = [
      { weight: 1, label: "a" },
      { weight: 3, label: "b" },
    ];
    expect(weightedPick(table, 0).label).toBe("a");
    expect(weightedPick(table, 0.99).label).toBe("b");
  });
});
