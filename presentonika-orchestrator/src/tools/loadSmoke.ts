import "dotenv/config";
import { Queue, QueueEvents, Worker } from "bullmq";
import type { ConnectionOptions, Job } from "bullmq";
import IORedis, { Redis } from "ioredis";
import { acquireUserSlot, releaseUserSlot } from "../concurrency/userSlots";

type LoadJob = { userId: number };

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const asBullConnection = (redis: Redis): ConnectionOptions => redis as unknown as ConnectionOptions;
const delay = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function runScenario(userCount: 3 | 10) {
  const queueName = `presentonika_p1_load_${userCount}_${Date.now()}_${process.pid}`;
  const queueRedis = new IORedis(redisUrl);
  const eventRedis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const workerRedis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const slotRedis = new IORedis(redisUrl);
  const queue = new Queue<LoadJob>(queueName, { connection: asBullConnection(queueRedis) });
  queue.setMaxListeners(0);
  const events = new QueueEvents(queueName, { connection: asBullConnection(eventRedis) });
  const activeByUser = new Map<number, number>();
  const maxByUser = new Map<number, number>();
  let activeGlobal = 0;
  let maxGlobal = 0;

  const worker = new Worker<LoadJob>(
    queueName,
    async (job: Job<LoadJob>) => {
      const token = String(job.id);
      const acquired = await acquireUserSlot(slotRedis, job.data.userId, token, {
        limit: 1,
        ttlSeconds: 300,
        waitMs: 10,
      });
      try {
        const userActive = (activeByUser.get(job.data.userId) || 0) + 1;
        activeByUser.set(job.data.userId, userActive);
        maxByUser.set(job.data.userId, Math.max(maxByUser.get(job.data.userId) || 0, userActive));
        activeGlobal += 1;
        maxGlobal = Math.max(maxGlobal, activeGlobal);
        await delay(75);
      } finally {
        activeGlobal -= 1;
        activeByUser.set(job.data.userId, Math.max(0, (activeByUser.get(job.data.userId) || 1) - 1));
        await releaseUserSlot(slotRedis, job.data.userId, token, acquired);
      }
      return { ok: true };
    },
    { connection: asBullConnection(workerRedis), concurrency: 20 },
  );

  const startedAt = Date.now();
  try {
    await Promise.all([events.waitUntilReady(), worker.waitUntilReady()]);
    const jobs = await queue.addBulk(
      Array.from({ length: userCount }, (_, index) => [
        { name: "load-smoke", data: { userId: 900_000_000 + userCount * 100 + index } },
        { name: "load-smoke", data: { userId: 900_000_000 + userCount * 100 + index } },
      ]).flat(),
    );
    await Promise.all(jobs.map((job) => job.waitUntilFinished(events, 15_000)));

    const perUserMax = Math.max(...maxByUser.values());
    if (perUserMax !== 1) throw new Error(`per-user concurrency violated: ${perUserMax}`);
    if (maxGlobal < Math.min(3, userCount)) throw new Error(`insufficient parallelism: ${maxGlobal}`);

    return {
      users: userCount,
      jobs: jobs.length,
      durationMs: Date.now() - startedAt,
      perUserMax,
      globalMax: maxGlobal,
    };
  } finally {
    await worker.close();
    await queue.drain(true).catch(() => undefined);
    await queue.obliterate({ force: true }).catch(() => undefined);
    await Promise.allSettled([events.close(), queue.close()]);
    await Promise.allSettled([queueRedis.quit(), eventRedis.quit(), workerRedis.quit(), slotRedis.quit()]);
  }
}

void Promise.all([runScenario(3), runScenario(10)])
  .then((scenarios) => process.stdout.write(`${JSON.stringify({ ok: true, scenarios })}\n`))
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
