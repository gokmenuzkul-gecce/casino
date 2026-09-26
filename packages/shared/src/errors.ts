export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, statusCode = 400, details?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const Errors = {
  unauthorized: (msg = "Oturum bulunamadi") => new AppError("UNAUTHORIZED", msg, 401),
  forbidden: (msg = "Bu islem icin yetkiniz yok") => new AppError("FORBIDDEN", msg, 403),
  notFound: (resource = "Kayit") => new AppError("NOT_FOUND", `${resource} bulunamadi`, 404),
  conflict: (msg: string) => new AppError("CONFLICT", msg, 409),
  validation: (msg: string, details?: Record<string, unknown>) => new AppError("VALIDATION", msg, 422, details),
  insufficientFunds: () => new AppError("INSUFFICIENT_FUNDS", "Yetersiz bakiye", 400),
  limitExceeded: (msg: string) => new AppError("LIMIT_EXCEEDED", msg, 400),
  rateLimited: (msg = "Cok fazla istek gonderdiniz") => new AppError("RATE_LIMITED", msg, 429),
  providerDisabled: (name: string) =>
    new AppError(
      "PROVIDER_DISABLED",
      `${name} saglayicisi yapilandirilmamis. .env dosyasinda kimlik bilgilerini girin ve PLATFORM_MODE=live yapin.`,
      503,
    ),
  providerError: (name: string, detail: string) => new AppError("PROVIDER_ERROR", `${name}: ${detail}`, 502),
  accountBlocked: (reason: string) => new AppError("ACCOUNT_BLOCKED", reason, 403),
  internal: (msg = "Beklenmeyen bir hata olustu") => new AppError("INTERNAL", msg, 500),
};
