import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email("Gecerli bir e-posta girin");

export const usernameSchema = z
  .string()
  .trim()
  .min(3, "Kullanici adi en az 3 karakter")
  .max(24, "Kullanici adi en fazla 24 karakter")
  .regex(/^[a-zA-Z0-9_]+$/, "Sadece harf, rakam ve alt cizgi kullanabilirsiniz");

export const passwordSchema = z
  .string()
  .min(8, "Sifre en az 8 karakter olmali")
  .max(128)
  .regex(/[a-z]/, "En az bir kucuk harf")
  .regex(/[A-Z]/, "En az bir buyuk harf")
  .regex(/[0-9]/, "En az bir rakam");

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{10,15}$/, "Gecerli bir telefon numarasi girin");

/** Amount arriving from clients as a decimal string, validated before minor-unit conversion. */
export const amountSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,8})?$/, "Gecerli bir tutar girin");

export const registerSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema,
  phone: phoneSchema.optional(),
  currency: z.enum(["TRY", "USD", "EUR", "GBP", "USDT", "BTC"]).default("TRY"),
  referralCode: z.string().trim().max(32).optional(),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: "Kullanim sartlarini kabul etmelisiniz" }) }),
  ageConfirmed: z.literal(true, { errorMap: () => ({ message: "18 yasindan buyuk oldugunuzu onaylamalisiniz" }) }),
});

export const loginSchema = z.object({
  identifier: z.string().trim().min(3),
  password: z.string().min(1),
  totp: z.string().trim().length(6).optional(),
  rememberMe: z.boolean().optional().default(false),
});

export const twoFactorVerifySchema = z.object({ code: z.string().trim().min(6).max(8) });

export const depositSchema = z.object({
  amount: amountSchema,
  method: z.enum(["CARD", "BANK_TRANSFER", "E_WALLET", "CRYPTO", "PAPARA", "PAYFIX", "MANUAL"]),
  currency: z.enum(["TRY", "USD", "EUR", "GBP", "USDT", "BTC"]).optional(),
  bonusCode: z.string().trim().max(40).optional(),
});

export const withdrawalSchema = z.object({
  amount: amountSchema,
  method: z.enum(["BANK_TRANSFER", "E_WALLET", "CRYPTO", "PAPARA", "PAYFIX"]),
  currency: z.enum(["TRY", "USD", "EUR", "GBP", "USDT", "BTC"]).optional(),
  iban: z.string().trim().max(34).optional(),
  walletAddress: z.string().trim().max(128).optional(),
});

export const betSchema = z.object({
  gameSlug: z.string().trim().min(1),
  amount: amountSchema,
  currency: z.enum(["TRY", "USD", "EUR", "GBP", "USDT", "BTC"]).optional(),
  /** Free-form per-game parameters (lines, mines count, risk level, etc.). */
  params: z.record(z.unknown()).optional(),
  clientSeed: z.string().trim().max(64).optional(),
  idempotencyKey: z.string().trim().max(80).optional(),
});

export const limitsSchema = z.object({
  depositDaily: amountSchema.nullable().optional(),
  depositWeekly: amountSchema.nullable().optional(),
  depositMonthly: amountSchema.nullable().optional(),
  lossDaily: amountSchema.nullable().optional(),
  lossWeekly: amountSchema.nullable().optional(),
  wagerDaily: amountSchema.nullable().optional(),
  sessionMinutes: z.number().int().min(15).max(1440).nullable().optional(),
});

export const kycSubmitSchema = z.object({
  fullName: z.string().trim().min(3).max(120),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-AA-GG formatinda girin"),
  nationality: z.string().trim().length(2),
  documentType: z.enum(["NATIONAL_ID", "PASSPORT", "DRIVERS_LICENSE", "RESIDENCE_PERMIT"]),
  documentNumber: z.string().trim().min(3).max(40),
  address: z.string().trim().min(5).max(240),
  city: z.string().trim().min(2).max(80),
  postalCode: z.string().trim().max(12).optional(),
  country: z.string().trim().length(2),
  documents: z.array(z.string().url()).max(6).optional(),
});

export const bonusCreateSchema = z.object({
  code: z.string().trim().min(3).max(40).regex(/^[A-Z0-9_-]+$/i),
  name: z.string().trim().min(2).max(120),
  type: z.enum(["WELCOME", "DEPOSIT_MATCH", "FREE_SPINS", "RELOAD", "CASHBACK", "LOYALTY", "TOURNAMENT", "DROPS_WINS", "REFERRAL"]),
  description: z.string().trim().max(2000).optional(),
  percent: z.number().min(0).max(1000).optional(),
  fixedAmount: amountSchema.optional(),
  maxBonus: amountSchema.optional(),
  minDeposit: amountSchema.optional(),
  wageringMultiplier: z.number().min(0).max(200).default(30),
  maxBetWithBonus: amountSchema.optional(),
  contributionRates: z.record(z.number().min(0).max(100)).optional(),
  allowedGames: z.array(z.string()).optional(),
  excludedGames: z.array(z.string()).optional(),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
  perUserLimit: z.number().int().min(1).default(1),
  totalBudget: amountSchema.optional(),
  vipTiers: z.array(z.string()).optional(),
  newPlayersOnly: z.boolean().default(true),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sortBy: z.string().trim().max(40).optional(),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  search: z.string().trim().max(120).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type BetInput = z.infer<typeof betSchema>;
export type DepositInput = z.infer<typeof depositSchema>;
export type WithdrawalInput = z.infer<typeof withdrawalSchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;
