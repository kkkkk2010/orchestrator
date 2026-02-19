import dotenv from "dotenv";
import { Worker } from "bullmq";
import { getQueueName, getWorkerRedisConnection } from "./queue";
import { logger } from "./logger";
import { sleep } from "./util/sleep";

dotenv.config();

const concurrency = parseInt(process.env.WORKER_CONCURRENCY || "2", 10);

const worker = new Worker(
  getQueueName(),
  async (job) => {
    const jobLogger = logger.child({ jobId: job.id });

    jobLogger.info("job started");
    await job.updateProgress(10);
    await sleep(300);

    await job.updateProgress(50);
    await sleep(500);

    await job.updateProgress(90);
    await sleep(300);

    await job.updateProgress(100);
    jobLogger.info("job completed");

    return { ok: true };
  },
  {
    connection: getWorkerRedisConnection(),
    concurrency,
  }
);

worker.on("failed", (job, error) => {
  logger.child({ jobId: job?.id }).error({ err: error }, "job failed");
});

worker.on("error", (error) => {
  logger.error({ err: error }, "worker error");
});

logger.info({ queue: getQueueName(), concurrency }, "worker started");
