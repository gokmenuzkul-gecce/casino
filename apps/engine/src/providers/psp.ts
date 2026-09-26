import { ProviderAdapter, ProviderHealth } from "./types.js";
import { env } from "../lib/env.js";
import { HttpClient, signHmac, verifyHmac, canonicalize } from "../lib/http.js";
import { Errors } from "@aurora/shared";

export interface DepositRequest {
  reference: string;
  amount: string;
  currency: string;
  method: string;
  playerId: string;
  returnUrl: string;
  callbackUrl: string;
  ip?: string;
  userAgent?: string;
  description?: string;
}

export interface DepositResult {
  providerRef: string;
  status: "PENDING" | "COMPLETED" | "FAILED";
  /** Some methods redirect the player, others confirm server-to-server. */
  redirectUrl?: string;
  instructions?: string;
  raw?: unknown;
}

export interface WithdrawalRequest {
  reference: string;
  amount: string;
  currency: string;
  method: string;
  playerId: string;
  iban?: string;
  walletAddress?: string;
  accountHolder?: string;
  callbackUrl: string;
}

export interface WithdrawalResult {
  providerRef: string;
  status: "PENDING" | "COMPLETED" | "FAILED";
  estimatedArrival?: string;
  raw?: unknown;
}

export interface PayoutCallback {
  reference: string;
  providerRef: string;
  status: "COMPLETED" | "FAILED" | "CANCELLED";
  amount?: string;
  currency?: string;
  failureReason?: string;
}

export interface PspAdapter extends ProviderAdapter {
  readonly kind: "psp";
  createDeposit(request: DepositRequest): Promise<DepositResult>;
  createWithdrawal(request: WithdrawalRequest): Promise<WithdrawalResult>;
  queryStatus(reference: string): Promise<{ status: string; providerRef?: string; raw?: unknown }>;
  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): boolean;
  parseWebhook(payload: Record<string, unknown>): PayoutCallback;
}

/** Demo PSP: deposits confirm instantly, withdrawals auto-approve. No network. */
export class DemoPsp implements PspAdapter {
  readonly kind = "psp" as const;
  readonly name = "demo";
  readonly isConfigured = true;
  readonly mode = "demo" as const;

  async createDeposit(request: DepositRequest): Promise<DepositResult> {
    return {
      providerRef: `demo_dep_${request.reference}`,
      status: "COMPLETED",
      instructions: "Demo modu: yatirim aninda onaylandi. Gercek odeme icin PSP bilgilerini girin.",
    };
  }

  async createWithdrawal(request: WithdrawalRequest): Promise<WithdrawalResult> {
    return {
      providerRef: `demo_wd_${request.reference}`,
      status: "COMPLETED",
      estimatedArrival: "demo modu: aninda",
    };
  }

  async queryStatus(reference: string) {
    return { status: "COMPLETED", providerRef: `demo_${reference}` };
  }

  verifyWebhook(): boolean {
    return false;
  }

  parseWebhook(payload: Record<string, unknown>): PayoutCallback {
    return {
      reference: String(payload.reference ?? ""),
      providerRef: String(payload.providerRef ?? ""),
      status: "COMPLETED",
      amount: payload.amount === undefined ? undefined : String(payload.amount),
      currency: payload.currency === undefined ? undefined : String(payload.currency),
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      kind: this.kind,
      provider: this.name,
      mode: this.mode,
      configured: true,
      reachable: true,
      checkedAt: new Date().toISOString(),
      detail: "Demo odeme saglayicisi aktif. Gercek para akisi kapali.",
    };
  }
}

/**
 * Generic hosted-checkout PSP. Covers the common pattern: create a payment
 * intent, receive a redirect URL, then get a signed webhook when it settles.
 */
export class RestPsp implements PspAdapter {
  readonly kind = "psp" as const;
  readonly isConfigured: boolean;
  readonly mode: "demo" | "live";
  readonly name: string;
  private readonly http: HttpClient;

  constructor(
    name: string,
    private readonly config: {
      baseUrl: string;
      apiKey: string;
      secretKey: string;
      merchantId: string;
      webhookSecret: string;
      authScheme: "bearer" | "header";
      paths: { deposit: string; withdrawal: string; status: string };
    },
  ) {
    this.name = name;
    this.isConfigured = Boolean(config.baseUrl && config.apiKey && config.secretKey);
    this.mode = this.isConfigured && env.platformMode === "live" ? "live" : "demo";
    this.http = new HttpClient(
      config.baseUrl,
      config.authScheme === "bearer"
        ? { authorization: `Bearer ${config.apiKey}`, "x-merchant-id": config.merchantId }
        : { "x-api-key": config.apiKey, "x-secret-key": config.secretKey, "x-merchant-id": config.merchantId },
      name,
    );
  }

  private sign(body: Record<string, unknown>): { signature: string; timestamp: string } {
    const timestamp = Date.now().toString();
    return { signature: signHmac(this.config.secretKey, `${timestamp}${canonicalize(body)}`), timestamp };
  }

