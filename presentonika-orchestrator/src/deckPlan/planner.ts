import OpenAI from "openai";
import { parseDeepseekJson } from "../llm/parseDeepseekJson";
import { buildDeterministicDeckPlan } from "./buildDeckPlan";
import { createPlanRequestSchema, deckPlanSchema, type CreatePlanRequest, type DeckPlan } from "./schema";

export type PlanGenerationDiagnostics = {
  source: "llm" | "deterministic";
  llmUsed: boolean;
  model?: string;
  timingMs: number;
  fallbackReason?: string;
};

export type PlanGenerationResult = {
  deckPlan: DeckPlan;
  diagnostics: PlanGenerationDiagnostics;
};

const PLAN_GENERATION_ENABLED = (): boolean => process.env.PLAN_GENERATION_ENABLED !== "false";
const PLAN_LLM_ENABLED = (): boolean => process.env.PLAN_LLM_ENABLED === "true";
const PLAN_FAIL_ON_ERROR = (): boolean => process.env.PLAN_FAIL_ON_ERROR === "true";
const PLAN_TIMEOUT_MS = (): number => Number.parseInt(process.env.PLAN_TIMEOUT_MS || "30000", 10);
const PLAN_MAX_OUTPUT_TOKENS = (): number => Number.parseInt(process.env.PLAN_MAX_OUTPUT_TOKENS || "1200", 10);
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
    "requiredItems item: {key?, kind, count, exact, description?}; use exact counts for examples/bullets/questions where useful.",
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
    "source must be \"llm\". version must be 1. createdAt must be an ISO string.",
  ].join("\n");
};

const normalizeLlmPlan = (raw: unknown, request: CreatePlanRequest): DeckPlan => {
  const candidate = raw && typeof raw === "object" && "deckPlan" in raw
    ? (raw as { deckPlan?: unknown }).deckPlan
    : raw;
  const record = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : {};
  const withDefaults = {
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
  return deckPlanSchema.parse(withDefaults);
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

      return {
        deckPlan: normalizeLlmPlan(parsed.parsed, request),
        diagnostics: {
          source: "llm",
          llmUsed: true,
          model: PLAN_MODEL(),
          timingMs: Date.now() - startedAt,
        },
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    if (PLAN_FAIL_ON_ERROR()) {
      throw error instanceof Error ? error : new Error(String(error));
    }
    return fallback(request, startedAt, error instanceof Error ? error.message : String(error));
  }
};
