import OpenAI from "openai";
import { parseDeepseekJson } from "../llm/parseDeepseekJson";
import { buildDeterministicDeckPlan } from "./buildDeckPlan";
import { createPlanRequestSchema, deckPlanSchema, type CreatePlanRequest, type DeckPlan } from "./schema";

export type PlannerNormalizationDiagnostics = {
  applied: boolean;
  normalizedKindAliases: number;
  movedVisualSuggestions: number;
  droppedInvalidRequiredItems: number;
  warnings: string[];
};

export type PlanGenerationDiagnostics = {
  source: "llm" | "deterministic";
  llmUsed: boolean;
  model?: string;
  timingMs: number;
  fallbackReason?: string;
  plannerNormalization?: PlannerNormalizationDiagnostics;
};

export type PlanGenerationResult = {
  deckPlan: DeckPlan;
  diagnostics: PlanGenerationDiagnostics;
};

const PLAN_GENERATION_ENABLED = (): boolean => process.env.PLAN_GENERATION_ENABLED !== "false";
const PLAN_LLM_ENABLED = (): boolean => process.env.PLAN_LLM_ENABLED === "true";
const PLAN_FAIL_ON_ERROR = (): boolean => process.env.PLAN_FAIL_ON_ERROR === "true";
const PLAN_TIMEOUT_MS = (): number => Number.parseInt(process.env.PLAN_TIMEOUT_MS || "30000", 10);
const PLAN_MAX_OUTPUT_TOKENS = (): number => Number.parseInt(process.env.PLAN_MAX_OUTPUT_TOKENS || "3000", 10);
const PLAN_MODEL = (): string => process.env.PLAN_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-chat";
const PLAN_API_KEY = (): string => process.env.PLAN_API_KEY || process.env.DEEPSEEK_API_KEY || "";
const PLAN_BASE_URL = (): string => process.env.PLAN_BASE_URL || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";

const fallback = (request: CreatePlanRequest, startedAt: number, reason: string): PlanGenerationResult => ({
  deckPlan: buildDeterministicDeckPlan(request),
  diagnostics: {
    source: "deterministic",
    llmUsed: false,
    model: PLAN_MODEL(),
    timingMs: Date.now() - startedAt,
    fallbackReason: reason,
  },
});

const buildPlannerPrompt = (request: CreatePlanRequest): string => {
  return [
    "Return ONLY JSON for a DeckPlan object. No markdown.",
    "DeckPlan is a scenario contract, not slide text and not UI copy.",
    "Required shape: version, topic, subject?, grade?, language, slideCount, presentationType, centralQuestion, thesis, audience?, slides[], globalRules[], source, createdAt.",
    "Each slide item: slide, role, titleIntent, claim, mustInclude[], mustAvoid[], requiredItems[], expectedEvidence[], relationToPrevious?, relationToNext?.",
    "Use roles: frame, route, problem_hook, context, evidence_mechanism, comparison, development_over_time, examples_as_evidence, check_understanding, conclusion.",
    "requiredItems item: {key?, kind, count, exact, description?}; kind MUST be one of: bullets, examples, questions, terms, steps, summary, route_items.",
    "Do NOT put map/image/diagram/table/chart into requiredItems. Put visual ideas into visualSuggestions: [{kind, description}] where kind is map, diagram, table, image, chart, timeline, or other.",
    "Make a coherent route: central question -> context -> evidence/mechanism -> examples -> understanding check -> conclusion.",
    "Avoid 10 independent overview slides, repeated thesis, fake claims, overclaims, and unsupported promises.",
    "Use readable claims suitable for showing to a teacher in an editor.",
    `topic: ${request.topic}`,
    `subject: ${request.subject || ""}`,
    `grade: ${request.grade || ""}`,
    `language: ${request.language || "ru"}`,
    `slideCount: ${request.slideCount || 10}`,
    `presentationType: ${request.presentationType || "auto"}`,
    `constraints: ${JSON.stringify(request.constraints || {})}`,
    "Return only a valid JSON object, no markdown, no code fences. source must be \"llm\". version must be 1. createdAt must be an ISO string.",
  ].join("\n");
};

