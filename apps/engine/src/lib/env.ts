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
  get nodeEnv() {
    return str("NODE_ENV", "development");
  },
  get isProduction() {
    return str("NODE_ENV") === "production";
  },
  get appName() {
    return str("APP_NAME", "Aurora");
  },
  get appUrl() {
    return str("APP_URL", "http://localhost:3000");
  },
  get engineUrl() {
    return str("ENGINE_URL", "http://localhost:4000");
  },
  get apiPublicUrl() {
    return str("API_PUBLIC_URL", "http://localhost:4000");
  },

  get databaseUrl() {
    return str("DATABASE_URL");
  },
  get redisUrl() {
    return str("REDIS_URL", "redis://localhost:6379");
  },

  get jwtAccessSecret() {
    return str("JWT_ACCESS_SECRET");
  },
  get jwtRefreshSecret() {
    return str("JWT_REFRESH_SECRET");
  },
  get jwtAccessTtl() {
    return num("JWT_ACCESS_TTL", 900);
  },
  get jwtRefreshTtl() {
    return num("JWT_REFRESH_TTL", 2_592_000);
  },
  get totpIssuer() {
    return str("TOTP_ISSUER", "Aurora");
  },
  get encryptionKey() {
    return str("ENCRYPTION_KEY");
  },
  get argonMemoryCost() {
    return num("ARGON2_MEMORY_COST", 19_456);
  },
  get argonTimeCost() {
    return num("ARGON2_TIME_COST", 2);
  },

  mail: {
    get transport() {
      return str("MAIL_TRANSPORT", "smtp");
    },
    get from() {
      return str("MAIL_FROM", "Aurora <no-reply@aurora.local>");
    },
    get host() {
      return str("SMTP_HOST", "localhost");
    },
    get port() {
      return num("SMTP_PORT", 1025);
    },
    get user() {
      return str("SMTP_USER");
    },
    get pass() {
      return str("SMTP_PASS");
    },
    get secure() {
      return bool("SMTP_SECURE", false);
    },
  },

  sms: {
    get provider() {
      return str("SMS_PROVIDER", "console");
    },
    get apiKey() {
      return str("SMS_API_KEY");
    },
    get sender() {
      return str("SMS_SENDER", "AURORA");
    },
  },

  get platformMode() {
    return (str("PLATFORM_MODE", "demo") === "live" ? "live" : "demo") as "demo" | "live";
  },
  get currency() {
    return str("CURRENCY", "TRY");
  },

  gameAggregator: {
    get provider() {
      return str("GAME_AGGREGATOR", "none");
    },
    get baseUrl() {
      return str("GAME_AGGREGATOR_BASE_URL");
    },
    get apiKey() {
      return str("GAME_AGGREGATOR_API_KEY");
    },
    get secret() {
      return str("GAME_AGGREGATOR_SECRET");
    },
    get merchantId() {
      return str("GAME_AGGREGATOR_MERCHANT_ID");
    },
    get callbackSecret() {
      return str("GAME_AGGREGATOR_CALLBACK_SECRET");
    },
  },

  /**
   * Gregmorn Hub. Stage and prod are separate deployments with separate
   * credentials and IP allowlists, so every value is an env var.
   */
  gregmorn: {
    get officeBaseUrl() {
      return str("GREG_MORN_OFFICE_URL");
    },
    get clientBaseUrl() {
      return str("GREG_MORN_CLIENT_URL");
    },
    get login() {
      return str("GREG_MORN_LOGIN");
    },
    get password() {
      return str("GREG_MORN_PASSWORD");
    },
    get secretKey() {
      return str("GREG_MORN_SECRET_KEY");
    },
    get userId() {
      return str("GREG_MORN_USER_ID");
    },
    get currency() {
      return str("GREG_MORN_CURRENCY", str("CURRENCY", "TRY"));
    },
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
    get baseUrl() {
      return str("BETSKILLA_BASE_URL");
    },
    get login() {
      return str("BETSKILLA_LOGIN");
    },
    get password() {
      return str("BETSKILLA_PASSWORD");
    },
    get currency() {
      return str("BETSKILLA_CURRENCY", str("CURRENCY", "TRY"));
    },
    get callbackSecret() {
      return str("BETSKILLA_CALLBACK_SECRET", str("GAME_AGGREGATOR_CALLBACK_SECRET"));
    },
  },

  /**
   * loginxgamesapi / GitSlotPark. Four independent vendor credential sets, each
   * on its own host (Pragmatic, PG Soft, Amatic, Amusnet). Speaks the
   * GitSlotPark Seamless Wallet API v2: catalogue, `userAuth` launch and the
   * five callbacks. See docs/providers/loginx-games-api.md.
   */
  loginx: {
    get currency() {
      return str("LOGINX_CURRENCY", str("CURRENCY", "TRY"));
    },
    /**
     * Base path the provider posts its five callbacks to. It is part of the
     * contract — the provider calls `<base>/GetBalance`, `<base>/BetWin` and so
     * on — so it must be stable and configured on the provider's side.
     */
    get walletCallbackBase() {
      return str("WALLET_CALLBACK_BASE", "/webhooks/callback");
    },
  },

  psp: {
    get provider() {
      return str("PSP_PROVIDER", "none");
    },
    get baseUrl() {
      return str("PSP_BASE_URL");
    },
    get apiKey() {
      return str("PSP_API_KEY");
    },
    get secretKey() {
      return str("PSP_SECRET_KEY");
    },
    get merchantId() {
      return str("PSP_MERCHANT_ID");
    },
    get webhookSecret() {
      return str("PSP_WEBHOOK_SECRET");
    },
    get currencies() {
      return str("PSP_CURRENCIES", "TRY").split(",").map((c) => c.trim());
    },
  },

  crypto: {
    get provider() {
      return str("CRYPTO_PROVIDER", "none");
    },
    get apiKey() {
      return str("CRYPTO_API_KEY");
    },
    get webhookSecret() {
      return str("CRYPTO_WEBHOOK_SECRET");
    },
    /**
     * Cryptomus authenticates with a merchant uuid header rather than a bearer
     * token, and pays out with a second, separate API key.
     */
    get merchantId() {
      return str("CRYPTO_MERCHANT_ID");
    },
    get payoutApiKey() {
      return str("CRYPTO_PAYOUT_API_KEY");
    },
  },

  kyc: {
    get provider() {
      return str("KYC_PROVIDER", "none");
    },
    get baseUrl() {
      return str("KYC_BASE_URL");
    },
    get apiKey() {
      return str("KYC_API_KEY");
    },
    get webhookSecret() {
      return str("KYC_WEBHOOK_SECRET");
    },
  },

  risk: {
    get provider() {
      return str("RISK_PROVIDER", "none");
    },
    get apiKey() {
      return str("RISK_API_KEY");
    },
  },

  affiliate: {
    get enabled() {
      return bool("AFFILIATE_ENABLED", true);
    },
    get cookieDays() {
      return num("AFFILIATE_COOKIE_DAYS", 30);
    },
  },

  admin: {
    get email() {
      return str("ADMIN_EMAIL", "admin@aurora.local");
    },
    get password() {
      return str("ADMIN_PASSWORD", "Admin!2345");
    },
    get username() {
      return str("ADMIN_USERNAME", "superadmin");
    },
  },

  features: {
    get sportsbook() {
      return bool("FEATURE_SPORTSBOOK", true);
    },
    get liveCasino() {
      return bool("FEATURE_LIVE_CASINO", true);
    },
    get tournaments() {
      return bool("FEATURE_TOURNAMENTS", true);
    },
    get vip() {
      return bool("FEATURE_VIP", true);
    },
    get affiliates() {
      return bool("FEATURE_AFFILIATES", true);
    },
    get crypto() {
      return bool("FEATURE_CRYPTO", true);
    },
    get kyc() {
      return bool("FEATURE_KYC", true);
    },
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
