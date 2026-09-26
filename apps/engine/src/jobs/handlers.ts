import { prisma } from "@aurora/db";
import { fromMinor, LedgerAccountType, LedgerDirection, TxType } from "@aurora/shared";
import { ledger } from "../services/ledger.js";
import { bonusService } from "../services/bonuses.js";
import { env } from "../lib/env.js";
import nodemailer from "nodemailer";

export interface JobContext {
  app?: { realtime?: { pushNotification: (userId: string, payload: Record<string, unknown>) => void } };
}

// ─────────────────────────── PAYMENTS ───────────────────────────

/** Auto-approve withdrawals that pass every configured gate. */
export async function jobAutoApproveWithdrawals(): Promise<unknown> {
  const { PaymentService } = await import("../services/payments.js");
  const { createProviderRegistry } = await import("../providers/index.js");
  const payments = new PaymentService(createProviderRegistry());

  const candidates = await prisma.paymentIntent.findMany({
    where: {
      direction: "WITHDRAWAL",
      status: "PENDING",
      requiresReview: false,
      createdAt: { lt: new Date(Date.now() - 60_000) },
    },
    include: { user: { include: { kyc: true } } },
    take: 25,
  });

  let approved = 0;
  let skipped = 0;

  for (const intent of candidates) {
    // Gate: KYC approved, no open high-severity risk flags, amount within auto-limit.
    const openFlags = await prisma.riskFlag.count({
      where: { userId: intent.userId, status: "OPEN", severity: { in: ["HIGH", "CRITICAL"] } },
    });
    const kycOk = !env.features.kyc || intent.user.kyc?.status === "APPROVED";
    const withinLimit = intent.amount <= 50_000_00n;

    if (!kycOk || openFlags > 0 || !withinLimit) {
      await prisma.paymentIntent.update({
        where: { id: intent.id },
        data: {
          requiresReview: true,
          reviewReason: !kycOk ? "KYC onayli degil" : openFlags > 0 ? "Acik risk uyarisi" : "Tutar otomatik limit ustunde",
        },
      });
      skipped++;
      continue;
    }

    try {
      await payments.approveWithdrawal(intent.id);
      approved++;
      await prisma.notification.create({
        data: {
          userId: intent.userId,
          type: "WITHDRAWAL_APPROVED",
          title: "Cekim onaylandi",
          body: `${fromMinor(intent.amount, intent.currency as never)} tutarindaki cekiminiz isleme alindi.`,
        },
      });
    } catch (error) {
      console.error(`[jobs] cekim onaylanamadi ${intent.reference}`, error);
      skipped++;
    }
  }

  return { approved, skipped, scanned: candidates.length };
}

/** Expire abandoned deposit intents so stale rows do not accumulate. */
export async function jobExpireDeposits(): Promise<unknown> {
  const result = await prisma.paymentIntent.updateMany({
    where: { direction: "DEPOSIT", status: "PENDING", expiresAt: { lt: new Date() } },
    data: { status: "FAILED", failureReason: "Zaman asimi" },
  });
  return { expired: result.count };
}

/** Reconcile wallet balances against the ledger and raise flags on drift. */
export async function jobReconcileLedger(): Promise<unknown> {
  const wallets = await prisma.wallet.findMany({ where: { type: "REAL" }, take: 500 });
  const mismatches: string[] = [];

  for (const wallet of wallets) {
    const entries = await prisma.ledgerEntry.findMany({
      where: { walletId: wallet.id },
      select: { direction: true, amount: true },
    });
    let computed = 0n;
    for (const entry of entries) {
      computed += entry.direction === "CREDIT" ? entry.amount : -entry.amount;
    }
    if (computed !== wallet.balance) {
      mismatches.push(wallet.id);
      await prisma.riskFlag.create({
        data: {
          userId: wallet.userId,
          type: "LEDGER_MISMATCH",
          severity: "CRITICAL",
          title: "Cuzdan bakiyesi defterle uyusmuyor",
          detail: `beklenen=${computed} kayitli=${wallet.balance}`,
          metadata: { walletId: wallet.id } as never,
        },
      });
    }
  }

  return { checked: wallets.length, mismatches: mismatches.length };
}

// ─────────────────────────── BONUSES ───────────────────────────

