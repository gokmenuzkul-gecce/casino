import { ProviderAdapter, ProviderHealth } from "./types.js";
import { env } from "../lib/env.js";
import { HttpClient, verifyHmac } from "../lib/http.js";
import { Errors } from "@aurora/shared";

export interface RiskAssessmentRequest {
  userId: string;
  event: "DEPOSIT" | "WITHDRAWAL" | "BET" | "LOGIN" | "REGISTER" | "BONUS";
  amount?: string;
  currency?: string;
  ip?: string;
  deviceId?: string;
  email?: string;
  country?: string;
  metadata?: Record<string, unknown>;
}

export interface RiskAssessmentResult {
  score: number;
  decision: "ALLOW" | "REVIEW" | "BLOCK";
  reasons: string[];
  raw?: unknown;
}

export interface RiskAdapter extends ProviderAdapter {
  readonly kind: "risk";
  assess(request: RiskAssessmentRequest): Promise<RiskAssessmentResult>;
}

/**
 * Rule-based risk engine used when no external vendor is configured. These
 * heuristics are deliberately conservative: they flag for review rather than
 * auto-blocking, except for clear sanctions/velocity breaches.
 */
export class RuleRiskEngine implements RiskAdapter {
  readonly kind = "risk" as const;
  readonly name = "rules";
  readonly isConfigured = true;
  readonly mode = "demo" as const;

  async assess(request: RiskAssessmentRequest): Promise<RiskAssessmentResult> {
    const reasons: string[] = [];
    let score = 0;

    const amount = request.amount ? Number(request.amount) : 0;
    if (request.event === "WITHDRAWAL" && amount > 50_000) {
      score += 30;
      reasons.push("Yuksek tutarli cekim");
    }
    if (request.event === "DEPOSIT" && amount > 100_000) {
      score += 20;
      reasons.push("Yuksek tutarli yatirim");
    }
    if (request.metadata?.newDevice === true) {
      score += 15;
      reasons.push("Yeni cihaz");
    }
    if (request.metadata?.newCountry === true) {
      score += 25;
      reasons.push("Yeni ulke");
    }
    if (request.metadata?.vpnDetected === true) {
      score += 20;
      reasons.push("VPN/proxy tespit edildi");
    }
    if (request.metadata?.chargebackHistory === true) {
      score += 40;
      reasons.push("Gecmis chargeback");
    }

    const decision = score >= 60 ? "BLOCK" : score >= 30 ? "REVIEW" : "ALLOW";
    return { score, decision, reasons };
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      kind: this.kind,
      provider: this.name,
      mode: this.mode,
      configured: true,
      reachable: true,
      checkedAt: new Date().toISOString(),
      detail: "Dahili kural motoru aktif",
    };
  }
}

/** External risk vendor adapter. */
export class RestRisk implements RiskAdapter {
  readonly kind = "risk" as const;
  readonly isConfigured: boolean;
  readonly mode: "demo" | "live";
  readonly name: string;
  private readonly http: HttpClient;

  constructor(name: string, config: { baseUrl: string; apiKey: string; path: string; webhookSecret?: string }) {
    this.name = name;
    this.isConfigured = Boolean(config.baseUrl && config.apiKey);
    this.mode = this.isConfigured && env.platformMode === "live" ? "live" : "demo";
    this.http = new HttpClient(config.baseUrl, { authorization: `Bearer ${config.apiKey}` }, name);
  }

  async assess(request: RiskAssessmentRequest): Promise<RiskAssessmentResult> {
    if (!this.isConfigured) throw Errors.providerDisabled("Risk saglayicisi");
    const response = await this.http.request<Record<string, unknown>>({
      method: "POST",
      path: "/assess",
      body: request,
    });
    const score = Number(response.score ?? response.riskScore ?? 0);
    const decisionRaw = String(response.decision ?? "").toUpperCase();
    return {
      score,
      decision: decisionRaw.includes("BLOCK") ? "BLOCK" : decisionRaw.includes("REVIEW") ? "REVIEW" : "ALLOW",
      reasons: Array.isArray(response.reasons) ? response.reasons.map(String) : [],
      raw: response,
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      kind: this.kind,
      provider: this.name,
      mode: this.mode,
      configured: this.isConfigured,
      reachable: null,
      checkedAt: new Date().toISOString(),
    };
  }
}

