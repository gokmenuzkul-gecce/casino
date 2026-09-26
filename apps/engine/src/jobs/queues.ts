import { Queue, Worker, QueueEvents, JobsOptions } from "bullmq";
import IORedis from "ioredis";
import { env } from "../lib/env.js";

let connection: IORedis | null = null;

/** Shared Redis connection for queues and workers. */
export function getRedis(): IORedis {
  if (!connection) {
    connection = new IORedis(env.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: false,
    });
    connection.on("error", (error) => console.error("[redis] hata", error.message));
  }
  return connection;
}

export const QUEUES = {
  PAYMENTS: "payments",
  BONUSES: "bonuses",
  NOTIFICATIONS: "notifications",
  ANALYTICS: "analytics",
  RISK: "risk",
  MAINTENANCE: "maintenance",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

const queues = new Map<string, Queue>();

export function getQueue(name: QueueName): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { count: 1_000 },
        removeOnFail: { count: 5_000 },
      },
    });
    queues.set(name, queue);
  }
  return queue;
}

/** Enqueue a job, tolerating a Redis outage so player actions never fail. */
export async function enqueue(
  queue: QueueName,
  jobName: string,
  payload: Record<string, unknown>,
  options?: JobsOptions,
): Promise<void> {
  try {
    await getQueue(queue).add(jobName, payload, options);
  } catch (error) {
    console.error(`[queue:${queue}] is eklenemedi (${jobName})`, error);
  }
}

export function createWorker(
  queue: QueueName,
  handler: (jobName: string, payload: Record<string, unknown>) => Promise<unknown>,
  concurrency = 5,
): Worker {
  const worker = new Worker(
    queue,
    async (job) => {
      const started = Date.now();
      try {
        const result = await handler(job.name, (job.data ?? {}) as Record<string, unknown>);
        await recordJobRun(queue, job.name, job.id, "COMPLETED", Date.now() - started, result);
        return result;
      } catch (error) {
        await recordJobRun(queue, job.name, job.id, "FAILED", Date.now() - started, null, error);
        throw error;
      }
    },
    { connection: getRedis(), concurrency },
  );

  worker.on("failed", (job, error) => {
    console.error(`[worker:${queue}] ${job?.name} basarisiz: ${error.message}`);
  });

  return worker;
}

/** Job history lands in Postgres so operators can audit automation. */
async function recordJobRun(
  queue: string,
  jobName: string,
  jobId: string | undefined,
  status: string,
  durationMs: number,
  result: unknown,
  error?: unknown,
): Promise<void> {
  try {
    const { prisma } = await import("@aurora/db");
    await prisma.jobRun.create({
      data: {
        queue,
        jobName,
        jobId,
        status,
        durationMs,
        result: (result ?? undefined) as never,
        error: error instanceof Error ? error.message : error ? String(error) : null,
        finishedAt: new Date(),
      },
    });
  } catch {
    /* job bookkeeping must never break the job itself */
  }
}

export async function closeQueues(): Promise<void> {
  for (const queue of queues.values()) await queue.close();
  queues.clear();
  if (connection) {
    await connection.quit();
    connection = null;
  }
}

export { QueueEvents };
