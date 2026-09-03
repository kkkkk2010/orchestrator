import "dotenv/config";
import path from "node:path";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { Worker } from "bullmq";
import { closeQueueResources, getQueueName, getQueueRedisConnection, getWorkerBullConnection, getWorkerHeartbeatKey } from "./queue";
import { logger } from "./logger";
import { recordOperationalEvent } from "./observability";
import { assertThemeTemplateExists, getThemeDir, readThemeMap, readThemeSafe } from "./themes/themeStore";
import { readDocJsonFromTemplateZip } from "./themes/templateZip";
import { extractImageSlots, extractPlaceholderLocations, inferSlideCount, normalizePlaceholders } from "./themes/parseDoc";
import { applyVariants } from "./templates/applyVariants";
import { applyFillsByLocations, extractRemainingKeys, scanRemainingFillTokens, setAtPath } from "./templates/applyFills";
import { assembleZip } from "./templates/assembleZip";
import { planImageReplacements } from "./images/planImageReplacements";
import { buildImagePlanFromMap, buildImagePlanWithDiagnostics, buildImagePromptFallback, isImagePromptLanguageCompatible } from "./images/imagePlan";
import { applySlideTypeHeuristics, buildSlideSummaries, enforceImagePromptUniqueness, isGenericImageQuery } from "./images/imagePrompts";
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
import { buildRagConfigLog, buildRagErrorLog, buildRagHitsSampleLog, buildRagRequestLog, buildRagResponseLog } from "./rag/logging";
import { DeepSeekClient } from "./llm/deepseek/DeepSeekClient";
import { buildSystemPrompt, buildUserPrompt } from "./llm/prompt";
import { mergeFills } from "./llm/mergeFills";
import { aggregateFillCounts, buildBatches } from "./llm/batching";
import { calcLlmRetryDelayMs, isRetryableLlmError } from "./llm/retry";
import { applyTypographyStandards, autoFitText, dedupeBulletLines, generateLocalFallback, generateLocalFallbackBullets, isBulletLikeFillKey, normalizeBulletLineFormatting, normalizeDocumentBulletMarkers, normalizeText, resolveThemeTypography, styleRoleByKey } from "./templates/textPostprocess";
import { applyLayoutThemeStyles } from "./templates/layoutTheme";
import { compileLayoutPresentation } from "./layouts";
import { adaptLayoutToContent } from "./layouts/contentAware";
import { inferContentDensityFromFills } from "./layouts/dynamicPlan";
import type { LayoutEngineDiagnostics } from "./layouts/types";
import { runContentQa } from "./content/contentQa";
import { buildContentRepairPlan } from "./content/contentRepair";
import { buildItemizedRepairKeys, composeExactBulletBlock, splitContentItems } from "./content/exactCountRepair";
import { buildDeterministicDeckPlan } from "./deckPlan";
import type { DeckPlanSlide } from "./deckPlan/schema";
import { acquireUserSlot, releaseUserSlot } from "./concurrency/userSlots";

const concurrency = parseInt(process.env.WORKER_CONCURRENCY || "2", 10);
const USER_CONCURRENCY_MAX = Math.max(1, parseInt(process.env.USER_CONCURRENCY_MAX || "1", 10));
const USER_SLOT_TTL_SECONDS = Math.max(300, parseInt(process.env.USER_SLOT_TTL_SECONDS || "7200", 10));

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
const LLM_TIMEOUT_MS = Number.parseInt(process.env.LLM_TIMEOUT_MS || "300000", 10);
const LLM_TOTAL_TIMEOUT_MS = Number.parseInt(process.env.LLM_TOTAL_TIMEOUT_MS || "600000", 10);
const LLM_MAX_KEYS_PER_REQUEST = Number.parseInt(process.env.LLM_MAX_KEYS_PER_REQUEST || "12", 10);
const LLM_BATCH_MODE = process.env.LLM_BATCH_MODE === "chunk" ? "chunk" : "bySlide";
const LLM_RETRIES = Number.parseInt(process.env.LLM_RETRIES || "2", 10);
const LLM_RETRY_BASE_DELAY_MS = Number.parseInt(process.env.LLM_RETRY_BASE_DELAY_MS || "400", 10);
const LLM_RETRY_MAX_DELAY_MS = Number.parseInt(process.env.LLM_RETRY_MAX_DELAY_MS || "5000", 10);
const LLM_RETRY_ON_ABORT = process.env.LLM_RETRY_ON_ABORT !== "false";
const FAIL_ON_REMAINING_TOKENS = process.env.FAIL_ON_REMAINING_TOKENS === "true";
const CONTENT_REPAIR_ENABLED = process.env.CONTENT_REPAIR_ENABLED !== "false";
const CONTENT_REPAIR_SCORE_THRESHOLD = Number.parseInt(process.env.CONTENT_REPAIR_SCORE_THRESHOLD || "95", 10);
const CONTENT_REPAIR_MAX_KEYS = Number.parseInt(process.env.CONTENT_REPAIR_MAX_KEYS || "8", 10);

const slideRole = (slideType: string): string => {
  switch (slideType) {
    case "cover": return "frame the topic and why it matters";
    case "goals": return "set goals and a realistic lesson path";
    case "hook": return "create curiosity with question, hint, fact, meaning";
    case "context": return "explain context and why it matters";
    case "definition": return "explain context, role, and key terms";
    case "bullets": return "teach facts with meaning and consequences";
    case "visual_explanation": return "explain a mechanism with concise visual support";
    case "comparison": return "compare two sides, periods, or ideas";
    case "twoCol": return "compare two sides, periods, or ideas";
    case "timeline": return "show sequence and significance of stages";
    case "steps": return "show sequence and significance of stages";
    case "examples": return "give examples and what they demonstrate";
    case "quiz": return "check understanding";
    case "summary": return "summarize takeaways and next action";
    default: return "fill the selected slide coherently";
  }
};

const slideDensity = (slideType: string): "low" | "medium" | "high" => {
  if (slideType === "cover" || slideType === "quiz") return "low";
  if (slideType === "bullets" || slideType === "examples" || slideType === "summary" || slideType === "visual_explanation") return "high";
  return "medium";
};
const DEDUP_ENABLED = process.env.DEDUP_ENABLED !== "false";

const MAX_SLIDES = parseInt(process.env.MAX_SLIDES || "30", 10);
const MAX_TEMPLATE_ZIP_BYTES = parseInt(process.env.MAX_TEMPLATE_ZIP_BYTES || "200000000", 10);
const MAX_OUTZIP_BYTES_LOCAL = parseInt(process.env.MAX_OUTZIP_BYTES_LOCAL || "250000000", 10);
const MAX_STAGED_BYTES = parseInt(process.env.MAX_STAGED_BYTES || String(MAX_OUTZIP_BYTES_LOCAL), 10);
const IMAGEPLAN_AUTO_DETECT = process.env.IMAGEPLAN_AUTO_DETECT !== "false";
const IMAGEPLAN_DETECT_FALLBACK_ALL_NON_DECOR = process.env.IMAGEPLAN_DETECT_FALLBACK_ALL_NON_DECOR !== "false";


const LAYOUT_ENGINE_ENABLED = process.env.LAYOUT_ENGINE_ENABLED === "true";
const LAYOUT_ENGINE_FAIL_ON_MISSING_LAYOUT = process.env.LAYOUT_ENGINE_FAIL_ON_MISSING_LAYOUT === "true";
const LAYOUT_ENGINE_VARIATION = process.env.LAYOUT_ENGINE_VARIATION !== "false";


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

const chunkKeys = <T>(items: T[], chunkSize: number): T[][] => {
  if (chunkSize <= 0) return [items];
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
};

const extractSlideFromKey = (key: string): number => {
  const match = key.match(/s(\d+)_/i);
  if (!match?.[1]) return 1;
  const num = Number.parseInt(match[1], 10);
  return Number.isFinite(num) && num > 0 ? num : 1;
};

const sourceFallbackForDeckPlan = (topic: string, deckPlan: { subject?: string; presentationType?: string }): string => {
  const context = `${topic} ${deckPlan.subject || ""} ${deckPlan.presentationType || ""}`.toLowerCase();
  if (/literature|литератур|пушкин|поэт|писател|роман|поэма/.test(context)) {
    return "Источники: школьный учебник литературы, тексты произведений, литературоведческие справочники.";
  }
  if (/history|истор|импер|войн|революц|государств/.test(context)) {
    return "Источники: школьный учебник истории, исторические карты, энциклопедические справочники.";
  }
  if (/science|physics|chemistry|biology|наук|физик|хими|биолог/.test(context)) {
    return "Источники: школьный учебник, научно-популярные справочники, материалы курса.";
  }
  return "Источники: школьный учебник, энциклопедические справочники, материалы курса.";
};

