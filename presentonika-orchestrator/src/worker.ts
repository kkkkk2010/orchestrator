import dotenv from "dotenv";
import { Worker } from "bullmq";
import { getQueueName, getWorkerRedisConnection } from "./queue";
import { logger } from "./logger";
import { assertThemeTemplateExists, getThemeDir, readThemeMap, readThemeSafe } from "./themes/themeStore";
import { readDocJsonFromTemplateZip } from "./themes/templateZip";
import { extractFillKeys, extractImageSlots, inferSlideCount } from "./themes/parseDoc";
import { applyVariants } from "./templates/applyVariants";
import { applyFills } from "./templates/applyFills";
import { assembleZip } from "./templates/assembleZip";
import { planImageReplacements } from "./images/planImageReplacements";
import { generateBackgrounds } from "./backgrounds/generateBackgrounds";
import { normalizeBackgroundTheme } from "./backgrounds/theme";

dotenv.config();

const concurrency = parseInt(process.env.WORKER_CONCURRENCY || "2", 10);
const IMAGE_MISSING_LIMIT = 50;
const BACKGROUND_MISSING_LIMIT = 50;

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
    const themeDir = getThemeDir(themeId);
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

    await job.updateProgress(75);
    jobLogger.info({ stage: "apply_variants_fills" }, "progress updated");

    const variantsStats = applyVariants(doc, map, { presentationId }, {
      onDropAtOutOfRange: ({ slideIndex, badIndex }) => {
        jobLogger.warn({ slideIndex, badIndex }, "dropAt index out of range");
      },
    });
    const fillsStats = applyFills(doc, fills);

    await job.updateProgress(80);
    jobLogger.info({ stage: "prepare_images" }, "progress updated");

    const imagePlan = await planImageReplacements({ doc, map, themeDir });
    for (const missingItem of imagePlan.missing) {
      jobLogger.warn(
        {
          slideIndex: missingItem.slide,
          elementIndex: missingItem.element,
          slotName: missingItem.slot,
          reason: missingItem.reason,
        },
        "image replacement skipped"
      );
    }

    await job.updateProgress(85);
    jobLogger.info({ stage: "generate_backgrounds" }, "progress updated");

    const theme = await readThemeSafe(themeId);
    const backgroundTheme = normalizeBackgroundTheme(theme);
    const backgrounds = await generateBackgrounds({
      jobId,
      presentationId,
      slideCount,
      theme: backgroundTheme,
    });

    for (const missingBackground of backgrounds.missing) {
      jobLogger.warn(
        {
          slideIndex: missingBackground.slide,
          path: missingBackground.path,
          reason: missingBackground.reason,
        },
        "background generation skipped"
      );
    }

    await job.updateProgress(90);
    jobLogger.info({ stage: "assemble_zip" }, "progress updated");

    const updatedDocJsonString = JSON.stringify(doc, null, 2);
    const assembled = await assembleZip({
      templateZipPath: templatePath,
      jobId,
      updatedDocJsonString,
      replacements: {
        ...imagePlan.replacements,
        ...backgrounds.replacements,
      },
    });

    const imageMissing = [...imagePlan.missing];
    for (const missingEntryPath of assembled.missingEntryPaths) {
      if (missingEntryPath.startsWith("backgrounds/")) {
        continue;
      }

      const missingItem = {
        slide: 0,
        element: -1,
        slot: missingEntryPath,
        reason: "zip_entry_not_found",
      };
      imageMissing.push(missingItem);
      jobLogger.warn(
        {
          slideIndex: missingItem.slide,
          elementIndex: missingItem.element,
          slotName: missingItem.slot,
          reason: missingItem.reason,
        },
        "image replacement skipped"
      );
    }

    const backgroundsMissing = [...backgrounds.missing];
    for (const missingEntryPath of assembled.missingEntryPaths) {
      if (!missingEntryPath.startsWith("backgrounds/")) {
        continue;
      }

      const match = missingEntryPath.match(/slide-(\d+)\.png$/);
      const slide = match ? Number.parseInt(match[1], 10) : 0;
      const missingItem = {
        slide,
        path: missingEntryPath,
        reason: "zip_entry_not_found",
      };
      backgroundsMissing.push(missingItem);
      jobLogger.warn({ slideIndex: slide, path: missingEntryPath, reason: missingItem.reason }, "background replacement skipped");
    }

    const imageMissingCapped = imageMissing.slice(0, IMAGE_MISSING_LIMIT);
    const backgroundsMissingCapped = backgroundsMissing.slice(0, BACKGROUND_MISSING_LIMIT);
    const backgroundsReplacedCount = assembled.replacedEntryPaths.filter((entryPath) => entryPath.startsWith("backgrounds/")).length;

    const result = {
      ok: true,
      themeId,
      slideCount,
      fillKeys,
      imageSlots,
      assemble: {
        outZipPath: assembled.outZipPath,
        replacedCount: fillsStats.replacedCount,
        missingKeys: fillsStats.missingKeys,
        droppedCount: variantsStats.droppedCount,
        droppedAtCount: variantsStats.droppedAtCount,
        imagePlannedCount: imagePlan.plannedCount,
        imageReplacedCount: assembled.replacedEntryPaths.filter((entryPath) => !entryPath.startsWith("backgrounds/")).length,
        imageMissing: imageMissingCapped,
        backgroundsPlannedCount: slideCount,
        backgroundsReplacedCount,
        backgroundsMissing: backgroundsMissingCapped,
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
        imagePlannedCount: imagePlan.plannedCount,
        imageReplacedCount: result.assemble.imageReplacedCount,
        imageMissingCount: imageMissing.length,
        backgroundsPlannedCount: slideCount,
        backgroundsReplacedCount,
        backgroundsMissingCount: backgroundsMissing.length,
        outZipPath: assembled.outZipPath,
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
