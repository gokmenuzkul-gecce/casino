import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Provably-fair primitives.
 *
 * Flow: the server commits to a secret seed by publishing its SHA-256 hash
 * before a round starts. After the round, the server reveals the seed and the
 * client can recompute every outcome. `nonce` increments per bet so one seed
 * can serve many rounds without reuse.
 */

export interface SeedPair {
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
}

export function generateServerSeed(): string {
  return randomBytes(32).toString("hex");
}

export function hashServerSeed(serverSeed: string): string {
  return createHash("sha256").update(serverSeed).digest("hex");
}

export function createSeedPair(clientSeed?: string): SeedPair {
  const serverSeed = generateServerSeed();
  return {
    serverSeed,
    serverSeedHash: hashServerSeed(serverSeed),
    clientSeed: clientSeed ?? randomBytes(8).toString("hex"),
    nonce: 0,
  };
}

export function verifyServerSeed(serverSeed: string, publishedHash: string): boolean {
  const actual = Buffer.from(hashServerSeed(serverSeed), "hex");
  const expected = Buffer.from(publishedHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}:${cursor}`) as a hex digest. */
export function hmacDigest(serverSeed: string, clientSeed: string, nonce: number, cursor = 0): string {
  return createHmac("sha256", serverSeed).update(`${clientSeed}:${nonce}:${cursor}`).digest("hex");
}

/**
 * Deterministic float in [0, 1) derived from the digest. Uses 4 bytes (32 bits)
 * per float so a single digest yields 8 independent values.
 */
export function floatsFromDigest(digest: string, count = 1): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const slice = digest.slice(i * 8, i * 8 + 8);
    if (slice.length < 8) break;
    out.push(parseInt(slice, 16) / 0x1_0000_0000);
  }
  return out;
}

/** Generate `count` floats, extending with new digests when needed. */
export function generateFloats(seed: SeedPair, count: number): number[] {
  return generateFloatsFrom(seed, 0, count);
}

/**
 * Generate `count` floats starting at digest `startCursor` (8 floats per digest).
 * Extending a stream must advance the cursor, never the nonce: a verifier
 * replaying the round applies HMAC(serverSeed, `${clientSeed}:${nonce}:${cursor}`)
 * with a fixed nonce, so bumping the nonce mid-stream would make outcomes
 * unreproducible.
 */
export function generateFloatsFrom(seed: SeedPair, startCursor: number, count: number): number[] {
  const floats: number[] = [];
  let cursor = startCursor;
  while (floats.length < count) {
    floats.push(...floatsFromDigest(hmacDigest(seed.serverSeed, seed.clientSeed, seed.nonce, cursor), 8));
    cursor++;
  }
  return floats.slice(0, count);
}

/** Map a float to an integer in [min, max] inclusive. */
export function floatToInt(value: number, min: number, max: number): number {
  return Math.floor(value * (max - min + 1)) + min;
}

/** Pick an index from a weighted table using a single float. */
export function weightedPick<T extends { weight: number }>(table: T[], value: number): T {
  const total = table.reduce((sum, row) => sum + row.weight, 0);
  let threshold = value * total;
  for (const row of table) {
    threshold -= row.weight;
    if (threshold < 0) return row;
  }
  return table[table.length - 1]!;
}