/** Expire lapsed bonuses and pull the remaining bonus balance. */
export async function jobExpireBonuses(): Promise<unknown> {
  const expired = await prisma.userBonus.findMany({
    where: { status: "ACTIVE", expiresAt: { lt: new Date() } },
    select: { id: true },
    take: 500,
  });

  for (const bonus of expired) {
    await bonusService.expireBonus(bonus.id).catch((error) => console.error("[jobs] bonus expire hatasi", error));
  }
  return { expired: expired.length };
}

/** Weekly cashback for VIP players, based on the week's net loss. */
export async function jobPayVipRewards(): Promise<unknown> {
  const tiers = await prisma.vipTierConfig.findMany({ where: { isActive: true } });
  const tierMap = new Map(tiers.map((t) => [t.tier, t]));
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);

  const players = await prisma.vipProfile.findMany({ where: { tier: { not: "BRONZE" } }, take: 1000 });

  let paid = 0;
  for (const profile of players) {
    const tier = tierMap.get(profile.tier);
    if (!tier) continue;

    const agg = await prisma.bet.aggregate({
      where: { userId: profile.userId, isDemo: false, placedAt: { gte: weekAgo }, profit: { lt: 0 } },
      _sum: { profit: true },
    });

    const netLoss = -(agg._sum.profit ?? 0n);
    if (netLoss <= 0n) continue;

    const cashback = (netLoss * BigInt(Math.round(Number(tier.cashbackPercent) * 100))) / 10_000n;
    if (cashback <= 0n) continue;

    const already = await prisma.transaction.findUnique({
      where: { idempotencyKey: `cashback:${profile.userId}:${weekAgo.toISOString().slice(0, 10)}` },
    });
    if (already) continue;

    await ledger.post({
      userId: profile.userId,
      type: TxType.CASHBACK,
      amount: cashback,
      currency: "TRY",
      legs: [
        { accountType: LedgerAccountType.PLAYER_REAL, direction: LedgerDirection.CREDIT, amount: cashback },
        { accountType: LedgerAccountType.HOUSE, direction: LedgerDirection.DEBIT, amount: cashback },
      ],
      description: `Haftalik cashback (${profile.tier})`,
      idempotencyKey: `cashback:${profile.userId}:${weekAgo.toISOString().slice(0, 10)}`,
    });

    await prisma.vipProfile.update({
      where: { id: profile.id },
      data: { cashbackBalance: { increment: cashback }, lastCashbackAt: new Date() },
    });

    await prisma.notification.create({
      data: {
        userId: profile.userId,
        type: "CASHBACK",
        title: "Cashback hesabiniza eklendi",
        body: `Haftalik cashback: ${fromMinor(cashback, "TRY" as never)}`,
      },
    });

    paid++;
  }

  return { paid };
}

/** Promote players whose lifetime wager crossed the next tier threshold. */
export async function jobUpgradeVipTiers(): Promise<unknown> {
  const tiers = await prisma.vipTierConfig.findMany({ where: { isActive: true }, orderBy: { level: "asc" } });
  if (tiers.length === 0) return { upgraded: 0 };

  const profiles = await prisma.vipProfile.findMany({ take: 2000 });
  let upgraded = 0;

  for (const profile of profiles) {
    const eligible = [...tiers].reverse().find((t) => profile.lifetimeWagered >= t.minWagered);
    if (eligible && eligible.level > profile.level) {
      await prisma.vipProfile.update({
        where: { id: profile.id },
        data: { tier: eligible.tier, level: eligible.level, upgradedAt: new Date() },
      });
      await prisma.notification.create({
        data: {
          userId: profile.userId,
          type: "VIP_UPGRADE",
          title: `VIP seviyeniz yukseldi: ${eligible.name}`,
          body: "Yeni avantajlariniz aktif.",
        },
      });
      upgraded++;
    }
  }

  return { upgraded };
}

// ─────────────────────────── RISK ───────────────────────────

