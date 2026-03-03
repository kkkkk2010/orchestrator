import "dotenv/config";
import path from "node:path";
import fs from "node:fs/promises";
import { Worker } from "bullmq";
import { getQueueName, getQueueRedisConnection, getWorkerRedisConnection } from "./queue";
import { logger } from "./logger";
import { assertThemeTemplateExists, getThemeDir, readThemeMap, readThemeSafe } from "./themes/themeStore";
import { readDocJsonFromTemplateZip } from "./themes/templateZip";
import { extractFillKeys, extractImageSlots, inferSlideCount } from "./themes/parseDoc";
import { applyVariants } from "./templates/applyVariants";
import { applyFills } from "./templates/applyFills";
import { assembleZip } from "./templates/assembleZip";
import { planImageReplacements } from "./images/planImageReplacements";
import { buildImagePlanFromMap } from "./images/imagePlan";
import { generateBackgrounds } from "./backgrounds/generateBackgrounds";
import { normalizeBackgroundTheme } from "./backgrounds/theme";
import { uploadOutzip } from "./wp/uploadOutzip";
import { saveOutzipFromUrl } from "./wp/saveOutzipFromUrl";
import { waitForHttp } from "./net/waitForHttp";
import { sleep } from "./util/sleep";
import { buildStagedUrl, createStagedFile, deleteStagedRecord } from "./staged/stagedStore";
import { HttpRagClient } from "./rag/httpRagClient";
import { formatQuerySourcesAsCitations, formatRetrieveContext } from "./rag/formatContext";
import { writeRagArtifacts } from "./rag/writeArtifacts";
import { DeepSeekClient } from "./llm/deepseek/DeepSeekClient";

const concurrency = parseInt(process.env.WORKER_CONCURRENCY || "2", 10);
const IMAGE_MISSING_LIMIT = 50;
const BACKGROUND_MISSING_LIMIT = 50;
const UPLOAD_TEXT_LIMIT = 500;
const WP_UPLOAD_TIMEOUT_MS = parseInt(process.env.WP_UPLOAD_TIMEOUT_MS || "20000", 10);
const WP_UPLOAD_ENABLED = process.env.WP_UPLOAD_ENABLED === "true";
const WP_FAIL_ON_UPLOAD_ERROR = process.env.WP_FAIL_ON_UPLOAD_ERROR !== "false";
const WP_SAVE_MODE = (process.env.WP_SAVE_MODE || "from_url").toLowerCase();
const WP_SAVE_FROM_URL_TIMEOUT_MS = parseInt(process.env.WP_SAVE_FROM_URL_TIMEOUT_MS || "30000", 10);
const WP_SAVE_RETRIES = parseInt(process.env.WP_SAVE_RETRIES || "10", 10);
const WP_SAVE_RETRY_BASE_DELAY_MS = parseInt(process.env.WP_SAVE_RETRY_BASE_DELAY_MS || "400", 10);
const WP_SAVE_WAIT_TIMEOUT_MS = parseInt(process.env.WP_SAVE_WAIT_TIMEOUT_MS || "5000", 10);
const PUBLIC_ZIP_BASE_URL = process.env.PUBLIC_ZIP_BASE_URL || "http://localhost:8080";
const STAGED_DIR_ABS = path.resolve(process.env.STAGED_DIR || ".staged");
const STAGED_TTL_SECONDS = parseInt(process.env.STAGED_TTL_SECONDS || "1800", 10);
const STAGED_CLEANUP_ON_SUCCESS = process.env.STAGED_CLEANUP_ON_SUCCESS !== "false";
const STAGED_CLEANUP_DELAY_SECONDS = parseInt(process.env.STAGED_CLEANUP_DELAY_SECONDS || "0", 10);



