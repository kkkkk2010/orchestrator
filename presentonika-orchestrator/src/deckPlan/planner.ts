import OpenAI from "openai";
import { parseDeepseekJson } from "../llm/parseDeepseekJson";
import { buildDeterministicDeckPlan } from "./buildDeckPlan";
import {
  createPlanRequestSchema,
  deckPlanPresentationTypeSchema,
  deckPlanSchema,
  normalizeDeckPlanSlideType,
  type CreatePlanRequest,
  type DeckPlan,
  type DeckPlanPresentationType,
  type DeckPlanRequiredItem,
  type DeckPlanSlideType,
} from "./schema";
import {
  getSlideTypeContract,
  isAllowedSlotForSlideType,
  isCountableSlotForSlideType,
  nonCountedDeckPlanSlots,
  normalizeDeckPlanSlot,
  slotContractsPromptText,
} from "./slideTypeContracts";
import {
  fallbackMustIncludeForSlide,
  sanitizeUserFacingArray,
  sanitizeUserFacingText,
  type UserFacingCleanupWarning,
} from "./userFacingCleanup";

export type PlannerNormalizationDiagnostics = {
  applied: boolean;
  normalizedKindAliases: number;
  movedVisualSuggestions: number;
  droppedInvalidRequiredItems: number;
  normalizedRequiredItems: number;
  droppedNonContentRequiredItems: number;
  remappedRequiredItems: number;
  slotContractWarnings: string[];
  normalizedNullOptionals: number;
  normalizedSlideTypes: number;
  normalizedSlideRoles: number;
  filledMustIncludeFallbacks: number;
  languageScriptMismatches: number;
  warnings: string[];
};

export type PlanDiagnosticWarning = {
  code: string;
  severity: "info" | "warn";
  slide?: number;
  message: string;
  sample?: string;
};

