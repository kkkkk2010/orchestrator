import dotenv from "dotenv";
import { Worker } from "bullmq";
import { getQueueName, getWorkerRedisConnection } from "./queue";
import { logger } from "./logger";
import { assertThemeTemplateExists } from "./themes/themeStore";
import { readDocJsonFromTemplateZip } from "./themes/templateZip";
import { extractFillKeys, extractImageSlots, inferSlideCount } from "./themes/parseDoc";

dotenv.config();

const concurrency = parseInt(process.env.WORKER_CONCURRENCY || "2", 10);

const worker = new Worker(
  getQueueName(),
  async (job) => {
    const themeId = typeof job.data?.themeId === "string" ? job.data.themeId : "";
    const jobLogger = logger.child({ jobId: job.id, themeId });

    jobLogger.info("job started");

    await job.updateProgress(10);
    jobLogger.info({ stage: "load_theme_pack" }, "progress updated");
    const templatePath = await assertThemeTemplateExists(themeId);

    await job.updateProgress(30);
    jobLogger.info({ stage: "read_template_zip" }, "progress updated");
    const doc = await readDocJsonFromTemplateZip(templatePath);

    await job.updateProgress(60);
    jobLogger.info({ stage: "parse_doc" }, "progress updated");

    const fillKeys = extractFillKeys(doc);
    const imageSlots = extractImageSlots(doc);
    const slideCount = inferSlideCount(doc);

    const result = {
      ok: true,
      themeId,
      fillKeys,
      imageSlots,
      slideCount,
    };

    await job.updateProgress(100);
    jobLogger.info(
      {
        stage: "done",
        fillKeysCount: fillKeys.length,
        imageSlotsCount: imageSlots.length,
        slideCount,
      },
      "job completed"
    );

    return result;
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