export interface CryptoPaymentRequest {
  reference: string;
  amount: string;
  currency: string;
  callbackUrl: string;
  /** Where the player lands after paying, and where to send them to pay. */
  returnUrl?: string;
}

export interface CryptoPaymentResult {
  providerRef: string;
  address?: string;
  amount?: string;
  currency?: string;
  expiresAt?: string;
  qrCode?: string;
  status: string;
  /** Hosted payment page to redirect the player to, when the provider has one. */
  url?: string;
}

/** Normalised crypto callback, matching the PSP callback vocabulary. */
export interface ParsedCryptoCallback {
  reference: string;
  providerRef: string;
  status: "COMPLETED" | "FAILED" | "CANCELLED" | "PENDING";
  amount?: string;
  currency?: string;
  failureReason?: string;
}

export interface CryptoPayoutRequest {
  reference: string;
  amount: string;
  currency: string;
  /** Destination wallet address for the payout. */
  address: string;
  callbackUrl: string;
}

export interface CryptoPayoutResult {
  providerRef: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  raw?: unknown;
}

export interface CryptoAdapter extends ProviderAdapter {
  readonly kind: "crypto";
  createInvoice(request: CryptoPaymentRequest): Promise<CryptoPaymentResult>;
  createPayout(request: CryptoPayoutRequest): Promise<CryptoPayoutResult>;
  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): boolean;
  parseWebhook(payload: Record<string, unknown>): ParsedCryptoCallback;
}

export class DisabledCrypto implements CryptoAdapter {
  readonly kind = "crypto" as const;
  readonly name = "none";
  readonly isConfigured = false;
  readonly mode = "demo" as const;

  async createInvoice(): Promise<CryptoPaymentResult> {
    throw Errors.providerDisabled("Kripto odeme saglayicisi");
  }
  async createPayout(): Promise<CryptoPayoutResult> {
    throw Errors.providerDisabled("Kripto odeme saglayicisi");
  }
  verifyWebhook(): boolean {
    return false;
  }
  parseWebhook(): ParsedCryptoCallback {
    return { reference: "", providerRef: "", status: "PENDING" };
  }
  async healthCheck(): Promise<ProviderHealth> {
    return { kind: this.kind, provider: this.name, mode: this.mode, configured: false, reachable: null, checkedAt: new Date().toISOString(), detail: "CRYPTO_PROVIDER bos" };
  }
}

export class RestCrypto implements CryptoAdapter {
  readonly kind = "crypto" as const;
  readonly isConfigured: boolean;
  readonly mode: "demo" | "live";
  readonly name: string;
  private readonly http: HttpClient;

  constructor(name: string, private readonly config: { baseUrl: string; apiKey: string; webhookSecret: string }) {
    this.name = name;
    this.isConfigured = Boolean(config.baseUrl && config.apiKey);
    this.mode = this.isConfigured && env.platformMode === "live" ? "live" : "demo";
    this.http = new HttpClient(config.baseUrl, { authorization: `Token ${config.apiKey}` }, name);
  }

  async createInvoice(request: CryptoPaymentRequest): Promise<CryptoPaymentResult> {
    if (!this.isConfigured) throw Errors.providerDisabled("Kripto odeme saglayicisi");
    const response = await this.http.request<Record<string, unknown>>({
      method: "POST",
      path: "/invoice",
      body: { order_id: request.reference, price_amount: request.amount, price_currency: request.currency, callback_url: request.callbackUrl },
    });
    return {
      providerRef: String(response.id ?? response.invoiceId ?? ""),
      address: str(response.pay_address ?? response.address),
      amount: str(response.pay_amount),
      currency: str(response.pay_currency),
      expiresAt: str(response.expiration_estimate_date ?? response.expiresAt),
      qrCode: str(response.qr_code ?? response.qrCode),
      status: String(response.status ?? "PENDING"),
      url: str(response.invoice_url ?? response.url),
    };
  }