const kindAliases: Record<string, string> = {
  bullet: "bullets",
  bullets: "bullets",
  question: "questions",
  questions: "questions",
  example: "examples",
  examples: "examples",
  term: "terms",
  terms: "terms",
  step: "steps",
  steps: "steps",
  timeline: "steps",
  conclusion: "summary",
  summary: "summary",
  route: "route_items",
  route_item: "route_items",
  route_items: "route_items",
};

const visualKinds = new Set(["map", "diagram", "table", "image", "chart"]);
const validVisualKinds = new Set(["map", "diagram", "table", "image", "chart", "timeline", "other"]);

const compactError = (error: unknown): string => {
  if (error && typeof error === "object" && "issues" in error && Array.isArray((error as { issues?: unknown[] }).issues)) {
    return (error as { issues: Array<{ path?: unknown[]; message?: string }> }).issues
      .slice(0, 5)
      .map((issue) => `${(issue.path || []).join(".") || "root"}: ${issue.message || "validation error"}`)
      .join("; ");
  }
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
};

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});

const normalizeVisualKind = (kind: string): "map" | "diagram" | "table" | "image" | "chart" | "timeline" | "other" => {
  const normalized = kind.toLowerCase().trim();
  return validVisualKinds.has(normalized) ? normalized as "map" | "diagram" | "table" | "image" | "chart" | "timeline" | "other" : "other";
};

const trimForSchema = (value: string, maxLength: number): string => value.trim().slice(0, maxLength);

const shouldTreatTimelineAsVisual = (item: Record<string, unknown>): boolean => {
  const text = [item.description, item.key, item.label, item.title]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  return /visual|map|image|diagram|table|chart|визуал|схем|таблиц|карт|изображ/.test(text);
};

export const normalizeLlmDeckPlanCandidate = (raw: unknown, request: CreatePlanRequest): { deckPlan: DeckPlan; normalization: PlannerNormalizationDiagnostics } => {
  const candidate = raw && typeof raw === "object" && "deckPlan" in raw
    ? (raw as { deckPlan?: unknown }).deckPlan
    : raw;
  const record = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : {};
  const normalization: PlannerNormalizationDiagnostics = {
    applied: false,
    normalizedKindAliases: 0,
    movedVisualSuggestions: 0,
    droppedInvalidRequiredItems: 0,
    warnings: [],
  };

  const withDefaults: Record<string, unknown> = {
    ...record,
    version: 1,
    topic: typeof record.topic === "string" && record.topic.trim() ? record.topic : request.topic,
    subject: typeof record.subject === "string" ? record.subject : request.subject,
    grade: typeof record.grade === "string" ? record.grade : request.grade,
    language: typeof record.language === "string" ? record.language : request.language || "ru",
    slideCount: typeof record.slideCount === "number" ? record.slideCount : request.slideCount || 10,
    presentationType: typeof record.presentationType === "string" ? record.presentationType : request.presentationType || "auto",
    source: "llm",
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString(),
  };

  const slides = Array.isArray(withDefaults.slides) ? withDefaults.slides : [];
  withDefaults.slides = slides.map((slideRaw: unknown, slideIndex: number) => {
    const slide = { ...asRecord(slideRaw) };
    const visualSuggestions: unknown[] = [];
    const rawVisualSuggestions = Array.isArray(slide.visualSuggestions) ? slide.visualSuggestions : [];
    for (const suggestionRaw of rawVisualSuggestions) {
      const suggestion = asRecord(suggestionRaw);
      const rawKind = typeof suggestion.kind === "string" ? suggestion.kind.trim().toLowerCase() : "";
      const slideNo = typeof slide.slide === "number" ? slide.slide : slideIndex + 1;
      if (!rawKind) {
        normalization.warnings.push(`slide ${slideNo}: dropped visualSuggestion without kind`);
        continue;
      }
      const kind = normalizeVisualKind(rawKind);
      if (kind !== rawKind) {
        normalization.warnings.push(`slide ${slideNo}: normalized visualSuggestion kind ${rawKind} -> ${kind}`);
      }
      visualSuggestions.push({
        kind,
        description: typeof suggestion.description === "string" && suggestion.description.trim()
          ? trimForSchema(suggestion.description, 240)
          : `Suggested ${kind} for slide ${slideNo}`,
      });
    }
    const requiredItems = Array.isArray(slide.requiredItems) ? slide.requiredItems : [];
    const nextRequiredItems: unknown[] = [];

    for (const itemRaw of requiredItems) {
      const item = { ...asRecord(itemRaw) };
      const rawKind = typeof item.kind === "string" ? item.kind.trim().toLowerCase() : "";
      const slideNo = typeof slide.slide === "number" ? slide.slide : slideIndex + 1;
      if (!rawKind) {
        normalization.droppedInvalidRequiredItems += 1;
        normalization.warnings.push(`slide ${slideNo}: dropped requiredItem without kind`);
        continue;
      }

      if (visualKinds.has(rawKind) || (rawKind === "timeline" && shouldTreatTimelineAsVisual(item))) {
        visualSuggestions.push({
          kind: normalizeVisualKind(rawKind),
          description: typeof item.description === "string" && item.description.trim()
            ? trimForSchema(item.description, 240)
            : `Suggested ${rawKind} for slide ${slideNo}`,
        });
        normalization.movedVisualSuggestions += 1;
        normalization.warnings.push(`slide ${slideNo}: moved requiredItem kind=${rawKind} to visualSuggestions`);
        continue;
      }

      const normalizedKind = kindAliases[rawKind];
      if (!normalizedKind) {
        normalization.droppedInvalidRequiredItems += 1;
        normalization.warnings.push(`slide ${slideNo}: dropped unsupported requiredItem kind=${rawKind}`);
        continue;
      }

      if (normalizedKind !== rawKind) {
        normalization.normalizedKindAliases += 1;
        normalization.warnings.push(`slide ${slideNo}: normalized requiredItem kind ${rawKind} -> ${normalizedKind}`);
      }
      nextRequiredItems.push({ ...item, kind: normalizedKind });
    }

    return {
      ...slide,
      requiredItems: nextRequiredItems,
      visualSuggestions,
    };
  });

  normalization.applied = normalization.normalizedKindAliases > 0
    || normalization.movedVisualSuggestions > 0
    || normalization.droppedInvalidRequiredItems > 0
    || normalization.warnings.length > 0;
  normalization.warnings = normalization.warnings.slice(0, 10);

  return {
    deckPlan: deckPlanSchema.parse(withDefaults),
    normalization,
  };
};

