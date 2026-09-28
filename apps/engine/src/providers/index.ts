import { env } from "../lib/env.js";
import { ProviderAdapter, ProviderHealth, ProviderKind } from "./types.js";
import {
  DisabledAggregator,
  GameAggregatorAdapter,
  RestAggregator,
} from "./aggregator.js";
import { GregmornAggregator } from "./gregmorn.js";
import { BetSkillaAggregator } from "./betskilla.js";
import { LoginxGamesAggregator, loginxVendorsFromEnv } from "./loginx.js";
import { DemoPsp, PspAdapter, RestPsp } from "./psp.js";
import { CryptomusCrypto } from "./cryptomus.js";
import { DemoKyc, KycAdapter, RestKyc } from "./kyc.js";
import {
  ConsoleSms,
  CryptoAdapter,
  DisabledCrypto,
  HttpSms,
  RestCrypto,
  RestRisk,
  RiskAdapter,
  RuleRiskEngine,
  SmsAdapter,
} from "./risk.js";

/**
 * Adapter selection is a pure function of environment configuration. This is the
 * single place where "which provider is active" is decided, so operators go live
 * by editing .env, not code.
 *
 * Known aggregator profiles carry the auth scheme and endpoint paths that most
 * vendors of that family use; anything else falls back to a generic REST shape.
 */
const AGGREGATOR_PROFILES: Record<
  string,
  {
    authScheme: "bearer" | "header" | "query";
    paths: { games: string; launch: string };
  }
> = {
  generic: { authScheme: "bearer", paths: { games: "/games", launch: "/games/launch" } },
  softswiss: { authScheme: "header", paths: { games: "/api/v1/games", launch: "/api/v1/games/launch" } },
  slotegrator: { authScheme: "bearer", paths: { games: "/api/games/list", launch: "/api/games/launch" } },
  "1x2": { authScheme: "header", paths: { games: "/api/v1/games", launch: "/api/v1/session" } },
  hub88: { authScheme: "bearer", paths: { games: "/api/v1/games", launch: "/api/v1/launch" } },
  pragmatic: { authScheme: "header", paths: { games: "/api/games", launch: "/api/launch" } },
};

const PSP_PROFILES: Record<
  string,
  {
    authScheme: "bearer" | "header";
    paths: { deposit: string; withdrawal: string; status: string };
  }
> = {
  generic: { authScheme: "header", paths: { deposit: "/payments", withdrawal: "/payouts", status: "/payments" } },
  payfix: { authScheme: "header", paths: { deposit: "/api/payin/create", withdrawal: "/api/payout/create", status: "/api/payment/status" } },
  papara: { authScheme: "bearer", paths: { deposit: "/payments", withdrawal: "/payouts", status: "/payments" } },
  stripe: { authScheme: "bearer", paths: { deposit: "/v1/payment_intents", withdrawal: "/v1/payouts", status: "/v1/payment_intents" } },
  payhound: { authScheme: "header", paths: { deposit: "/api/deposit", withdrawal: "/api/withdraw", status: "/api/status" } },
};

export function buildAggregator(): GameAggregatorAdapter {
  const { provider, baseUrl, apiKey, secret, merchantId, callbackSecret } = env.gameAggregator;

  // Gregmorn speaks its own protocol (two hosts, token auth, command callbacks),
  // so it bypasses the generic profile table entirely.
  if (provider === "gregmorn") {
    const gregmorn = new GregmornAggregator({
      officeBaseUrl: env.gregmorn.officeBaseUrl,
      clientBaseUrl: env.gregmorn.clientBaseUrl,
      login: env.gregmorn.login,
      password: env.gregmorn.password,
      secretKey: env.gregmorn.secretKey,
      userId: env.gregmorn.userId,
      currency: env.gregmorn.currency,
    });
    return gregmorn.isConfigured ? gregmorn : new DisabledAggregator();
  }

  // BetSkilla brands (Xenzora, Kingsbet) front everything behind the brand host
  // with a cookie session, so they get their own adapter too.
  if (provider === "betskilla" || provider === "xenzora" || provider === "kingsbet") {
    const betskilla = new BetSkillaAggregator({
      baseUrl: env.betskilla.baseUrl,
      login: env.betskilla.login,
      password: env.betskilla.password,
      currency: env.betskilla.currency,
      callbackSecret: env.betskilla.callbackSecret,
    });
    return betskilla.isConfigured ? betskilla : new DisabledAggregator();
  }

  // loginxgamesapi fronts four vendors (Pragmatic Play, PG Soft, Amatic,
  // Amusnet) behind one GitSlotPark Seamless Wallet API v2 contract: catalogue,
  // userAuth launch and the five wallet callbacks.
  if (provider === "loginx") {
    const loginx = new LoginxGamesAggregator({
      vendors: loginxVendorsFromEnv((key) => process.env[key] ?? ""),
      currency: env.loginx.currency,
    });
    return loginx.isConfigured ? loginx : new DisabledAggregator();
  }

  if (!provider || provider === "none" || !baseUrl || !apiKey) return new DisabledAggregator();

  const profile = AGGREGATOR_PROFILES[provider] ?? AGGREGATOR_PROFILES.generic!;
  return new RestAggregator(provider, {
    baseUrl,
    apiKey,
    secret: secret || apiKey,
    merchantId: merchantId || "merchant",
    callbackSecret: callbackSecret || secret,
    authScheme: profile.authScheme,
    paths: profile.paths,
  });
}

