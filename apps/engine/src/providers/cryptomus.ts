/**
 * Cryptomus (cryptomus.com) merchant adapter.
 *
 * Cryptomus does not fit the generic REST crypto adapter: it authenticates with
 * a body signature rather than a bearer token, and it puts the webhook signature
 * inside the payload instead of a header. Three details in its contract are easy
 * to get wrong and each one silently rejects every request:
 *
 * 1. `sign` is `md5(base64(json_body) + API_KEY)` — base64 of the body, not a
 *    hex digest of it. Sending the body with a different serialization than the
 *    one that was signed breaks the check, so the exact string we sign is the
 *    exact string we send.
 * 2. PHP's `json_encode` escapes forward slashes (`/` -> `\/`); `JSON.stringify`
 *    does not. Cryptomus recomputes the signature from the raw body it received,
 *    so outbound bodies must escape slashes and inbound verification must
 *    re-serialize with slashes escaped. Without this, any value containing a `/`
 *    (urls, txids) produces a mismatch.
 * 3. The webhook signature covers the payload WITHOUT the `sign` field.
 *
 * Deposits (invoice) use the payment API key. Payouts use a separate payout key
 * and endpoint, which is why they are configured independently.
 *
 * See https://doc.cryptomus.com/merchant-api/request-format and
 * https://doc.cryptomus.com/merchant-api/payments/webhook.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "../lib/env.js";
import { HttpClient } from "../lib/http.js";
import { ProviderHealth } from "./types.js";
import { CryptoAdapter, CryptoPaymentRequest, CryptoPaymentResult, CryptoPayoutRequest, CryptoPayoutResult } from "./risk.js";
import { Errors } from "@aurora/shared";

/** PHP-compatible JSON: escapes forward slashes the way json_encode does. */
export function phpJson(value: unknown): string {
  return JSON.stringify(value).replace(/\//g, "\\/");
}

/** md5(base64(body) + apiKey), hex. Used for requests and webhook checks. */
export function cryptomusSign(body: string, apiKey: string): string {
  return createHash("md5").update(Buffer.from(body, "utf8").toString("base64") + apiKey).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

/**
 * Cryptomus payment statuses -> our internal vocabulary.
 *
 * `confirm_check` means the network has not confirmed yet: it is NOT final and
 * must not credit. `wrong_amount` is a real failure the player has to see.
 * `refund_*` are post-settlement reversals, which for a deposit means the funds
 * are being taken back, so they are reported as FAILED rather than COMPLETED.
 */
export function mapCryptomusStatus(status: string): "PENDING" | "COMPLETED" | "FAILED" | "CANCELLED" {
  switch (status) {
    case "paid":
    case "paid_over":
      return "COMPLETED";
    case "cancel":
      return "CANCELLED";
    case "fail":
    case "wrong_amount":
    case "system_fail":
    case "refund_process":
    case "refund_fail":
    case "refund_paid":
      return "FAILED";
    case "confirm_check":
    default:
      return "PENDING";
  }
}

export class CryptomusCrypto implements CryptoAdapter {
  readonly kind = "crypto" as const;
  readonly name = "cryptomus";
  readonly isConfigured: boolean;
  readonly mode: "demo" | "live";
  private readonly http: HttpClient;

  constructor(
    private readonly config: {
      baseUrl: string;
      apiKey: string;
      merchantId: string;
      payoutApiKey: string;
    },
  ) {
    this.isConfigured = Boolean(config.baseUrl && config.apiKey && config.merchantId);
    this.mode = this.isConfigured && env.platformMode === "live" ? "live" : "demo";
    this.http = new HttpClient(config.baseUrl, {}, this.name);
  }

  /** POST with the body signature Cryptomus expects. */
  private async post<T>(path: string, payload: Record<string, unknown>): Promise<T> {
    if (!this.isConfigured) throw Errors.providerDisabled("Kripto odeme saglayicisi");
    const body = phpJson(payload);
    return this.http.request<T>({
      method: "POST",
      path,
      body,
      headers: {
        "content-type": "application/json",
        merchant: this.config.merchantId,
        sign: cryptomusSign(body, this.config.apiKey),
      },
    });
  }

  async createInvoice(request: CryptoPaymentRequest): Promise<CryptoPaymentResult> {
    const response = await this.post<{ result?: Record<string, unknown> }>("/v1/payment", {
      amount: request.amount,
      currency: request.currency,
      order_id: request.reference,
      url_callback: request.callbackUrl,
      url_return: request.returnUrl,
      url_success: request.returnUrl,
      is_payment_multiple: false,
    });

    const result = response.result ?? {};
    return {
      providerRef: String(result.uuid ?? ""),
      address: result.address === undefined || result.address === null ? undefined : String(result.address),
      amount: result.payer_amount === undefined ? undefined : String(result.payer_amount),
      currency: result.payer_currency === undefined ? undefined : String(result.payer_currency),
      expiresAt: result.expired_at === undefined ? undefined : String(result.expired_at),
      qrCode: undefined,
      // The hosted payment form is what the player is redirected to.
      status: "PENDING",
      url: result.url === undefined ? undefined : String(result.url),
    };
  }

  /**
   * Payouts use a separate API key from deposits, which is why the adapter
   * takes both. Cryptomus splits the two so a leaked deposit key cannot drain
   * the merchant balance.
   */
  async createPayout(request: CryptoPayoutRequest): Promise<CryptoPayoutResult> {
    if (!this.isConfigured || !this.config.payoutApiKey) {
      throw Errors.providerDisabled("Kripto cekim saglayicisi");
    }
    const body = phpJson({
      amount: request.amount,
      currency: request.currency,
      order_id: request.reference,
      address: request.address,
      url_callback: request.callbackUrl,
      is_subtract: true,
    });
    const response = await this.http.request<{ result?: Record<string, unknown> }>({
      method: "POST",
      path: "/v1/payout",
      body,
      headers: {
        "content-type": "application/json",
        merchant: this.config.merchantId,
        sign: cryptomusSign(body, this.config.payoutApiKey),
      },
    });

    const result = response.result ?? {};
    const raw = String(result.status ?? "").toLowerCase();
    const status: CryptoPayoutResult["status"] =
      ["paid", "complete", "completed", "finished"].includes(raw)
        ? "COMPLETED"
        : ["fail", "failed", "rejected", "cancel", "system_fail"].includes(raw)
          ? "FAILED"
          : raw === "process" || raw === "processing"
            ? "PROCESSING"
            : "PENDING";
    return { providerRef: String(result.uuid ?? ""), status, raw: result };
  }

  /**
   * The signature travels in the payload, so it is parsed out of the raw body
   * and the remainder is re-serialized exactly as Cryptomus signed it.
   */
  verifyWebhook(rawBody: string, _headers: Record<string, string | undefined>): boolean {
    if (!this.config.apiKey) return false;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return false;
    }
    const sign = parsed.sign;
    if (typeof sign !== "string" || sign === "") return false;
    const { sign: _omit, ...rest } = parsed;
    return safeEqualHex(cryptomusSign(phpJson(rest), this.config.apiKey), sign);
  }

  parseWebhook(payload: Record<string, unknown>): {
    reference: string;
    providerRef: string;
    status: "COMPLETED" | "FAILED" | "CANCELLED" | "PENDING";
    amount?: string;
    currency?: string;
    failureReason?: string;
  } {
    const status = mapCryptomusStatus(String(payload.status ?? ""));
    return {
      reference: String(payload.order_id ?? ""),
      providerRef: String(payload.uuid ?? ""),
      status,
      amount: payload.payment_amount === undefined ? undefined : String(payload.payment_amount),
      currency: payload.payer_currency === undefined ? undefined : String(payload.payer_currency),
      failureReason: status === "FAILED" ? `Cryptomus durumu: ${String(payload.status ?? "bilinmiyor")}` : undefined,
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
        detail: "Cryptomus merchant id veya API anahtari eksik",
      };
    }
    // There is no cheap read-only probe that does not create an object, so the
    // adapter reports configuration state without a network call.
    return {
      kind: this.kind,
      provider: this.name,
      mode: this.mode,
      configured: true,
      reachable: null,
      checkedAt: new Date().toISOString(),
      detail: "Cryptomus yapilandirildi. Canli akis icin PLATFORM_MODE=live gerekir.",
    };
  }
}
