import { createHmac, timingSafeEqual } from "node:crypto";
import { Errors } from "@aurora/shared";

export interface HttpRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Retry count for idempotent verbs. POST is never retried by default. */
  retries?: number;
}

export class HttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly defaultHeaders: Record<string, string> = {},
    private readonly providerName = "provider",
  ) {}

  private buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
    const url = new URL(path.replace(/^\//, ""), this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  async request<T = unknown>(options: HttpRequestOptions): Promise<T> {
    const method = options.method ?? "GET";
    const maxAttempts = options.retries ?? (method === "GET" ? 3 : 1);
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
      try {
        const response = await fetch(this.buildUrl(options.path, options.query), {
          method,
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            ...this.defaultHeaders,
            ...options.headers,
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: controller.signal,
        });

        const text = await response.text();
        const parsed = text ? safeJson(text) : null;

        if (!response.ok) {
          // 4xx are deterministic client errors: do not retry.
          if (response.status >= 400 && response.status < 500) {
            throw Errors.providerError(this.providerName, `HTTP ${response.status}: ${text.slice(0, 300)}`);
          }
          throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
        }
        return parsed as T;
      } catch (error) {
        lastError = error;
        if (error instanceof Error && error.name === "AbortError") {
          lastError = new Error(`timeout after ${options.timeoutMs ?? 15_000}ms`);
        }
        if (attempt < maxAttempts) await delay(250 * attempt);
      } finally {
        clearTimeout(timeout);
      }
    }

    throw Errors.providerError(this.providerName, lastError instanceof Error ? lastError.message : String(lastError));
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** HMAC-SHA256 signature over a canonical payload, hex encoded. */
export function signHmac(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function verifyHmac(secret: string, payload: string, signature: string): boolean {
  const expected = Buffer.from(signHmac(secret, payload), "hex");
  const actual = Buffer.from(signature, "hex");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * Canonical string for callback verification: sorted key=value pairs joined by
 * "&". Providers differ in their exact scheme, so adapters override this.
 */
export function canonicalize(payload: Record<string, unknown>): string {
  return Object.keys(payload)
    .filter((key) => payload[key] !== undefined && payload[key] !== null)
    .sort()
    .map((key) => `${key}=${typeof payload[key] === "object" ? JSON.stringify(payload[key]) : String(payload[key])}`)
    .join("&");
}
