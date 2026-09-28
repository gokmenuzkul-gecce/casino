import type { FastifyInstance } from "fastify";
import {
  AuditAction,
  ADMIN_ROLES,
  Errors,
  LedgerAccountType,
  LedgerDirection,
  PERMISSIONS,
  TxType,
  UserRole,
  bonusCreateSchema,
  paginationSchema,
} from "@aurora/shared";
import { prisma } from "@aurora/db";
import { ledger, parseAmount } from "../services/ledger.js";
import { audit } from "../services/audit.js";
import { authenticate, requirePermission, requireStaff } from "../middleware/auth.js";
import { registryHealth, createProviderRegistry } from "../providers/index.js";
import {
  PROVIDER_ENV_KEYS,
  loadProviderConfig,
  publicValues,
  saveProviderConfig,
} from "../services/provider-config.js";
import { env } from "../lib/env.js";
import { nanoid } from "nanoid";

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const staff = [authenticate, requireStaff()];

  // ── dashboard ─────────────────────────────────────────────────────────

  app.get("/admin/dashboard", { preHandler: staff }, async () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const yesterday = new Date(today.getTime() - 24 * 3600 * 1000);

    const [
      onlinePlayers,
      totalPlayers,
      newPlayersToday,
      depositsToday,
      withdrawalsToday,
      betsToday,
      pendingWithdrawals,
      pendingKyc,
      openRiskFlags,
      activeBonuses,
      activeTournaments,
      depositsYesterday,
      betsYesterday,
    ] = await Promise.all([
      prisma.session.count({ where: { isActive: true, lastSeenAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } } }),
      prisma.user.count({ where: { roles: { has: UserRole.PLAYER } } }),
      prisma.user.count({ where: { createdAt: { gte: today } } }),
      prisma.paymentIntent.aggregate({
        where: { direction: "DEPOSIT", status: "COMPLETED", completedAt: { gte: today } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.paymentIntent.aggregate({
        where: { direction: "WITHDRAWAL", status: "COMPLETED", completedAt: { gte: today } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.bet.aggregate({
        where: { isDemo: false, placedAt: { gte: today } },
        _sum: { stake: true, payout: true },
        _count: true,
      }),
      prisma.paymentIntent.count({ where: { direction: "WITHDRAWAL", status: "PENDING" } }),
      prisma.kycProfile.count({ where: { status: { in: ["PENDING", "IN_REVIEW"] } } }),
      prisma.riskFlag.count({ where: { status: "OPEN" } }),
      prisma.userBonus.count({ where: { status: "ACTIVE" } }),
      prisma.tournament.count({ where: { status: "ACTIVE" } }),
      prisma.paymentIntent.aggregate({
        where: { direction: "DEPOSIT", status: "COMPLETED", completedAt: { gte: yesterday, lt: today } },
        _sum: { amount: true },
      }),
      prisma.bet.aggregate({
        where: { isDemo: false, placedAt: { gte: yesterday, lt: today } },
        _sum: { stake: true, payout: true },
      }),
    ]);

    const wagered = betsToday._sum.stake ?? 0n;
    const paid = betsToday._sum.payout ?? 0n;
    const ggr = wagered - paid;

    const wageredYesterday = betsYesterday._sum.stake ?? 0n;
    const paidYesterday = betsYesterday._sum.payout ?? 0n;
    const ggrYesterday = wageredYesterday - paidYesterday;

    return {
      metrics: {
        onlinePlayers,
        totalPlayers,
        newPlayersToday,
        depositsToday: (depositsToday._sum.amount ?? 0n).toString(),
        depositCountToday: depositsToday._count,
        withdrawalsToday: (withdrawalsToday._sum.amount ?? 0n).toString(),
        withdrawalCountToday: withdrawalsToday._count,
        wageredToday: wagered.toString(),
        paidToday: paid.toString(),
        ggrToday: ggr.toString(),
        ggrYesterday: ggrYesterday.toString(),
        betsToday: betsToday._count,
        pendingWithdrawals,
        pendingKyc,
        openRiskFlags,
        activeBonuses,
        activeTournaments,
        depositsYesterday: (depositsYesterday._sum.amount ?? 0n).toString(),
      },
      providers: await registryHealth(app.providers),
      platformMode: env.platformMode,
      features: env.features,
    };
  });

  /** Time series for dashboard charts. */
  app.get("/admin/dashboard/chart", { preHandler: staff }, async (request) => {
    const days = Math.min(Number((request.query as { days?: string }).days ?? 14), 90);
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    since.setUTCHours(0, 0, 0, 0);

    const [financial, bets] = await Promise.all([
      prisma.financialStatDaily.findMany({ where: { date: { gte: since } }, orderBy: { date: "asc" } }),
      prisma.bet.groupBy({
        by: ["placedAt"],
        where: { isDemo: false, placedAt: { gte: since } },
        _sum: { stake: true, payout: true },
      }),
    ]);

    // Aggregate bets into per-day buckets for the chart.
    const buckets = new Map<string, { wagered: bigint; paid: bigint }>();
    for (const row of bets) {
      const key = row.placedAt.toISOString().slice(0, 10);
      const bucket = buckets.get(key) ?? { wagered: 0n, paid: 0n };
      bucket.wagered += row._sum.stake ?? 0n;
      bucket.paid += row._sum.payout ?? 0n;
      buckets.set(key, bucket);
    }

    const series: { date: string; deposits: string; withdrawals: string; wagered: string; ggr: string; newPlayers: number }[] = [];
    for (let i = 0; i < days; i++) {
      const date = new Date(since.getTime() + i * 24 * 3600 * 1000);
      const key = date.toISOString().slice(0, 10);
      const fin = financial.find((f) => f.date.toISOString().slice(0, 10) === key);
      const bucket = buckets.get(key);
      const wagered = bucket?.wagered ?? 0n;
      const paid = bucket?.paid ?? 0n;
      series.push({
        date: key,
        deposits: (fin?.deposits ?? 0n).toString(),
        withdrawals: (fin?.withdrawals ?? 0n).toString(),
        wagered: wagered.toString(),
        ggr: (wagered - paid).toString(),
        newPlayers: fin?.newPlayers ?? 0,
      });
    }

    return { series };
  });

  // ── users ─────────────────────────────────────────────────────────────

  app.get("/admin/users", { preHandler: [authenticate, requirePermission(PERMISSIONS.USER_VIEW)] }, async (request) => {
    const query = paginationSchema.parse(request.query);
    const filters = request.query as Record<string, string | undefined>;

    const where = {
      roles: filters.role ? { has: filters.role } : undefined,
      status: filters.status,
      vip: filters.vipTier ? { tier: filters.vipTier } : undefined,
      kyc: filters.kycStatus ? { status: filters.kycStatus } : undefined,
      OR: query.search
        ? [
            { username: { contains: query.search, mode: "insensitive" as const } },
            { email: { contains: query.search, mode: "insensitive" as const } },
            { phone: { contains: query.search } },
            { id: query.search },
          ]
        : undefined,
      createdAt:
        filters.from || filters.to
          ? { gte: filters.from ? new Date(filters.from) : undefined, lte: filters.to ? new Date(filters.to) : undefined }
          : undefined,
    };

    const sortBy = query.sortBy ?? "createdAt";
    const [total, rows] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { [sortBy]: query.sortDir },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          vip: { select: { tier: true, level: true, lifetimeWagered: true } },
          kyc: { select: { status: true, level: true } },
          wallets: { where: { type: "REAL" }, select: { balance: true, locked: true, currency: true } },
          _count: { select: { bets: true, transactions: true } },
        },
      }),
    ]);

    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      users: rows.map((u) => ({
        id: u.id,
        email: u.email,
        username: u.username,
        roles: u.roles,
        status: u.status,
        currency: u.currency,
        country: u.country,
        phone: u.phone,
        twoFactorEnabled: u.twoFactorEnabled,
        riskScore: u.riskScore,
        tags: u.tags,
        vipTier: u.vip?.tier ?? null,
        kycStatus: u.kyc?.status ?? "NOT_STARTED",
        balance: u.wallets[0]?.balance.toString() ?? "0",
        locked: u.wallets[0]?.locked.toString() ?? "0",
        betCount: u._count.bets,
        transactionCount: u._count.transactions,
        lastLoginAt: u.lastLoginAt,
        lastLoginIp: u.lastLoginIp,
        createdAt: u.createdAt,
      })),
    };
  });

  app.get("/admin/users/:id", { preHandler: [authenticate, requirePermission(PERMISSIONS.USER_VIEW)] }, async (request) => {
    const { id } = request.params as { id: string };
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        wallets: true,
        kyc: { include: { documents: true } },
        vip: true,
        limits: { where: { isActive: true } },
        bonuses: { include: { bonus: { select: { name: true, code: true } } }, take: 20, orderBy: { activatedAt: "desc" } },
        riskFlags: { orderBy: { createdAt: "desc" }, take: 20 },
        sessions: { where: { isActive: true }, orderBy: { lastSeenAt: "desc" }, take: 10 },
        adminNotes: { orderBy: { createdAt: "desc" }, take: 20 },
        deviceFingerprints: { orderBy: { lastSeenAt: "desc" }, take: 10 },
        _count: { select: { bets: true, transactions: true, referrals: true } },
      },
    });
    if (!user) throw Errors.notFound("Kullanici");

    const [betStats, txStats, deposits, withdrawals] = await Promise.all([
      prisma.bet.aggregate({
        where: { userId: id, isDemo: false },
        _sum: { stake: true, payout: true, profit: true },
        _count: true,
      }),
      prisma.transaction.count({ where: { userId: id } }),
      prisma.paymentIntent.aggregate({
        where: { userId: id, direction: "DEPOSIT", status: "COMPLETED" },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.paymentIntent.aggregate({
        where: { userId: id, direction: "WITHDRAWAL", status: "COMPLETED" },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    return {
      user: {
        ...user,
        passwordHash: undefined,
        twoFactorSecret: undefined,
        backupCodes: undefined,
        wallets: user.wallets.map((w) => ({
          id: w.id,
          type: w.type,
          currency: w.currency,
          balance: w.balance.toString(),
          locked: w.locked.toString(),
        })),
        bonuses: user.bonuses.map((b) => ({
          id: b.id,
          name: b.bonus.name,
          code: b.bonus.code,
          status: b.status,
          granted: b.grantedAmount.toString(),
          remaining: b.remainingAmount.toString(),
          wageringRequired: b.wageringRequired.toString(),
          wageringRemaining: b.wageringRemaining.toString(),
          currency: b.currency,
        })),
        limits: user.limits.map((l) => ({
          id: l.id,
          type: l.type,
          period: l.period,
          amount: l.amount.toString(),
          currency: l.currency,
        })),
      },
      stats: {
        totalWagered: (betStats._sum.stake ?? 0n).toString(),
        totalPaid: (betStats._sum.payout ?? 0n).toString(),
        netLoss: (-(betStats._sum.profit ?? 0n)).toString(),
        betCount: betStats._count,
        transactionCount: txStats,
        totalDeposits: (deposits._sum.amount ?? 0n).toString(),
        depositCount: deposits._count,
        totalWithdrawals: (withdrawals._sum.amount ?? 0n).toString(),
        withdrawalCount: withdrawals._count,
        referralCount: user._count.referrals,
      },
      recentBets: await prisma.bet.findMany({
        where: { userId: id },
        orderBy: { placedAt: "desc" },
        take: 20,
        include: { game: { select: { name: true, slug: true } } },
      }),
      recentTransactions: await prisma.transaction.findMany({
        where: { userId: id },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    };
  });

  app.patch("/admin/users/:id", { preHandler: [authenticate, requirePermission(PERMISSIONS.USER_EDIT)] }, async (request) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const before = await prisma.user.findUnique({ where: { id } });
    if (!before) throw Errors.notFound("Kullanici");

    const allowed = ["email", "username", "phone", "country", "status", "currency", "locale", "timezone", "tags", "notes", "riskScore"];
    const data: Record<string, unknown> = {};
    for (const key of allowed) if (body[key] !== undefined) data[key] = body[key];

    const user = await prisma.user.update({ where: { id }, data });

    await audit.log({
      actorId: request.user!.id,
      actorRole: request.user!.roles[0],
      action: AuditAction.USER_UPDATED,
      entityType: "User",
      entityId: id,
      before: { email: before.email, status: before.status, tags: before.tags },
      after: data,
      ip: request.ip,
    });

    return { user: { ...user, passwordHash: undefined, twoFactorSecret: undefined } };
  });

  app.post("/admin/users/:id/status", { preHandler: [authenticate, requirePermission(PERMISSIONS.USER_SUSPEND)] }, async (request) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { status?: string; reason?: string };
    if (!body.status) throw Errors.validation("Durum gerekli");

    const before = await prisma.user.findUnique({ where: { id }, select: { status: true } });
    const user = await prisma.user.update({
      where: { id },
      data: {
        status: body.status,
        lockedAt: ["SUSPENDED", "BANNED"].includes(body.status) ? new Date() : null,
        lockReason: ["SUSPENDED", "BANNED"].includes(body.status) ? (body.reason ?? "Yonetici karari") : null,
      },
    });

    if (["SUSPENDED", "BANNED"].includes(body.status)) {
      await prisma.session.updateMany({
        where: { userId: id, isActive: true },
        data: { isActive: false, revokedAt: new Date(), revokedReason: `ADMIN_${body.status}` },
      });
    }

    await audit.log({
      actorId: request.user!.id,
      action: AuditAction.USER_SUSPENDED,
      entityType: "User",
      entityId: id,
      before: { status: before?.status },
      after: { status: body.status, reason: body.reason },
      severity: "WARNING",
    });

    return { ok: true, status: user.status };
  });

  app.post("/admin/users/:id/roles", { preHandler: [authenticate, requirePermission(PERMISSIONS.USER_ROLE_ASSIGN)] }, async (request) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { roles?: string[] };
    if (!Array.isArray(body.roles) || body.roles.length === 0) throw Errors.validation("En az bir rol gerekli");

    const valid = Object.values(UserRole) as string[];
    const invalid = body.roles.filter((r) => !valid.includes(r));
    if (invalid.length > 0) throw Errors.validation(`Gecersiz rol: ${invalid.join(", ")}`);

    // Only a super admin may mint another super admin.
    if (body.roles.includes(UserRole.SUPER_ADMIN) && !request.user!.roles.includes(UserRole.SUPER_ADMIN)) {
      throw Errors.forbidden("Sadece super admin bu rolu atayabilir");
    }

    const before = await prisma.user.findUnique({ where: { id }, select: { roles: true } });
    const user = await prisma.user.update({ where: { id }, data: { roles: body.roles } });

    await audit.log({
      actorId: request.user!.id,
      action: AuditAction.ROLE_CHANGED,
      entityType: "User",
      entityId: id,
      before: { roles: before?.roles },
      after: { roles: body.roles },
      severity: "CRITICAL",
    });

    return { ok: true, roles: user.roles };
  });

  /** Manual balance adjustment: always through the ledger, always audited. */
  app.post("/admin/users/:id/balance", { preHandler: [authenticate, requirePermission(PERMISSIONS.USER_BALANCE_ADJUST)] }, async (request) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { amount?: string; currency?: string; type?: string; reason?: string; walletType?: string };
    if (!body.amount || !body.reason) throw Errors.validation("Tutar ve sebep gerekli");

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw Errors.notFound("Kullanici");

    const currency = body.currency ?? user.currency;
    const amount = parseAmount(body.amount, currency);
    const walletType = body.walletType ?? "REAL";
    const isCredit = !body.amount.startsWith("-");

    const posted = await ledger.post({
      userId: id,
      type: TxType.ADJUSTMENT,
      amount,
      currency,
      walletType: walletType as never,
      legs: isCredit
        ? [
            {
              accountType: walletType === "BONUS" ? LedgerAccountType.PLAYER_BONUS : LedgerAccountType.PLAYER_REAL,
              direction: LedgerDirection.CREDIT,
              amount,
            },
            { accountType: LedgerAccountType.HOUSE, direction: LedgerDirection.DEBIT, amount },
          ]
        : [
            {
              accountType: walletType === "BONUS" ? LedgerAccountType.PLAYER_BONUS : LedgerAccountType.PLAYER_REAL,
              direction: LedgerDirection.DEBIT,
              amount,
            },
            { accountType: LedgerAccountType.HOUSE, direction: LedgerDirection.CREDIT, amount },
          ],
      description: `Manuel duzeltme: ${body.reason}`,
      metadata: { actorId: request.user!.id, reason: body.reason, type: body.type ?? "MANUAL" },
    });

    await audit.log({
      actorId: request.user!.id,
      action: AuditAction.BALANCE_ADJUSTMENT,
      entityType: "User",
      entityId: id,
      after: { amount: amount.toString(), currency, reason: body.reason, direction: isCredit ? "CREDIT" : "DEBIT" },
      severity: "CRITICAL",
      ip: request.ip,
    });

    return { ok: true, reference: posted.reference, balanceAfter: posted.balanceAfter.toString() };
  });

  app.post("/admin/users/:id/notes", { preHandler: [authenticate, requirePermission(PERMISSIONS.USER_EDIT)] }, async (request) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { body?: string; pinned?: boolean };
    if (!body.body) throw Errors.validation("Not metni gerekli");
    const note = await prisma.adminNote.create({
      data: { userId: id, authorId: request.user!.id, body: body.body, pinned: body.pinned ?? false },
    });
    return { note };
  });

  /** Reset a player's password and force a re-login. */
  app.post("/admin/users/:id/reset-password", { preHandler: [authenticate, requirePermission(PERMISSIONS.USER_RESET_PASSWORD)] }, async (request) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { newPassword?: string };
    const { authService } = await import("../services/auth.js");
    const password = body.newPassword ?? `Aa1!${nanoid(12)}`;
    const hash = await authService.hashPassword(password);
    await prisma.user.update({ where: { id }, data: { passwordHash: hash } });
    await authService.revokeAllSessions(id, "ADMIN_RESET");
    await audit.log({
      actorId: request.user!.id,
      action: AuditAction.PASSWORD_RESET,
      entityType: "User",
      entityId: id,
      severity: "CRITICAL",
    });
    return { ok: true, temporaryPassword: body.newPassword ? undefined : password };
  });

  // ── KYC review ────────────────────────────────────────────────────────

  app.get("/admin/kyc", { preHandler: [authenticate, requirePermission(PERMISSIONS.KYC_VIEW)] }, async (request) => {
    const query = paginationSchema.parse(request.query);
    const status = (request.query as { status?: string }).status;

    const where = { status: status ?? { in: ["PENDING", "IN_REVIEW"] } };
    const [total, rows] = await Promise.all([
      prisma.kycProfile.count({ where }),
      prisma.kycProfile.findMany({
        where,
        orderBy: { submittedAt: "asc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          user: { select: { id: true, username: true, email: true, createdAt: true } },
          documents: true,
        },
      }),
    ]);

    return { total, page: query.page, pageSize: query.pageSize, submissions: rows };
  });

  app.post("/admin/kyc/:id/review", { preHandler: [authenticate, requirePermission(PERMISSIONS.KYC_REVIEW)] }, async (request) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { decision?: "APPROVE" | "REJECT"; level?: number; reason?: string };
    if (!body.decision) throw Errors.validation("Karar gerekli");

    const before = await prisma.kycProfile.findUnique({ where: { id } });
    if (!before) throw Errors.notFound("KYC basvurusu");

    const approved = body.decision === "APPROVE";
    const profile = await prisma.kycProfile.update({
      where: { id },
      data: {
        status: approved ? "APPROVED" : "REJECTED",
        level: approved ? (body.level ?? 1) : before.level,
        reviewedById: request.user!.id,
        reviewedAt: new Date(),
        rejectionReason: approved ? null : (body.reason ?? "Belgeler yetersiz"),
      },
    });

    if (approved) {
      await prisma.user.update({
        where: { id: profile.userId },
        data: { status: "ACTIVE", emailVerifiedAt: new Date() },
      });
    }

    await audit.log({
      actorId: request.user!.id,
      action: AuditAction.KYC_UPDATED,
      entityType: "KycProfile",
      entityId: id,
      before: { status: before.status },
      after: { status: profile.status, level: profile.level },
      severity: "INFO",
    });

    return { ok: true, status: profile.status };
  });

  // ── payments ──────────────────────────────────────────────────────────

  app.get("/admin/payments", { preHandler: [authenticate, requirePermission(PERMISSIONS.PAYMENT_VIEW)] }, async (request) => {
    const query = paginationSchema.parse(request.query);
    const filters = request.query as Record<string, string | undefined>;

    const where = {
      direction: filters.direction,
      status: filters.status,
      method: filters.method,
      requiresReview: filters.requiresReview === "true" ? true : undefined,
      user: query.search
        ? { OR: [{ username: { contains: query.search, mode: "insensitive" as const } }, { email: { contains: query.search, mode: "insensitive" as const } }] }
        : undefined,
      createdAt:
        filters.from || filters.to
          ? { gte: filters.from ? new Date(filters.from) : undefined, lte: filters.to ? new Date(filters.to) : undefined }
          : undefined,
    };

    const [total, rows, totals] = await Promise.all([
      prisma.paymentIntent.count({ where }),
      prisma.paymentIntent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { user: { select: { id: true, username: true, email: true, kyc: { select: { status: true } } } } },
      }),
      prisma.paymentIntent.groupBy({ by: ["direction", "status"], _sum: { amount: true }, _count: true }),
    ]);

    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      payments: rows.map((p) => ({
        id: p.id,
        reference: p.reference,
        userId: p.userId,
        username: p.user.username,
        email: p.user.email,
        kycStatus: p.user.kyc?.status ?? "NOT_STARTED",
        direction: p.direction,
        method: p.method,
        provider: p.provider,
        amount: p.amount.toString(),
        fee: p.fee.toString(),
        currency: p.currency,
        status: p.status,
        requiresReview: p.requiresReview,
        reviewReason: p.reviewReason,
        iban: p.iban,
        createdAt: p.createdAt,
        completedAt: p.completedAt,
        failureReason: p.failureReason,
      })),
      summary: totals.map((t) => ({
        direction: t.direction,
        status: t.status,
        count: t._count,
        amount: (t._sum.amount ?? 0n).toString(),
      })),
    };
  });

  app.post("/admin/payments/:id/approve", { preHandler: [authenticate, requirePermission(PERMISSIONS.PAYMENT_WITHDRAWAL_APPROVE)] }, async (request) => {
    const { id } = request.params as { id: string };
    return app.payments.approveWithdrawal(id, request.user!.id);
  });

  app.post("/admin/payments/:id/reject", { preHandler: [authenticate, requirePermission(PERMISSIONS.PAYMENT_WITHDRAWAL_APPROVE)] }, async (request) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { reason?: string };
    return app.payments.rejectWithdrawal(id, body.reason ?? "Yonetici reddi", request.user!.id);
  });

  app.get("/admin/payment-methods", { preHandler: [authenticate, requirePermission(PERMISSIONS.PAYMENT_METHOD_MANAGE)] }, async () => {
    const rows = await prisma.paymentMethodConfig.findMany({ orderBy: { sortOrder: "asc" } });
    return { methods: rows };
  });

  app.patch("/admin/payment-methods/:method", { preHandler: [authenticate, requirePermission(PERMISSIONS.PAYMENT_METHOD_MANAGE)] }, async (request) => {
    const { method } = request.params as { method: string };
    const body = (request.body ?? {}) as Record<string, unknown>;

    const data: Record<string, unknown> = {};
    for (const key of ["enabled", "displayName", "iconUrl", "sortOrder", "maintenanceMode", "instructions", "currencies"]) {
      if (body[key] !== undefined) data[key] = body[key];
    }
    if (body.minAmount !== undefined) data.minAmount = parseAmount(String(body.minAmount), "TRY");
    if (body.maxAmount !== undefined) data.maxAmount = parseAmount(String(body.maxAmount), "TRY");
    if (body.feePercent !== undefined) data.feePercent = Number(body.feePercent);
    if (body.feeFixed !== undefined) data.feeFixed = parseAmount(String(body.feeFixed), "TRY");

    const updated = await prisma.paymentMethodConfig.update({ where: { method }, data });
    await audit.log({
      actorId: request.user!.id,
      action: AuditAction.SETTINGS_UPDATED,
      entityType: "PaymentMethodConfig",
      entityId: method,
      after: data,
    });
    return { method: updated };
  });

  // ── games ─────────────────────────────────────────────────────────────

  app.get("/admin/games", { preHandler: [authenticate, requirePermission(PERMISSIONS.GAME_VIEW)] }, async (request) => {
    const query = paginationSchema.parse(request.query);
    const filters = request.query as Record<string, string | undefined>;

    const where = {
      category: filters.category ? { slug: filters.category } : undefined,
      provider: filters.provider ? { slug: filters.provider } : undefined,
      isActive: filters.active === "true" ? true : filters.active === "false" ? false : undefined,
      embedType: filters.embedType,
      OR: query.search ? [{ name: { contains: query.search, mode: "insensitive" as const } }, { slug: { contains: query.search } }] : undefined,
    };

    const [total, rows] = await Promise.all([
      prisma.game.count({ where }),
      prisma.game.findMany({
        where,
        orderBy: { sortOrder: "asc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          category: { select: { slug: true, name: true } },
          provider: { select: { slug: true, name: true } },
          _count: { select: { bets: true } },
        },
      }),
    ]);

    return { total, page: query.page, pageSize: query.pageSize, games: rows };
  });

  app.patch("/admin/games/:slug", { preHandler: [authenticate, requirePermission(PERMISSIONS.GAME_EDIT)] }, async (request) => {
    const { slug } = request.params as { slug: string };
    const body = (request.body ?? {}) as Record<string, unknown>;

    const data: Record<string, unknown> = {};
    const fields = [
      "name", "description", "thumbnailUrl", "bannerUrl", "themeColor", "volatility",
      "isActive", "isFeatured", "isNew", "isExclusive", "isJackpot", "demoEnabled",
      "realEnabled", "tags", "sortOrder", "maxWin", "lines", "reels", "launchUrl", "config",
    ];
    for (const key of fields) if (body[key] !== undefined) data[key] = body[key];
    if (body.rtp !== undefined) data.rtp = Number(body.rtp);
    if (body.minBet !== undefined) data.minBet = parseAmount(String(body.minBet), "TRY");
    if (body.maxBet !== undefined) data.maxBet = parseAmount(String(body.maxBet), "TRY");

    const before = await prisma.game.findUnique({ where: { slug }, select: { rtp: true, isActive: true } });
    const game = await prisma.game.update({ where: { slug }, data });

    await audit.log({
      actorId: request.user!.id,
      action: AuditAction.GAME_UPDATED,
      entityType: "Game",
      entityId: slug,
      before: before as never,
      after: data,
      severity: data.rtp !== undefined ? "CRITICAL" : "INFO",
    });

    return { game };
  });

  /** Import games from the configured aggregator into the local catalogue. */
  app.post("/admin/games/sync", { preHandler: [authenticate, requirePermission(PERMISSIONS.GAME_EDIT)] }, async (request) => {
    const aggregator = app.providers.gameAggregator;
    if (!aggregator.isConfigured) {
      throw Errors.providerDisabled("Oyun agregatoru");
    }

    const body = (request.body ?? {}) as { category?: string; pageSize?: number };
    const games = await aggregator.listGames({ pageSize: body.pageSize ?? 200, category: body.category });

    let created = 0;
    let updated = 0;

    for (const remote of games) {
      const provider = await prisma.gameProviderModel.upsert({
        where: { slug: slugify(remote.provider) },
        create: { slug: slugify(remote.provider), name: remote.provider, type: "AGGREGATOR" },
        update: {},
      });

      const categorySlug = mapCategory(remote.category);
      const category = await prisma.gameCategoryModel.upsert({
        where: { slug: categorySlug },
        create: { slug: categorySlug, name: categorySlug },
        update: {},
      });

      const existing = await prisma.game.findFirst({
        where: { providerId: provider.id, providerGameId: remote.externalId },
      });

      const data = {
        name: remote.name,
        thumbnailUrl: remote.thumbnailUrl,
        bannerUrl: remote.bannerUrl,
        categoryId: category.id,
        providerId: provider.id,
        providerGameId: remote.externalId,
        rtp: remote.rtp ?? 96,
        volatility: remote.volatility ?? "MEDIUM",
        lines: remote.lines,
        reels: remote.reels,
        demoEnabled: remote.demoSupported ?? true,
        realEnabled: remote.realSupported ?? true,
        embedType: "EXTERNAL",
        tags: remote.tags ?? [],
        supportedCurrencies: remote.currencies ?? ["TRY"],
        jurisdictions: remote.jurisdictions ?? [],
        isJackpot: categorySlug === "JACKPOT",
      };

      if (existing) {
        await prisma.game.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await prisma.game.create({
          data: { slug: `${slugify(remote.provider)}-${slugify(remote.externalId)}`, ...data },
        });
        created++;
      }
    }

    await audit.log({
      actorId: request.user!.id,
      action: "GAMES_SYNCED",
      entityType: "Game",
      after: { created, updated, total: games.length, provider: aggregator.name },
    });

    return { created, updated, total: games.length, provider: aggregator.name };
  });

  /**
   * Free-spin eligibility for one game. Gregmorn exposes this separately so an
   * operator can check limits before committing a free-spin campaign.
   */
  app.post(
    "/admin/games/freespins-info",
    { preHandler: [authenticate, requirePermission(PERMISSIONS.GAME_VIEW)] },
    async (request) => {
      const aggregator = app.providers.gameAggregator;
      if (!aggregator.isConfigured) throw Errors.providerDisabled("Oyun agregatoru");
      if (typeof aggregator.freespinsInfo !== "function") {
        throw Errors.validation(`${aggregator.name} saglayicisi free spin desteklemiyor`);
      }

      const body = (request.body ?? {}) as { gameId?: string; currency?: string };
      if (!body.gameId) throw Errors.validation("gameId zorunlu");

      return aggregator.freespinsInfo({ gameId: body.gameId, currency: body.currency });
    },
  );

  // ── bonuses ───────────────────────────────────────────────────────────

  app.get("/admin/bonuses", { preHandler: [authenticate, requirePermission(PERMISSIONS.BONUS_VIEW)] }, async () => {
    const rows = await prisma.bonus.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { userBonuses: true } } },
    });
    return {
      bonuses: rows.map((b) => ({
        ...b,
        percent: b.percent?.toString() ?? null,
        wageringMultiplier: b.wageringMultiplier.toString(),
        grantedCount: b._count.userBonuses,
      })),
    };
  });

  app.post("/admin/bonuses", { preHandler: [authenticate, requirePermission(PERMISSIONS.BONUS_CREATE)] }, async (request) => {
    const body = bonusCreateSchema.parse(request.body);
    const currency = (request.body as { currency?: string }).currency ?? "TRY";

    const bonus = await prisma.bonus.create({
      data: {
        code: body.code.toUpperCase(),
        name: body.name,
        description: body.description,
        type: body.type,
        percent: body.percent,
        fixedAmount: body.fixedAmount ? parseAmount(body.fixedAmount, currency) : null,
        maxBonus: body.maxBonus ? parseAmount(body.maxBonus, currency) : null,
        minDeposit: body.minDeposit ? parseAmount(body.minDeposit, currency) : null,
        wageringMultiplier: body.wageringMultiplier,
        maxBetWithBonus: body.maxBetWithBonus ? parseAmount(body.maxBetWithBonus, currency) : null,
        contributionRates: (body.contributionRates ?? undefined) as never,
        allowedGames: body.allowedGames ?? [],
        excludedGames: body.excludedGames ?? [],
        currency,
        validFrom: body.validFrom ? new Date(body.validFrom) : null,
        validUntil: body.validUntil ? new Date(body.validUntil) : null,
        perUserLimit: body.perUserLimit,
        totalBudget: body.totalBudget ? parseAmount(body.totalBudget, currency) : null,
        vipTiers: body.vipTiers ?? [],
        newPlayersOnly: body.newPlayersOnly,
        createdById: request.user!.id,
      },
    });

    await audit.log({
      actorId: request.user!.id,
      action: AuditAction.BONUS_CREATED,
      entityType: "Bonus",
      entityId: bonus.id,
      after: { code: bonus.code, type: bonus.type },
    });

    return { bonus };
  });

  app.patch("/admin/bonuses/:id", { preHandler: [authenticate, requirePermission(PERMISSIONS.BONUS_EDIT)] }, async (request) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;

    const data: Record<string, unknown> = {};
    for (const key of ["name", "description", "status", "terms", "displayOnHome", "bannerUrl", "isAutoApply", "isStackable", "newPlayersOnly", "perUserLimit", "vipTiers", "allowedGames", "excludedGames", "contributionRates"]) {
      if (body[key] !== undefined) data[key] = body[key];
    }
    for (const key of ["percent", "wageringMultiplier"]) if (body[key] !== undefined) data[key] = Number(body[key]);
    for (const key of ["fixedAmount", "maxBonus", "minDeposit", "totalBudget", "maxBetWithBonus"]) {
      if (body[key] !== undefined) data[key] = body[key] === null ? null : parseAmount(String(body[key]), "TRY");
    }

    const bonus = await prisma.bonus.update({ where: { id }, data });
    await audit.log({
      actorId: request.user!.id,
      action: AuditAction.BONUS_UPDATED,
      entityType: "Bonus",
      entityId: id,
      after: data,
    });
    return { bonus };
  });

  // ── risk ──────────────────────────────────────────────────────────────

  app.get("/admin/risk", { preHandler: [authenticate, requirePermission(PERMISSIONS.RISK_VIEW)] }, async (request) => {
    const query = paginationSchema.parse(request.query);
    const filters = request.query as Record<string, string | undefined>;

    const where = {
      status: filters.status ?? { in: ["OPEN", "INVESTIGATING"] },
      severity: filters.severity,
      type: filters.type,
    };

    const [total, rows] = await Promise.all([
      prisma.riskFlag.count({ where }),
      prisma.riskFlag.findMany({
        where,
        orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { user: { select: { id: true, username: true, email: true, riskScore: true } } },
      }),
    ]);

    return { total, page: query.page, pageSize: query.pageSize, flags: rows };
  });

  app.post("/admin/risk/:id/resolve", { preHandler: [authenticate, requirePermission(PERMISSIONS.RISK_MANAGE)] }, async (request) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { resolution?: string; action?: string };

    const flag = await prisma.riskFlag.update({
      where: { id },
      data: {
        status: "RESOLVED",
        resolvedById: request.user!.id,
        resolvedAt: new Date(),
        resolution: body.resolution ?? body.action ?? "Islem tamamlandi",
      },
    });

    await audit.log({
      actorId: request.user!.id,
      action: "RISK_RESOLVED",
      entityType: "RiskFlag",
      entityId: id,
      after: { resolution: flag.resolution },
      severity: "WARNING",
    });

    return { ok: true };
  });

  app.get("/admin/blocklist", { preHandler: [authenticate, requirePermission(PERMISSIONS.RISK_BLOCKLIST)] }, async () => {
    const rows = await prisma.blocklist.findMany({ where: { isActive: true }, orderBy: { createdAt: "desc" }, take: 500 });
    return { entries: rows };
  });

  app.post("/admin/blocklist", { preHandler: [authenticate, requirePermission(PERMISSIONS.RISK_BLOCKLIST)] }, async (request) => {
    const body = (request.body ?? {}) as { type?: string; value?: string; reason?: string; expiresAt?: string };
    if (!body.type || !body.value) throw Errors.validation("Tur ve deger gerekli");

    const entry = await prisma.blocklist.upsert({
      where: { type_value: { type: body.type, value: body.value } },
      create: {
        type: body.type,
        value: body.value,
        reason: body.reason,
        createdById: request.user!.id,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      },
      update: { isActive: true, reason: body.reason },
    });

    await audit.log({
      actorId: request.user!.id,
      action: "BLOCKLIST_ADDED",
      entityType: "Blocklist",
      entityId: entry.id,
      after: { type: body.type, value: body.value },
      severity: "WARNING",
    });

    return { entry };
  });

  app.delete("/admin/blocklist/:id", { preHandler: [authenticate, requirePermission(PERMISSIONS.RISK_BLOCKLIST)] }, async (request) => {
    const { id } = request.params as { id: string };
    await prisma.blocklist.update({ where: { id }, data: { isActive: false } });
    return { ok: true };
  });

  // ── reports ───────────────────────────────────────────────────────────

  app.get("/admin/reports/financial", { preHandler: [authenticate, requirePermission(PERMISSIONS.REPORT_FINANCE)] }, async (request) => {
    const q = request.query as { from?: string; to?: string; groupBy?: string };
    const from = q.from ? new Date(q.from) : new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const to = q.to ? new Date(q.to) : new Date();

    const [deposits, withdrawals, bets, bonuses] = await Promise.all([
      prisma.paymentIntent.aggregate({
        where: { direction: "DEPOSIT", status: "COMPLETED", completedAt: { gte: from, lte: to } },
        _sum: { amount: true, fee: true },
        _count: true,
      }),
      prisma.paymentIntent.aggregate({
        where: { direction: "WITHDRAWAL", status: "COMPLETED", completedAt: { gte: from, lte: to } },
        _sum: { amount: true, fee: true },
        _count: true,
      }),
      prisma.bet.aggregate({
        where: { isDemo: false, placedAt: { gte: from, lte: to } },
        _sum: { stake: true, payout: true, profit: true },
        _count: true,
      }),
      prisma.transaction.aggregate({
        where: { type: { in: ["BONUS_CREDIT", "CASHBACK", "RAKEBACK"] }, createdAt: { gte: from, lte: to } },
        _sum: { amount: true },
      }),
    ]);

    const wagered = bets._sum.stake ?? 0n;
    const paid = bets._sum.payout ?? 0n;
    const ggr = wagered - paid;
    const bonusCost = bonuses._sum.amount ?? 0n;
    const depositTotal = deposits._sum.amount ?? 0n;
    const withdrawalTotal = withdrawals._sum.amount ?? 0n;

    return {
      period: { from, to },
      deposits: { total: depositTotal.toString(), count: deposits._count, fees: (deposits._sum.fee ?? 0n).toString() },
      withdrawals: { total: withdrawalTotal.toString(), count: withdrawals._count, fees: (withdrawals._sum.fee ?? 0n).toString() },
      gaming: {
        wagered: wagered.toString(),
        paid: paid.toString(),
        ggr: ggr.toString(),
        betCount: bets._count,
        holdPercent: wagered > 0n ? Number((ggr * 10000n) / wagered) / 100 : 0,
      },
      bonuses: { total: bonusCost.toString() },
      ngr: (ggr - bonusCost).toString(),
      netCash: (depositTotal - withdrawalTotal).toString(),
      byMethod: await prisma.paymentIntent.groupBy({
        by: ["method", "direction"],
        where: { status: "COMPLETED", completedAt: { gte: from, lte: to } },
        _sum: { amount: true },
        _count: true,
      }),
      byGame: await prisma.bet.groupBy({
        by: ["gameId"],
        where: { isDemo: false, placedAt: { gte: from, lte: to } },
        _sum: { stake: true, payout: true },
        _count: true,
        orderBy: { _sum: { stake: "desc" } },
        take: 20,
      }),
    };
  });

  app.get("/admin/reports/players", { preHandler: [authenticate, requirePermission(PERMISSIONS.REPORT_VIEW)] }, async (request) => {
    const q = request.query as { from?: string; to?: string };
    const from = q.from ? new Date(q.from) : new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const to = q.to ? new Date(q.to) : new Date();

    const topPlayers = await prisma.bet.groupBy({
      by: ["userId"],
      where: { isDemo: false, placedAt: { gte: from, lte: to } },
      _sum: { stake: true, payout: true, profit: true },
      _count: true,
      orderBy: { _sum: { stake: "desc" } },
      take: 25,
    });

    const users = await prisma.user.findMany({
      where: { id: { in: topPlayers.map((p) => p.userId) } },
      select: { id: true, username: true, email: true, vip: { select: { tier: true } } },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const [activeCount, newCount] = await Promise.all([
      prisma.bet.groupBy({ by: ["userId"], where: { isDemo: false, placedAt: { gte: from, lte: to } } }).then((r) => r.length),
      prisma.user.count({ where: { createdAt: { gte: from, lte: to } } }),
    ]);

    return {
      period: { from, to },
      activePlayers: activeCount,
      newPlayers: newCount,
      topPlayers: topPlayers.map((p) => ({
        userId: p.userId,
        username: userMap.get(p.userId)?.username ?? "Gizli",
        email: userMap.get(p.userId)?.email ?? "",
        vipTier: userMap.get(p.userId)?.vip?.tier ?? null,
        wagered: (p._sum.stake ?? 0n).toString(),
        paid: (p._sum.payout ?? 0n).toString(),
        netLoss: (-(p._sum.profit ?? 0n)).toString(),
        betCount: p._count,
      })),
    };
  });

  // ── settings & feature flags ──────────────────────────────────────────

  app.get("/admin/settings", { preHandler: [authenticate, requirePermission(PERMISSIONS.SETTINGS_VIEW)] }, async () => {
    const [settings, flags] = await Promise.all([
      prisma.setting.findMany({ where: { isSecret: false } }),
      prisma.featureFlag.findMany(),
    ]);
    return { settings, flags };
  });

  app.put("/admin/settings/:key", { preHandler: [authenticate, requirePermission(PERMISSIONS.SETTINGS_EDIT)] }, async (request) => {
    const { key } = request.params as { key: string };
    const body = (request.body ?? {}) as { value?: unknown; category?: string };

    const setting = await prisma.setting.upsert({
      where: { key },
      create: { key, value: body.value as never, category: body.category ?? "general", updatedById: request.user!.id },
      update: { value: body.value as never, updatedById: request.user!.id },
    });

    await audit.log({
      actorId: request.user!.id,
      action: AuditAction.SETTINGS_UPDATED,
      entityType: "Setting",
      entityId: key,
      after: { value: body.value },
      severity: "WARNING",
    });

    return { setting };
  });

  app.put("/admin/feature-flags/:key", { preHandler: [authenticate, requirePermission(PERMISSIONS.SETTINGS_FEATURE_FLAGS)] }, async (request) => {
    const { key } = request.params as { key: string };
    const body = (request.body ?? {}) as { enabled?: boolean; rolloutPercent?: number; description?: string };

    const flag = await prisma.featureFlag.upsert({
      where: { key },
      create: {
        key,
        enabled: body.enabled ?? false,
        rolloutPercent: body.rolloutPercent ?? 100,
        description: body.description,
      },
      update: { enabled: body.enabled, rolloutPercent: body.rolloutPercent, description: body.description },
    });

    await audit.log({
      actorId: request.user!.id,
      action: AuditAction.SETTINGS_UPDATED,
      entityType: "FeatureFlag",
      entityId: key,
      after: { enabled: flag.enabled },
    });

    return { flag };
  });

  // ── provider / integration management ─────────────────────────────────

  app.get("/admin/integrations", { preHandler: [authenticate, requirePermission(PERMISSIONS.SETTINGS_PROVIDERS)] }, async () => {
    const [health, configs, scheduled] = await Promise.all([
      registryHealth(app.providers),
      prisma.providerConfig.findMany(),
      prisma.scheduledTask.findMany({ orderBy: { name: "asc" } }),
    ]);

    // The panel edits credentials per kind, so expose what is already saved with
    // secrets masked. Without this an operator sees only env-derived health and
    // has nowhere to enter the values in the first place.
    const saved: Record<string, { provider: string; isEnabled: boolean; values: Record<string, string> }> = {};
    for (const kind of Object.keys(PROVIDER_ENV_KEYS)) {
      const config = await loadProviderConfig(kind);
      if (config) saved[kind] = { provider: config.provider, isEnabled: config.isEnabled, values: publicValues(config.values) };
    }

    return {
      platformMode: env.platformMode,
      health,
      configs,
      saved,
      scheduledTasks: scheduled,
      /** The env keys each integration needs, so the admin UI can guide setup. */
      requiredEnvKeys: PROVIDER_ENV_KEYS,
      supportedAggregators: ["generic", "gregmorn", "betskilla", "softswiss", "slotegrator", "1x2", "hub88", "pragmatic"],
      supportedPsps: ["generic", "payfix", "papara", "stripe", "payhound"],
    };
  });

  /**
   * Save provider credentials from the panel and bring them live.
   *
   * The adapters read their config from the environment, so a save writes the
   * values through and rebuilds the registry in place: the new provider answers
   * the next request without an .env edit or a restart. The registry object is
   * mutated rather than replaced so the decorators and PaymentService keep the
   * same reference.
   */
  app.put("/admin/integrations/:kind", { preHandler: [authenticate, requirePermission(PERMISSIONS.SETTINGS_PROVIDERS)] }, async (request) => {
    const { kind } = request.params as { kind: string };
    const body = (request.body ?? {}) as { provider?: string; values?: Record<string, string> };

    const previousKind = app.providers.gameAggregator.name;
    const result = await saveProviderConfig({
      kind,
      provider: String(body.provider ?? ""),
      values: body.values ?? {},
      actorId: request.user!.id,
    });

    Object.assign(app.providers, createProviderRegistry());

    await audit.log({
      actorId: request.user!.id,
      action: AuditAction.SETTINGS_UPDATED,
      entityType: "ProviderConfig",
      entityId: kind,
      // Only key names and the provider profile are recorded: the values are
      // credentials and must not reach the audit trail.
      after: { provider: body.provider, changed: result.changed, previousProvider: previousKind },
    });

    return { saved: true, changed: result.changed, health: await registryHealth(app.providers) };
  });

  // ── audit ─────────────────────────────────────────────────────────────

  app.get("/admin/audit", { preHandler: [authenticate, requirePermission(PERMISSIONS.AUDIT_VIEW)] }, async (request) => {
    const query = paginationSchema.parse(request.query);
    const filters = request.query as Record<string, string | undefined>;
    return audit.list({
      page: query.page,
      pageSize: query.pageSize,
      action: filters.action,
      actorId: filters.actorId,
      entityType: filters.entityType,
      entityId: filters.entityId,
      severity: filters.severity,
      from: filters.from ? new Date(filters.from) : undefined,
      to: filters.to ? new Date(filters.to) : undefined,
    });
  });

  // ── admin staff management ────────────────────────────────────────────

  app.get("/admin/staff", { preHandler: [authenticate, requirePermission(PERMISSIONS.ADMIN_VIEW)] }, async () => {
    const rows = await prisma.user.findMany({
      where: { roles: { hasSome: ADMIN_ROLES } },
      select: {
        id: true,
        username: true,
        email: true,
        roles: true,
        status: true,
        twoFactorEnabled: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return { staff: rows };
  });

  // ── CMS ───────────────────────────────────────────────────────────────

  app.get("/admin/cms/pages", { preHandler: [authenticate, requirePermission(PERMISSIONS.CMS_VIEW)] }, async () => {
    const rows = await prisma.cmsPage.findMany({ orderBy: { updatedAt: "desc" } });
    return { pages: rows };
  });

  app.put("/admin/cms/pages/:slug", { preHandler: [authenticate, requirePermission(PERMISSIONS.CMS_EDIT)] }, async (request) => {
    const { slug } = request.params as { slug: string };
    const body = (request.body ?? {}) as Record<string, unknown>;

    const page = await prisma.cmsPage.upsert({
      where: { slug },
      create: {
        slug,
        title: String(body.title ?? slug),
        content: String(body.content ?? ""),
        locale: String(body.locale ?? "tr"),
        status: String(body.status ?? "DRAFT"),
        seoTitle: body.seoTitle as string | undefined,
        seoDescription: body.seoDescription as string | undefined,
        seoKeywords: (body.seoKeywords as string[] | undefined) ?? [],
        authorId: request.user!.id,
        publishedAt: body.status === "PUBLISHED" ? new Date() : null,
      },
      update: {
        title: body.title as string | undefined,
        content: body.content as string | undefined,
        status: body.status as string | undefined,
        seoTitle: body.seoTitle as string | undefined,
        seoDescription: body.seoDescription as string | undefined,
        seoKeywords: body.seoKeywords as string[] | undefined,
        publishedAt: body.status === "PUBLISHED" ? new Date() : undefined,
      },
    });

    await audit.log({
      actorId: request.user!.id,
      action: body.status === "PUBLISHED" ? AuditAction.CMS_PUBLISH : AuditAction.CMS_EDIT,
      entityType: "CmsPage",
      entityId: slug,
    });

    return { page };
  });

  app.get("/admin/cms/banners", { preHandler: [authenticate, requirePermission(PERMISSIONS.CMS_VIEW)] }, async () => {
    return { banners: await prisma.banner.findMany({ orderBy: { sortOrder: "asc" } }) };
  });

  app.post("/admin/cms/banners", { preHandler: [authenticate, requirePermission(PERMISSIONS.CMS_EDIT)] }, async (request) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const banner = await prisma.banner.create({
      data: {
        title: String(body.title ?? ""),
        imageUrl: String(body.imageUrl ?? ""),
        linkUrl: body.linkUrl as string | undefined,
        position: String(body.position ?? "HOME_HERO"),
        sortOrder: Number(body.sortOrder ?? 0),
        isActive: body.isActive !== false,
      },
    });
    return { banner };
  });

  app.get("/admin/cms/announcements", { preHandler: [authenticate, requirePermission(PERMISSIONS.CMS_VIEW)] }, async () => {
    return { announcements: await prisma.announcement.findMany({ orderBy: { createdAt: "desc" } }) };
  });

  app.post("/admin/cms/announcements", { preHandler: [authenticate, requirePermission(PERMISSIONS.CMS_EDIT)] }, async (request) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const announcement = await prisma.announcement.create({
      data: {
        title: String(body.title ?? ""),
        body: String(body.body ?? ""),
        type: String(body.type ?? "INFO"),
        isActive: body.isActive !== false,
      },
    });
    return { announcement };
  });

  // ── tournaments ───────────────────────────────────────────────────────

  app.get("/admin/tournaments", { preHandler: [authenticate, requirePermission(PERMISSIONS.TOURNAMENT_VIEW)] }, async () => {
    const rows = await prisma.tournament.findMany({
      orderBy: { startAt: "desc" },
      include: { _count: { select: { entries: true } } },
    });
    return { tournaments: rows };
  });

  app.post("/admin/tournaments", { preHandler: [authenticate, requirePermission(PERMISSIONS.TOURNAMENT_MANAGE)] }, async (request) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const currency = String(body.currency ?? "TRY");

    const tournament = await prisma.tournament.create({
      data: {
        slug: String(body.slug ?? nanoid(10)),
        name: String(body.name ?? "Turnuva"),
        description: body.description as string | undefined,
        bannerUrl: body.bannerUrl as string | undefined,
        type: String(body.type ?? "LEADERBOARD"),
        status: String(body.status ?? "SCHEDULED"),
        metric: String(body.metric ?? "WAGERED"),
        prizePool: parseAmount(String(body.prizePool ?? "0"), currency),
        currency,
        entryFee: body.entryFee ? parseAmount(String(body.entryFee), currency) : 0n,
        maxEntries: body.maxEntries ? Number(body.maxEntries) : null,
        allowedGames: (body.allowedGames as string[]) ?? [],
        allowedCategories: (body.allowedCategories as string[]) ?? [],
        startAt: new Date(String(body.startAt ?? Date.now())),
        endAt: new Date(String(body.endAt ?? Date.now() + 7 * 24 * 3600 * 1000)),
      },
    });

    return { tournament };
  });

  // ── affiliates ────────────────────────────────────────────────────────

  app.get("/admin/affiliates", { preHandler: [authenticate, requirePermission(PERMISSIONS.AFFILIATE_VIEW)] }, async (request) => {
    const query = paginationSchema.parse(request.query);
    const [total, rows] = await Promise.all([
      prisma.affiliate.count(),
      prisma.affiliate.findMany({
        orderBy: { lifetimeEarnings: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { user: { select: { username: true, email: true } } },
      }),
    ]);
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      affiliates: rows.map((a) => ({
        id: a.id,
        code: a.code,
        username: a.user.username,
        email: a.user.email,
        status: a.status,
        commissionType: a.commissionType,
        revenueSharePercent: a.revenueSharePercent.toString(),
        balance: a.balance.toString(),
        lifetimeEarnings: a.lifetimeEarnings.toString(),
        clicks: a.clicks.toString(),
        signups: a.signups.toString(),
        depositors: a.depositors.toString(),
        totalDeposits: a.totalDeposits.toString(),
        createdAt: a.createdAt,
      })),
    };
  });

  app.post("/admin/affiliates/:id/payout", { preHandler: [authenticate, requirePermission(PERMISSIONS.AFFILIATE_PAYOUT)] }, async (request) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { amount?: string };
    const affiliate = await prisma.affiliate.findUnique({ where: { id } });
    if (!affiliate) throw Errors.notFound("Afiili");

    const amount = body.amount ? parseAmount(body.amount, affiliate.currency) : affiliate.balance;
    if (amount <= 0n) throw Errors.validation("Odenek tutari yok");
    if (amount > affiliate.balance) throw Errors.validation("Bakiye yetersiz");

    const payout = await prisma.$transaction(async (tx) => {
      await tx.affiliate.update({
        where: { id },
        data: { balance: { decrement: amount }, lifetimePaid: { increment: amount } },
      });
      return tx.affiliatePayout.create({
        data: { affiliateId: id, amount, currency: affiliate.currency, status: "PAID", approvedById: request.user!.id, paidAt: new Date() },
      });
    });

    await audit.log({
      actorId: request.user!.id,
      action: "AFFILIATE_PAID",
      entityType: "Affiliate",
      entityId: id,
      after: { amount: amount.toString() },
      severity: "WARNING",
    });

    return { payout };
  });
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function mapCategory(category: string): string {
  const upper = category.toUpperCase();
  if (upper.includes("LIVE")) return "LIVE_CASINO";
  if (upper.includes("TABLE") || upper.includes("BLACKJACK") || upper.includes("ROULETTE") || upper.includes("BACCARAT")) return "TABLE";
  if (upper.includes("CRASH")) return "CRASH";
  if (upper.includes("JACKPOT")) return "JACKPOT";
  if (upper.includes("INSTANT") || upper.includes("MINES") || upper.includes("PLINKO")) return "INSTANT";
  if (upper.includes("FISH")) return "FISHING";
  if (upper.includes("LOTTERY") || upper.includes("KENO")) return "LOTTERY";
  if (upper.includes("SPORT")) return "SPORTS";
  if (upper.includes("VIRTUAL")) return "VIRTUAL";
  return "SLOTS";
}
