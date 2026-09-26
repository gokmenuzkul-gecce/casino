/**
 * Money handling. All amounts are stored and computed as integer minor units
 * (e.g. kuruş for TRY, cents for USD) to avoid floating point drift.
 * Conversion to/from human-readable values happens only at the UI boundary.
 */

export const MINOR_UNITS_PER_MAJOR = 100n;

export type CurrencyCode = "TRY" | "USD" | "EUR" | "GBP" | "USDT" | "BTC";

export interface CurrencyMeta {
  code: CurrencyCode;
  symbol: string;
  decimals: number;
  /** Minimum accepted deposit in minor units. */
  minDeposit: bigint;
  /** Minimum accepted withdrawal in minor units. */
  minWithdrawal: bigint;
}

export const CURRENCIES: Record<CurrencyCode, CurrencyMeta> = {
  TRY: { code: "TRY", symbol: "₺", decimals: 2, minDeposit: 5_000n, minWithdrawal: 10_000n },
  USD: { code: "USD", symbol: "$", decimals: 2, minDeposit: 500n, minWithdrawal: 1_000n },
  EUR: { code: "EUR", symbol: "€", decimals: 2, minDeposit: 500n, minWithdrawal: 1_000n },
  GBP: { code: "GBP", symbol: "£", decimals: 2, minDeposit: 500n, minWithdrawal: 1_000n },
  USDT: { code: "USDT", symbol: "₮", decimals: 2, minDeposit: 1_000n, minWithdrawal: 2_000n },
  BTC: { code: "BTC", symbol: "₿", decimals: 8, minDeposit: 10_000n, minWithdrawal: 20_000n },
};

export function currencyMeta(code: string): CurrencyMeta {
  const meta = CURRENCIES[code as CurrencyCode];
  if (!meta) throw new Error(`Unsupported currency: ${code}`);
  return meta;
}

/** Parse a human string/number ("12.50") into minor units. Throws on malformed input. */
export function toMinor(value: string | number, currency: CurrencyCode = "TRY"): bigint {
  const meta = currencyMeta(currency);
  const raw = typeof value === "number" ? value.toFixed(meta.decimals) : value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(raw)) throw new Error(`Invalid amount: ${value}`);
  const negative = raw.startsWith("-");
  const [whole = "0", frac = ""] = raw.replace("-", "").split(".");
  const padded = frac.padEnd(meta.decimals, "0").slice(0, meta.decimals);
  const result = BigInt(whole) * 10n ** BigInt(meta.decimals) + BigInt(padded || "0");
  return negative ? -result : result;
}

/** Render minor units as a plain decimal string without symbol grouping. */
export function fromMinor(value: bigint, currency: CurrencyCode = "TRY"): string {
  const meta = currencyMeta(currency);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const divisor = 10n ** BigInt(meta.decimals);
  const whole = abs / divisor;
  const frac = (abs % divisor).toString().padStart(meta.decimals, "0");
  const body = meta.decimals === 0 ? whole.toString() : `${whole}.${frac}`;
  return negative ? `-${body}` : body;
}

/** Format with symbol and thousands separators for display. */
export function formatMoney(value: bigint, currency: CurrencyCode = "TRY"): string {
  const meta = currencyMeta(currency);
  const plain = fromMinor(value, currency);
  const [whole = "0", frac] = plain.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = frac ? `${grouped}.${frac}` : grouped;
  return `${meta.symbol}${body}`;
}

/**
 * Apply a payout multiplier (given as a decimal string or number, e.g. "2.5")
 * to a stake in minor units, rounding half-up to the nearest minor unit.
 */
export function applyMultiplier(stake: bigint, multiplier: string | number, currency: CurrencyCode = "TRY"): bigint {
  const meta = currencyMeta(currency);
  const scale = 10n ** BigInt(meta.decimals + 6);
  const m = toMinor(multiplier, currency) * 10n ** 6n;
  const product = stake * m;
  const quotient = product / scale;
  const remainder = product % scale;
  return remainder * 2n >= scale ? quotient + 1n : quotient;
}

/** Percentage of an amount, half-up rounded. */
export function percentOf(amount: bigint, percent: string | number, currency: CurrencyCode = "TRY"): bigint {
  return applyMultiplier(amount, Number(percent) / 100, currency);
}

export function clamp(value: bigint, min: bigint, max: bigint): bigint {
  return value < min ? min : value > max ? max : value;
}