export function buildPsp(): PspAdapter {
  const { provider, baseUrl, apiKey, secretKey, merchantId, webhookSecret } = env.psp;
  if (!provider || provider === "none" || !baseUrl || !apiKey) return new DemoPsp();

  const profile = PSP_PROFILES[provider] ?? PSP_PROFILES.generic!;
  return new RestPsp(provider, {
    baseUrl,
    apiKey,
    secretKey: secretKey || apiKey,
    merchantId: merchantId || "merchant",
    webhookSecret: webhookSecret || secretKey,
    authScheme: profile.authScheme,
    paths: profile.paths,
  });
}

export function buildKyc(): KycAdapter {
  const { provider, baseUrl, apiKey, webhookSecret } = env.kyc;
  if (!provider || provider === "none" || !baseUrl || !apiKey) return new DemoKyc();
  return new RestKyc(provider, { baseUrl, apiKey, webhookSecret, path: "/applicants" });
}

export function buildRisk(): RiskAdapter {
  const { provider, apiKey } = env.risk;
  if (!provider || provider === "none" || !apiKey) return new RuleRiskEngine();
  const baseUrl = process.env.RISK_BASE_URL ?? "";
  if (!baseUrl) return new RuleRiskEngine();
  return new RestRisk(provider, { baseUrl, apiKey, path: "/assess" });
}

export function buildCrypto(): CryptoAdapter {
  const { provider, apiKey, webhookSecret, merchantId, payoutApiKey } = env.crypto;
  const baseUrl = process.env.CRYPTO_BASE_URL ?? "";
  if (!provider || provider === "none") return new DisabledCrypto();

  // Cryptomus has its own protocol: body signatures, payload-borne webhook
  // signature and a separate payout key. It never fits the generic adapter.
  if (provider === "cryptomus") {
    return new CryptomusCrypto({ baseUrl: baseUrl || "https://api.cryptomus.com", apiKey, merchantId, payoutApiKey });
  }

  if (!apiKey || !baseUrl) return new DisabledCrypto();
  return new RestCrypto(provider, { baseUrl, apiKey, webhookSecret });
}

export function buildSms(): SmsAdapter {
  const { provider, apiKey, sender } = env.sms;
  const endpoint = process.env.SMS_ENDPOINT ?? "";
  if (!provider || provider === "console" || !apiKey || !endpoint) return new ConsoleSms();
  return new HttpSms(provider, { apiKey, sender, endpoint });
}

/** All adapters in one place, resolved once at boot. */
export interface ProviderRegistry {
  gameAggregator: GameAggregatorAdapter;
  psp: PspAdapter;
  kyc: KycAdapter;
  risk: RiskAdapter;
  crypto: CryptoAdapter;
  sms: SmsAdapter;
}

export function createProviderRegistry(): ProviderRegistry {
  return {
    gameAggregator: buildAggregator(),
    psp: buildPsp(),
    kyc: buildKyc(),
    risk: buildRisk(),
    crypto: buildCrypto(),
    sms: buildSms(),
  };
}

/** Health snapshot for the admin integrations page. */
export async function registryHealth(registry: ProviderRegistry): Promise<ProviderHealth[]> {
  const adapters: ProviderAdapter[] = [
    registry.gameAggregator,
    registry.psp,
    registry.kyc,
    registry.risk,
    registry.crypto,
    registry.sms,
  ];
  return Promise.all(
    adapters.map(async (adapter) => {
      try {
        return await adapter.healthCheck();
      } catch (error) {
        return {
          kind: adapter.kind as ProviderKind,
          provider: adapter.name,
          mode: adapter.mode,
          configured: adapter.isConfigured,
          reachable: false,
          checkedAt: new Date().toISOString(),
          detail: error instanceof Error ? error.message : String(error),
        } satisfies ProviderHealth;
      }
    }),
  );
}

export type { ProviderHealth, ProviderKind };
