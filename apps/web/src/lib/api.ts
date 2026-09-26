const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

let accessToken: string | null = localStorage.getItem("aurora_access_token");
let refreshToken: string | null = localStorage.getItem("aurora_refresh_token");
let refreshing: Promise<boolean> | null = null;

export function setTokens(tokens: { accessToken: string; refreshToken: string } | null): void {
  accessToken = tokens?.accessToken ?? null;
  refreshToken = tokens?.refreshToken ?? null;
  if (tokens) {
    localStorage.setItem("aurora_access_token", tokens.accessToken);
    localStorage.setItem("aurora_refresh_token", tokens.refreshToken);
  } else {
    localStorage.removeItem("aurora_access_token");
    localStorage.removeItem("aurora_refresh_token");
  }
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Refresh once, shared across concurrent 401s. */
async function tryRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const response = await fetch(`${BASE}/api/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken }),
        credentials: "include",
      });
      if (!response.ok) return false;
      const data = (await response.json()) as { tokens: { accessToken: string; refreshToken: string } };
      setTokens(data.tokens);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  retry?: boolean;
}

export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;

  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: "include",
  });

  if (response.status === 401 && options.retry !== false) {
    const ok = await tryRefresh();
    if (ok) return api<T>(path, { ...options, retry: false });
  }

  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : {};

  if (!response.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } }).error;
    throw new ApiError(err?.message ?? `HTTP ${response.status}`, err?.code ?? "UNKNOWN", response.status, err?.details);
  }
  return data as T;
}

export const get = <T>(path: string): Promise<T> => api<T>(path);
export const post = <T>(path: string, body?: unknown): Promise<T> => api<T>(path, { method: "POST", body });
export const patch = <T>(path: string, body?: unknown): Promise<T> => api<T>(path, { method: "PATCH", body });
export const put = <T>(path: string, body?: unknown): Promise<T> => api<T>(path, { method: "PUT", body });
export const del = <T>(path: string): Promise<T> => api<T>(path, { method: "DELETE" });

/** Format a decimal amount for display, with the currency symbol. */
export function money(value: string | number | null | undefined, currency = "TRY"): string {
  if (value === null || value === undefined) return "0.00";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "0.00";
  const symbols: Record<string, string> = { TRY: "₺", USD: "$", EUR: "€", USDT: "₮", BTC: "₿" };
  return `${symbols[currency] ?? ""}${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