/** Heuristic scan for suspicious accounts; creates risk flags for review. */
export async function jobRiskScan(): Promise<unknown> {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const flags: string[] = [];

  // Same device used by many accounts.
  const sharedDevices = await prisma.deviceFingerprint.groupBy({
    by: ["fingerprint"],
    _count: { userId: true },
    having: { userId: { _count: { gt: 3 } } },
  });

  for (const device of sharedDevices) {
    const users = await prisma.deviceFingerprint.findMany({
      where: { fingerprint: device.fingerprint },
      select: { userId: true },
      take: 10,
    });
    for (const user of users) {
      const exists = await prisma.riskFlag.findFirst({
        where: { userId: user.userId, type: "MULTI_ACCOUNT_DEVICE", status: "OPEN" },
      });
      if (exists) continue;
      await prisma.riskFlag.create({
        data: {
          userId: user.userId,
          type: "MULTI_ACCOUNT_DEVICE",
          severity: "HIGH",
          title: "Ayni cihazdan coklu hesap",
          detail: `${device._count.userId} hesap ayni cihaz parmak izini kullaniyor`,
          metadata: { fingerprint: device.fingerprint } as never,
        },
      });
      flags.push("MULTI_ACCOUNT_DEVICE");
    }
  }

  // Large deposits followed immediately by withdrawal attempts.
  const recentDepositors = await prisma.paymentIntent.findMany({
    where: { direction: "DEPOSIT", status: "COMPLETED", completedAt: { gte: since } },
    select: { userId: true, amount: true, completedAt: true, reference: true },
    take: 300,
  });

  for (const deposit of recentDepositors) {
    if (!deposit.completedAt) continue;
    const withdrawal = await prisma.paymentIntent.findFirst({
      where: { userId: deposit.userId, direction: "WITHDRAWAL", createdAt: { gte: deposit.completedAt } },
      orderBy: { createdAt: "asc" },
    });
    if (!withdrawal) continue;

    const gapMinutes = (withdrawal.createdAt.getTime() - deposit.completedAt.getTime()) / 60_000;
    if (gapMinutes >= 10 || withdrawal.amount < deposit.amount) continue;

    const exists = await prisma.riskFlag.findFirst({
      where: { userId: deposit.userId, type: "RAPID_DEPOSIT_WITHDRAWAL", status: "OPEN" },
    });
    if (exists) continue;

    await prisma.riskFlag.create({
      data: {
        userId: deposit.userId,
        type: "RAPID_DEPOSIT_WITHDRAWAL",
        severity: "MEDIUM",
        title: "Hizli yatirim-cekim dongusu",
        detail: `${Math.round(gapMinutes)} dakika icinde cekim denemesi`,
        metadata: { depositRef: deposit.reference, withdrawalRef: withdrawal.reference } as never,
      },
    });
    flags.push("RAPID_DEPOSIT_WITHDRAWAL");
  }

  return { flagsCreated: flags.length, types: [...new Set(flags)] };
}

// ─────────────────────────── ANALYTICS ───────────────────────────