const RAG_ENABLED = process.env.RAG_ENABLED === "true";
const RAG_FAIL_ON_ERROR = process.env.RAG_FAIL_ON_ERROR === "true";
const RAG_COLLECTION = process.env.RAG_COLLECTION || "default";
const RAG_MODE_DEFAULT = process.env.RAG_MODE === "query" ? "query" : "retrieve";
const RAG_TOP_K = parseInt(process.env.RAG_TOP_K || "10", 10);
const RAG_MIN_SCORE = Number.parseFloat(process.env.RAG_MIN_SCORE || "0.45");
const RAG_MAX_CONTEXT_CHARS = parseInt(process.env.RAG_MAX_CONTEXT_CHARS || "12000", 10);
const RAG_MAX_HITS = parseInt(process.env.RAG_MAX_HITS || "12", 10);
const RAG_DEFAULT_SOURCE_URIS = (process.env.RAG_DEFAULT_SOURCE_URIS || "")
  .split(",")
  .map((item: string) => item.trim())
  .filter((item: string) => item.length > 0);
const RAG_INCLUDE_IN_OUTZIP = process.env.RAG_INCLUDE_IN_OUTZIP !== "false";

const LLM_ENABLED = process.env.LLM_ENABLED === "true";
const LLM_FAIL_ON_ERROR = process.env.LLM_FAIL_ON_ERROR === "true";

const MAX_SLIDES = parseInt(process.env.MAX_SLIDES || "30", 10);
const MAX_TEMPLATE_ZIP_BYTES = parseInt(process.env.MAX_TEMPLATE_ZIP_BYTES || "200000000", 10);
const MAX_OUTZIP_BYTES_LOCAL = parseInt(process.env.MAX_OUTZIP_BYTES_LOCAL || "250000000", 10);
const MAX_STAGED_BYTES = parseInt(process.env.MAX_STAGED_BYTES || String(MAX_OUTZIP_BYTES_LOCAL), 10);


const cleanupStagedFile = async (params: {
  stagedName: string;
  stagedAbsPath: string;
  jobLogger: typeof logger;
}): Promise<void> => {
  try {
    await deleteStagedRecord(getQueueRedisConnection(), params.stagedName);
    await fs.unlink(params.stagedAbsPath).catch(() => undefined);
  } catch (error) {
    params.jobLogger.warn({ err: error, stagedName: params.stagedName }, "staged cleanup failed");
  }
};

type StageName =
  | "load_theme_pack"
  | "read_template_zip"
  | "parse_doc"
  | "rag_retrieve"
  | "llm_generate"
  | "apply_variants_fills"
  | "prepare_images"
  | "generate_backgrounds"
  | "assemble_zip"
  | "publish_outzip"
  | "wp_save_from_url"
  | "upload_to_wp";

const createStageTimer = (): {
  mark: (stage: StageName) => void;
  timingsMs: Partial<Record<StageName, number>>;
} => {
  const timingsMs: Partial<Record<StageName, number>> = {};
  let last = Date.now();

  return {
    mark: (stage: StageName) => {
      const now = Date.now();
      timingsMs[stage] = now - last;
      last = now;
    },
    timingsMs,
  };
};


const isRetryableNetworkError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("etimedout") ||
    message.includes("fetch failed") ||
    message.includes("network")
  );
};

const calcRetryDelayMs = (attempt: number): number => {
  const backoff = Math.min(5000, WP_SAVE_RETRY_BASE_DELAY_MS * (2 ** Math.max(0, attempt - 1)));
  const jitter = Math.floor(Math.random() * 150);
  return backoff + jitter;
};

const buildTestFills = (fillKeys: string[]): Record<string, string> => {
  const fills: Record<string, string> = {};

  for (const key of fillKeys) {
    fills[key] = `TEST_${key}`;
  }

  return fills;
};



const applyImagePlanPatch = (params: {
  imagePlanDocument: ReturnType<typeof buildImagePlanFromMap>;
  patch: { slots: Array<{ slotId: string; query?: string; hint?: string; styleHint?: string; negative?: string[] }> };
}): void => {
  const slotById = new Map<string, ReturnType<typeof buildImagePlanFromMap>["slots"][number]>();
  for (const slot of params.imagePlanDocument.slots as ReturnType<typeof buildImagePlanFromMap>["slots"]) {
    slotById.set(slot.slotId, slot);
  }

  for (const slotPatch of params.patch.slots) {
    const slot = slotById.get(slotPatch.slotId);
    if (!slot) {
      continue;
    }

    if (typeof slotPatch.query === "string" && slotPatch.query.trim().length > 0) {
      slot.query = slotPatch.query;
    }
    if (typeof slotPatch.hint === "string" && slotPatch.hint.trim().length > 0) {
      slot.hint = slotPatch.hint;
    }
    if (typeof slotPatch.styleHint === "string" && slotPatch.styleHint.trim().length > 0) {
      slot.styleHint = slotPatch.styleHint;
    }
    if (Array.isArray(slotPatch.negative) && slotPatch.negative.length > 0) {
      slot.negative = slotPatch.negative;
    }
  }
};

