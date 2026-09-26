import type { FastifyInstance } from "fastify";
import { QUEUES, createWorker, enqueue, closeQueues } from "./queues.js";
import * as handlers from "./handlers.js";
import { prisma } from "@aurora/db";

const workers: import("bullmq").Worker[] = [];
const timers: NodeJS.Timeout[] = [];

/**
 * Background automation.
 *
 * Two layers: BullMQ workers handle event-driven work (a withdrawal was queued,
 * a message needs delivery) with retries and backoff; a light scheduler enqueues
 * recurring maintenance jobs on fixed intervals. Recurring jobs are idempotent,
 * so a duplicate run cannot double-pay anyone.
 *
 * Every scheduled task is registered in the ScheduledTask table so the admin
 * integrations page can show what is running and when it last succeeded.
 */
export async function startJobs(app: FastifyInstance): Promise<void> {
  const ctx = { app: { realtime: app.realtime } };

  // ── workers ───────────────────────────────────────────────────────────
  workers.push(
    createWorker(QUEUES.PAYMENTS, async (name) => {
      switch (name) {
        case "auto-approve-withdrawals":
          return handlers.jobAutoApproveWithdrawals();
        case "expire-deposits":
          return handlers.jobExpireDeposits();
        case "reconcile-ledger":
          return handlers.jobReconcileLedger();
        default:
          return { skipped: true };
      }
    }, 3),
  );

  workers.push(
    createWorker(QUEUES.BONUSES, async (name) => {
      switch (name) {
        case "expire-bonuses":
          return handlers.jobExpireBonuses();
        case "pay-vip-rewards":
          return handlers.jobPayVipRewards();
        case "upgrade-vip-tiers":
          return handlers.jobUpgradeVipTiers();
        case "grow-jackpots":
          return handlers.jobGrowJackpots();
        default:
          return { skipped: true };
      }
    }, 3),
  );

  workers.push(
    createWorker(QUEUES.NOTIFICATIONS, async (name) => {
      switch (name) {
        case "deliver-messages":
          return handlers.jobDeliverMessages();
        default:
          return { skipped: true };
      }
    }, 5),
  );

  workers.push(
    createWorker(QUEUES.ANALYTICS, async (name) => {
      switch (name) {
        case "aggregate-daily-stats":
          return handlers.jobAggregateDailyStats();
        case "snapshot-leaderboards":
          return handlers.jobSnapshotLeaderboards();
        case "affiliate-commissions":
          return handlers.jobAffiliateCommissions();
        default:
          return { skipped: true };
      }
    }, 2),
  );

  workers.push(
    createWorker(QUEUES.RISK, async (name) => {
      switch (name) {
        case "risk-scan":
          return handlers.jobRiskScan();
        default:
          return { skipped: true };
      }
    }, 2),
  );

  workers.push(
    createWorker(QUEUES.MAINTENANCE, async (name) => {
      switch (name) {
        case "cleanup":
          return handlers.jobCleanup();
        default:
          return { skipped: true };
      }
    }, 1),
  );

  // ── schedule ──────────────────────────────────────────────────────────
  const schedule: {
    queue: (typeof QUEUES)[keyof typeof QUEUES];
    job: string;
    everyMs: number;
    cron: string;
    description: string;
    runImmediately?: boolean;
  }[] = [
    { queue: QUEUES.PAYMENTS, job: "auto-approve-withdrawals", everyMs: 60_000, cron: "*/1 * * * *", description: "Otomatik cekim onayi" },
    { queue: QUEUES.PAYMENTS, job: "expire-deposits", everyMs: 300_000, cron: "*/5 * * * *", description: "Zaman asimi yatirimlari kapat" },
    { queue: QUEUES.PAYMENTS, job: "reconcile-ledger", everyMs: 3_600_000, cron: "0 * * * *", description: "Defter mutabakati" },
    { queue: QUEUES.BONUSES, job: "expire-bonuses", everyMs: 600_000, cron: "*/10 * * * *", description: "Bonus suresi kontrolu" },
    { queue: QUEUES.BONUSES, job: "grow-jackpots", everyMs: 300_000, cron: "*/5 * * * *", description: "Jackpot havuzu buyutme" },
    { queue: QUEUES.BONUSES, job: "upgrade-vip-tiers", everyMs: 900_000, cron: "*/15 * * * *", description: "VIP seviye yukseltme" },
    { queue: QUEUES.BONUSES, job: "pay-vip-rewards", everyMs: 604_800_000, cron: "0 3 * * 1", description: "Haftalik cashback odemesi" },
    { queue: QUEUES.NOTIFICATIONS, job: "deliver-messages", everyMs: 30_000, cron: "*/1 * * * *", description: "E-posta/SMS gonderimi" },
    { queue: QUEUES.ANALYTICS, job: "aggregate-daily-stats", everyMs: 900_000, cron: "*/15 * * * *", description: "Gunluk istatistik toplama" },
    { queue: QUEUES.ANALYTICS, job: "snapshot-leaderboards", everyMs: 3_600_000, cron: "0 * * * *", description: "Liderlik tablosu kaydi" },
    { queue: QUEUES.ANALYTICS, job: "affiliate-commissions", everyMs: 86_400_000, cron: "0 2 * * *", description: "Afiili komisyon hesaplama" },
    { queue: QUEUES.RISK, job: "risk-scan", everyMs: 600_000, cron: "*/10 * * * *", description: "Risk taramasi" },
    { queue: QUEUES.MAINTENANCE, job: "cleanup", everyMs: 86_400_000, cron: "0 4 * * *", description: "Temizlik isleri" },
  ];

  for (const entry of schedule) {
    await prisma.scheduledTask.upsert({
      where: { name: entry.job },
      create: {
        name: entry.job,
        cron: entry.cron,
        handler: `${entry.queue}:${entry.job}`,
        isActive: true,
        nextRunAt: new Date(Date.now() + entry.everyMs),
      },
      update: { cron: entry.cron, handler: `${entry.queue}:${entry.job}`, nextRunAt: new Date(Date.now() + entry.everyMs) },
    });

    // Keep the DB-sourced cadence and the in-process timer in agreement by
    // reading the interval back from the same schedule definition.
    const timer = setInterval(() => {
      void enqueue(entry.queue, entry.job, {})
        .then(() =>
          prisma.scheduledTask.update({
            where: { name: entry.job },
            data: {
              lastRunAt: new Date(),
              lastStatus: "ENQUEUED",
              nextRunAt: new Date(Date.now() + entry.everyMs),
              runCount: { increment: 1 },
            },
          }),
        )
        .catch((error) => console.error(`[jobs] ${entry.job} kuyruga eklenemedi`, error));
    }, entry.everyMs);
    timers.push(timer);

    // Stagger the first runs so boot does not fire everything at once.
    setTimeout(() => void enqueue(entry.queue, entry.job, {}).catch(() => undefined), 5_000 + Math.random() * 20_000);
  }

  app.log.warn(`[jobs] ${workers.length} worker ve ${timers.length} zamanlanmis gorev baslatildi`);
}

export async function stopJobs(): Promise<void> {
  for (const timer of timers) clearInterval(timer);
  timers.length = 0;
  for (const worker of workers) await worker.close();
  workers.length = 0;
  await closeQueues();
}
