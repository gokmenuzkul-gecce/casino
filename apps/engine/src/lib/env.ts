import { Errors } from "@aurora/shared";

/**
 * Reads and validates environment configuration. Nothing here throws at import
 * time for optional providers: a missing credential only disables that provider,
 * which keeps the platform bootable in demo mode.
 */

function str(key: string, fallback = ""): string {
  const value = process.env[key];
  return value === undefined || value === "" ? fallback : value;
}

function num(key: string, fallback: number): number {
  const value = process.env[key];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(key: string, fallback = false): boolean {
  const value = process.env[key];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export const env = {
  nodeEnv: str("NODE_ENV", "development"),
  isProduction: str("NODE_ENV") === "production",
  appName: str("APP_NAME", "Aurora"),
  appUrl: str("APP_URL", "http://localhost:3000"),
  engineUrl: str("ENGINE_URL", "http://localhost:4000"),
  apiPublicUrl: str("API_PUBLIC_URL", "http://localhost:4000"),

  databaseUrl: str("DATABASE_URL"),
  redisUrl: str("REDIS_URL", "redis://localhost:6379"),

  jwtAccessSecret: str("JWT_ACCESS_SECRET"),
  jwtRefreshSecret: str("JWT_REFRESH_SECRET"),
  jwtAccessTtl: num("JWT_ACCESS_TTL", 900),
  jwtRefreshTtl: num("JWT_REFRESH_TTL", 2_592_000),
  totpIssuer: str("TOTP_ISSUER", "Aurora"),
  encryptionKey: str("ENCRYPTION_KEY"),
  argonMemoryCost: num("ARGON2_MEMORY_COST", 19_456),
  argonTimeCost: num("ARGON2_TIME_COST", 2),

  mail: {
    transport: str("MAIL_TRANSPORT", "smtp"),
    from: str("MAIL_FROM", "Aurora <no-reply@aurora.local>"),
    host: str("SMTP_HOST", "localhost"),
    port: num("SMTP_PORT", 1025),
    user: str("SMTP_USER"),
    pass: str("SMTP_PASS"),
    secure: bool("SMTP_SECURE", false),
  },

  sms: {
    provider: str("SMS_PROVIDER", "console"),
    apiKey: str("SMS_API_KEY"),
    sender: str("SMS_SENDER", "AURORA"),
  },

  platformMode: (str("PLATFORM_MODE", "demo") === "live" ? "live" : "demo") as "demo" | "live",
  currency: str("CURRENCY", "TRY"),

  gameAggregator: {
    provider: str("GAME_AGGREGATOR", "none"),
    baseUrl: str("GAME_AGGREGATOR_BASE_URL"),
    apiKey: str("GAME_AGGREGATOR_API_KEY"),
    secret: str("GAME_AGGREGATOR_SECRET"),
    merchantId: str("GAME_AGGREGATOR_MERCHANT_ID"),
    callbackSecret: str("GAME_AGGREGATOR_CALLBACK_SECRET"),
  },

  /**
   * Gregmorn Hub. Stage and prod are separate deployments with separate
   * credentials and IP allowlists, so every value is an env var.
   */
  gregmorn: {
    officeBaseUrl: str("GREG_MORN_OFFICE_URL"),
    clientBaseUrl: str("GREG_MORN_CLIENT_URL"),
    login: str("GREG_MORN_LOGIN"),
    password: str("GREG_MORN_PASSWORD"),
    secretKey: str("GREG_MORN_SECRET_KEY"),
    userId: str("GREG_MORN_USER_ID"),
    currency: str("GREG_MORN_CURRENCY", str("CURRENCY", "TRY")),
  },

  /**
   * BetSkilla white-label hub (Xenzora/Kingsbet). Games, session launch and the
   * player session all live behind the operator brand's own `/api` gateway, so
   * the brand host is the only required value; the rest are optional overrides.
   *
   * `callbackSecret` signs the seamless-wallet callbacks the hub sends back:
   * without it the wallet bridge stays inert and games run on the hub's own
   * balance instead of the player's.
   */
  betskilla: {
    baseUrl: str("BETSKILLA_BASE_URL"),
    login: str("BETSKILLA_LOGIN"),
    password: str("BETSKILLA_PASSWORD"),
    currency: str("BETSKILLA_CURRENCY", str("CURRENCY", "TRY")),
    callbackSecret: str("BETSKILLA_CALLBACK_SECRET", str("GAME_AGGREGATOR_CALLBACK_SECRET")),
  },

  psp: {
    provider: str("PSP_PROVIDER", "none"),
    baseUrl: str("PSP_BASE_URL"),
    apiKey: str("PSP_API_KEY"),
    secretKey: str("PSP_SECRET_KEY"),
    merchantId: str("PSP_MERCHANT_ID"),
    webhookSecret: str("PSP_WEBHOOK_SECRET"),
    currencies: str("PSP_CURRENCIES", "TRY").split(",").map((c) => c.trim()),
  },

  crypto: {
    provider: str("CRYPTO_PROVIDER", "none"),
    apiKey: str("CRYPTO_API_KEY"),
    webhookSecret: str("CRYPTO_WEBHOOK_SECRET"),
  },

  kyc: {
    provider: str("KYC_PROVIDER", "none"),
    baseUrl: str("KYC_BASE_URL"),
    apiKey: str("KYC_API_KEY"),
    webhookSecret: str("KYC_WEBHOOK_SECRET"),
  },

  risk: {
    provider: str("RISK_PROVIDER", "none"),
    apiKey: str("RISK_API_KEY"),
  },

  affiliate: {
    enabled: bool("AFFILIATE_ENABLED", true),
    cookieDays: num("AFFILIATE_COOKIE_DAYS", 30),
  },

  admin: {
    email: str("ADMIN_EMAIL", "admin@aurora.local"),
    password: str("ADMIN_PASSWORD", "Admin!2345"),
    username: str("ADMIN_USERNAME", "superadmin"),
  },

  features: {
    sportsbook: bool("FEATURE_SPORTSBOOK", true),
    liveCasino: bool("FEATURE_LIVE_CASINO", true),
    tournaments: bool("FEATURE_TOURNAMENTS", true),
    vip: bool("FEATURE_VIP", true),
    affiliates: bool("FEATURE_AFFILIATES", true),
    crypto: bool("FEATURE_CRYPTO", true),
    kyc: bool("FEATURE_KYC", true),
  },
} as const;

/** Fail fast on secrets that must never be left at defaults in production. */
export function assertProductionReadiness(): void {
  if (!env.isProduction) return;
  const problems: string[] = [];
  if (!env.jwtAccessSecret || env.jwtAccessSecret.includes("change_me")) problems.push("JWT_ACCESS_SECRET");
  if (!env.jwtRefreshSecret || env.jwtRefreshSecret.includes("change_me")) problems.push("JWT_REFRESH_SECRET");
  if (!env.encryptionKey || env.encryptionKey.includes("change")) problems.push("ENCRYPTION_KEY");
  if (env.platformMode === "live" && env.psp.provider === "none") problems.push("PSP_PROVIDER");
  if (problems.length > 0) {
    throw Errors.internal(`Uretim icin su ayarlar eksik: ${problems.join(", ")}`);
  }
}