const worker = new Worker(
  getQueueName(),
  async (job) => {
    const themeId = typeof job.data?.themeId === "string" ? job.data.themeId : "";
    const presentationId = typeof job.data?.presentationId === "number" ? job.data.presentationId : 0;
    const jobId = typeof job.id === "string" ? job.id : String(job.id);
    const jobLogger = logger.child({ jobId: job.id, themeId });

    jobLogger.info("job started");

    const jobTmpDir = path.resolve(".tmp", jobId);
    const jobLockPath = path.resolve(jobTmpDir, ".lock");
    await fs.mkdir(jobTmpDir, { recursive: true });
    await fs.writeFile(jobLockPath, JSON.stringify({ startedAt: new Date().toISOString(), jobId }));

    try {
      const { mark, timingsMs } = createStageTimer();

    await job.updateProgress(10);
    jobLogger.info({ stage: "load_theme_pack" }, "progress updated");
    const themeDir = getThemeDir(themeId);
    const templatePath = await assertThemeTemplateExists(themeId);
    mark("load_theme_pack");

    const templateStats = await fs.stat(templatePath);
    if (templateStats.size > MAX_TEMPLATE_ZIP_BYTES) {
      throw new Error(`TemplateTooLarge: ${templateStats.size} > ${MAX_TEMPLATE_ZIP_BYTES}`);
    }

    await job.updateProgress(30);
    jobLogger.info({ stage: "read_template_zip" }, "progress updated");
    const doc = await readDocJsonFromTemplateZip(templatePath);
    mark("read_template_zip");

    await job.updateProgress(60);
    jobLogger.info({ stage: "parse_doc" }, "progress updated");

    const fillKeys = extractFillKeys(doc);
    const imageSlots = extractImageSlots(doc);
    const slideCount = inferSlideCount(doc);
    mark("parse_doc");

    if (slideCount > MAX_SLIDES) {
      throw new Error(`TooManySlides: ${slideCount} > ${MAX_SLIDES}`);
    }

    const ragEnabledForJob = RAG_ENABLED;
    const ragStartedAt = Date.now();
    let ragContextText: string | undefined;
    let ragCitations: ReturnType<typeof formatRetrieveContext>["citations"] | undefined;
    let ragAnswer: string | undefined;
    let ragSources: ReturnType<typeof formatQuerySourcesAsCitations> | undefined;
    let ragJsonString: string | null = null;
    let ragTmpPath: string | null = null;
    let ragIncluded = false;
    let ragHitCount = 0;
    const ragMode = job.data?.rag?.mode === "query" ? "query" : (job.data?.rag?.mode === "retrieve" ? "retrieve" : RAG_MODE_DEFAULT);
    const ragCollection = typeof job.data?.rag?.collection === "string" && job.data.rag.collection.length > 0
      ? job.data.rag.collection
      : RAG_COLLECTION;
    const ragTopK = typeof job.data?.rag?.topK === "number" ? job.data.rag.topK : RAG_TOP_K;
    const ragMinScore = typeof job.data?.rag?.minScore === "number" ? job.data.rag.minScore : RAG_MIN_SCORE;
    const ragSourceUris = Array.isArray(job.data?.rag?.sourceUris) && job.data.rag.sourceUris.length > 0
      ? job.data.rag.sourceUris
      : (RAG_DEFAULT_SOURCE_URIS.length > 0 ? RAG_DEFAULT_SOURCE_URIS : undefined);
    let ragError: string | undefined;

    if (ragEnabledForJob) {
      try {
        await job.updateProgress(70);
        jobLogger.info({ stage: "rag_retrieve", mode: ragMode }, "progress updated");

        const ragClient = new HttpRagClient();
        const ragQuery = `тема урока: ${typeof job.data?.topic === "string" ? job.data.topic : ""}`;

        if (ragMode === "query") {
          const response = await ragClient.query({
            query: ragQuery,
            topK: ragTopK,
            minScore: ragMinScore,
            collection: ragCollection,
            sourceUris: ragSourceUris,
          });

          ragAnswer = response.answer;
          ragSources = formatQuerySourcesAsCitations(response.sources.slice(0, RAG_MAX_HITS));
          ragHitCount = response.sources.length;

          const artifacts = await writeRagArtifacts({
            jobId,
            mode: "query",
            query: ragQuery,
            collection: ragCollection,
            sourceUris: ragSourceUris,
            topK: ragTopK,
            minScore: ragMinScore,
            sources: response.sources,
          }).catch((error) => {
            jobLogger.warn({ err: error }, "unable to persist rag artifact");
            return null;
          });

          ragJsonString = artifacts?.ragJsonString || null;
          ragTmpPath = artifacts?.ragTmpPath || null;
        } else {
          const response = await ragClient.retrieve({
            query: ragQuery,
            topK: ragTopK,
            minScore: ragMinScore,
            collection: ragCollection,
            sourceUris: ragSourceUris,
          });

          const formatted = formatRetrieveContext(response.hits, RAG_MAX_CONTEXT_CHARS, RAG_MAX_HITS);
          ragContextText = formatted.contextText;
          ragCitations = formatted.citations;
          ragHitCount = response.hits.length;

          const artifacts = await writeRagArtifacts({
            jobId,
            mode: "retrieve",
            query: ragQuery,
            collection: ragCollection,
            sourceUris: ragSourceUris,
            topK: ragTopK,
            minScore: ragMinScore,
            hits: response.hits,
          }).catch((error) => {
            jobLogger.warn({ err: error }, "unable to persist rag artifact");
            return null;
          });

          ragJsonString = artifacts?.ragJsonString || null;
          ragTmpPath = artifacts?.ragTmpPath || null;
        }
      } catch (error) {
        ragError = error instanceof Error ? error.message : String(error);
        if (RAG_FAIL_ON_ERROR) {
          throw new Error(`RagFailed: ${ragError}`);
        }
        jobLogger.warn({ err: error }, "rag retrieval failed, continuing without context");
      } finally {
        mark("rag_retrieve");
      }
    }

    const map = await readThemeMap(themeId);
    const baseGeneratedFills = buildTestFills(fillKeys);
    let llmFills: Record<string, string> = {};
    let llmError: string | undefined;
    let llmMeta: { model?: string; tokens?: number; latencyMs?: number; attempts?: number } | undefined;
    let llmImagePlanPatch: {
      slots: Array<{ slotId: string; query?: string; hint?: string; styleHint?: string; negative?: string[] }>;
    } | undefined;

    if (LLM_ENABLED) {
      await job.updateProgress(72);
      jobLogger.info({ stage: "llm_generate" }, "progress updated");

      try {
        const llmClient = new DeepSeekClient();
        const llmImagePlanInput = buildImagePlanFromMap({
          map,
          doc,
          presentationId,
          themeId,
          topic: typeof job.data?.topic === "string" ? job.data.topic : "",
          language: typeof job.data?.language === "string" ? job.data.language : null,
        });

        const llmResponse = await llmClient.generate({
          presentationId,
          themeId,
          topic: typeof job.data?.topic === "string" ? job.data.topic : "",
          language: typeof job.data?.language === "string" ? job.data.language : null,
          fillKeys,
          imagePlan: llmImagePlanInput,
          rag: ragMode === "retrieve"
            ? {
                mode: "retrieve",
                contextText: ragContextText,
                citations: ragCitations,
              }
            : {
                mode: "query",
                answer: ragAnswer,
                sources: ragSources,
              },
        });

        llmFills = llmResponse.fills;
        llmMeta = {
          model: llmResponse.meta?.model,
          tokens: llmResponse.meta?.tokens,
          latencyMs: llmResponse.meta?.latencyMs,
          attempts: llmResponse.meta?.attempts,
        };
        llmImagePlanPatch = llmResponse.imagePlanPatch;
      } catch (error) {
        llmError = error instanceof Error ? error.message : String(error);
        if (LLM_FAIL_ON_ERROR) {
          throw new Error(`LLMFailed: ${llmError}`);
        }
        jobLogger.warn({ err: error }, "llm generation failed, fallback to test fills");
      } finally {
        mark("llm_generate");
      }
    }

    const generatedFills = { ...baseGeneratedFills, ...llmFills };
    const debugFillsRaw = job.data?.debug?.fills;
    const debugFills = (debugFillsRaw && typeof debugFillsRaw === "object" ? debugFillsRaw : {}) as Record<string, string>;
    const fills = { ...generatedFills, ...debugFills };
    const debugFillsApplied = Object.keys(debugFills).length > 0;

    await job.updateProgress(75);
    jobLogger.info({ stage: "apply_variants_fills" }, "progress updated");

    const variantsStats = applyVariants(doc, map, { presentationId }, fills, {
      onDropAtOutOfRange: ({ slideIndex, badIndex }) => {
        jobLogger.warn({ slideIndex, badIndex }, "dropAt index out of range");
      },
    });
    const fillsStats = applyFills(doc, fills);
    mark("apply_variants_fills");


    const imagePlanTmpPath = path.resolve(".tmp", jobId, "imagePlan.json");
    let imagePlanDocument: ReturnType<typeof buildImagePlanFromMap> | null = null;
    let imagePlanJsonString: string | null = null;
    let imagePlanIncluded = false;

    try {
      imagePlanDocument = buildImagePlanFromMap({
        map,
        doc,
        presentationId,
        themeId,
        topic: typeof job.data?.topic === "string" ? job.data.topic : "",
        language: typeof job.data?.language === "string" ? job.data.language : null,
      });

      if (llmImagePlanPatch && llmImagePlanPatch.slots.length > 0) {
        applyImagePlanPatch({ imagePlanDocument, patch: llmImagePlanPatch });
      }

      imagePlanJsonString = JSON.stringify(imagePlanDocument, null, 2);
      imagePlanIncluded = true;

      await fs.writeFile(imagePlanTmpPath, imagePlanJsonString).catch((error) => {
        jobLogger.warn({ err: error, imagePlanTmpPath }, "unable to persist imagePlan tmp file");
      });
    } catch (error) {
      imagePlanIncluded = false;
      imagePlanDocument = null;
      imagePlanJsonString = null;
      jobLogger.warn({ err: error }, "unable to build imagePlan json");
    }

    await job.updateProgress(80);
    jobLogger.info({ stage: "prepare_images" }, "progress updated");

    const imagePlan = await planImageReplacements({ doc, map, themeDir });
    mark("prepare_images");
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
    mark("generate_backgrounds");

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
      extraEntries: {
        ...(imagePlanJsonString
          ? {
              "imagePlan.json": Buffer.from(imagePlanJsonString, "utf8"),
            }
          : {}),
        ...(ragJsonString && RAG_INCLUDE_IN_OUTZIP
          ? {
              "rag.json": Buffer.from(ragJsonString, "utf8"),
            }
          : {}),
      },
    });
    mark("assemble_zip");
    ragIncluded = Boolean(ragJsonString && RAG_INCLUDE_IN_OUTZIP);

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
    const imageReplacedCount = assembled.replacedEntryPaths.filter((entryPath) => !entryPath.startsWith("backgrounds/")).length;

    const outZipPath = assembled.outZipPath;
    const outZipStats = await fs.stat(outZipPath);
    const outZipBytes = outZipStats.size;
    if (outZipBytes > MAX_OUTZIP_BYTES_LOCAL) {
      throw new Error(`OutZipTooLarge: ${outZipBytes} > ${MAX_OUTZIP_BYTES_LOCAL}`);
    }

    const backgroundsBytesTotal = await Object.values(backgrounds.replacements).reduce(async (accPromise, filePath) => {
      const acc = await accPromise;
      try {
        const stats = await fs.stat(filePath);
        return acc + stats.size;
      } catch {
        return acc;
      }
    }, Promise.resolve(0));

    let upload = {
      attempted: false,
      mode: WP_SAVE_MODE,
      ok: false,
      status: null as number | null,
      outZipUrl: null as string | null,
      responseJson: null as unknown | null,
      responseTextSnippet: null as string | null,
      uploadSkipped: true,
    };

    if (WP_SAVE_MODE === "from_url") {
      await job.updateProgress(92);
      jobLogger.info({ stage: "publish_outzip" }, "progress updated");

      if (outZipBytes > MAX_STAGED_BYTES) {
        throw new Error(`StagedTooLarge: ${outZipBytes} > ${MAX_STAGED_BYTES}`);
      }

      const staged = await createStagedFile({
        jobId,
        localZipPath: outZipPath,
        stagedDirAbs: STAGED_DIR_ABS,
        ttlSeconds: STAGED_TTL_SECONDS,
        redis: getQueueRedisConnection(),
      });

      mark("publish_outzip");

      const outZipUrl = buildStagedUrl({
        baseUrl: PUBLIC_ZIP_BASE_URL,
        name: staged.name,
        token: staged.token,
      });

      await job.updateProgress(95);
      jobLogger.info({ stage: "wp_save_from_url" }, "progress updated");

      await waitForHttp(job.data.save.endpoint, {
        timeoutMs: WP_SAVE_WAIT_TIMEOUT_MS,
        intervalMs: 250,
      });

      let saveResult: Awaited<ReturnType<typeof saveOutzipFromUrl>> | null = null;
      let lastNetworkError: unknown = null;
      const maxRetries = Math.max(1, WP_SAVE_RETRIES);

      for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
        try {
          const current = await saveOutzipFromUrl({
            endpoint: job.data.save.endpoint,
            presentationId: job.data.save.presentationId,
            saveToken: job.data.save.saveToken,
            outZipUrl,
            timeoutMs: WP_SAVE_FROM_URL_TIMEOUT_MS,
          });

          saveResult = current;
          break;
        } catch (error) {
          lastNetworkError = error;
          if (!isRetryableNetworkError(error) || attempt >= maxRetries) {
            throw error;
          }

          const delayMs = calcRetryDelayMs(attempt);
          jobLogger.warn({ attempt, maxRetries, delayMs, err: error }, "wp save network error, retrying");
          await sleep(delayMs);
        }
      }

      if (!saveResult) {
        throw new Error(`WPSaveFromUrlNetworkFailed: ${String(lastNetworkError)}`);
      }

      mark("wp_save_from_url");

      upload = {
        attempted: true,
        mode: "from_url",
        ok: saveResult.ok,
        status: saveResult.status,
        outZipUrl,
        responseJson: saveResult.responseJson,
        responseTextSnippet: saveResult.responseText.slice(0, UPLOAD_TEXT_LIMIT),
        uploadSkipped: false,
      };

      if (saveResult.ok) {
        if (STAGED_CLEANUP_ON_SUCCESS) {
          if (STAGED_CLEANUP_DELAY_SECONDS > 0) {
            const delayMs = STAGED_CLEANUP_DELAY_SECONDS * 1000;
            setTimeout(() => {
              void cleanupStagedFile({
                stagedName: staged.name,
                stagedAbsPath: staged.absPath,
                jobLogger,
              });
            }, delayMs);
          } else {
            await cleanupStagedFile({
              stagedName: staged.name,
              stagedAbsPath: staged.absPath,
              jobLogger,
            });
          }
        }
      } else {
        const shortReason = saveResult.responseText.slice(0, 120).replace(/\s+/g, " ");
        const failMessage = `WPSaveFromUrlFailed: ${saveResult.status} ${shortReason}`;

        if (WP_FAIL_ON_UPLOAD_ERROR) {
          throw new Error(failMessage);
        }

        jobLogger.error({ status: saveResult.status, endpoint: job.data.save.endpoint }, failMessage);
      }
    } else if (WP_SAVE_MODE === "upload") {
      await job.updateProgress(95);
      jobLogger.info({ stage: "upload_to_wp" }, "progress updated");

      if (WP_UPLOAD_ENABLED) {
        const uploadResult = await uploadOutzip({
          endpoint: job.data.save.endpoint,
          presentationId: job.data.save.presentationId,
          saveToken: job.data.save.saveToken,
          zipPath: outZipPath,
          timeoutMs: WP_UPLOAD_TIMEOUT_MS,
        });

        mark("upload_to_wp");

        upload = {
          attempted: true,
          mode: "upload",
          ok: uploadResult.ok,
          status: uploadResult.status,
          outZipUrl: null,
          responseJson: uploadResult.responseJson,
          responseTextSnippet: uploadResult.responseText.slice(0, UPLOAD_TEXT_LIMIT),
          uploadSkipped: false,
        };

        if (!uploadResult.ok) {
          const shortReason = uploadResult.responseText.slice(0, 120).replace(/\s+/g, " ");
          const failMessage = `WPUploadFailed: ${uploadResult.status} ${shortReason}`;

          if (WP_FAIL_ON_UPLOAD_ERROR) {
            throw new Error(failMessage);
          }

          jobLogger.error({ status: uploadResult.status, endpoint: job.data.save.endpoint }, failMessage);
        }
      } else {
        upload = {
          attempted: false,
          mode: "upload",
          ok: false,
          status: null,
          outZipUrl: null,
          responseJson: null,
          responseTextSnippet: null,
          uploadSkipped: true,
        };
      }
    }

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
        chosenVariants: variantsStats.chosenVariants,
        debugFillsApplied,
        imagePlannedCount: imagePlan.plannedCount,
        imagePlanVersion: 1,
        imagePlanIncluded,
        imagePlanSlotsCount: imagePlanDocument ? imagePlanDocument.slots.length : 0,
        imagePlanPathTmp: path.relative(process.cwd(), imagePlanTmpPath),
        imageReplacedCount,
        imageMissing: imageMissingCapped,
        backgroundsPlannedCount: slideCount,
        backgroundsReplacedCount,
        backgroundsMissing: backgroundsMissingCapped,
        ragIncluded,
      },
      rag: {
        enabled: ragEnabledForJob,
        ok: ragEnabledForJob ? !ragError : false,
        mode: ragMode,
        topK: ragTopK,
        minScore: ragMinScore,
        hitCount: ragHitCount,
        citationCount: ragCitations?.length || ragSources?.length || 0,
        contextChars: ragContextText?.length || ragAnswer?.length || 0,
        usedSourceUrisCount: ragSourceUris?.length || 0,
        error: ragError,
        timingsMs: ragEnabledForJob ? Date.now() - ragStartedAt : undefined,
        pathTmp: ragTmpPath ? path.relative(process.cwd(), ragTmpPath) : null,
      },
      llm: {
        enabled: LLM_ENABLED,
        ok: LLM_ENABLED ? !llmError : false,
        model: llmMeta?.model,
        tokens: llmMeta?.tokens,
        latencyMs: llmMeta?.latencyMs,
        attempts: llmMeta?.attempts,
        imagePlanPatchedSlots: llmImagePlanPatch?.slots.length || 0,
        error: llmError,
      },
      upload,
      stats: {
        timingsMs,
        outZipBytes,
        backgroundsBytesTotal,
        backgroundsCount: Object.keys(backgrounds.replacements).length,
        stagedCleanupMode: STAGED_CLEANUP_ON_SUCCESS
          ? STAGED_CLEANUP_DELAY_SECONDS > 0
            ? "delay"
            : "immediate"
          : "disabled",
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
        chosenVariants: variantsStats.chosenVariants,
        debugFillsApplied,
        imagePlannedCount: imagePlan.plannedCount,
        imagePlanVersion: 1,
        imagePlanIncluded,
        imagePlanSlotsCount: imagePlanDocument ? imagePlanDocument.slots.length : 0,
        imagePlanPathTmp: path.relative(process.cwd(), imagePlanTmpPath),
        imageReplacedCount,
        imageMissingCount: imageMissing.length,
        backgroundsPlannedCount: slideCount,
        backgroundsReplacedCount,
        backgroundsMissingCount: backgroundsMissing.length,
        ragEnabledForJob,
        ragMode,
        ragHitCount,
        ragIncluded,
        ragError,
        llmEnabled: LLM_ENABLED,
        llmModel: llmMeta?.model,
        llmError,
        uploadAttempted: upload.attempted,
        uploadMode: upload.mode,
        uploadOk: upload.ok,
        uploadStatus: upload.status,
        outZipPath,
      },
      "job completed"
    );

    return result;
    } finally {
      await fs.unlink(jobLockPath).catch(() => undefined);
    }
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
