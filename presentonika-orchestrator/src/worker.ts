import dotenv from "dotenv";
import { Worker } from "bullmq";
import { getQueueName, getWorkerRedisConnection } from "./queue";
import { logger } from "./logger";
import { assertThemeTemplateExists, readThemeMap } from "./themes/themeStore";
import { readDocJsonFromTemplateZip } from "./themes/templateZip";
import { extractFillKeys, extractImageSlots, inferSlideCount } from "./themes/parseDoc";
import { applyVariants } from "./templates/applyVariants";
import { applyFills } from "./templates/applyFills";
import { assembleZip } from "./templates/assembleZip";

dotenv.config();

const concurrency = parseInt(process.env.WORKER_CONCURRENCY || "2", 10);

const buildTestFills = (fillKeys: string[]): Record<string, string> => {
  const fills: Record<string, string> = {};

  for (const key of fillKeys) {
    fills[key] = `TEST_${key}`;
  }

  return fills;
};

const worker = new Worker(
  getQueueName(),
  async (job) => {
    const themeId = typeof job.data?.themeId === "string" ? job.data.themeId : "";
    const presentationId = typeof job.data?.presentationId === "number" ? job.data.presentationId : 0;
    const jobId = typeof job.id === "string" ? job.id : String(job.id);
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

    const fills = buildTestFills(fillKeys);
    const map = await readThemeMap(themeId);

    const variantsStats = applyVariants(doc, map, { presentationId }, {
      onDropAtOutOfRange: ({ slideIndex, badIndex }) => {
        jobLogger.warn({ slideIndex, badIndex }, "dropAt index out of range");
      },
    });
    const fillsStats = applyFills(doc, fills);

    await job.updateProgress(85);
    jobLogger.info({ stage: "assemble_zip" }, "progress updated");

    const updatedDocJsonString = JSON.stringify(doc, null, 2);
    const outZipPath = await assembleZip({
      templateZipPath: templatePath,
      jobId,
      updatedDocJsonString,
    });

    const result = {
      ok: true,
      themeId,
      slideCount,
      fillKeys,
      imageSlots,
      assemble: {
        outZipPath,
        replacedCount: fillsStats.replacedCount,
        missingKeys: fillsStats.missingKeys,
        droppedCount: variantsStats.droppedCount,
        droppedAtCount: variantsStats.droppedAtCount,
      },
    };

    await job.updateProgress(100);
    jobLogger.info(
      {
        stage: "done",
        fillKeysCount: fillKeys.length,
        imageSlotsCount: imageSlots.length,
        slideCount,
        replacedCount: fillsStats.replacedCount,
        droppedCount: variantsStats.droppedCount,
        droppedAtCount: variantsStats.droppedAtCount,
        outZipPath,
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
