/**
 * Provider integration layer.
 *
 * Every external dependency (game aggregator, PSP, KYC, risk, crypto, messaging)
 * is behind an interface with a demo implementation and a live implementation.
 * The active implementation is chosen at boot from environment configuration,
 * so filling in credentials and setting PLATFORM_MODE=live is enough to go live
 * with no code changes.
 */

export type ProviderKind = "gameAggregator" | "psp" | "crypto" | "kyc" | "risk" | "sms" | "mail";

export interface ProviderHealth {
  kind: ProviderKind;
  provider: string;
  mode: "demo" | "live";
  configured: boolean;
  reachable: boolean | null;
  checkedAt: string;
  detail?: string;
}

/** Base contract: every adapter can report whether it is usable. */
export interface ProviderAdapter {
  readonly kind: ProviderKind;
  readonly name: string;
  readonly isConfigured: boolean;
  readonly mode: "demo" | "live";
  healthCheck(): Promise<ProviderHealth>;
}