export type PlanGenerationDiagnostics = {
  source: "llm" | "deterministic";
  llmUsed: boolean;
  model?: string;
  timingMs: number;
  fallbackReason?: string;
  plannerNormalization?: PlannerNormalizationDiagnostics;
  planDiagnostics?: {
    warnings: PlanDiagnosticWarning[];
  };
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

const fallback = (request: CreatePlanRequest, startedAt: number, reason: string): PlanGenerationResult => {
  const deckPlan = buildDeterministicDeckPlan(request);
  return {
    deckPlan,
    diagnostics: {
      source: "deterministic",
      llmUsed: false,
      model: PLAN_MODEL(),
      timingMs: Date.now() - startedAt,
      fallbackReason: reason,
      planDiagnostics: evaluateDeckPlanSequence(deckPlan),
    },
  };
};

export const buildPlannerPrompt = (request: CreatePlanRequest): string => {
  return [
    "Return ONLY JSON for a DeckPlan object. No markdown.",
    "DeckPlan is a scenario contract, not slide text and not UI copy.",
    "Required shape: version, topic, subject?, grade?, language, slideCount, presentationType, centralQuestion, thesis, audience?, slides[], globalRules[], source.",
    "Each slide item: slide, slideType, role, titleIntent, claim, mustInclude[], mustAvoid[], requiredItems[], expectedEvidence[], visualSuggestions[], relationToPrevious?, relationToNext?.",
    "slideType MUST be one of: cover, goals, hook, context, definition, bullets, comparison, twoCol, steps, timeline, examples, quiz, summary, visual_explanation.",
    "presentationType must be concrete. If request presentationType=auto, infer one of: historical_overview, overview, lesson, causes_consequences, biography_contribution, literary_analysis, law_formula, process, comparison.",
    "Create a dynamic sequence for the topic. Do not force examples to slide 8 or quiz to slide 9; choose the order that best serves the lesson.",
    "Start with cover/frame, put goals/route near the beginning, and make summary/conclusion the final slide; include quiz/check near the end only when useful or requested.",
    "Use exactly one summary/conclusion slide. If homework or sources need a separate slide, use slideType=bullets with role=application and place it before the final summary.",
    "Pedagogical sequence: context before mechanism, examples after context/mechanisms, quiz after core content, summary strictly at the end. Timeline should not appear after quiz unless it is a recap timeline.",
    "Do not use null anywhere. If an optional value such as relationToPrevious/relationToNext is absent, omit the field.",
    "Omit createdAt. The server sets createdAt.",
    "titleIntent and claim must always be non-empty strings.",
    "mustInclude should usually contain 2-4 concrete teacher-readable items per slide.",
    "mustAvoid should usually contain 1-3 useful constraints per slide.",
    "Use roles: frame, route, problem_hook, context, evidence_mechanism, comparison, development_over_time, examples_as_evidence, check_understanding, conclusion.",
    "requiredItems item: {slot?, key?, kind, count, exact, description?}; requiredItems are only for countable content slots.",
    "requiredItems.kind MUST be one of: bullets, examples, questions, terms, steps, summary, route_items.",
    "Do NOT create requiredItems for title/subtitle/meta/sources/homework/task.",
    "Do NOT put bullets/questions/examples into title.",
    "Use these slideType slot contracts exactly:\n" + slotContractsPromptText(),
    "Do NOT put map/image/diagram/table/chart into requiredItems. Put visual ideas into visualSuggestions: [{kind, description}] where kind is map, diagram, table, image, chart, timeline, or other.",
    "Make a coherent route: central question -> context -> evidence/mechanism -> examples -> understanding check -> conclusion.",
    "Avoid 10 independent overview slides, repeated thesis, fake claims, overclaims, and unsupported promises.",
    "Use readable claims suitable for showing to a teacher in an editor.",
    "For history/state topics use precise academic wording: 'анатолийский бейлик' instead of 'кочевое племя' when relevant; 'система управления религиозными общинами' instead of simplistic 'религиозная терпимость'; prefer 'сыграла важную роль' over absolute claims.",
    "For Russian history plans avoid presenting 'религиозная терпимость' as an absolute. Prefer nuanced wording such as 'система управления религиозными общинами', 'относительная автономия общин', or 'миллетная система' when relevant.",
    `topic: ${request.topic}`,
    `subject: ${request.subject || ""}`,
    `grade: ${request.grade || ""}`,
    `language: ${request.language || "ru"}`,
    `slideCount: ${request.slideCount || 10}`,
    `presentationType: ${request.presentationType || "auto"}`,
    `constraints: ${JSON.stringify(request.constraints || {})}`,
    "Return only a valid JSON object, no markdown, no code fences. source must be \"llm\". version must be 1. Do not include technical diagnostics in user-facing fields.",
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
const presentationTypeValues = new Set<string>(deckPlanPresentationTypeSchema.options);

const inferPresentationType = (request: CreatePlanRequest): DeckPlanPresentationType => {
  const context = `${request.topic} ${request.subject || ""} ${request.presentationType || ""}`.toLowerCase();
  if (request.presentationType && request.presentationType !== "auto") return request.presentationType;
  if (/literature|литератур|поэт|писател|роман|поэма|пушкин/.test(context)) return "literary_analysis";
  if (/history|истор|импер|государств|войн|революц|осман/.test(context)) return "historical_overview";
  if (/law|право|закон|формул/.test(context)) return "law_formula";
  if (/process|процесс|биолог|физик|хими|science|наук/.test(context)) return "process";
  if (/сравн|compare|comparison/.test(context)) return "comparison";
  if (/биограф|person|личност|деятель/.test(context)) return "biography_contribution";
  return "lesson";
};

export const evaluateDeckPlanSequence = (deckPlan: DeckPlan): { warnings: PlanDiagnosticWarning[] } => {
  const warnings: PlanDiagnosticWarning[] = [];
  const slides = [...deckPlan.slides].sort((a, b) => a.slide - b.slide);
  const routeSlide = slides.find((slide) => slide.slideType === "goals");
  const summarySlides = slides.filter((slide) => slide.slideType === "summary" && slide.role !== "homework_sources");
  const firstQuiz = slides.find((slide) => slide.slideType === "quiz");
  const firstQuizIndex = firstQuiz ? slides.findIndex((slide) => slide.slide === firstQuiz.slide) : -1;
  const coreTypes = new Set<DeckPlanSlideType>(["context", "definition", "bullets", "comparison", "twoCol", "steps", "timeline", "examples", "visual_explanation"]);

  if (!routeSlide) {
    warnings.push({ code: "missing_route_slide", severity: "warn", message: "DeckPlan has no goals/route slide." });
  }
  if (summarySlides.length === 0) {
    warnings.push({ code: "missing_summary_slide", severity: "warn", message: "DeckPlan has no summary/conclusion slide." });
  } else {
    const lastSummary = summarySlides[summarySlides.length - 1];
    if (lastSummary.slide !== deckPlan.slideCount) {
      warnings.push({ code: "summary_not_last", severity: "warn", slide: lastSummary.slide, message: "Summary/conclusion must be the final slide in the plan." });
    }
  }
  if (firstQuiz && firstQuizIndex >= 0) {
    const laterCore = slides.slice(firstQuizIndex + 1).find((slide) => coreTypes.has(slide.slideType));
    if (laterCore) {
      warnings.push({ code: "quiz_before_core_content", severity: "warn", slide: firstQuiz.slide, message: "Quiz appears before later core content slides.", sample: `later core slide ${laterCore.slide} ${laterCore.slideType}` });
    }
    const laterTimeline = slides.slice(firstQuizIndex + 1).find((slide) => slide.slideType === "timeline" || slide.slideType === "steps");
    if (laterTimeline) {
      warnings.push({ code: "timeline_after_quiz", severity: "warn", slide: laterTimeline.slide, message: "Timeline/steps appears after quiz; this should only happen for recap." });
    }
  }
  const slideTypeCounts = slides.reduce<Record<string, number>>((acc, slide) => {
    acc[slide.slideType] = (acc[slide.slideType] || 0) + 1;
    return acc;
  }, {});
  for (const [slideType, count] of Object.entries(slideTypeCounts)) {
    if (count > Math.max(3, Math.ceil(deckPlan.slideCount / 3)) && !["bullets"].includes(slideType)) {
      warnings.push({ code: "repeated_slide_type_too_often", severity: "info", message: `Slide type ${slideType} repeats ${count} times.` });
    }
  }
  for (const slide of slides) {
    if (slide.mustInclude.length === 0) {
      warnings.push({ code: "empty_must_include", severity: "warn", slide: slide.slide, message: "Slide has empty mustInclude; UI plan may be too vague." });
    }
  }
  if (deckPlan.presentationType === "auto") {
    warnings.push({ code: "auto_presentation_type_not_resolved", severity: "warn", message: "presentationType remained auto instead of a concrete route type." });
  }

  return { warnings };
};

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

const isBlankString = (value: unknown): value is string => typeof value === "string" && value.trim().length === 0;

const shouldTreatTimelineAsVisual = (item: Record<string, unknown>): boolean => {
  const text = [item.description, item.key, item.label, item.title]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  return /visual|map|image|diagram|table|chart|визуал|схем|таблиц|карт|изображ/.test(text);
};

const warnSlotContract = (normalization: PlannerNormalizationDiagnostics, warning: string): void => {
  normalization.slotContractWarnings.push(warning);
  normalization.warnings.push(warning);
};

const withRequiredItem = (item: DeckPlanRequiredItem, overrides: Partial<DeckPlanRequiredItem>): DeckPlanRequiredItem => ({
  ...item,
  ...overrides,
});

const normalizeRequiredItemsByContract = (params: {
  slideType: DeckPlanSlideType;
  slideNo: number;
  items: DeckPlanRequiredItem[];
  normalization: PlannerNormalizationDiagnostics;
}): DeckPlanRequiredItem[] => {
  const { slideType, slideNo, items, normalization } = params;
  const contract = getSlideTypeContract(slideType);
  const out: DeckPlanRequiredItem[] = [];

  const pushItem = (item: DeckPlanRequiredItem, reason?: string): void => {
    const slot = normalizeDeckPlanSlot(item.slot);
    if (!slot || !isAllowedSlotForSlideType(slideType, slot)) {
      normalization.droppedInvalidRequiredItems += 1;
      warnSlotContract(normalization, `slide ${slideNo}: dropped requiredItem with unsupported slot=${slot || "missing"} for ${slideType}`);
      return;
    }
    if (!isCountableSlotForSlideType(slideType, slot)) {
      normalization.droppedNonContentRequiredItems += 1;
      warnSlotContract(normalization, `slide ${slideNo}: ignored non-countable requiredItem slot=${slot} for ${slideType}`);
      return;
    }
    const normalizedItem = { ...item, slot };
    out.push(normalizedItem);
    if (reason) {
      normalization.remappedRequiredItems += 1;
      normalization.normalizedRequiredItems += 1;
      warnSlotContract(normalization, `slide ${slideNo}: ${reason}`);
    }
  };

  for (const item of items) {
    const slot = normalizeDeckPlanSlot(item.slot);
    const kind = item.kind;

    if (slideType === "cover") {
      normalization.droppedNonContentRequiredItems += 1;
      warnSlotContract(normalization, `slide ${slideNo}: dropped cover requiredItem; cover has no countable content slots`);
      continue;
    }

    if (slot && nonCountedDeckPlanSlots.has(slot)) {
      if (slideType === "hook" && kind === "questions") {
        pushItem(withRequiredItem(item, { slot: "hook_question", count: 1 }), `remapped ${slot}/${kind} -> hook_question/questions`);
        continue;
      }
      if ((slideType === "comparison" || slideType === "twoCol") && kind === "bullets") {
        pushItem(withRequiredItem(item, { slot: "left_bullets", count: 3, exact: true }), `remapped ${slot}/bullets -> left_bullets`);
        pushItem(withRequiredItem(item, { slot: "right_bullets", count: 3, exact: true }), `remapped ${slot}/bullets -> right_bullets`);
        continue;
      }
      normalization.droppedNonContentRequiredItems += 1;
      warnSlotContract(normalization, `slide ${slideNo}: dropped non-countable requiredItem slot=${slot} kind=${kind}`);
      continue;
    }

    if ((slideType === "context" || slideType === "definition") && slot === "bullets") {
      if (kind === "terms") {
        pushItem(withRequiredItem(item, { slot: "keywords" }), "remapped bullets/terms -> keywords/terms");
      } else {
        pushItem(withRequiredItem(item, { slot: "definition", kind: "summary", count: 1, exact: false }), "remapped bullets content -> definition/summary");
      }
      continue;
    }

    if ((slideType === "context" || slideType === "definition") && !slot) {
      if (kind === "terms") {
        pushItem(withRequiredItem(item, { slot: "keywords" }), "filled missing terms slot -> keywords");
      } else {
        pushItem(withRequiredItem(item, { slot: "definition", kind: "summary", count: Math.min(item.count, 1), exact: false }), "filled missing body slot -> definition");
      }
      continue;
    }

    if ((slideType === "comparison" || slideType === "twoCol") && (!slot || slot === "bullets")) {
      if (kind === "bullets" || kind === "route_items") {
        pushItem(withRequiredItem(item, { slot: "left_bullets", kind: "bullets", count: 3, exact: true }), "remapped comparison bullets -> left_bullets");
        pushItem(withRequiredItem(item, { slot: "right_bullets", kind: "bullets", count: 3, exact: true }), "remapped comparison bullets -> right_bullets");
        continue;
      }
    }

    if (slideType === "examples" && (!slot || slot !== "examples") && kind === "examples") {
      pushItem(withRequiredItem(item, { slot: "examples" }), `remapped ${slot || "missing"}/examples -> examples`);
      continue;
    }

    if (slideType === "quiz" && (!slot || slot === "title" || slot === "bullets") && kind === "questions") {
      pushItem(withRequiredItem(item, { slot: "questions" }), `remapped ${slot || "missing"}/questions -> questions`);
      continue;
    }

    if ((slideType === "steps" || slideType === "timeline") && (!slot || slot === "bullets") && kind === "steps") {
      pushItem(withRequiredItem(item, { slot: "steps" }), `remapped ${slot || "missing"}/steps -> steps`);
      continue;
    }

    if (slideType === "summary" && (!slot || slot === "bullets") && kind === "summary") {
      pushItem(withRequiredItem(item, { slot: "summary" }), `remapped ${slot || "missing"}/summary -> summary`);
      continue;
    }

    if (!slot) {
      const defaultSlot = contract.contentCountSlots[0];
      if (defaultSlot) {
        pushItem(withRequiredItem(item, { slot: defaultSlot }), `filled missing slot -> ${defaultSlot}`);
      } else {
        normalization.droppedNonContentRequiredItems += 1;
        warnSlotContract(normalization, `slide ${slideNo}: dropped requiredItem without content slot for ${slideType}`);
      }
      continue;
    }

    pushItem(item);
  }

  return out.slice(0, 8);
};

const normalizeSlideRoleForUi = (params: {
  slideType: DeckPlanSlideType;
  role: string;
  titleIntent: string;
  claim: string;
  slideNo: number;
  normalization: PlannerNormalizationDiagnostics;
}): string => {
  const canonicalRoles: Partial<Record<DeckPlanSlideType, string>> = {
    cover: "frame",
    goals: "route",
    hook: "problem_hook",
    context: "context",
    definition: "evidence_mechanism",
    bullets: "evidence_mechanism",
    comparison: "comparison",
    twoCol: "comparison",
    steps: "development_over_time",
    timeline: "development_over_time",
    examples: "examples_as_evidence",
    quiz: "check_understanding",
    visual_explanation: "evidence_mechanism",
  };
  const reservedRoles = new Set([
    "frame",
    "route",
    "problem_hook",
    "context",
    "evidence_mechanism",
    "comparison",
    "development_over_time",
    "examples_as_evidence",
    "check_understanding",
    "conclusion",
    "homework_sources",
  ]);
  if (params.slideType !== "summary") {
    const canonicalRole = canonicalRoles[params.slideType];
    if (canonicalRole && reservedRoles.has(params.role) && params.role !== canonicalRole) {
      params.normalization.normalizedSlideRoles += 1;
      params.normalization.warnings.unshift(`slide ${params.slideNo}: normalized incompatible ${params.role} role -> ${canonicalRole}`);
      return canonicalRole;
    }
    return params.role;
  }
  const text = `${params.role} ${params.titleIntent} ${params.claim}`.toLowerCase();
  if (/homework_sources|homework|sources|домаш|источник|дополнитель|закреп/.test(text) && !/homework_sources/.test(params.role)) {
    params.normalization.normalizedSlideRoles += 1;
    params.normalization.warnings.push(`slide ${params.slideNo}: normalized summary role -> homework_sources`);
    return "homework_sources";
  }
  return params.role;
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
    normalizedRequiredItems: 0,
    droppedNonContentRequiredItems: 0,
    remappedRequiredItems: 0,
    slotContractWarnings: [],
    normalizedNullOptionals: 0,
    normalizedSlideTypes: 0,
    normalizedSlideRoles: 0,
    filledMustIncludeFallbacks: 0,
    languageScriptMismatches: 0,
    warnings: [],
  };
  const cleanupWarnings: UserFacingCleanupWarning[] = [];

  const normalizeOptionalString = (value: unknown, path: string, maxLength: number): string | undefined => {
    if (value === null) {
      normalization.normalizedNullOptionals += 1;
      normalization.warnings.push(`${path}: removed null optional string`);
      return undefined;
    }
    if (isBlankString(value)) {
      normalization.warnings.push(`${path}: removed empty optional string`);
      return undefined;
    }
    return typeof value === "string" ? trimForSchema(value, maxLength) : undefined;
  };

  const normalizeRequiredString = (value: unknown, path: string, fallbackValue: string, maxLength: number): string => {
    if (value === null) {
      normalization.normalizedNullOptionals += 1;
      normalization.warnings.push(`${path}: replaced null string with fallback`);
      return fallbackValue;
    }
    if (isBlankString(value)) {
      normalization.warnings.push(`${path}: replaced empty string with fallback`);
      return fallbackValue;
    }
    return typeof value === "string" ? trimForSchema(value, maxLength) : fallbackValue;
  };

  const normalizeStringArray = (value: unknown, path: string): string[] => {
    if (value === null) {
      normalization.normalizedNullOptionals += 1;
      normalization.warnings.push(`${path}: replaced null array with []`);
      return [];
    }
    if (!Array.isArray(value)) return [];
    return value
      .flatMap((item, index) => {
        if (item === null) {
          normalization.normalizedNullOptionals += 1;
          normalization.warnings.push(`${path}.${index}: removed null string`);
          return [];
        }
        if (isBlankString(item)) return [];
        return typeof item === "string" ? [trimForSchema(item, 180)] : [];
      })
      .slice(0, 10);
  };

  const rawPresentationType = typeof record.presentationType === "string" ? record.presentationType : request.presentationType || "auto";
  const presentationType = presentationTypeValues.has(rawPresentationType)
    ? rawPresentationType
    : inferPresentationType(request);
  const resolvedPresentationType = presentationType === "auto" ? inferPresentationType(request) : presentationType;
  if (rawPresentationType !== resolvedPresentationType) {
    normalization.warnings.push(`presentationType: normalized ${rawPresentationType || "missing"} -> ${resolvedPresentationType}`);
  }
  if (typeof record.createdAt === "string") {
    normalization.warnings.push("createdAt: ignored LLM timestamp and used server timestamp");
  }

  const language = typeof record.language === "string" ? record.language : request.language || "ru";
  const topic = typeof record.topic === "string" && record.topic.trim() ? record.topic : request.topic;
  const centralQuestionFallback = language.toLowerCase().startsWith("ru")
    ? `Почему тема «${topic}» важна для понимания урока?`
    : `Why does "${topic}" matter for this lesson?`;
  const thesisFallback = language.toLowerCase().startsWith("ru")
    ? `${topic}: объяснить ключевые причины, механизмы и выводы через связный маршрут урока.`
    : `${topic}: explain the key causes, mechanisms, and conclusions through a coherent lesson route.`;

  const withDefaults: Record<string, unknown> = {
    ...record,
    version: 1,
    topic,
    subject: typeof record.subject === "string" ? record.subject : request.subject,
    grade: typeof record.grade === "string" ? record.grade : request.grade,
    language,
    slideCount: typeof record.slideCount === "number" ? record.slideCount : request.slideCount || 10,
    presentationType: resolvedPresentationType,
    centralQuestion: typeof record.centralQuestion === "string"
      ? sanitizeUserFacingText({
        value: trimForSchema(record.centralQuestion, 420),
        fallback: centralQuestionFallback,
        language,
        path: "centralQuestion",
        warnings: cleanupWarnings,
      })
      : record.centralQuestion,
    thesis: typeof record.thesis === "string"
      ? sanitizeUserFacingText({
        value: trimForSchema(record.thesis, 520),
        fallback: thesisFallback,
        language,
        path: "thesis",
        warnings: cleanupWarnings,
      })
      : record.thesis,
    source: "llm",
    createdAt: new Date().toISOString(),
  };
  withDefaults.audience = normalizeOptionalString(record.audience, "audience", 160);
  withDefaults.globalRules = sanitizeUserFacingArray({
    values: normalizeStringArray(record.globalRules, "globalRules"),
    fallbackValues: [],
    language,
    path: "globalRules",
    warnings: cleanupWarnings,
  });

  const slides = Array.isArray(withDefaults.slides) ? withDefaults.slides : [];
  const normalizedSlides = slides.map((slideRaw: unknown, slideIndex: number) => {
    const slide = { ...asRecord(slideRaw) };
    const slideNo = typeof slide.slide === "number" ? slide.slide : slideIndex + 1;
    const ru = String(withDefaults.language || "ru").toLowerCase().startsWith("ru");
    const titleIntentFallback = ru
      ? `Описать роль слайда ${slideNo} в сценарии урока.`
      : `Describe the role of slide ${slideNo} in the lesson plan.`;
    const claimFallback = ru
      ? `Продвинуть главный вопрос на слайде ${slideNo}.`
      : `Advance the central question on slide ${slideNo}.`;
    const slideTypeContext = [slide.role, slide.titleIntent, slide.claim].filter((part): part is string => typeof part === "string").join(" ");
    const normalizedSlideType = normalizeDeckPlanSlideType(slide.slideType, slideTypeContext) || "bullets";
    if (typeof slide.slideType !== "string" || slide.slideType !== normalizedSlideType) {
      normalization.normalizedSlideTypes += 1;
      normalization.warnings.push(`slide ${slideNo}: normalized slideType ${typeof slide.slideType === "string" ? slide.slideType : "missing"} -> ${normalizedSlideType}`);
    }
    const visualSuggestions: unknown[] = [];
    const rawVisualSuggestions = Array.isArray(slide.visualSuggestions) ? slide.visualSuggestions : [];
    for (const suggestionRaw of rawVisualSuggestions) {
      const suggestion = asRecord(suggestionRaw);
      const rawKind = typeof suggestion.kind === "string" ? suggestion.kind.trim().toLowerCase() : "";
      if (!rawKind) {
        normalization.warnings.push(`slide ${slideNo}: dropped visualSuggestion without kind`);
        continue;
      }
      const kind = normalizeVisualKind(rawKind);
      if (kind !== rawKind) {
        normalization.warnings.push(`slide ${slideNo}: normalized visualSuggestion kind ${rawKind} -> ${kind}`);
      }
      const descriptionFallback = ru ? `Визуальная подсказка ${kind} для слайда ${slideNo}` : `Suggested ${kind} for slide ${slideNo}`;
      visualSuggestions.push({
        kind,
        description: sanitizeUserFacingText({
          value: normalizeRequiredString(suggestion.description, `slides.${slideIndex}.visualSuggestions.description`, descriptionFallback, 240),
          fallback: descriptionFallback,
          language: String(withDefaults.language || "ru"),
          path: `slides.${slideIndex}.visualSuggestions.description`,
          slide: slideNo,
          warnings: cleanupWarnings,
        }),
      });
    }
    const requiredItems = Array.isArray(slide.requiredItems) ? slide.requiredItems : [];
    const nextRequiredItems: DeckPlanRequiredItem[] = [];

    for (const itemRaw of requiredItems) {
      const item = { ...asRecord(itemRaw) };
      const rawKind = typeof item.kind === "string" ? item.kind.trim().toLowerCase() : "";
      if (!rawKind) {
        normalization.droppedInvalidRequiredItems += 1;
        normalization.warnings.push(`slide ${slideNo}: dropped requiredItem without kind`);
        continue;
      }

      if (visualKinds.has(rawKind) || (rawKind === "timeline" && shouldTreatTimelineAsVisual(item))) {
        const descriptionFallback = ru ? `Визуальная подсказка ${rawKind} для слайда ${slideNo}` : `Suggested ${rawKind} for slide ${slideNo}`;
        visualSuggestions.push({
          kind: normalizeVisualKind(rawKind),
          description: sanitizeUserFacingText({
            value: normalizeRequiredString(item.description, `slides.${slideIndex}.requiredItems.description`, descriptionFallback, 240),
            fallback: descriptionFallback,
            language: String(withDefaults.language || "ru"),
            path: `slides.${slideIndex}.requiredItems.description`,
            slide: slideNo,
            warnings: cleanupWarnings,
          }),
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
      const normalizedItem = {
        ...item,
        kind: normalizedKind,
        key: normalizeOptionalString(item.key, `slides.${slideIndex}.requiredItems.key`, 120),
        slot: normalizeOptionalString(item.slot, `slides.${slideIndex}.requiredItems.slot`, 80),
        description: normalizeOptionalString(item.description, `slides.${slideIndex}.requiredItems.description`, 240),
        count: typeof item.count === "number" && Number.isFinite(item.count) ? Math.max(1, Math.min(12, Math.round(item.count))) : 1,
        exact: typeof item.exact === "boolean" ? item.exact : true,
      } as DeckPlanRequiredItem;
      nextRequiredItems.push(Object.fromEntries(Object.entries(normalizedItem).filter(([, value]) => value !== undefined)) as DeckPlanRequiredItem);
    }
    const contractRequiredItems = normalizeRequiredItemsByContract({
      slideType: normalizedSlideType,
      slideNo,
      items: nextRequiredItems,
      normalization,
    });
    const titleIntent = sanitizeUserFacingText({
      value: normalizeRequiredString(slide.titleIntent, `slides.${slideIndex}.titleIntent`, titleIntentFallback, 180),
      fallback: titleIntentFallback,
      language: String(withDefaults.language || "ru"),
      path: `slides.${slideIndex}.titleIntent`,
      slide: slideNo,
      warnings: cleanupWarnings,
    });
    const claim = sanitizeUserFacingText({
      value: normalizeRequiredString(slide.claim, `slides.${slideIndex}.claim`, claimFallback, 420),
      fallback: claimFallback,
      language: String(withDefaults.language || "ru"),
      path: `slides.${slideIndex}.claim`,
      slide: slideNo,
      warnings: cleanupWarnings,
    });
    const role = sanitizeUserFacingText({
      value: normalizeSlideRoleForUi({
        slideType: normalizedSlideType,
        role: normalizeRequiredString(slide.role, `slides.${slideIndex}.role`, "evidence_mechanism", 80),
        titleIntent,
        claim,
        slideNo,
        normalization,
      }),
      fallback: "evidence_mechanism",
      language: String(withDefaults.language || "ru"),
      path: `slides.${slideIndex}.role`,
      slide: slideNo,
      warnings: cleanupWarnings,
    });

    const slideForFallback = {
      ...slide,
      slide: slideNo,
      slideType: normalizedSlideType,
      role,
      titleIntent,
      claim,
      mustInclude: [],
      mustAvoid: [],
      expectedEvidence: [],
      requiredItems: contractRequiredItems,
      visualSuggestions,
    } as DeckPlan["slides"][number];
    const normalizedMustInclude = normalizeStringArray(slide.mustInclude, `slides.${slideIndex}.mustInclude`);
    if (normalizedMustInclude.length === 0) {
      normalization.filledMustIncludeFallbacks += 1;
      normalization.warnings.push(`slide ${slideNo}: filled empty mustInclude with deterministic UI fallback`);
    }

    const normalizedSlide = {
      ...slide,
      slide: slideNo,
      slideType: normalizedSlideType,
      role,
      titleIntent,
      claim,
      mustInclude: sanitizeUserFacingArray({
        values: normalizedMustInclude,
        fallbackValues: fallbackMustIncludeForSlide(slideForFallback, String(withDefaults.language || "ru")),
        language: String(withDefaults.language || "ru"),
        path: `slides.${slideIndex}.mustInclude`,
        slide: slideNo,
        warnings: cleanupWarnings,
        maxItems: 4,
      }),
      mustAvoid: sanitizeUserFacingArray({
        values: normalizeStringArray(slide.mustAvoid, `slides.${slideIndex}.mustAvoid`),
        fallbackValues: [],
        language: String(withDefaults.language || "ru"),
        path: `slides.${slideIndex}.mustAvoid`,
        slide: slideNo,
        warnings: cleanupWarnings,
      }),
      expectedEvidence: sanitizeUserFacingArray({
        values: normalizeStringArray(slide.expectedEvidence, `slides.${slideIndex}.expectedEvidence`),
        fallbackValues: [],
        language: String(withDefaults.language || "ru"),
        path: `slides.${slideIndex}.expectedEvidence`,
        slide: slideNo,
        warnings: cleanupWarnings,
      }),
      requiredItems: contractRequiredItems,
      visualSuggestions,
      relationToPrevious: normalizeOptionalString(slide.relationToPrevious, `slides.${slideIndex}.relationToPrevious`, 240),
      relationToNext: normalizeOptionalString(slide.relationToNext, `slides.${slideIndex}.relationToNext`, 240),
    };
    return Object.fromEntries(Object.entries(normalizedSlide).filter(([, value]) => value !== undefined));
  });

  for (const warning of cleanupWarnings) {
    if (warning.code === "language_script_mismatch") {
      normalization.languageScriptMismatches += 1;
    }
    normalization.warnings.push(`${warning.slide ? `slide ${warning.slide}: ` : ""}${warning.code}: ${warning.sample || warning.message}`);
  }

  const typedSlides = normalizedSlides as DeckPlan["slides"];
  const conclusionSummaryIndexes = typedSlides
    .map((slide, index) => slide.slideType === "summary" && slide.role !== "homework_sources" ? index : -1)
    .filter((index) => index >= 0);
  const homeworkSummaryIndexes = typedSlides
    .map((slide, index) => slide.slideType === "summary" && slide.role === "homework_sources" ? index : -1)
    .filter((index) => index >= 0);

  if (conclusionSummaryIndexes.length > 0 && homeworkSummaryIndexes.length > 0) {
    for (const index of homeworkSummaryIndexes) {
      const slide = typedSlides[index];
      const itemCount = Math.max(2, Math.min(4, slide.mustInclude.length || 3));
      slide.slideType = "bullets";
      slide.role = "application";
      slide.requiredItems = [{
        slot: "bullets",
        kind: "bullets",
        count: itemCount,
        exact: true,
        description: String(withDefaults.language || "ru").toLowerCase().startsWith("ru")
          ? "практические задания или источники для закрепления"
          : "practical follow-up tasks or sources",
      }];
      normalization.normalizedSlideTypes += 1;
      normalization.normalizedSlideRoles += 1;
      normalization.warnings.unshift(`slide ${slide.slide}: normalized standalone homework summary -> bullets/application`);
    }
  }

  let finalSummaryIndex = -1;
  for (let index = typedSlides.length - 1; index >= 0; index -= 1) {
    if (typedSlides[index].slideType === "summary" && typedSlides[index].role !== "homework_sources") {
      finalSummaryIndex = index;
      break;
    }
  }
  if (finalSummaryIndex < 0) {
    for (let index = typedSlides.length - 1; index >= 0; index -= 1) {
      if (typedSlides[index].slideType === "summary") {
        finalSummaryIndex = index;
        break;
      }
    }
  }
  if (finalSummaryIndex >= 0 && finalSummaryIndex !== typedSlides.length - 1) {
    const [summarySlide] = typedSlides.splice(finalSummaryIndex, 1);
    typedSlides.push(summarySlide);
    typedSlides.forEach((slide, index) => { slide.slide = index + 1; });
    normalization.warnings.unshift(`slides: moved summary from ${finalSummaryIndex + 1} to final position`);
  }
  withDefaults.slides = typedSlides;

  normalization.applied = normalization.normalizedKindAliases > 0
    || normalization.movedVisualSuggestions > 0
    || normalization.droppedInvalidRequiredItems > 0
    || normalization.normalizedRequiredItems > 0
    || normalization.droppedNonContentRequiredItems > 0
    || normalization.remappedRequiredItems > 0
    || normalization.normalizedNullOptionals > 0
    || normalization.normalizedSlideTypes > 0
    || normalization.normalizedSlideRoles > 0
    || normalization.filledMustIncludeFallbacks > 0
    || normalization.languageScriptMismatches > 0
    || normalization.warnings.length > 0;
  normalization.slotContractWarnings = normalization.slotContractWarnings.slice(0, 20);
  normalization.warnings = normalization.warnings.slice(0, 20);

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
      const planDiagnostics = evaluateDeckPlanSequence(normalized.deckPlan);
      return {
        deckPlan: normalized.deckPlan,
        diagnostics: {
          source: "llm",
          llmUsed: true,
          model: PLAN_MODEL(),
          timingMs: Date.now() - startedAt,
          plannerNormalization: normalized.normalization,
          planDiagnostics,
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