  async createPayout(request: CryptoPayoutRequest): Promise<CryptoPayoutResult> {
    if (!this.isConfigured) throw Errors.providerDisabled("Kripto odeme saglayicisi");
    const response = await this.http.request<Record<string, unknown>>({
      method: "POST",
      path: "/payout",
      body: {
        order_id: request.reference,
        amount: request.amount,
        currency: request.currency,
        address: request.address,
        callback_url: request.callbackUrl,
      },
    });
    const raw = String(response.status ?? "").toLowerCase();
    const status: CryptoPayoutResult["status"] =
      ["finished", "complete", "completed", "paid"].includes(raw)
        ? "COMPLETED"
        : ["failed", "fail", "rejected", "expired"].includes(raw)
          ? "FAILED"
          : raw === "processing"
            ? "PROCESSING"
            : "PENDING";
    return { providerRef: String(response.id ?? response.uuid ?? ""), status, raw: response };
  }

  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): boolean {
    if (!this.config.webhookSecret) return false;
    const signature = headers["x-signature"] ?? headers["hmac"] ?? headers["x-crypto-signature"];
    if (!signature) return false;
    return verifyHmac(this.config.webhookSecret, rawBody, signature);
  }

  parseWebhook(payload: Record<string, unknown>): ParsedCryptoCallback {
    const raw = String(payload.payment_status ?? payload.status ?? "").toLowerCase();
    const status: ParsedCryptoCallback["status"] =
      ["confirmed", "finished", "complete", "completed", "paid"].includes(raw)
        ? "COMPLETED"
        : ["failed", "fail", "expired", "cancelled", "canceled"].includes(raw)
          ? raw.includes("cancel")
            ? "CANCELLED"
            : "FAILED"
          : "PENDING";
    return {
      reference: String(payload.order_id ?? payload.reference ?? ""),
      providerRef: String(payload.invoice_id ?? payload.id ?? payload.uuid ?? ""),
      status,
      amount: str(payload.price_amount ?? payload.amount),
      currency: str(payload.price_currency ?? payload.currency),
      failureReason: status === "FAILED" ? `Durum: ${raw}` : undefined,
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { kind: this.kind, provider: this.name, mode: this.mode, configured: this.isConfigured, reachable: null, checkedAt: new Date().toISOString() };
  }
}

export interface SmsAdapter extends ProviderAdapter {
  readonly kind: "sms";
  send(to: string, message: string): Promise<{ providerRef?: string }>;
}

export class ConsoleSms implements SmsAdapter {
  readonly kind = "sms" as const;
  readonly name = "console";
  readonly isConfigured = true;
  readonly mode = "demo" as const;

  async send(to: string, message: string) {
    console.log(`[sms:demo] -> ${to}: ${message}`);
    return { providerRef: `console_${Date.now()}` };
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { kind: this.kind, provider: this.name, mode: this.mode, configured: true, reachable: true, checkedAt: new Date().toISOString(), detail: "SMS konsola yaziliyor" };
  }
}

export class HttpSms implements SmsAdapter {
  readonly kind = "sms" as const;
  readonly isConfigured: boolean;
  readonly mode: "demo" | "live";
  readonly name: string;

  constructor(name: string, private readonly config: { apiKey: string; sender: string; endpoint: string }) {
    this.name = name;
    this.isConfigured = Boolean(config.apiKey && config.endpoint);
    this.mode = this.isConfigured && env.platformMode === "live" ? "live" : "demo";
  }

  async send(to: string, message: string) {
    if (!this.isConfigured) throw Errors.providerDisabled("SMS saglayicisi");
    const response = await fetch(this.config.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.config.apiKey}` },
      body: JSON.stringify({ to, message, sender: this.config.sender }),
    });
    if (!response.ok) throw Errors.providerError(this.name, `HTTP ${response.status}`);
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { providerRef: str(data.id ?? data.messageId) };
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { kind: this.kind, provider: this.name, mode: this.mode, configured: this.isConfigured, reachable: null, checkedAt: new Date().toISOString() };
  }
}

export function isProviderAdapter(value: unknown): value is ProviderAdapter {
  return typeof value === "object" && value !== null && "kind" in value && "healthCheck" in value;
}

function str(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : String(value);
}