/** Roll daily statistics into the reporting tables. */
export async function jobAggregateDailyStats(): Promise<unknown> {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);

  const [deposits, withdrawals, bets, bonuses, newPlayers, activePlayers] = await Promise.all([
    prisma.paymentIntent.aggregate({
      where: { direction: "DEPOSIT", status: "COMPLETED", completedAt: { gte: date } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.paymentIntent.aggregate({
      where: { direction: "WITHDRAWAL", status: "COMPLETED", completedAt: { gte: date } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.bet.aggregate({
      where: { isDemo: false, placedAt: { gte: date } },
      _sum: { stake: true, payout: true },
    }),
    prisma.transaction.aggregate({
      where: { type: { in: ["BONUS_CREDIT", "CASHBACK", "RAKEBACK"] }, createdAt: { gte: date } },
      _sum: { amount: true },
    }),
    prisma.user.count({ where: { createdAt: { gte: date } } }),
    prisma.bet.groupBy({ by: ["userId"], where: { isDemo: false, placedAt: { gte: date } } }).then((r) => r.length),
  ]);

  const wagered = bets._sum.stake ?? 0n;
  const paid = bets._sum.payout ?? 0n;

  const record = await prisma.financialStatDaily.upsert({
    where: { date },
    create: {
      date,
      currency: "TRY",
      deposits: deposits._sum.amount ?? 0n,
      withdrawals: withdrawals._sum.amount ?? 0n,
      depositCount: deposits._count,
      withdrawalCount: withdrawals._count,
      wagered,
      payout: paid,
      ggr: wagered - paid,
      bonusCost: bonuses._sum.amount ?? 0n,
      newPlayers,
      activePlayers,
    },
    update: {
      deposits: deposits._sum.amount ?? 0n,
      withdrawals: withdrawals._sum.amount ?? 0n,
      depositCount: deposits._count,
      withdrawalCount: withdrawals._count,
      wagered,
      payout: paid,
      ggr: wagered - paid,
      bonusCost: bonuses._sum.amount ?? 0n,
      newPlayers,
      activePlayers,
    },
  });

  return { date, ggr: (wagered - paid).toString(), record: record.id };
}

/** Snapshot leaderboards so historical rankings survive. */
export async function jobSnapshotLeaderboards(): Promise<unknown> {
  const periods = ["DAILY", "WEEKLY", "MONTHLY"];
  let snapshots = 0;

  for (const period of periods) {
    const since =
      period === "DAILY"
        ? new Date(new Date().setUTCHours(0, 0, 0, 0))
        : period === "WEEKLY"
          ? new Date(Date.now() - 7 * 24 * 3600 * 1000)
          : new Date(Date.now() - 30 * 24 * 3600 * 1000);

    const rows = await prisma.bet.groupBy({
      by: ["userId"],
      where: { isDemo: false, placedAt: { gte: since } },
      _sum: { stake: true },
      orderBy: { _sum: { stake: "desc" } },
      take: 100,
    });

    const users = await prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.userId) } },
      select: { id: true, username: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u.username]));

    for (const [index, row] of rows.entries()) {
      await prisma.leaderboardSnapshot.create({
        data: {
          period,
          metric: "WAGERED",
          userId: row.userId,
          username: userMap.get(row.userId) ?? "Gizli",
          value: row._sum.stake ?? 0n,
          rank: index + 1,
        },
      });
      snapshots++;
    }
  }

  return { snapshots };
}

// ─────────────────────────── NOTIFICATIONS ───────────────────────────

let mailer: nodemailer.Transporter | null = null;

function getMailer(): nodemailer.Transporter {
  if (!mailer) {
    mailer = nodemailer.createTransport({
      host: env.mail.host,
      port: env.mail.port,
      secure: env.mail.secure,
      auth: env.mail.user ? { user: env.mail.user, pass: env.mail.pass } : undefined,
    });
  }
  return mailer;
}

/** Deliver queued outbound messages (email/SMS) with retry accounting. */
export async function jobDeliverMessages(): Promise<unknown> {
  const pending = await prisma.outboundMessage.findMany({
    where: { status: "QUEUED", attempts: { lt: 3 } },
    take: 50,
    orderBy: { createdAt: "asc" },
  });

  let sent = 0;
  let failed = 0;

  for (const message of pending) {
    try {
      if (message.channel === "EMAIL") {
        await getMailer().sendMail({
          from: env.mail.from,
          to: message.toAddress,
          subject: message.subject ?? env.appName,
          html: message.body,
        });
      } else if (message.channel === "SMS") {
        const { buildSms } = await import("../providers/index.js");
        await buildSms().send(message.toAddress, message.body);
      }

      await prisma.outboundMessage.update({
        where: { id: message.id },
        data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 } },
      });
      sent++;
    } catch (error) {
      await prisma.outboundMessage.update({
        where: { id: message.id },
        data: {
          attempts: { increment: 1 },
          status: message.attempts + 1 >= 3 ? "FAILED" : "QUEUED",
          error: error instanceof Error ? error.message : String(error),
        },
      });
      failed++;
    }
  }

  return { sent, failed, scanned: pending.length };
}

/** Queue a message for delivery from a template key. */
export async function queueMessage(params: {
  channel: "EMAIL" | "SMS" | "IN_APP";
  templateKey?: string;
  to: string;
  subject?: string;
  body: string;
}): Promise<void> {
  await prisma.outboundMessage.create({
    data: {
      channel: params.channel,
      templateKey: params.templateKey,
      toAddress: params.to,
      subject: params.subject,
      body: params.body,
      status: params.channel === "IN_APP" ? "SENT" : "QUEUED",
      sentAt: params.channel === "IN_APP" ? new Date() : null,
    },
  });
}

