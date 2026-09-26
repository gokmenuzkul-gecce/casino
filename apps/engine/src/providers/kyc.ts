import { ProviderAdapter, ProviderHealth } from "./types.js";
import { env } from "../lib/env.js";
import { HttpClient, verifyHmac } from "../lib/http.js";
import { Errors } from "@aurora/shared";

export interface KycVerificationRequest {
  reference: string;
  fullName: string;
  birthDate: string;
  nationality: string;
  documentType: string;
  documentNumber: string;
  address: string;
  city: string;
  country: string;
  documentUrls: string[];
  ip?: string;
}

export interface KycVerificationResult {
  providerRef: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "IN_REVIEW";
  level?: number;
  pepMatch?: boolean;
  sanctionsMatch?: boolean;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH";
  reason?: string;
  raw?: unknown;
}

export interface KycAdapter extends ProviderAdapter {
  readonly kind: "kyc";
  verify(request: KycVerificationRequest): Promise<KycVerificationResult>;
  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): boolean;
}

/**
 * Demo KYC: performs deterministic local checks (format, sanctions list stub,
 * age) so the flow is exercisable without a vendor. Never approves a document
 * that is obviously malformed, which keeps the demo honest about its limits.
 */
export class DemoKyc implements KycAdapter {
  readonly kind = "kyc" as const;
  readonly name = "demo";
  readonly isConfigured = true;
  readonly mode = "demo" as const;

  async verify(request: KycVerificationRequest): Promise<KycVerificationResult> {
    const problems: string[] = [];
    if (request.documentNumber.replace(/\W/g, "").length < 5) problems.push("Belge numarasi gecersiz");
    const birth = new Date(request.birthDate);
    if (Number.isNaN(birth.getTime())) problems.push("Dogum tarihi gecersiz");
    else {
      const age = (Date.now() - birth.getTime()) / (365.25 * 24 * 3600 * 1000);
      if (age < 18) problems.push("18 yasindan kucuk");
      if (age > 120) problems.push("Dogum tarihi mantiksiz");
    }
    if (request.documentUrls.length === 0) problems.push("Belge yuklenmedi");

    if (problems.length > 0) {
      return {
        providerRef: `demo_kyc_${request.reference}`,
        status: "REJECTED",
        reason: problems.join("; "),
        riskLevel: "MEDIUM",
      };
    }
    return {
      providerRef: `demo_kyc_${request.reference}`,
      status: "IN_REVIEW",
      level: 1,
      pepMatch: false,
      sanctionsMatch: false,
      riskLevel: "LOW",
      reason: "Demo modu: otomatik kontroller gecti, manuel inceleme bekliyor.",
    };
  }

  verifyWebhook(): boolean {
    return false;
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      kind: this.kind,
      provider: this.name,
      mode: this.mode,
      configured: true,
      reachable: true,
      checkedAt: new Date().toISOString(),
      detail: "Demo KYC aktif. Gercek belge dogrulama icin KYC saglayicisi girin.",
    };
  }
}

/** Generic KYC vendor adapter: submit documents, receive a decision webhook. */
export class RestKyc implements KycAdapter {
  readonly kind = "kyc" as const;
  readonly isConfigured: boolean;
  readonly mode: "demo" | "live";
  readonly name: string;
  private readonly http: HttpClient;

  constructor(
    name: string,
    private readonly config: { baseUrl: string; apiKey: string; webhookSecret: string; path: string },
  ) {
    this.name = name;
    this.isConfigured = Boolean(config.baseUrl && config.apiKey);
    this.mode = this.isConfigured && env.platformMode === "live" ? "live" : "demo";
    this.http = new HttpClient(config.baseUrl, { authorization: `Bearer ${config.apiKey}` }, name);
  }

  async verify(request: KycVerificationRequest): Promise<KycVerificationResult> {
    if (!this.isConfigured) throw Errors.providerDisabled("KYC saglayicisi");
    const response = await this.http.request<Record<string, unknown>>({
      method: "POST",
      path: this.config.path,
      body: {
        reference: request.reference,
        applicant: {
          fullName: request.fullName,
          dateOfBirth: request.birthDate,
          nationality: request.nationality,
          address: { street: request.address, city: request.city, country: request.country },
        },
        document: { type: request.documentType, number: request.documentNumber, images: request.documentUrls },
        ip: request.ip,
      },
    });

    const status = String(response.status ?? "PENDING").toUpperCase();
    return {
      providerRef: String(response.id ?? response.applicantId ?? request.reference),
      status: status.includes("APPROV")
        ? "APPROVED"
        : status.includes("REJECT") || status.includes("DECLIN")
          ? "REJECTED"
          : status.includes("REVIEW")
            ? "IN_REVIEW"
            : "PENDING",
      level: response.level === undefined ? undefined : Number(response.level),
      pepMatch: Boolean(response.pepMatch ?? response.pep),
      sanctionsMatch: Boolean(response.sanctionsMatch ?? response.sanctions),
      riskLevel: str(response.riskLevel) as KycVerificationResult["riskLevel"],
      reason: str(response.reason ?? response.message),
      raw: response,
    };
  }

  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): boolean {
    if (!this.config.webhookSecret) return false;
    const signature = headers["x-signature"] ?? headers["x-kyc-signature"];
    if (!signature) return false;
    return verifyHmac(this.config.webhookSecret, rawBody, signature);
  }

  async healthCheck(): Promise<ProviderHealth> {
    if (!this.isConfigured) {
      return { kind: this.kind, provider: this.name, mode: this.mode, configured: false, reachable: null, checkedAt: new Date().toISOString(), detail: "KYC kimlik bilgileri eksik" };
    }
    return { kind: this.kind, provider: this.name, mode: this.mode, configured: true, reachable: null, checkedAt: new Date().toISOString() };
  }
}

function str(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : String(value);
}