const worker = new Worker(
  getQueueName(),
  async (job) => {
    const themeId = typeof job.data?.themeId === "string" ? job.data.themeId : "";
    const presentationId = typeof job.data?.presentationId === "number" ? job.data.presentationId : 0;
    const userId = typeof job.data?.userId === "number" ? job.data.userId : 0;
    const requestId = typeof job.data?.requestId === "string" ? job.data.requestId : undefined;
    const jobId = typeof job.id === "string" ? job.id : String(job.id);
    const jobLogger = logger.child({ jobId: job.id, themeId });

    jobLogger.info("job started");

    const jobTmpDir = path.resolve(".tmp", jobId);
    const jobLockPath = path.resolve(jobTmpDir, ".lock");
    await fs.mkdir(jobTmpDir, { recursive: true });
    await fs.writeFile(jobLockPath, JSON.stringify({ startedAt: new Date().toISOString(), jobId }));
    let userSlotAcquired = false;
    try {
      userSlotAcquired = await acquireUserSlot(getQueueRedisConnection(), userId, jobId, {
        limit: USER_CONCURRENCY_MAX,
        ttlSeconds: USER_SLOT_TTL_SECONDS,
        onWait: () => jobLogger.info(
          { userId, userConcurrencyMax: USER_CONCURRENCY_MAX },
          "job waiting for per-user slot",
        ),
      });
      await recordOperationalEvent(getQueueRedisConnection(), {
        service: "orchestrator",
        event: "generation.started",
        level: "info",
        requestId,
        presentationId,
        queueAgeMs: Math.max(0, Date.now() - job.timestamp),
      }).catch((error) => jobLogger.warn({ err: error }, "start metric write failed"));
      const { mark, timingsMs } = createStageTimer();

    await job.updateProgress(10);
    jobLogger.info({ stage: "load_theme_pack" }, "progress updated");
    const themeDir = getThemeDir(themeId);
    let templatePath = await assertThemeTemplateExists(themeId);
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

    let preVariantDoc = JSON.parse(JSON.stringify(doc)) as unknown;

    normalizePlaceholders(doc);
    let initialPlaceholderScan = extractPlaceholderLocations(doc);
    let initialFillKeys = [...new Set(initialPlaceholderScan.locations.map((item) => item.key))];
    let imageSlots = extractImageSlots(doc);
    let slideCount = inferSlideCount(doc);
    const topic = typeof job.data?.topic === "string" ? job.data.topic : "";
    const language = typeof job.data?.language === "string" ? job.data.language : null;
    const providedDeckPlan = job.data?.deckPlan;
    const deckPlan = providedDeckPlan ?? buildDeterministicDeckPlan({
      topic,
      language: language || "ru",
      slideCount,
      presentationType: "auto",
    });
    const deckPlanDiagnostics = {
      present: Boolean(providedDeckPlan),
      source: deckPlan.source,
      mode: providedDeckPlan ? "provided" : "deterministic_fallback",
      slideCount: deckPlan.slideCount,
      presentationType: deckPlan.presentationType,
      dynamicPlanUsed: true,
      slideTypes: deckPlan.slides.map((slide: { slide: number; slideType: string; role: string }) => ({ slide: slide.slide, slideType: slide.slideType, role: slide.role })),
    };
    mark("parse_doc");

    if (Math.max(slideCount, deckPlan.slideCount) > MAX_SLIDES) {
      throw new Error(`TooManySlides: ${Math.max(slideCount, deckPlan.slideCount)} > ${MAX_SLIDES}`);
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
    let ragUsedContextChars = 0;
    let ragHttpStatus: number | undefined;
    let ragElapsedMs = 0;
    let ragSampleHits: Array<{ score?: number; source_uri?: string; fragment_id?: string }> = [];
    const ragMode = job.data?.rag?.mode === "query" ? "query" : (job.data?.rag?.mode === "retrieve" ? "retrieve" : RAG_MODE_DEFAULT);
    const ragCollection = typeof job.data?.rag?.collection === "string" && job.data.rag.collection.length > 0
      ? job.data.rag.collection
      : RAG_COLLECTION;
    const ragTopK = typeof job.data?.rag?.topK === "number" ? job.data.rag.topK : RAG_TOP_K;
    const ragMinScore = typeof job.data?.rag?.minScore === "number" ? job.data.rag.minScore : RAG_MIN_SCORE;
    let ragError: string | undefined;
    const ragMiniPrompt = "Сначала используй информацию из приложенных фрагментов. Если фрагментов нет или их не хватает — ответь на основе своих знаний без выдуманных ссылок [n].";
    const ragTimeoutMs = Number.parseInt(process.env.RAG_TIMEOUT_MS || "15000", 10);
    if (!ragEnabledForJob) {
      jobLogger.info(`[JOB ${jobId}] rag: disabled`);
    } else {
      jobLogger.info(`[JOB ${jobId}] ${buildRagConfigLog({ enabled: ragEnabledForJob, mode: ragMode, collection: ragCollection, topK: ragTopK, minScore: ragMinScore, timeoutMs: ragTimeoutMs })}`);
    }

    if (ragEnabledForJob) {
      try {
        await job.updateProgress(70);
        jobLogger.info({ stage: "rag_retrieve", mode: ragMode }, "progress updated");

        const ragClient = new HttpRagClient();
        const ragQuery = `тема урока: ${typeof job.data?.topic === "string" ? job.data.topic : ""}`;
        jobLogger.info(`[JOB ${jobId}] ${buildRagRequestLog({ endpoint: ragMode === "retrieve" ? "/retrieve" : "/query", querySnippet: ragQuery.slice(0, 120), topK: ragTopK, minScore: ragMinScore, collection: ragCollection })}`);
        const ragRequestStartedAt = Date.now();

        if (ragMode === "query") {
          const response = await ragClient.query({
            query: ragQuery,
            topK: ragTopK,
            minScore: ragMinScore,
            collection: ragCollection,
            sourceUris: RAG_DEFAULT_SOURCE_URIS.length > 0 ? RAG_DEFAULT_SOURCE_URIS : undefined,
          });

          ragAnswer = response.answer;
          ragSources = formatQuerySourcesAsCitations(response.sources.slice(0, RAG_MAX_HITS));
          ragHitCount = response.sources.length;
          ragUsedContextChars = ragAnswer?.length || 0;
          ragElapsedMs = Date.now() - ragRequestStartedAt;
          ragHttpStatus = response.httpStatus;
          ragSampleHits = response.sources.slice(0, 3).map((source) => ({ score: source.score, source_uri: source.source_uri, fragment_id: source.fragment_id }));
          jobLogger.info(`[JOB ${jobId}] ${buildRagResponseLog({ ok: true, httpStatus: ragHttpStatus, hitCount: ragHitCount, usedContextChars: ragUsedContextChars, elapsedMs: ragElapsedMs })}`);
          jobLogger.info(`[JOB ${jobId}] ${buildRagHitsSampleLog(ragSampleHits)}`);

          const artifacts = await writeRagArtifacts({
            jobId,
            mode: "query",
            query: ragQuery,
            collection: ragCollection,
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
          });

          const formatted = formatRetrieveContext(response.hits, RAG_MAX_CONTEXT_CHARS, RAG_MAX_HITS);
          ragContextText = formatted.contextText || response.contextText;
          ragCitations = formatted.citations;
          ragHitCount = response.hits.length;
          ragUsedContextChars = ragContextText?.length || 0;
          ragElapsedMs = Date.now() - ragRequestStartedAt;
          ragHttpStatus = response.httpStatus;
          ragSampleHits = response.hits.slice(0, 3).map((hit) => ({ score: hit.score, source_uri: hit.source_uri, fragment_id: hit.fragment_id }));
          if (Array.isArray(response.warnings) && response.warnings.length > 0) {
            for (const warning of response.warnings.slice(0, 5)) {
              jobLogger.warn(`[JOB ${jobId}] rag.normalize.warn: ${warning}`);
            }
          }
          jobLogger.info(`[JOB ${jobId}] ${buildRagResponseLog({ ok: true, httpStatus: ragHttpStatus, hitCount: ragHitCount, usedContextChars: ragUsedContextChars, elapsedMs: ragElapsedMs })}`);
          jobLogger.info(`[JOB ${jobId}] ${buildRagHitsSampleLog(ragSampleHits)}`);
          if (ragHitCount === 0) {
            jobLogger.warn(`[JOB ${jobId}] rag: hitCount=0 (continue fail-open)`);
          }

          const artifacts = await writeRagArtifacts({
            jobId,
            mode: "retrieve",
            query: ragQuery,
            collection: ragCollection,
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
        ragElapsedMs = Date.now() - ragStartedAt;
        jobLogger.warn({ err: error }, `[JOB ${jobId}] ${buildRagResponseLog({ ok: false, hitCount: 0, usedContextChars: 0, elapsedMs: ragElapsedMs })}`);
        jobLogger.warn({ err: error }, `[JOB ${jobId}] ${buildRagErrorLog(ragError || "unknown")}`);
        jobLogger.warn({ err: error }, "rag retrieval failed, continuing without context");
      } finally {
        mark("rag_retrieve");
      }
    }

    const map = await readThemeMap(themeId);
    let layoutEngineDiagnostics: LayoutEngineDiagnostics = {
      enabled: LAYOUT_ENGINE_ENABLED,
      mode: "legacy_fallback" as "catalog" | "builtins" | "legacy_fallback",
      dynamicPlanUsed: true,
      deckPlanSlideCount: deckPlan.slideCount,
      compiledSlideTypes: [],
      fallbackSlideTypeMappings: [],
      fallbackSlotInferences: [],
      repeatGroupAdaptations: [],
      unsupportedSlideTypes: [] as string[],
      dynamicBindings: [] as Array<{ slide: number; slotName: string; fillKey: string }>,
      missingSlotBindings: [] as string[],
      duplicateFillKeys: [] as string[],
      legacyEmergencyFallbackUsed: !LAYOUT_ENGINE_ENABLED,
      selectedLayouts: [],
      missingLayoutTypes: [] as string[],
      slotBindingWarnings: [] as string[],
      mergedAssetsCount: 0,
    };
    let layoutIds: string[] = [];
    if (LAYOUT_ENGINE_ENABLED) {
      try {
        const compiled = await compileLayoutPresentation({
          presentationId,
          themeId,
          jobId,
          variation: LAYOUT_ENGINE_VARIATION,
          legacyTemplateZipPath: templatePath,
          deckPlan,
          topic,
          language: language || "ru",
        });
        (doc as Record<string, unknown>).slides = ((compiled.doc as Record<string, unknown>).slides || []) as unknown[];
        templatePath = compiled.templateZipPath;
        layoutEngineDiagnostics = compiled.diagnostics;
        layoutIds = compiled.layoutIds;
        normalizePlaceholders(doc);
        initialPlaceholderScan = extractPlaceholderLocations(doc);
        initialFillKeys = [...new Set(initialPlaceholderScan.locations.map((item) => item.key))];
        imageSlots = extractImageSlots(doc);
        slideCount = inferSlideCount(doc);
        preVariantDoc = JSON.parse(JSON.stringify(doc)) as unknown;

        const mapSlides = ((map as Record<string, unknown>).slides && typeof (map as Record<string, unknown>).slides === "object"
          ? (map as Record<string, unknown>).slides
          : {}) as Record<string, unknown>;
        for (const [slide, imageAt] of Object.entries(compiled.imageAtBySlide)) {
          const slideRow = (mapSlides[slide] && typeof mapSlides[slide] === "object" ? mapSlides[slide] : {}) as Record<string, unknown>;
          slideRow.imageAt = imageAt;
          mapSlides[slide] = slideRow;
        }
        (map as Record<string, unknown>).slides = mapSlides;
      } catch (error) {
        if (LAYOUT_ENGINE_FAIL_ON_MISSING_LAYOUT) {
          throw error instanceof Error ? error : new Error(String(error));
        }
        jobLogger.warn({ err: error }, "layout engine failed, fallback to legacy template pipeline");
        layoutEngineDiagnostics.mode = "legacy_fallback";
        layoutEngineDiagnostics.legacyEmergencyFallbackUsed = true;
      }
    }
    const debugFillsRaw = job.data?.debug?.fills;
    const debugFills = (debugFillsRaw && typeof debugFillsRaw === "object" ? debugFillsRaw : {}) as Record<string, string>;
    const debugFillsApplied = Object.keys(debugFills).length > 0;

    const variantSeedFills = { ...mergeFills(initialFillKeys, {}, "TEST_"), ...debugFills };
    let variantsStats = applyVariants(doc, map, { presentationId }, variantSeedFills, {
      onDropAtOutOfRange: ({ slideIndex, badIndex }) => {
        jobLogger.warn({ slideIndex, badIndex }, "dropAt index out of range");
      },
    });

    const normalizedAfterVariants = normalizePlaceholders(doc);
    let placeholderScan = extractPlaceholderLocations(doc);
    const fillKeys = [...new Set(placeholderScan.locations.map((item) => item.key))];
    const selectedLayoutBySlide = new Map(layoutEngineDiagnostics.selectedLayouts.map((row) => [row.slide, row]));
    const deckPlanRoute = deckPlan.slides.map((slide: {
      slide: number;
      slideType: string;
      role: string;
      claim: string;
      titleIntent: string;
      requiredItems: unknown[];
    }) => {
      const selectedLayout = selectedLayoutBySlide.get(slide.slide);
      return {
        slide: slide.slide,
        slideType: slide.slideType,
        role: slide.role,
        claim: slide.claim,
        titleIntent: slide.titleIntent,
        selectedLayoutId: selectedLayout?.layoutId || null,
        resolvedLayoutSlideType: selectedLayout?.resolvedSlideType || null,
        fillKeys: fillKeys.filter((key) => key.startsWith(`s${slide.slide}_`)),
        requiredItems: slide.requiredItems,
      };
    });
    const placeholdersBySlide = placeholderScan.locations.reduce<Record<string, { count: number; keys: string[] }>>((acc, location) => {
      const slideKey = String(location.slide);
      if (!acc[slideKey]) {
        acc[slideKey] = { count: 0, keys: [] };
      }
      acc[slideKey].count += 1;
      if (!acc[slideKey].keys.includes(location.key)) {
        acc[slideKey].keys.push(location.key);
      }
      return acc;
    }, {});

    let llmFills: Record<string, string> = {};
    let llmError: string | undefined;
    let llmMeta: {
      model?: string;
      tokens?: number;
      latencyMs?: number;
      attempts?: number;
      parseOk?: boolean;
      parseError?: string;
      rawResponseText?: string;
    } | undefined;
    let llmImagePlanPatch: {
      slots: Array<{ slotId: string; query?: string; hint?: string; styleHint?: string; negative?: string[] }>;
    } = { slots: [] };
    const llmStartedAt = Date.now();
    const llmDirPath = path.resolve(jobTmpDir, "llm");
    await fs.mkdir(llmDirPath, { recursive: true }).catch(() => undefined);

    const llmDiagnostics = {
      enabled: LLM_ENABLED,
      attempted: false,
      ok: false,
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
      timeoutMs: LLM_TIMEOUT_MS,
      totalTimeoutMs: LLM_TOTAL_TIMEOUT_MS,
      batchMode: LLM_BATCH_MODE,
      maxKeysPerRequest: LLM_MAX_KEYS_PER_REQUEST,
      batchCount: 0,
      batches: [] as Array<{
        index: number;
        slide?: number;
        keysCount: number;
        keysSample: string[];
        attempted: boolean;
        ok: boolean;
        parseOk: boolean;
        receivedKeysCount: number;
        missingKeysCount: number;
        timingMs: number;
        httpStatus?: number;
        error?: string;
        retryCount: number;
      }>,
      fillKeysCount: fillKeys.length,
      fillKeysSample: fillKeys.slice(0, 10),
      receivedKeysCount: 0,
      missingKeysCount: fillKeys.length,
      parseOk: false,
      parseError: undefined as string | undefined,
      httpStatus: undefined as number | undefined,
      error: undefined as string | undefined,
      timingMs: undefined as number | undefined,
      usedFallbackForAll: false,
      hint: undefined as string | undefined,
    };

    if (LLM_ENABLED && fillKeys.length > 0) {
      await job.updateProgress(73);
      jobLogger.info({ stage: "llm_generate" }, "progress updated");
      llmDiagnostics.attempted = true;

      try {
        const apiKey = process.env.DEEPSEEK_API_KEY;
        if (!apiKey) {
          throw new Error("LLMConfigError: DEEPSEEK_API_KEY is empty");
        }

        const llmClient = new DeepSeekClient();
        const batches = buildBatches({
          fillKeys,
          placeholdersBySlide,
          maxKeysPerRequest: LLM_MAX_KEYS_PER_REQUEST,
          mode: LLM_BATCH_MODE,
        });

        llmDiagnostics.batchCount = batches.length;

        for (const batch of batches) {
          const batchStartedAt = Date.now();
          const elapsedTotal = batchStartedAt - llmStartedAt;
          if (elapsedTotal > LLM_TOTAL_TIMEOUT_MS) {
            const timeoutError = `LlmTotalTimeout: ${elapsedTotal} > ${LLM_TOTAL_TIMEOUT_MS}`;
            if (LLM_FAIL_ON_ERROR) {
              throw new Error(timeoutError);
            }
            llmDiagnostics.error = timeoutError;
            llmDiagnostics.hint = "total llm deadline reached; remaining keys will fallback";
            break;
          }

          const batchFilePrefix = path.resolve(llmDirPath, `batch-${String(batch.index).padStart(2, "0")}`);

          const batchImagePlanInput = {
            ...buildImagePlanFromMap({
              map,
              doc,
              presentationId,
              themeId,
              topic,
              language,
            }),
          };

          const batchPromptInput = {
            presentationId,
            themeId,
            topic,
            language,
            fillKeys: batch.keys,
            imagePlan: batchImagePlanInput,
            strictKeysRequired: true,
            deckPlan,
            layoutContext: layoutEngineDiagnostics.selectedLayouts
              .filter((row) => !batch.slide || row.slide === batch.slide)
              .map((row) => ({
                slide: row.slide,
                slideType: row.slideType,
                layoutId: row.layoutId,
                role: slideRole(row.slideType),
                textDensity: slideDensity(row.slideType),
              })),
            rag: ragMode === "retrieve"
              ? {
                  mode: "retrieve" as const,
                  contextText: ragContextText,
                  citations: ragCitations,
                  miniPrompt: ragMiniPrompt,
                }
              : {
                  mode: "query" as const,
                  answer: ragAnswer,
                  sources: ragSources,
                  miniPrompt: ragMiniPrompt,
                },
          };

          const systemPrompt = buildSystemPrompt();
          const userPrompt = buildUserPrompt(batchPromptInput);

          await fs.writeFile(
            `${batchFilePrefix}.request.json`,
            JSON.stringify(
              {
                model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
                timeoutMs: LLM_TIMEOUT_MS,
                keys: batch.keys,
                systemPromptHash: createHash("sha256").update(systemPrompt).digest("hex").slice(0, 16),
                userPromptSnippet: userPrompt.slice(0, 2000),
              },
              null,
              2
            )
          ).catch(() => undefined);

          let retryCount = 0;
          let batchOk = false;
          let batchParseOk = false;
          let batchError: string | undefined;

          for (let attempt = 1; attempt <= Math.max(1, LLM_RETRIES + 1); attempt += 1) {
            try {
              const llmResponse = await llmClient.generate(batchPromptInput);
              llmMeta = llmResponse.meta;
              llmImagePlanPatch = {
                slots: [...llmImagePlanPatch.slots, ...(llmResponse.imagePlanPatch?.slots || [])],
              };
              llmFills = { ...llmFills, ...llmResponse.fills };

              await fs.writeFile(`${batchFilePrefix}.response.txt`, (llmResponse.meta?.rawResponseText || "").slice(0, 8000)).catch(() => undefined);
              await fs.writeFile(`${batchFilePrefix}.parsed.json`, JSON.stringify(llmResponse, null, 2)).catch(() => undefined);

              batchOk = true;
              batchParseOk = llmResponse.meta?.parseOk !== false;
              break;
            } catch (error) {
              batchError = error instanceof Error ? error.message : String(error);
              retryCount = attempt - 1;

              const retryable = isRetryableLlmError(error, LLM_RETRY_ON_ABORT);
              if (!retryable || attempt > LLM_RETRIES) {
                await fs.writeFile(`${batchFilePrefix}.error.json`, JSON.stringify({ error: batchError }, null, 2)).catch(() => undefined);
                break;
              }

              const delayMs = calcLlmRetryDelayMs(attempt, LLM_RETRY_BASE_DELAY_MS, LLM_RETRY_MAX_DELAY_MS);
              await sleep(delayMs);
            }
          }

          const counts = aggregateFillCounts(batch.keys, llmFills);
          llmDiagnostics.batches.push({
            index: batch.index,
            slide: batch.slide,
            keysCount: batch.keys.length,
            keysSample: batch.keys.slice(0, 5),
            attempted: true,
            ok: batchOk,
            parseOk: batchParseOk,
            receivedKeysCount: counts.receivedKeysCount,
            missingKeysCount: counts.missingKeysCount,
            timingMs: Date.now() - batchStartedAt,
            error: batchError,
            retryCount,
          });

          if (!batchOk && LLM_FAIL_ON_ERROR) {
            throw new Error(batchError || `LLMBatchFailed: ${batch.index}`);
          }
        }

        const aggregated = aggregateFillCounts(fillKeys, llmFills);
        llmDiagnostics.receivedKeysCount = aggregated.receivedKeysCount;
        llmDiagnostics.missingKeysCount = aggregated.missingKeysCount;
        llmDiagnostics.ok = aggregated.receivedKeysCount > 0;
        llmDiagnostics.parseOk = llmDiagnostics.batches.every((batch) => batch.parseOk || !batch.ok);
      } catch (error) {
        llmError = error instanceof Error ? error.message : String(error);
        llmDiagnostics.error = llmError;
        llmDiagnostics.ok = false;
        llmDiagnostics.parseOk = false;

        if (LLM_FAIL_ON_ERROR) {
          throw new Error(`LLMFailed: ${llmError}`);
        }

        jobLogger.warn({ err: error }, "llm generation failed, fallback to test fills for missing keys");
      } finally {
        llmDiagnostics.timingMs = Date.now() - llmStartedAt;
        mark("llm_generate");
      }
    } else {
      llmDiagnostics.attempted = false;
      llmDiagnostics.ok = !LLM_ENABLED || fillKeys.length === 0;
      llmDiagnostics.hint = fillKeys.length === 0
        ? "fillKeys are empty: no placeholders found"
        : (LLM_ENABLED ? undefined : "LLM disabled");
    }

    const generatedFills = mergeFills(fillKeys, llmFills, "TEST_");
    const fills = { ...generatedFills, ...debugFills };
    const formatNormalizations = {
      count: 0,
      documentTextCount: 0,
      examples: [] as Array<{ key: string; before: string; after: string; rules: string[] }>,
    };
    const applySafeFormatNormalizations = (keys: string[]): void => {
      for (const key of keys) {
        const value = fills[key];
        if (typeof value !== "string") continue;
        if (!isBulletLikeFillKey(key) && !/•\s*•|[^\n]\s+•/.test(value)) continue;
        const normalized = normalizeBulletLineFormatting(value);
        if (!normalized.changed) continue;
        fills[key] = normalized.value;
        formatNormalizations.count += 1;
        if (formatNormalizations.examples.length < 8) {
          formatNormalizations.examples.push({
            key,
            before: value.slice(0, 180),
            after: normalized.value.slice(0, 180),
            rules: normalized.rules,
          });
        }
      }
    };

    for (const key of Object.keys(fills)) {
      fills[key] = normalizeText(key, fills[key]);
    }

    const slideSummariesForContent = buildSlideSummaries(fills, slideCount);
    for (const [key, value] of Object.entries(fills)) {
      const role = styleRoleByKey(key);
      if (role === "bullets" || key.includes("_plan") || key.includes("_goals") || key.includes("_examples")) {
        const match = key.match(/^s(\d+)_/i);
        const slide = match?.[1] ? Number.parseInt(match[1], 10) : 1;
        const slideType = slideSummariesForContent[slide]?.slideType || "general";
        if (DEDUP_ENABLED) {
          fills[key] = dedupeBulletLines(value, topic, slideType);
        } else {
          const lines = value.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
          while (lines.length < 4) {
            const fallback = generateLocalFallbackBullets(topic, slideType)[lines.length % 3];
            lines.push(fallback);
          }
          fills[key] = lines.slice(0, 6).map((line) => line.startsWith("•") ? line : `• ${line}`).join("\n");
        }
      }

      if (key.endsWith("_sources") || key.includes("sources")) {
        if (!ragEnabledForJob || ragHitCount === 0) {
          fills[key] = sourceFallbackForDeckPlan(topic, deckPlan);
        } else {
          const sourceUris = (ragSources || ragCitations || []).map((item) => item.source_uri).filter((uri): uri is string => typeof uri === "string").slice(0, 5);
          fills[key] = sourceUris.length > 0 ? `Источники: ${sourceUris.join("; ")}` : fills[key];
        }
      }
    }
    applySafeFormatNormalizations(Object.keys(fills));

    const fallbackKeysCount = fillKeys.filter((key) => {
      if (Object.prototype.hasOwnProperty.call(debugFills, key)) return false;
      return fills[key] === `TEST_${key}`;
    }).length;

    const aggregated = aggregateFillCounts(fillKeys, llmFills);
    llmDiagnostics.receivedKeysCount = aggregated.receivedKeysCount;
    llmDiagnostics.missingKeysCount = aggregated.missingKeysCount;
    llmDiagnostics.usedFallbackForAll = fillKeys.length > 0 && fallbackKeysCount === fillKeys.length;

    let fillsStats = applyFillsByLocations(doc, placeholderScan.locations, fills);
    let remainingFillTokenStats = scanRemainingFillTokens(doc);
    let remainingKeys = extractRemainingKeys(remainingFillTokenStats.remainingSamples);

    const qualityGate = {
      remainingKeysCount: remainingKeys.length,
      remainingKeysSample: remainingKeys.slice(0, 15),
      targetedPassAttempted: false,
      targetedPassOk: false,
      targetedPassReceivedKeysCount: 0,
      localFallbackAppliedKeysCount: 0,
      finalRemainingTestTokensCount: remainingFillTokenStats.remainingTestTokensCount,
      finalRemainingMustacheTokensCount: remainingFillTokenStats.remainingMustacheTokensCount,
      hint: undefined as string | undefined,
    };

    if (remainingKeys.length > 0 && LLM_ENABLED) {
      qualityGate.targetedPassAttempted = true;
      try {
        const llmClient = new DeepSeekClient();
        const targetBatches = chunkKeys(remainingKeys, 5);
        let targetedReceived = 0;

        for (const keys of targetBatches) {
          const response = await llmClient.generate({
            presentationId,
            themeId,
            topic,
            language,
            fillKeys: keys,
            imagePlan: buildImagePlanFromMap({ map, doc, presentationId, themeId, topic, language }),
            mode: "targeted_fills",
            strictKeysRequired: true,
            deckPlan,
            layoutContext: layoutEngineDiagnostics.selectedLayouts
              .filter((row) => keys.some((key) => key.startsWith(`s${row.slide}_`)))
              .map((row) => ({
                slide: row.slide,
                slideType: row.slideType,
                layoutId: row.layoutId,
                role: slideRole(row.slideType),
                textDensity: slideDensity(row.slideType),
              })),
          });
          for (const [key, value] of Object.entries(response.fills)) {
            fills[key] = normalizeText(key, value);
            targetedReceived += 1;
          }
          applySafeFormatNormalizations(keys);
        }

        const targetLocations = placeholderScan.locations.filter((location) => remainingKeys.includes(location.key));
        applyFillsByLocations(doc, targetLocations, fills);
        remainingFillTokenStats = scanRemainingFillTokens(doc);
        remainingKeys = extractRemainingKeys(remainingFillTokenStats.remainingSamples);
        qualityGate.targetedPassOk = true;
        qualityGate.targetedPassReceivedKeysCount = targetedReceived;
      } catch (error) {
        jobLogger.warn({ err: error }, "quality gate targeted LLM pass failed");
      }
    }

    if (remainingKeys.length > 0) {
      for (const key of remainingKeys) {
        if (key.startsWith("TEST_")) continue;
        const slideNumber = extractSlideFromKey(key);
        const slideContext = deckPlan.slides.find((slide: DeckPlanSlide) => slide.slide === slideNumber);
        fills[key] = normalizeText(key, generateLocalFallback({ key, topic, slideNumber, slideContext }));
        qualityGate.localFallbackAppliedKeysCount += 1;
      }
      applySafeFormatNormalizations(remainingKeys);
      const targetLocations = placeholderScan.locations.filter((location) => remainingKeys.includes(location.key));
      applyFillsByLocations(doc, targetLocations, fills);
      remainingFillTokenStats = scanRemainingFillTokens(doc);
      remainingKeys = extractRemainingKeys(remainingFillTokenStats.remainingSamples);
    }

    qualityGate.remainingKeysCount = remainingKeys.length;
    qualityGate.remainingKeysSample = remainingKeys.slice(0, 15);
    qualityGate.finalRemainingTestTokensCount = remainingFillTokenStats.remainingTestTokensCount;
    qualityGate.finalRemainingMustacheTokensCount = remainingFillTokenStats.remainingMustacheTokensCount;

    if (remainingKeys.length > 0) {
      qualityGate.hint = "BUG: tokens remained after targeted pass + local fallback";
      jobLogger.error({ remainingKeys, samples: remainingFillTokenStats.remainingSamples }, qualityGate.hint);
      if (FAIL_ON_REMAINING_TOKENS) {
        throw new Error("RemainingTokensAfterQualityGate");
      }
    }

    let contentQuality = runContentQa({
      fills,
      fillKeys,
      topic,
      deckPlan,
    });
    jobLogger.info(
      {
        score: contentQuality.score,
        issueCount: contentQuality.issues.length,
        stats: contentQuality.stats,
      },
      "content qa completed"
    );

    const contentRepair = {
      enabled: CONTENT_REPAIR_ENABLED,
      attempted: false,
      accepted: false,
      acceptedPasses: 0,
      beforeScore: contentQuality.score,
      afterScore: contentQuality.score,
      requestedKeys: [] as string[],
      receivedKeys: [] as string[],
      issueCodes: [] as string[],
      passes: [] as Array<{
        attempt: number;
        beforeScore: number;
        afterScore: number;
        requestedKeys: string[];
        receivedKeys: string[];
        accepted: boolean;
        error?: string;
      }>,
      error: undefined as string | undefined,
    };

    if (CONTENT_REPAIR_ENABLED && LLM_ENABLED) {
      for (let attempt = 1; attempt <= 2 && contentQuality.score < CONTENT_REPAIR_SCORE_THRESHOLD; attempt += 1) {
        const repairPlan = buildContentRepairPlan({
          report: contentQuality,
          fillKeys,
          maxKeys: Math.max(1, CONTENT_REPAIR_MAX_KEYS),
        });
        if (repairPlan.keys.length === 0) break;

        contentRepair.attempted = true;
        contentRepair.requestedKeys = [...new Set([...contentRepair.requestedKeys, ...repairPlan.keys])];
        contentRepair.issueCodes = [...new Set([...contentRepair.issueCodes, ...repairPlan.issues.map((issue) => issue.code)])];
        const originalValues = Object.fromEntries(repairPlan.keys.map((key) => [key, fills[key] || ""]));
        const beforeErrorCount = contentQuality.issues.filter((issue) => issue.severity === "error").length;
        const pass = {
          attempt,
          beforeScore: contentQuality.score,
          afterScore: contentQuality.score,
          requestedKeys: repairPlan.keys,
          receivedKeys: [] as string[],
          accepted: false,
          error: undefined as string | undefined,
        };
        let stopRepair = false;

        try {
          const llmClient = new DeepSeekClient();
          const response = await llmClient.generate({
            presentationId,
            themeId,
            topic,
            language,
            fillKeys: repairPlan.keys,
            imagePlan: buildImagePlanFromMap({ map, doc, presentationId, themeId, topic, language }),
            mode: "content_repair",
            strictKeysRequired: true,
            deckPlan,
            layoutContext: layoutEngineDiagnostics.selectedLayouts
              .filter((row) => repairPlan.keys.some((key) => key.startsWith(`s${row.slide}_`)))
              .map((row) => ({
                slide: row.slide,
                slideType: row.slideType,
                layoutId: row.layoutId,
                role: slideRole(row.slideType),
                textDensity: slideDensity(row.slideType),
              })),
            repairContext: {
              currentFills: originalValues,
              issues: repairPlan.issues.map((issue) => ({
                code: issue.code,
                key: issue.key,
                slide: issue.slide,
                message: issue.message,
              })),
            },
          });

          pass.receivedKeys = Object.keys(response.fills).filter((key) => repairPlan.keys.includes(key));
          contentRepair.receivedKeys = [...new Set([...contentRepair.receivedKeys, ...pass.receivedKeys])];
          if (pass.receivedKeys.length !== repairPlan.keys.length) throw new Error("ContentRepairReturnedIncompleteFields");

          for (const key of pass.receivedKeys) {
            fills[key] = normalizeText(key, response.fills[key]);
          }
          applySafeFormatNormalizations(pass.receivedKeys);

          for (const location of placeholderScan.locations) {
            if (pass.receivedKeys.includes(location.key)) setAtPath(doc, location.path, fills[location.key]);
          }

          const candidateQuality = runContentQa({ fills, fillKeys, topic, deckPlan });
          const candidateErrorCount = candidateQuality.issues.filter((issue) => issue.severity === "error").length;
          const improved = candidateQuality.score > contentQuality.score
            || (candidateQuality.score === contentQuality.score && candidateQuality.issues.length < contentQuality.issues.length);
          pass.afterScore = candidateQuality.score;

          if (improved && candidateErrorCount <= beforeErrorCount) {
            contentQuality = candidateQuality;
            pass.accepted = true;
            contentRepair.acceptedPasses += 1;
          } else {
            for (const [key, value] of Object.entries(originalValues)) fills[key] = value;
            for (const location of placeholderScan.locations) {
              if (repairPlan.keys.includes(location.key)) setAtPath(doc, location.path, fills[location.key]);
            }
            stopRepair = true;
          }
        } catch (error) {
          for (const [key, value] of Object.entries(originalValues)) fills[key] = value;
          for (const location of placeholderScan.locations) {
            if (repairPlan.keys.includes(location.key)) setAtPath(doc, location.path, fills[location.key]);
          }
          pass.error = error instanceof Error ? error.message : String(error);
          contentRepair.error = pass.error;
          stopRepair = true;
          jobLogger.warn({ err: error, requestedKeys: repairPlan.keys }, "content repair pass failed");
        }
        contentRepair.passes.push(pass);
        if (stopRepair) break;
      }
    }

    contentRepair.accepted = contentRepair.acceptedPasses > 0;
    contentRepair.afterScore = contentQuality.score;

    jobLogger.info(contentRepair, "content repair completed");

    const structuralContentRepair = {
      enabled: CONTENT_REPAIR_ENABLED,
      attempted: false,
      acceptedPasses: 0,
      passes: [] as Array<{
        attempt: number;
        strategy?: "field" | "itemized";
        requestedKeys: string[];
        receivedKeys: string[];
        beforeErrorCount: number;
        afterErrorCount: number;
        accepted: boolean;
        error?: string;
      }>,
      remainingErrorCount: contentQuality.issues.filter((issue) => issue.severity === "error").length,
    };

    if (CONTENT_REPAIR_ENABLED && LLM_ENABLED) {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const blockingIssues = contentQuality.issues.filter((issue) => issue.severity === "error" && issue.key);
        const requestedKeys = [...new Set(blockingIssues.flatMap((issue) => issue.key ? [issue.key] : []))]
          .slice(0, Math.max(1, CONTENT_REPAIR_MAX_KEYS));
        if (requestedKeys.length === 0) break;

        structuralContentRepair.attempted = true;
        const beforeErrorCount = contentQuality.issues.filter((issue) => issue.severity === "error").length;
        const originalValues = Object.fromEntries(requestedKeys.map((key) => [key, fills[key] || ""]));
        const pass = {
          attempt,
          strategy: "field" as const,
          requestedKeys,
          receivedKeys: [] as string[],
          beforeErrorCount,
          afterErrorCount: beforeErrorCount,
          accepted: false,
          error: undefined as string | undefined,
        };

        try {
          const llmClient = new DeepSeekClient();
          const response = await llmClient.generate({
            presentationId,
            themeId,
            topic,
            language,
            fillKeys: requestedKeys,
            imagePlan: buildImagePlanFromMap({ map, doc, presentationId, themeId, topic, language }),
            mode: "content_repair",
            strictKeysRequired: true,
            deckPlan,
            layoutContext: layoutEngineDiagnostics.selectedLayouts
              .filter((row) => requestedKeys.some((key) => key.startsWith(`s${row.slide}_`)))
              .map((row) => ({
                slide: row.slide,
                slideType: row.slideType,
                layoutId: row.layoutId,
                role: slideRole(row.slideType),
                textDensity: slideDensity(row.slideType),
              })),
            repairContext: {
              currentFills: originalValues,
              issues: blockingIssues.map((issue) => ({
                code: issue.code,
                key: issue.key,
                slide: issue.slide,
                message: `${issue.message} Это обязательное структурное условие; верни точное количество отдельных строк.`,
              })),
            },
          });

          pass.receivedKeys = Object.keys(response.fills).filter((key) => requestedKeys.includes(key));
          if (pass.receivedKeys.length !== requestedKeys.length) throw new Error("StructuralRepairReturnedIncompleteFields");
          for (const key of requestedKeys) fills[key] = normalizeText(key, response.fills[key]);
          applySafeFormatNormalizations(requestedKeys);
          applyFillsByLocations(
            doc,
            placeholderScan.locations.filter((location) => requestedKeys.includes(location.key)),
            fills,
          );

          const candidateQuality = runContentQa({ fills, fillKeys, topic, deckPlan });
          const afterErrorCount = candidateQuality.issues.filter((issue) => issue.severity === "error").length;
          pass.afterErrorCount = afterErrorCount;
          pass.accepted = afterErrorCount < beforeErrorCount && candidateQuality.score >= contentQuality.score;
          if (!pass.accepted) {
            for (const key of requestedKeys) fills[key] = originalValues[key];
            applyFillsByLocations(
              doc,
              placeholderScan.locations.filter((location) => requestedKeys.includes(location.key)),
              fills,
            );
            structuralContentRepair.passes.push(pass);
            break;
          }

          contentQuality = candidateQuality;
          structuralContentRepair.acceptedPasses += 1;
        } catch (error) {
          for (const key of requestedKeys) fills[key] = originalValues[key];
          applyFillsByLocations(
            doc,
            placeholderScan.locations.filter((location) => requestedKeys.includes(location.key)),
            fills,
          );
          pass.error = error instanceof Error ? error.message : String(error);
          jobLogger.warn({ err: error, requestedKeys, attempt }, "structural content repair failed");
        }
        structuralContentRepair.passes.push(pass);
      }

      const exactCountIssues = [...new Map(
        contentQuality.issues
          .filter((issue) => issue.severity === "error" && issue.key && typeof issue.expected === "number" && issue.expected > 0)
          .map((issue) => [issue.key as string, issue]),
      ).values()];
      for (const issue of exactCountIssues) {
        const key = issue.key as string;
        const expected = issue.expected as number;
        const itemKeys = buildItemizedRepairKeys(key, expected);
        const currentItems = splitContentItems(fills[key] || "");
        const currentFills = Object.fromEntries(itemKeys.map((itemKey, index) => [itemKey, currentItems[index] || ""]));
        const originalValue = fills[key] || "";
        const beforeErrorCount = contentQuality.issues.filter((item) => item.severity === "error").length;
        const pass = {
          attempt: structuralContentRepair.passes.length + 1,
          strategy: "itemized" as const,
          requestedKeys: itemKeys,
          receivedKeys: [] as string[],
          beforeErrorCount,
          afterErrorCount: beforeErrorCount,
          accepted: false,
          error: undefined as string | undefined,
        };
        structuralContentRepair.attempted = true;

        try {
          const llmClient = new DeepSeekClient();
          const response = await llmClient.generate({
            presentationId,
            themeId,
            topic,
            language,
            fillKeys: itemKeys,
            imagePlan: buildImagePlanFromMap({ map, doc, presentationId, themeId, topic, language }),
            mode: "content_repair",
            strictKeysRequired: true,
            deckPlan,
            layoutContext: layoutEngineDiagnostics.selectedLayouts
              .filter((row) => key.startsWith(`s${row.slide}_`))
              .map((row) => ({
                slide: row.slide,
                slideType: row.slideType,
                layoutId: row.layoutId,
                role: slideRole(row.slideType),
                textDensity: slideDensity(row.slideType),
              })),
            repairContext: {
              currentFills,
              issues: itemKeys.map((itemKey, index) => ({
                code: "required_count_item",
                key: itemKey,
                slide: issue.slide,
                message: `Сформулируй ровно один самостоятельный содержательный пункт ${index + 1} из ${expected}; не объединяй его с другими пунктами.`,
              })),
            },
          });

          pass.receivedKeys = Object.keys(response.fills).filter((itemKey) => itemKeys.includes(itemKey));
          if (pass.receivedKeys.length !== itemKeys.length) throw new Error("ExactCountRepairReturnedIncompleteFields");
          fills[key] = normalizeText(key, composeExactBulletBlock(response.fills, itemKeys));
          applySafeFormatNormalizations([key]);
          applyFillsByLocations(
            doc,
            placeholderScan.locations.filter((location) => location.key === key),
            fills,
          );

          const candidateQuality = runContentQa({ fills, fillKeys, topic, deckPlan });
          pass.afterErrorCount = candidateQuality.issues.filter((item) => item.severity === "error").length;
          pass.accepted = pass.afterErrorCount < beforeErrorCount && candidateQuality.score >= contentQuality.score;
          if (pass.accepted) {
            contentQuality = candidateQuality;
            structuralContentRepair.acceptedPasses += 1;
          } else {
            fills[key] = originalValue;
            applyFillsByLocations(
              doc,
              placeholderScan.locations.filter((location) => location.key === key),
              fills,
            );
          }
        } catch (error) {
          fills[key] = originalValue;
          applyFillsByLocations(
            doc,
            placeholderScan.locations.filter((location) => location.key === key),
            fills,
          );
          pass.error = error instanceof Error ? error.message : String(error);
          jobLogger.warn({ err: error, key, expected }, "itemized exact-count repair failed");
        }
        structuralContentRepair.passes.push(pass);
      }
    }
    structuralContentRepair.remainingErrorCount = contentQuality.issues.filter((issue) => issue.severity === "error").length;
    jobLogger.info(structuralContentRepair, "structural content repair completed");

    const actualContentDensity = inferContentDensityFromFills(fills, slideCount);
    layoutEngineDiagnostics.actualContentDensity = actualContentDensity;
    layoutEngineDiagnostics.postFillSelectionUsed = false;
    layoutEngineDiagnostics.postFillLayoutChanges = [];
    if (LAYOUT_ENGINE_ENABLED && layoutEngineDiagnostics.mode !== "legacy_fallback") {
      try {
        const beforeLayouts = new Map(layoutEngineDiagnostics.selectedLayouts.map((row) => [row.slide, row.layoutId]));
        const recompiled = await compileLayoutPresentation({
          presentationId,
          themeId,
          jobId,
          variation: LAYOUT_ENGINE_VARIATION,
          legacyTemplateZipPath: templatePath,
          deckPlan,
          topic,
          language: language || "ru",
          contentDensityBySlide: actualContentDensity,
        });
        const changes = recompiled.diagnostics.selectedLayouts.flatMap((row) => {
          const before = beforeLayouts.get(row.slide);
          return before && before !== row.layoutId ? [{ slide: row.slide, before, after: row.layoutId }] : [];
        });
        layoutEngineDiagnostics.postFillSelectionUsed = true;
        layoutEngineDiagnostics.postFillLayoutChanges = changes;

        if (changes.length > 0) {
          const candidateDoc = recompiled.doc;
          normalizePlaceholders(candidateDoc);
          const candidatePlaceholderScan = extractPlaceholderLocations(candidateDoc);
          const postFillKeys = new Set(candidatePlaceholderScan.locations.map((location) => location.key));
          const incompatibleKeys = fillKeys.filter((key) => !postFillKeys.has(key));
          if (incompatibleKeys.length > 0) throw new Error(`PostFillLayoutMissingKeys: ${incompatibleKeys.join(",")}`);

          (doc as Record<string, unknown>).slides = ((candidateDoc as Record<string, unknown>).slides || []) as unknown[];
          templatePath = recompiled.templateZipPath;
          layoutIds = recompiled.layoutIds;
          layoutEngineDiagnostics = {
            ...recompiled.diagnostics,
            postFillSelectionUsed: true,
            postFillLayoutChanges: changes,
            actualContentDensity,
          };
          placeholderScan = candidatePlaceholderScan;

          const mapSlides = ((map as Record<string, unknown>).slides && typeof (map as Record<string, unknown>).slides === "object"
            ? (map as Record<string, unknown>).slides
            : {}) as Record<string, unknown>;
          for (const rawSlide of Object.values(mapSlides)) {
            if (rawSlide && typeof rawSlide === "object") delete (rawSlide as Record<string, unknown>).imageAt;
          }
          for (const [slide, imageAt] of Object.entries(recompiled.imageAtBySlide)) {
            const slideRow = (mapSlides[slide] && typeof mapSlides[slide] === "object" ? mapSlides[slide] : {}) as Record<string, unknown>;
            slideRow.imageAt = imageAt;
            mapSlides[slide] = slideRow;
          }
          (map as Record<string, unknown>).slides = mapSlides;

          preVariantDoc = JSON.parse(JSON.stringify(doc)) as unknown;
          variantsStats = applyVariants(doc, map, { presentationId }, fills, {
            onDropAtOutOfRange: ({ slideIndex, badIndex }) => {
              jobLogger.warn({ slideIndex, badIndex }, "post-fill dropAt index out of range");
            },
          });
          placeholderScan = extractPlaceholderLocations(doc);
          fillsStats = applyFillsByLocations(doc, placeholderScan.locations, fills);
          imageSlots = extractImageSlots(doc);
          slideCount = inferSlideCount(doc);
        }
      } catch (error) {
        jobLogger.warn({ err: error }, "post-fill layout selection failed; keeping initial compiled layouts");
      }
    }

    formatNormalizations.documentTextCount = normalizeDocumentBulletMarkers(doc);

    const theme = await readThemeSafe(themeId);
    const layoutThemeStats = applyLayoutThemeStyles({ doc, theme });
    const themeTypography = resolveThemeTypography(themeId, theme);
    const typographyStats = applyTypographyStandards({
      doc,
      placeholderLocations: placeholderScan.locations,
      themeTypography,
    });
    let contentAwareLayoutStats = adaptLayoutToContent(doc);
    let textFitStats = autoFitText({
      doc,
      placeholderLocations: placeholderScan.locations,
      themeTypography,
    });
    if (textFitStats.overflowCount > 0) {
      const repeatedLayoutStats = adaptLayoutToContent(doc);
      contentAwareLayoutStats = {
        groupsFound: Math.max(contentAwareLayoutStats.groupsFound, repeatedLayoutStats.groupsFound),
        groupsAdjusted: contentAwareLayoutStats.groupsAdjusted + repeatedLayoutStats.groupsAdjusted,
        groupsCompacted: contentAwareLayoutStats.groupsCompacted + repeatedLayoutStats.groupsCompacted,
        groupsExpanded: contentAwareLayoutStats.groupsExpanded + repeatedLayoutStats.groupsExpanded,
        elementsMoved: contentAwareLayoutStats.elementsMoved + repeatedLayoutStats.elementsMoved,
        overflowRiskCount: repeatedLayoutStats.overflowRiskCount,
        titlesAdjusted: contentAwareLayoutStats.titlesAdjusted + repeatedLayoutStats.titlesAdjusted,
        fontFallbackCount: contentAwareLayoutStats.fontFallbackCount + repeatedLayoutStats.fontFallbackCount,
      };
      textFitStats = autoFitText({
        doc,
        placeholderLocations: placeholderScan.locations,
        themeTypography,
      });
    }

    const overflowRepair = {
      attempted: false,
      accepted: false,
      beforeOverflowCount: textFitStats.overflowCount,
      afterOverflowCount: textFitStats.overflowCount,
      requestedKeys: [] as string[],
      receivedKeys: [] as string[],
      error: undefined as string | undefined,
    };
    if (LLM_ENABLED && textFitStats.overflowCount > 0) {
      const overflowingItems = textFitStats.items.filter((item) => item.overflowAfterFit);
      const requestedKeys = [...new Set(overflowingItems.map((item) => item.key))];
      overflowRepair.requestedKeys = requestedKeys;
      overflowRepair.attempted = requestedKeys.length > 0;

      if (requestedKeys.length > 0) {
        const originalValues = Object.fromEntries(requestedKeys.map((key) => [key, fills[key] || ""]));
        const docSnapshot = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
        const beforeTextFitStats = textFitStats;
        const beforeContentAwareStats = contentAwareLayoutStats;
        const beforeQuality = contentQuality;
        try {
          const llmClient = new DeepSeekClient();
          const response = await llmClient.generate({
            presentationId,
            themeId,
            topic,
            language,
            fillKeys: requestedKeys,
            imagePlan: buildImagePlanFromMap({ map, doc, presentationId, themeId, topic, language }),
            mode: "content_repair",
            strictKeysRequired: true,
            deckPlan,
            layoutContext: layoutEngineDiagnostics.selectedLayouts
              .filter((row) => requestedKeys.some((key) => key.startsWith(`s${row.slide}_`)))
              .map((row) => ({
                slide: row.slide,
                slideType: row.slideType,
                layoutId: row.layoutId,
                role: slideRole(row.slideType),
                textDensity: slideDensity(row.slideType),
              })),
            repairContext: {
              currentFills: originalValues,
              issues: overflowingItems.map((item) => ({
                code: "layout_overflow",
                key: item.key,
                slide: item.slide,
                message: `Текст занимает ${item.requiredLines} строк при доступных ${item.maxLines}. Сократи до ${Math.max(60, Math.floor((fills[item.key]?.length || 0) * item.maxLines / Math.max(1, item.requiredLines) * 0.88))} символов без потери фактов и требуемой структуры.`,
              })),
            },
          });

          overflowRepair.receivedKeys = Object.keys(response.fills).filter((key) => requestedKeys.includes(key));
          if (overflowRepair.receivedKeys.length !== requestedKeys.length) throw new Error("OverflowRepairReturnedIncompleteFields");
          for (const key of requestedKeys) fills[key] = normalizeText(key, response.fills[key]);
          applySafeFormatNormalizations(requestedKeys);
          applyFillsByLocations(
            doc,
            placeholderScan.locations.filter((location) => requestedKeys.includes(location.key)),
            fills,
          );
          applyTypographyStandards({ doc, placeholderLocations: placeholderScan.locations, themeTypography });
          const candidateContentAwareStats = adaptLayoutToContent(doc);
          const candidateTextFitStats = autoFitText({
            doc,
            placeholderLocations: placeholderScan.locations,
            themeTypography,
          });
          const candidateQuality = runContentQa({ fills, fillKeys, topic, deckPlan });
          const beforeErrors = beforeQuality.issues.filter((issue) => issue.severity === "error").length;
          const candidateErrors = candidateQuality.issues.filter((issue) => issue.severity === "error").length;
          const accepted = candidateTextFitStats.overflowCount < beforeTextFitStats.overflowCount
            && candidateErrors <= beforeErrors
            && candidateQuality.score >= beforeQuality.score - 5;

          overflowRepair.afterOverflowCount = candidateTextFitStats.overflowCount;
          overflowRepair.accepted = accepted;
          if (accepted) {
            textFitStats = candidateTextFitStats;
            contentAwareLayoutStats = candidateContentAwareStats;
            contentQuality = candidateQuality;
          } else {
            for (const key of requestedKeys) fills[key] = originalValues[key];
            const docRecord = doc as Record<string, unknown>;
            for (const key of Object.keys(docRecord)) delete docRecord[key];
            Object.assign(docRecord, docSnapshot);
            textFitStats = beforeTextFitStats;
            contentAwareLayoutStats = beforeContentAwareStats;
          }
        } catch (error) {
          for (const key of requestedKeys) fills[key] = originalValues[key];
          const docRecord = doc as Record<string, unknown>;
          for (const key of Object.keys(docRecord)) delete docRecord[key];
          Object.assign(docRecord, docSnapshot);
          textFitStats = beforeTextFitStats;
          contentAwareLayoutStats = beforeContentAwareStats;
          overflowRepair.error = error instanceof Error ? error.message : String(error);
          jobLogger.warn({ err: error, requestedKeys }, "layout overflow repair failed");
        }
      }
    }

    await job.updateProgress(75);
    jobLogger.info({ stage: "apply_variants_fills" }, "progress updated");
    mark("apply_variants_fills");


    const imagePlanTmpPath = path.resolve(".tmp", jobId, "imagePlan.json");
    const diagnosticsTmpPath = path.resolve(".tmp", jobId, "diagnostics.json");
    let imagePlanDocument: ReturnType<typeof buildImagePlanFromMap> | null = null;
    let imagePlanJsonString: string | null = null;
    let imagePlanIncluded = false;
    let imagePlanMode: "auto_detect" | "map_only" | "mixed" | "disabled" | "empty" = "empty";
    let imageSlotsDroppedCount = 0;
    let imageSlotsInvalidCount = 0;
    let diagnosticsJsonString: string | null = null;
    let diagnosticsIncluded = false;
    const imagePromptsDiagnostics = { attempted: false, ok: false, slotCount: 0, filledCount: 0, missingCount: 0, duplicatesBefore: 0, duplicatesAfter: 0, badGenericCount: 0, compressionAppliedCount: 0, sampleQueries: [] as string[], sample: [] as Array<{ slotId: string; query: string }> };

    try {
      const imagePlanBuild = buildImagePlanWithDiagnostics({
        map,
        originalDoc: preVariantDoc,
        currentDoc: doc,
        presentationId,
        themeId,
        topic: typeof job.data?.topic === "string" ? job.data.topic : "",
        language: typeof job.data?.language === "string" ? job.data.language : null,
        autoDetect: IMAGEPLAN_AUTO_DETECT,
        fallbackAllNonDecor: IMAGEPLAN_DETECT_FALLBACK_ALL_NON_DECOR,
      });
      imagePlanDocument = imagePlanBuild.imagePlan;
      imagePlanMode = imagePlanBuild.diagnostics.mode;
      imageSlotsDroppedCount = imagePlanBuild.diagnostics.droppedCount;
      imageSlotsInvalidCount = imagePlanBuild.diagnostics.invalidCount;

      if (llmImagePlanPatch && llmImagePlanPatch.slots.length > 0) {
        applyImagePlanPatch({ imagePlanDocument, patch: llmImagePlanPatch });
      }

      const slideSummaries = buildSlideSummaries(fills, slideCount);
      imagePromptsDiagnostics.slotCount = imagePlanDocument.slots.length;
      if (LLM_ENABLED && imagePlanDocument.slots.length > 0) {
        imagePromptsDiagnostics.attempted = true;
        try {
          const llmClient = new DeepSeekClient();
          const batches = chunkKeys(imagePlanDocument.slots as Array<{ slotId: string; slide: number; kind: "hero" | "photo" | "icon" | "other"; aspect?: "portrait" | "landscape" | "square" | "any" }>, 7);
          let generatedCount = 0;
          for (const batch of batches) {
            const response = await llmClient.generate({
              presentationId,
              themeId,
              topic,
              language,
              fillKeys: [],
              imagePlan: imagePlanDocument,
              mode: "image_prompts",
              imagePromptsInput: batch.map((slot) => ({
                slotId: slot.slotId,
                slide: slot.slide,
                kind: slot.kind,
                aspect: slot.aspect,
                slideType: slideSummaries[slot.slide]?.slideType || "general",
                title: slideSummaries[slot.slide]?.title || "",
                keywords: slideSummaries[slot.slide]?.keywords || [],
                entities: slideSummaries[slot.slide]?.entities || [],
                slideSummary: slideSummaries[slot.slide]?.summary || topic,
              })),
            });
            const patchSlots = response.imagePlanPatch?.slots || [];
            generatedCount += patchSlots.length;
            if (patchSlots.length > 0) {
              applyImagePlanPatch({ imagePlanDocument, patch: { slots: patchSlots } });
            }
          }
          imagePromptsDiagnostics.ok = true;
          imagePromptsDiagnostics.filledCount = generatedCount;
        } catch (error) {
          jobLogger.warn({ err: error }, "image prompts llm failed, using fallback");
        }
      }

      for (const slot of imagePlanDocument.slots as Array<{ slotId: string; slide: number; kind: "hero" | "photo" | "icon" | "other"; query: string; hint: string | null; negative?: string[]; styleHint?: string }>) {
        const needsFallback = !slot.query
          || slot.query.toLowerCase().includes("слайд")
          || slot.query.toLowerCase().includes("topic")
          || isGenericImageQuery(slot.query)
          || !isImagePromptLanguageCompatible(slot.query, language);
        if (needsFallback) {
          const fallback = buildImagePromptFallback({
            topic,
            slideTitle: fills[`s${slot.slide}_title`] || "",
            slideSummary: slideSummaries[slot.slide]?.summary || topic,
            kind: slot.kind,
            language,
          });
          slot.query = fallback.query;
          slot.hint = fallback.hint;
          slot.negative = fallback.negative;
          slot.styleHint = slot.styleHint || fallback.styleHint;
        }
      }

      for (const slot of imagePlanDocument.slots as Array<{ slotId: string; slide: number; kind: "hero" | "photo" | "icon" | "other"; query: string; hint: string | null; negative?: string[]; styleHint?: string }>) {
        const summary = slideSummaries[slot.slide];
        slot.query = applySlideTypeHeuristics(slot.query, summary?.slideType || "general", slot.kind);
        slot.query = slot.query.replace(/["':]/g, "").replace(/\s+/g, " ").trim();
        if (slot.hint) {
          slot.hint = slot.hint.replace(/["':]/g, "").replace(/\s+/g, " ").trim();
        }
      }

      const dedupStats = enforceImagePromptUniqueness(imagePlanDocument.slots, slideSummaries, topic);
      for (const slot of imagePlanDocument.slots as Array<{ slotId: string; slide: number; kind: "hero" | "photo" | "icon" | "other"; query: string; hint: string | null; negative?: string[]; styleHint?: string }>) {
        const queryIsValid = isImagePromptLanguageCompatible(slot.query, language) && !isGenericImageQuery(slot.query);
        const hintIsValid = !slot.hint || isImagePromptLanguageCompatible(slot.hint, language);
        if (queryIsValid && hintIsValid) continue;
        const fallback = buildImagePromptFallback({
          topic,
          slideTitle: fills[`s${slot.slide}_title`] || "",
          slideSummary: slideSummaries[slot.slide]?.summary || topic,
          kind: slot.kind,
          language,
        });
        slot.query = applySlideTypeHeuristics(fallback.query, slideSummaries[slot.slide]?.slideType || "general", slot.kind)
          .replace(/["':]/g, "")
          .replace(/\s+/g, " ")
          .trim();
        slot.hint = fallback.hint;
        slot.negative = fallback.negative;
        slot.styleHint = slot.styleHint || fallback.styleHint;
      }
      imagePromptsDiagnostics.duplicatesBefore = dedupStats.duplicatesBefore;
      imagePromptsDiagnostics.duplicatesAfter = dedupStats.duplicatesAfter;
      imagePromptsDiagnostics.badGenericCount = dedupStats.badGenericCount;
      imagePromptsDiagnostics.compressionAppliedCount = dedupStats.compressionAppliedCount;
      imagePromptsDiagnostics.sampleQueries = (imagePlanDocument.slots as Array<{ query: string }>).slice(0, 10).map((slot) => slot.query);
      imagePromptsDiagnostics.sample = (imagePlanDocument.slots as Array<{ slotId: string; query: string }>).slice(0, 8).map((slot) => ({ slotId: slot.slotId, query: slot.query }));
      imagePromptsDiagnostics.missingCount = (imagePlanDocument.slots as Array<{ query: string }>).filter((slot) => !slot.query || slot.query.trim().length < 5).length;

      imagePlanJsonString = JSON.stringify(imagePlanDocument, null, 2);
      imagePlanIncluded = true;

      await fs.writeFile(imagePlanTmpPath, imagePlanJsonString).catch((error) => {
        jobLogger.warn({ err: error, imagePlanTmpPath }, "unable to persist imagePlan tmp file");
      });

      const diagnostics = {
        version: 1,
        presentationId,
        themeId,
        topic: typeof job.data?.topic === "string" ? job.data.topic : "",
        createdAt: new Date().toISOString(),
        placeholders: {
          keys: fillKeys,
          count: placeholderScan.locations.length,
          locations: placeholderScan.locations,
          bySlide: placeholdersBySlide,
          normalizedCount: normalizedAfterVariants.normalizedCount,
        },
        rag: {
          enabled: ragEnabledForJob,
          mode: ragMode,
          ok: ragEnabledForJob ? !ragError : false,
          collection: ragCollection,
          topK: ragTopK,
          minScore: ragMinScore,
          hitCount: ragHitCount,
          usedContextChars: ragUsedContextChars,
          elapsedMs: ragElapsedMs,
          sampleHits: ragSampleHits,
          error: ragError,
        },
        imagePlan: {
          ...imagePlanBuild.diagnostics,
          included: imagePlanIncluded,
          slotCount: imagePlanDocument.slots.length,
          slots: imagePlanBuild.diagnostics.targetsSample,
          hint: imagePlanBuild.diagnostics.finalSlotCount > 0
            ? "Image plan slots resolved for editor picker"
            : "No final slots resolved. Check imageAt bindings or auto-detect settings.",
        },
        layoutEngine: layoutEngineDiagnostics,
        deckPlan: {
          ...deckPlanDiagnostics,
          route: deckPlanRoute,
        },
        deckPlanRoute,
        llm: llmDiagnostics,
        fills: {
          fillKeysCount: fillKeys.length,
          receivedKeysCount: llmDiagnostics.receivedKeysCount,
          missingKeysCount: llmDiagnostics.missingKeysCount,
          remainingTestTokensCount: remainingFillTokenStats.remainingTestTokensCount,
          remainingMustacheTokensCount: remainingFillTokenStats.remainingMustacheTokensCount,
          remainingSamples: remainingFillTokenStats.remainingSamples,
          remainingKeysCount: qualityGate.remainingKeysCount,
          remainingKeysSample: qualityGate.remainingKeysSample,
          targetedPassAttempted: qualityGate.targetedPassAttempted,
          targetedPassOk: qualityGate.targetedPassOk,
          targetedPassReceivedKeysCount: qualityGate.targetedPassReceivedKeysCount,
          localFallbackAppliedKeysCount: qualityGate.localFallbackAppliedKeysCount,
          finalRemainingTestTokensCount: qualityGate.finalRemainingTestTokensCount,
          finalRemainingMustacheTokensCount: qualityGate.finalRemainingMustacheTokensCount,
          hint: qualityGate.hint,
        },
        formatNormalizations,
        typography: {
          colorsApplied: typographyStats.colorsApplied,
          themeColorMode: typographyStats.themeColorMode,
          touched: typographyStats.touched,
          scale: themeTypography.scale,
          sizes: themeTypography.sizes,
        },
        layoutVisuals: layoutThemeStats,
        contentAwareLayout: contentAwareLayoutStats,
        textFit: textFitStats,
        overflowRepair,
        contentQuality,
        contentRepair,
        structuralContentRepair,
        imagePrompts: imagePromptsDiagnostics,
        stats: {
          slides: slideCount,
          elementsScanned: placeholderScan.elementsScanned,
          placeholdersFound: placeholderScan.locations.length,
        },
      };

      diagnosticsJsonString = JSON.stringify(diagnostics, null, 2);
      diagnosticsIncluded = true;
      await fs.writeFile(diagnosticsTmpPath, diagnosticsJsonString).catch((error) => {
        jobLogger.warn({ err: error, diagnosticsTmpPath }, "unable to persist diagnostics tmp file");
      });
    } catch (error) {
      imagePlanIncluded = false;
      imagePlanDocument = null;
      imagePlanJsonString = null;
      diagnosticsJsonString = null;
      diagnosticsIncluded = false;
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
        ...(diagnosticsJsonString
          ? {
              "diagnostics.json": Buffer.from(diagnosticsJsonString, "utf8"),
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
        try {
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
        } catch (error) {
          mark("upload_to_wp");
          const message = error instanceof Error ? error.message : String(error);
          if (message.startsWith("WPUploadFailed:") && WP_FAIL_ON_UPLOAD_ERROR) {
            throw error instanceof Error ? error : new Error(message);
          }
          const failMessage = `WPUploadTransportFailed: ${message.slice(0, 180).replace(/\s+/g, " ")}`;
          upload = {
            attempted: true,
            mode: "upload",
            ok: false,
            status: null,
            outZipUrl: null,
            responseJson: null,
            responseTextSnippet: failMessage.slice(0, UPLOAD_TEXT_LIMIT),
            uploadSkipped: false,
          };

          if (WP_FAIL_ON_UPLOAD_ERROR) {
            throw new Error(failMessage);
          }

          jobLogger.error({ endpoint: job.data.save.endpoint, err: error }, failMessage);
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
        placeholderCount: placeholderScan.locations.length,
        placeholderKeys: fillKeys,
        placeholdersBySlide,
        imagePlannedCount: imagePlan.plannedCount,
        imagePlanVersion: 1,
        imagePlanIncluded,
        imagePlanMode,
        imagePlanSlotsCount: imagePlanDocument ? imagePlanDocument.slots.length : 0,
        imageSlotCount: imagePlanDocument ? imagePlanDocument.slots.length : 0,
        imageSlots: imagePlanDocument ? (imagePlanDocument.slots as Array<{ slotId: string; slide: number; element: number }>).map((slot) => ({ slotId: slot.slotId, slide: slot.slide, element: slot.element })) : [],
        imageSlotsDroppedCount,
        imageSlotsInvalidCount,
        imagePlanPathTmp: path.relative(process.cwd(), imagePlanTmpPath),
        diagnosticsIncluded,
        contentQualityScore: contentQuality.score,
        contentQualityIssueCount: contentQuality.issues.length,
        layoutEngineEnabled: layoutEngineDiagnostics.enabled,
        layoutEngineMode: layoutEngineDiagnostics.mode,
        layoutIds,
        mergedAssetsCount: layoutEngineDiagnostics.mergedAssetsCount,
        usedFallbackForAll: llmDiagnostics.usedFallbackForAll,
        remainingTestTokensCount: remainingFillTokenStats.remainingTestTokensCount,
        remainingMustacheTokensCount: remainingFillTokenStats.remainingMustacheTokensCount,
        finalRemainingTestTokensCount: qualityGate.finalRemainingTestTokensCount,
        finalRemainingMustacheTokensCount: qualityGate.finalRemainingMustacheTokensCount,
        imageReplacedCount,
        imageMissing: imageMissingCapped,
        backgroundsPlannedCount: slideCount,
        backgroundsReplacedCount,
        backgroundsMissing: backgroundsMissingCapped,
        ragIncluded,
      },
      deckPlan: {
        ...deckPlanDiagnostics,
        centralQuestion: deckPlan.centralQuestion,
        thesis: deckPlan.thesis,
        route: deckPlanRoute,
      },
      deckPlanRoute,
      formatNormalizations,
      contentQuality,
      contentRepair,
      structuralContentRepair,
      rag: {
        enabled: ragEnabledForJob,
        ok: ragEnabledForJob ? !ragError : false,
        mode: ragMode,
        hitCount: ragHitCount,
        usedContextChars: ragUsedContextChars,
        sampleHits: ragSampleHits,
        error: ragError,
      },
      llm: {
        enabled: llmDiagnostics.enabled,
        attempted: llmDiagnostics.attempted,
        ok: llmDiagnostics.ok,
        model: llmMeta?.model || llmDiagnostics.model,
        parseOk: llmDiagnostics.parseOk,
        parseError: llmDiagnostics.parseError,
        receivedKeysCount: llmDiagnostics.receivedKeysCount,
        missingKeysCount: llmDiagnostics.missingKeysCount,
        timeoutMs: llmDiagnostics.timeoutMs,
        totalTimeoutMs: llmDiagnostics.totalTimeoutMs,
        batchMode: llmDiagnostics.batchMode,
        maxKeysPerRequest: llmDiagnostics.maxKeysPerRequest,
        batchCount: llmDiagnostics.batchCount,
        tokens: llmMeta?.tokens,
        latencyMs: llmMeta?.latencyMs,
        attempts: llmMeta?.attempts,
        imagePlanPatchedSlots: llmImagePlanPatch?.slots.length || 0,
        acceptedFillsCount: llmDiagnostics.receivedKeysCount,
        expectedFillsCount: fillKeys.length,
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
        imagePlanMode,
        imagePlanSlotsCount: imagePlanDocument ? imagePlanDocument.slots.length : 0,
        imageSlotCount: imagePlanDocument ? imagePlanDocument.slots.length : 0,
        imageSlots: imagePlanDocument ? (imagePlanDocument.slots as Array<{ slotId: string; slide: number; element: number }>).map((slot) => ({ slotId: slot.slotId, slide: slot.slide, element: slot.element })) : [],
        imageSlotsDroppedCount,
        imageSlotsInvalidCount,
        imagePlanPathTmp: path.relative(process.cwd(), imagePlanTmpPath),
        diagnosticsIncluded,
        layoutEngineEnabled: layoutEngineDiagnostics.enabled,
        layoutEngineMode: layoutEngineDiagnostics.mode,
        layoutIds,
        mergedAssetsCount: layoutEngineDiagnostics.mergedAssetsCount,
        usedFallbackForAll: llmDiagnostics.usedFallbackForAll,
        remainingTestTokensCount: remainingFillTokenStats.remainingTestTokensCount,
        remainingMustacheTokensCount: remainingFillTokenStats.remainingMustacheTokensCount,
        finalRemainingTestTokensCount: qualityGate.finalRemainingTestTokensCount,
        finalRemainingMustacheTokensCount: qualityGate.finalRemainingMustacheTokensCount,
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
        contentQualityScore: contentQuality.score,
        contentQualityIssueCount: contentQuality.issues.length,
        llmEnabled: llmDiagnostics.enabled,
        llmAttempted: llmDiagnostics.attempted,
        llmModel: llmMeta?.model || llmDiagnostics.model,
        llmParseOk: llmDiagnostics.parseOk,
        llmParseError: llmDiagnostics.parseError,
        llmError,
        llmAcceptedFillsCount: llmDiagnostics.receivedKeysCount,
        llmMissingKeysCount: llmDiagnostics.missingKeysCount,
        expectedFillsCount: fillKeys.length,
        uploadAttempted: upload.attempted,
        uploadMode: upload.mode,
        uploadOk: upload.ok,
        uploadStatus: upload.status,
        outZipPath,
      },
      "job completed"
    );

    await recordOperationalEvent(getQueueRedisConnection(), {
      service: "orchestrator",
      event: "generation.completed",
      level: "info",
      requestId,
      presentationId,
    }).catch((error) => jobLogger.warn({ err: error }, "completion metric write failed"));
    return result;
    } finally {
      if (userSlotAcquired) {
        await releaseUserSlot(getQueueRedisConnection(), userId, jobId, userSlotAcquired)
          .catch((error) => jobLogger.warn({ err: error }, "user slot release failed"));
      }
      await fs.unlink(jobLockPath).catch(() => undefined);
    }
  },
  {
    connection: getWorkerBullConnection(),
    concurrency,
  }
);

worker.on("failed", (job, error) => {
  logger.child({ jobId: job?.id }).error({ err: error }, "job failed");
  if (job) {
    void recordOperationalEvent(getQueueRedisConnection(), {
      service: "orchestrator",
      event: "generation.failed",
      level: "error",
      requestId: typeof job.data?.requestId === "string" ? job.data.requestId : undefined,
      presentationId: typeof job.data?.presentationId === "number" ? job.data.presentationId : undefined,
      errorCode: error.name || "generation_failed",
    }).catch(() => undefined);
  }
});

worker.on("error", (error) => {
  logger.error({ err: error }, "worker error");
});

logger.info({ queue: getQueueName(), concurrency }, "worker started");

const heartbeatIntervalMs = Math.max(5_000, Number.parseInt(process.env.WORKER_HEARTBEAT_INTERVAL_MS || "10000", 10));
const heartbeatTtlSeconds = Math.max(15, Number.parseInt(process.env.WORKER_HEARTBEAT_TTL_SECONDS || "30", 10));
const writeHeartbeat = async (): Promise<void> => {
  try {
    await getQueueRedisConnection().set(
      getWorkerHeartbeatKey(),
      JSON.stringify({ timestamp: new Date().toISOString(), pid: process.pid }),
      "EX",
      heartbeatTtlSeconds
    );
  } catch (error) {
    logger.warn({ err: error }, "worker heartbeat failed");
  }
};

const heartbeatInterval = setInterval(() => void writeHeartbeat(), heartbeatIntervalMs);
heartbeatInterval.unref();
void writeHeartbeat();

let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down orchestrator worker");
  clearInterval(heartbeatInterval);
  await worker.close().catch((error) => logger.error({ err: error }, "worker close failed"));
  await getQueueRedisConnection().del(getWorkerHeartbeatKey()).catch(() => undefined);
  await closeQueueResources();
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