// ─────────────────────────── MAINTENANCE ───────────────────────────

/** Purge expired sessions and stale webhook/job rows. */
export async function jobCleanup(): Promise<unknown> {
  const now = new Date();
  const [sessions, webhooks, jobRuns] = await Promise.all([
    prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.webhookEvent.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 90 * 24 * 3600 * 1000) } } }),
    prisma.jobRun.deleteMany({ where: { startedAt: { lt: new Date(now.getTime() - 30 * 24 * 3600 * 1000) } } }),
  ]);

  return { sessions: sessions.count, webhooks: webhooks.count, jobRuns: jobRuns.count };
}

/** Grow jackpot pools from the configured contribution rate. */
export async function jobGrowJackpots(): Promise<unknown> {
  const jackpots = await prisma.jackpot.findMany({ where: { isActive: true } });
  let updated = 0;

  for (const jackpot of jackpots) {
    const agg = await prisma.bet.aggregate({
      where: { gameId: jackpot.gameId, isDemo: false, placedAt: { gte: jackpot.updatedAt } },
      _sum: { stake: true },
    });
    const wagered = agg._sum.stake ?? 0n;
    if (wagered <= 0n) continue;

    const contribution = (wagered * BigInt(Math.round(Number(jackpot.contributionRate) * 100))) / 10_000n;
    if (contribution <= 0n) continue;

    await prisma.jackpot.update({
      where: { id: jackpot.id },
      data: { currentAmount: { increment: contribution } },
    });
    updated++;
  }

  return { updated };
}

/** Compute affiliate commissions for the previous day. */
export async function jobAffiliateCommissions(): Promise<unknown> {
  if (!env.affiliate.enabled) return { skipped: true };

  const periodEnd = new Date();
  periodEnd.setUTCHours(0, 0, 0, 0);
  const periodStart = new Date(periodEnd.getTime() - 24 * 3600 * 1000);

  const affiliates = await prisma.affiliate.findMany({ where: { status: "ACTIVE" }, take: 500 });
  let created = 0;

  for (const affiliate of affiliates) {
    const referred = await prisma.user.findMany({
      where: { referredById: affiliate.userId },
      select: { id: true },
    });
    if (referred.length === 0) continue;

    const ids = referred.map((r) => r.id);
    const [deposits, bets] = await Promise.all([
      prisma.paymentIntent.aggregate({
        where: { userId: { in: ids }, direction: "DEPOSIT", status: "COMPLETED", completedAt: { gte: periodStart, lt: periodEnd } },
        _sum: { amount: true },
      }),
      prisma.bet.aggregate({
        where: { userId: { in: ids }, isDemo: false, placedAt: { gte: periodStart, lt: periodEnd } },
        _sum: { stake: true, payout: true },
      }),
    ]);

    const wagered = bets._sum.stake ?? 0n;
    const paid = bets._sum.payout ?? 0n;
    const netRevenue = wagered - paid;

    const exists = await prisma.affiliateCommission.findFirst({
      where: { affiliateId: affiliate.id, periodStart, type: affiliate.commissionType },
    });
    if (exists) continue;

    const share = netRevenue > 0n ? (netRevenue * BigInt(Math.round(Number(affiliate.revenueSharePercent) * 100))) / 10_000n : 0n;
    const cpa = affiliate.commissionType === "CPA" && (deposits._sum.amount ?? 0n) > 0n ? affiliate.cpaAmount : 0n;
    const amount = share + cpa;
    if (amount <= 0n) continue;

    await prisma.affiliateCommission.create({
      data: {
        affiliateId: affiliate.id,
        type: affiliate.commissionType,
        amount,
        currency: affiliate.currency,
        periodStart,
        periodEnd,
        deposits: deposits._sum.amount ?? 0n,
        netRevenue,
        status: "PENDING",
      },
    });

    await prisma.affiliate.update({
      where: { id: affiliate.id },
      data: {
        balance: { increment: amount },
        lifetimeEarnings: { increment: amount },
        totalNetRevenue: { increment: netRevenue > 0n ? netRevenue : 0n },
      },
    });
    created++;
  }

  return { created, affiliates: affiliates.length };
}
