import { SeedPair, generateFloatsFrom } from "@aurora/shared";

/**
 * Deterministic RNG bound to a provably-fair seed pair. The same seed pair and
 * call sequence always produce the same numbers, which is what makes outcomes
 * verifiable by the player after the server seed is revealed.
 */
export class FairRandom {
  private floats: number[];
  private cursor = 0;
  /** Digest index the next refill starts from, so the stream keeps growing. */
  private digestCursor = 0;

  constructor(private readonly seed: SeedPair, precompute = 256) {
    this.floats = generateFloatsFrom(seed, 0, precompute);
    this.digestCursor = Math.ceil(precompute / 8);
  }

  /** Uniform float in [0, 1). */
  next(): number {
    if (this.cursor >= this.floats.length) {
      const extra = generateFloatsFrom(this.seed, this.digestCursor, 256);
      this.digestCursor += Math.ceil(extra.length / 8);
      this.floats.push(...extra);
    }
    return this.floats[this.cursor++]!;
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Pick one element uniformly. */
  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)]!;
  }

  /** Weighted pick over a table. */
  weighted<T extends { weight: number }>(table: readonly T[]): T {
    const total = table.reduce((sum, row) => sum + row.weight, 0);
    let threshold = this.next() * total;
    for (const row of table) {
      threshold -= row.weight;
      if (threshold < 0) return row;
    }
    return table[table.length - 1]!;
  }

  /** Fisher-Yates shuffle, in place, driven by the fair RNG. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items;
  }

  /** Sample k distinct indices from [0, n). */
  sampleIndices(n: number, k: number): number[] {
    const indices = Array.from({ length: n }, (_, i) => i);
    this.shuffle(indices);
    return indices.slice(0, k);
  }
}