export const generateDeckPlan = async (input: unknown): Promise<PlanGenerationResult> => {
  const startedAt = Date.now();
  const request = createPlanRequestSchema.parse(input);

  if (!PLAN_GENERATION_ENABLED()) {
    return fallback(request, startedAt, "PLAN_GENERATION_ENABLED=false");
  }
  if (!PLAN_LLM_ENABLED()) {
    return fallback(request, startedAt, "PLAN_LLM_ENABLED!=true");
  }
  if (!PLAN_API_KEY()) {
    return fallback(request, startedAt, "planner api key missing");
  }

  try {
    const client = new OpenAI({
      apiKey: PLAN_API_KEY(),
      baseURL: PLAN_BASE_URL(),
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`PlanTimeout: ${PLAN_TIMEOUT_MS()}`)), PLAN_TIMEOUT_MS());
    try {
      const response = await client.chat.completions.create({
        model: PLAN_MODEL(),
        temperature: 0.35,
        max_tokens: PLAN_MAX_OUTPUT_TOKENS(),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You create concise DeckPlan JSON for educational presentations." },
          { role: "user", content: buildPlannerPrompt(request) },
        ],
      }, { signal: controller.signal });

      const content = response.choices?.[0]?.message?.content || "";
      const parsed = parseDeepseekJson(typeof content === "string" ? content : "");
      if (!parsed.parsed) {
        throw new Error(parsed.parseError || "PlanInvalidJSON");
      }

      const normalized = normalizeLlmDeckPlanCandidate(parsed.parsed, request);
      return {
        deckPlan: normalized.deckPlan,
        diagnostics: {
          source: "llm",
          llmUsed: true,
          model: PLAN_MODEL(),
          timingMs: Date.now() - startedAt,
          plannerNormalization: normalized.normalization,
        },
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    if (PLAN_FAIL_ON_ERROR()) {
      throw error instanceof Error ? error : new Error(String(error));
    }
    return fallback(request, startedAt, compactError(error));
  }
};
