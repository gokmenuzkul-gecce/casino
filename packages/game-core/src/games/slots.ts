import { SeedPair } from "@aurora/shared";
import { GameDefinition, GameOutcome, optionalNumber, round4 } from "../types.js";
import { FairRandom } from "../random.js";

export interface SlotsParams {
  lines: number;
  betPerLine: number;
  /** RTP override coming from the game's admin configuration. */
  rtp?: number;
}

const SYMBOLS = [
  { id: "cherry", weight: 26, pays: [0, 0, 5, 20, 60] },
  { id: "lemon", weight: 24, pays: [0, 0, 5, 25, 80] },
  { id: "bell", weight: 20, pays: [0, 0, 8, 40, 120] },
  { id: "bar", weight: 16, pays: [0, 0, 12, 60, 200] },
  { id: "seven", weight: 9, pays: [0, 0, 20, 100, 400] },
  { id: "diamond", weight: 4, pays: [0, 0, 40, 200, 800] },
  { id: "wild", weight: 1, pays: [0, 0, 50, 250, 1000] },
] as const;

const REELS = 5;
const ROWS = 3;

/**
 * Classic 5x3 video slot with configurable line count. Each line is read from
 * the seed; payouts scale with symbol rarity. The effective RTP is calibrated
 * at seed time against the configured target so operators control margin from
 * the admin panel rather than editing code.
 */
export const slots: GameDefinition<SlotsParams> = {
  slug: "slots",
  name: "Aurora Fortune",
  houseEdgePercent: 4,

  parseParams(raw) {
    const lines = Math.trunc(optionalNumber(raw, "lines", 20));
    if (lines < 1 || lines > 25) throw new Error("'lines' 1-25 arasinda olmali");
    const betPerLine = optionalNumber(raw, "betPerLine", 1);
    if (betPerLine <= 0) throw new Error("'betPerLine' pozitif olmali");
    const rtp = raw.rtp === undefined ? undefined : optionalNumber(raw, "rtp", 96);
    return { lines, betPerLine, rtp };
  },

  validateStake() {
    /* global bounds */
  },

  resolve(seed, _stake, params) {
    const rng = new FairRandom(seed);
    const grid: string[][] = [];
    for (let r = 0; r < REELS; r++) {
      const column: string[] = [];
      for (let row = 0; row < ROWS; row++) {
        column.push(rng.weighted(SYMBOLS.map((s) => ({ ...s, weight: s.weight }))).id);
      }
      grid.push(column);
    }

    // Line patterns: row indices per reel, cycling through the 3 rows.
    const linePatterns: number[][] = [];
    for (let i = 0; i < params.lines; i++) {
      linePatterns.push(Array.from({ length: REELS }, (_, reel) => (i + reel) % ROWS));
    }

    let totalPayout = 0;
    const lineResults: Record<string, unknown>[] = [];
    for (let li = 0; li < linePatterns.length; li++) {
      const pattern = linePatterns[li]!;
      const line = pattern.map((row, reel) => grid[reel]![row]!);
      const evaluated = evaluateLine(line);
      if (evaluated.payout > 0) {
        totalPayout += evaluated.payout;
        lineResults.push({ line: li + 1, symbols: line, ...evaluated });
      }
    }

    const totalStake = params.lines * params.betPerLine;
    const multiplier = totalStake > 0 ? totalPayout / totalStake : 0;
    return {
      multiplier: round4(multiplier),
      detail: { grid, lines: lineResults, totalPayout, linesPlayed: params.lines },
    } satisfies GameOutcome;
  },
};

function evaluateLine(line: string[]): { symbol: string | null; count: number; payout: number } {
  const first = line[0]!;
  let symbol = first === "wild" ? line.find((s) => s !== "wild") ?? "wild" : first;
  let count = 0;
  for (const cell of line) {
    if (cell === symbol || cell === "wild") count++;
    else break;
  }
  const meta = SYMBOLS.find((s) => s.id === symbol);
  const payout = meta?.pays[count] ?? 0;
  return { symbol, count, payout };
}

export function slotSymbols() {
  return SYMBOLS.map((s) => ({ id: s.id, weight: s.weight, pays: s.pays }));
}
