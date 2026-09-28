import { prisma } from "@aurora/db";
import { Errors } from "@aurora/shared";
import { decryptSecret, encryptSecret } from "../lib/secrets.js";

/**
 * Provider credentials entered from the admin panel.
 *
 * Historically a provider could only be configured by editing .env and
 * restarting, which meant an operator had no way to switch on a game aggregator
 * from the product itself. Values saved here are stored encrypted in
 * `provider_configs` and overlaid onto env at boot and on save, so the running
 * adapter picks them up without a code change or a restart.
 */

/** Env keys a provider's `config` JSON may carry, per kind. */
export const PROVIDER_ENV_KEYS: Record<string, string[]> = {
  gameAggregator: [
    "GAME_AGGREGATOR",
    "GAME_AGGREGATOR_BASE_URL",
    "GAME_AGGREGATOR_API_KEY",
    "GAME_AGGREGATOR_SECRET",
    "GAME_AGGREGATOR_MERCHANT_ID",
    "GAME_AGGREGATOR_CALLBACK_SECRET",
    "GREG_MORN_OFFICE_URL",
    "GREG_MORN_CLIENT_URL",
    "GREG_MORN_LOGIN",
    "GREG_MORN_PASSWORD",
    "GREG_MORN_SECRET_KEY",
    "GREG_MORN_USER_ID",
    "GREG_MORN_CURRENCY",
    "BETSKILLA_BASE_URL",
    "BETSKILLA_LOGIN",
    "BETSKILLA_PASSWORD",
    "BETSKILLA_CURRENCY",
    "BETSKILLA_CALLBACK_SECRET",
    // loginxgamesapi: four independent vendors, each host + agentid/apitoken/
    // secretkey. Entered from the panel so credentials never sit in the repo.
    "LOGINX_CURRENCY",
    "LOGINX_PRAGMATIC_AGENTID",
    "LOGINX_PRAGMATIC_APITOKEN",
    "LOGINX_PRAGMATIC_SECRETKEY",
    "LOGINX_PRAGMATIC_HOST",
    "LOGINX_PGSOFT_AGENTID",
    "LOGINX_PGSOFT_APITOKEN",
    "LOGINX_PGSOFT_SECRETKEY",
    "LOGINX_PGSOFT_HOST",
    "LOGINX_AMATIC_AGENTID",
    "LOGINX_AMATIC_APITOKEN",
    "LOGINX_AMATIC_SECRETKEY",
    "LOGINX_AMATIC_HOST",
    "LOGINX_AMUSNET_AGENTID",
    "LOGINX_AMUSNET_APITOKEN",
    "LOGINX_AMUSNET_SECRETKEY",
    "LOGINX_AMUSNET_HOST",
  ],
  psp: ["PSP_PROVIDER", "PSP_BASE_URL", "PSP_API_KEY", "PSP_SECRET_KEY", "PSP_MERCHANT_ID", "PSP_WEBHOOK_SECRET"],
  crypto: ["CRYPTO_PROVIDER", "CRYPTO_BASE_URL", "CRYPTO_API_KEY", "CRYPTO_WEBHOOK_SECRET"],
  kyc: ["KYC_PROVIDER", "KYC_BASE_URL", "KYC_API_KEY", "KYC_WEBHOOK_SECRET"],
  risk: ["RISK_PROVIDER", "RISK_BASE_URL", "RISK_API_KEY"],
  sms: ["SMS_PROVIDER", "SMS_ENDPOINT", "SMS_API_KEY", "SMS_SENDER"],
};

/** Values that must never be written to a log, an audit row or an API response. */
const SECRET_KEY_PATTERN = /SECRET|PASSWORD|API_KEY|_KEY$/;

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

interface StoredConfig {
  provider: string;
  isEnabled: boolean;
  values: Record<string, string>;
}

/**
 * Apply every saved provider config onto `process.env`.
 *
 * Called once at boot, before the registry is built, and again after an admin
 * save. A stored value wins over .env: the panel is the more recent, more
 * explicit instruction.
 */
export async function applyProviderConfigs(): Promise<void> {
  let rows: Awaited<ReturnType<typeof prisma.providerConfig.findMany>>;
  try {
    rows = await prisma.providerConfig.findMany({ where: { isEnabled: true } });
  } catch {
    // A database that is not up yet must not stop the engine from booting: .env
    // alone is a valid configuration.
    return;
  }
  for (const row of rows) {
    const values = readValues(row.config);
    // The provider profile itself (`gregmorn`, `betskilla`, …) is how the
    // registry picks an adapter, so it is written back on every apply.
    process.env.GAME_AGGREGATOR = row.provider;
    for (const [key, value] of Object.entries(values)) {
      if (value !== "") process.env[key] = value;
    }
  }
}

/** Decrypt a stored config blob into plain env assignments. */
function readValues(config: unknown): Record<string, string> {
  if (!config || typeof config !== "object") return {};
  const raw = config as { values?: Record<string, string> };
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw.values ?? {})) {
    if (typeof value !== "string" || value === "") continue;
    try {
      out[key] = decryptSecret(value);
    } catch {
      // A value encrypted under a rotated key is unusable; skip it rather than
      // taking the whole boot down.
    }
  }
  return out;
}

export async function loadProviderConfig(kind: string): Promise<StoredConfig | null> {
  const row = await prisma.providerConfig.findFirst({ where: { kind } });
  if (!row) return null;
  return { provider: row.provider, isEnabled: row.isEnabled, values: readValues(row.config) };
}

/**
 * Persist a provider config and push it into the live environment.
 *
 * `input` holds the raw submitted values; anything blank is left as-is, so the
 * panel can show a masked secret and not require it to be retyped on every save.
 */
export async function saveProviderConfig(input: {
  kind: string;
  provider: string;
  values: Record<string, string>;
  actorId: string;
}): Promise<{ changed: string[] }> {
  const allowed = PROVIDER_ENV_KEYS[input.kind];
  if (!allowed) throw Errors.validation(`Bilinmeyen saglayici turu: ${input.kind}`);

  const existing = await prisma.providerConfig.findFirst({ where: { kind: input.kind } });
  const previous = existing ? readValues(existing.config) : {};

  const changed: string[] = [];
  const merged: Record<string, string> = { ...previous };
  for (const [key, value] of Object.entries(input.values)) {
    if (!allowed.includes(key)) continue;
    if (value === "") continue;
    if (previous[key] === value) continue;
    merged[key] = value;
    changed.push(key);
    // Applied here as well as at boot so a save takes effect immediately.
    process.env[key] = value;
  }
  process.env.GAME_AGGREGATOR = input.provider;

  const encrypted: Record<string, string> = {};
  for (const [key, value] of Object.entries(merged)) encrypted[key] = encryptSecret(value);

  const data = {
    kind: input.kind,
    provider: input.provider,
    isEnabled: true,
    config: { values: encrypted },
  };

  if (existing) {
    await prisma.providerConfig.update({ where: { id: existing.id }, data });
  } else {
    await prisma.providerConfig.create({ data });
  }

  return { changed };
}

/** Masked view for the API: secrets never leave the server in clear. */
export function publicValues(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    out[key] = isSecretKey(key) ? "••••••••" : value;
  }
  return out;
}

export { maskSecret } from "../lib/secrets.js";