  async createDeposit(request: DepositRequest): Promise<DepositResult> {
    if (!this.isConfigured) throw Errors.providerDisabled("Odeme saglayicisi");
    const body = {
      merchantId: this.config.merchantId,
      merchantReference: request.reference,
      amount: request.amount,
      currency: request.currency,
      method: request.method,
      customerId: request.playerId,
      successUrl: request.returnUrl,
      failUrl: request.returnUrl,
      callbackUrl: request.callbackUrl,
      ip: request.ip,
      description: request.description,
    };
    const { signature, timestamp } = this.sign(body);
    const response = await this.http.request<Record<string, unknown>>({
      method: "POST",
      path: this.config.paths.deposit,
      body,
      headers: { "x-signature": signature, "x-timestamp": timestamp },
    });

    return {
      providerRef: String(response.paymentId ?? response.transactionId ?? response.id ?? ""),
      status: mapStatus(String(response.status ?? "PENDING")),
      redirectUrl: str(response.redirectUrl ?? response.paymentUrl ?? response.url),
      instructions: str(response.instructions ?? response.message),
      raw: response,
    };
  }

  async createWithdrawal(request: WithdrawalRequest): Promise<WithdrawalResult> {
    if (!this.isConfigured) throw Errors.providerDisabled("Odeme saglayicisi");
    const body = {
      merchantId: this.config.merchantId,
      merchantReference: request.reference,
      amount: request.amount,
      currency: request.currency,
      method: request.method,
      customerId: request.playerId,
      iban: request.iban,
      walletAddress: request.walletAddress,
      accountHolder: request.accountHolder,
      callbackUrl: request.callbackUrl,
    };
    const { signature, timestamp } = this.sign(body);
    const response = await this.http.request<Record<string, unknown>>({
      method: "POST",
      path: this.config.paths.withdrawal,
      body,
      headers: { "x-signature": signature, "x-timestamp": timestamp },
    });

    return {
      providerRef: String(response.payoutId ?? response.transactionId ?? response.id ?? ""),
      status: mapStatus(String(response.status ?? "PENDING")),
      estimatedArrival: str(response.estimatedArrival ?? response.eta),
      raw: response,
    };
  }

  async queryStatus(reference: string) {
    if (!this.isConfigured) throw Errors.providerDisabled("Odeme saglayicisi");
    const response = await this.http.request<Record<string, unknown>>({
      path: `${this.config.paths.status}/${encodeURIComponent(reference)}`,
      query: { merchantId: this.config.merchantId },
    });
    return {
      status: String(response.status ?? "UNKNOWN"),
      providerRef: str(response.transactionId ?? response.id),
      raw: response,
    };
  }

  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): boolean {
    if (!this.config.webhookSecret) return false;
    const signature = headers["x-signature"] ?? headers["x-webhook-signature"] ?? headers["signature"];
    if (!signature) return false;
    const candidates = [rawBody];
    try {
      candidates.push(canonicalize(JSON.parse(rawBody) as Record<string, unknown>));
    } catch {
      /* raw only */
    }
    return candidates.some((payload) => verifyHmac(this.config.webhookSecret, payload, signature));
  }

  parseWebhook(payload: Record<string, unknown>): PayoutCallback {
    const status = String(payload.status ?? "").toUpperCase();
    return {
      reference: String(payload.merchantReference ?? payload.reference ?? payload.merchant_reference ?? ""),
      providerRef: String(payload.transactionId ?? payload.payoutId ?? payload.id ?? ""),
      status: status.includes("COMPLETE") || status.includes("SUCCESS") ? "COMPLETED" : status.includes("CANCEL") ? "CANCELLED" : "FAILED",
      amount: payload.amount === undefined ? undefined : String(payload.amount),
      currency: payload.currency === undefined ? undefined : String(payload.currency),
      failureReason: str(payload.failureReason ?? payload.errorMessage),
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    if (!this.isConfigured) {
      return {
        kind: this.kind,
        provider: this.name,
        mode: this.mode,
        configured: false,
        reachable: null,
        checkedAt: new Date().toISOString(),
        detail: "PSP kimlik bilgileri eksik",
      };
    }
    try {
      await this.http.request({ path: this.config.paths.status, query: { merchantId: this.config.merchantId, probe: 1 }, retries: 1 });
      return { kind: this.kind, provider: this.name, mode: this.mode, configured: true, reachable: true, checkedAt: new Date().toISOString() };
    } catch (error) {
      return {
        kind: this.kind,
        provider: this.name,
        mode: this.mode,
        configured: true,
        reachable: false,
        checkedAt: new Date().toISOString(),
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

function mapStatus(status: string): "PENDING" | "COMPLETED" | "FAILED" {
  const upper = status.toUpperCase();
  if (upper.includes("COMPLETE") || upper.includes("SUCCESS") || upper.includes("APPROV")) return "COMPLETED";
  if (upper.includes("FAIL") || upper.includes("DECLIN") || upper.includes("REJECT")) return "FAILED";
  return "PENDING";
}

function str(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : String(value);
}
