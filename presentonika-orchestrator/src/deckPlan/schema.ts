import { z } from "zod";

export const deckPlanPresentationTypeSchema = z.enum([
  "auto",
  "historical_overview",
  "overview",
  "lesson",
  "causes_consequences",
  "biography_contribution",
  "literary_analysis",
  "law_formula",
  "process",
  "comparison",
]);

export const deckPlanSourceSchema = z.enum(["llm", "deterministic", "user_edited"]);

export const deckPlanSlideTypeSchema = z.enum([
  "cover",
  "goals",
  "hook",
  "context",
  "definition",
  "bullets",
  "comparison",
  "twoCol",
  "steps",
  "timeline",
  "examples",
  "quiz",
  "summary",
  "visual_explanation",
]);

export const deckPlanSlideRoleSchema = z.string().min(1).max(80);

const canonicalSlideTypeAliases: Record<string, z.infer<typeof deckPlanSlideTypeSchema>> = {
  cover: "cover",
  frame: "cover",
  title: "cover",
  goals: "goals",
  goal: "goals",
  route: "goals",
  plan: "goals",
  hook: "hook",
  problem_hook: "hook",
  problem: "hook",
  context: "context",
  definition: "definition",
  terms: "definition",
  evidence_mechanism: "bullets",
  mechanism: "bullets",
  mechanisms: "bullets",
  bullets: "bullets",
  facts: "bullets",
  visual_explanation: "visual_explanation",
  visual: "visual_explanation",
  comparison: "comparison",
  compare: "comparison",
  twocol: "twoCol",
  two_col: "twoCol",
  two_column: "twoCol",
  "two-column": "twoCol",
  steps: "steps",
  step: "steps",
  development_over_time: "timeline",
  timeline: "timeline",
  chronology: "timeline",
  examples_as_evidence: "examples",
  examples: "examples",
  example: "examples",
  quiz: "quiz",
  questions: "quiz",
  check_understanding: "quiz",
  reflection: "summary",
  conclusion: "summary",
  summary: "summary",
  homework: "summary",
};

export const normalizeDeckPlanSlideType = (value: unknown, fallbackContext?: unknown): z.infer<typeof deckPlanSlideTypeSchema> | undefined => {
  const direct = typeof value === "string" ? value.trim() : "";
  const normalized = direct.replace(/[\s-]+/g, "_").toLowerCase();
  if (normalized && canonicalSlideTypeAliases[normalized]) return canonicalSlideTypeAliases[normalized];
  if (direct === "twoCol") return "twoCol";

  const context = typeof fallbackContext === "string" ? fallbackContext.toLowerCase() : "";
  if (/quiz|question|проверк|вопрос/.test(context)) return "quiz";
  if (/example|пример/.test(context)) return "examples";
  if (/timeline|chronolog|этап|последователь|хронолог/.test(context)) return "timeline";
  if (/compare|comparison|сравн/.test(context)) return "comparison";
  if (/goal|route|plan|цель|маршрут|план/.test(context)) return "goals";
  if (/hook|problem|парадокс|проблем|интриг/.test(context)) return "hook";
  if (/summary|conclusion|итог|вывод|домаш/.test(context)) return "summary";
  if (/context|definition|контекст|определ|термин/.test(context)) return "context";
  if (/visual|image|diagram|map|схем|карт|изображ/.test(context)) return "visual_explanation";
  return undefined;
};

export const deckPlanRequiredItemSchema = z.object({
  key: z.string().min(1).optional(),
  slot: z.string().min(1).max(80).optional(),
  kind: z.enum(["bullets", "examples", "questions", "terms", "steps", "summary", "route_items"]),
  count: z.number().int().min(1).max(12),
  exact: z.boolean().default(true),
  description: z.string().max(240).optional(),
});

export const deckPlanVisualSuggestionSchema = z.object({
  kind: z.enum(["map", "diagram", "table", "image", "chart", "timeline", "other"]),
  description: z.string().min(1).max(240),
});

const requiredItemsSchema = z.preprocess((value) => value ?? [], z.array(deckPlanRequiredItemSchema).max(8));

export const deckPlanSlideSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const row = value as Record<string, unknown>;
  const requiredItems = Array.isArray(row.requiredItems) ? row.requiredItems : [];
  const requiredText = requiredItems.map((item) => {
    if (!item || typeof item !== "object") return "";
    const record = item as Record<string, unknown>;
    return [record.slot, record.kind, record.key, record.description].filter((part): part is string => typeof part === "string").join(" ");
  }).join(" ");
  const fallbackText = [row.role, row.titleIntent, row.claim, requiredText].filter((part): part is string => typeof part === "string").join(" ");
  const slideType = normalizeDeckPlanSlideType(row.slideType, fallbackText) || "bullets";
  return { ...row, slideType };
}, z.object({
  slide: z.number().int().min(1).max(50),
  slideType: deckPlanSlideTypeSchema,
  role: deckPlanSlideRoleSchema,
  titleIntent: z.string().min(1).max(180),
  claim: z.string().min(1).max(420),
  mustInclude: z.array(z.string().min(1).max(180)).max(10).default([]),
  mustAvoid: z.array(z.string().min(1).max(180)).max(10).default([]),
  requiredItems: requiredItemsSchema,
  expectedEvidence: z.array(z.string().min(1).max(180)).max(10).default([]),
  visualSuggestions: z.array(deckPlanVisualSuggestionSchema).max(8).default([]),
  relationToPrevious: z.string().max(240).optional(),
  relationToNext: z.string().max(240).optional(),
}));

export const deckPlanSchema = z.object({
  version: z.literal(1),
  topic: z.string().min(1).max(240),
  subject: z.string().max(80).optional(),
  grade: z.string().max(40).optional(),
  language: z.string().min(2).max(12).default("ru"),
  slideCount: z.number().int().min(1).max(50).default(10),
  presentationType: deckPlanPresentationTypeSchema.default("auto"),
  centralQuestion: z.string().min(1).max(420),
  thesis: z.string().min(1).max(520),
  audience: z.string().max(160).optional(),
  slides: z.array(deckPlanSlideSchema).min(1).max(50),
  globalRules: z.array(z.string().min(1).max(240)).max(20).default([]),
  source: deckPlanSourceSchema,
  createdAt: z.string().datetime(),
}).superRefine((plan, ctx) => {
  if (plan.slides.length !== plan.slideCount) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["slides"],
      message: `slides length ${plan.slides.length} must match slideCount ${plan.slideCount}`,
    });
  }

  const seen = new Set<number>();
  for (const slide of plan.slides) {
    if (seen.has(slide.slide)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slides"],
        message: `duplicate slide ${slide.slide}`,
      });
    }
    seen.add(slide.slide);
  }
});

export const createPlanRequestSchema = z.object({
  topic: z.string().min(1).max(240),
  subject: z.string().max(80).optional(),
  grade: z.string().max(40).optional(),
  language: z.string().min(2).max(12).default("ru"),
  slideCount: z.number().int().min(1).max(20).default(10),
  presentationType: deckPlanPresentationTypeSchema.default("auto"),
  themeId: z.string().max(120).optional(),
  constraints: z
    .object({
      depth: z.string().max(80).optional(),
      tone: z.string().max(80).optional(),
      includeQuiz: z.boolean().optional(),
      includeHomework: z.boolean().optional(),
    })
    .optional(),
});

export type DeckPlanPresentationType = z.infer<typeof deckPlanPresentationTypeSchema>;
export type DeckPlanSource = z.infer<typeof deckPlanSourceSchema>;
export type DeckPlanSlideType = z.infer<typeof deckPlanSlideTypeSchema>;
export type DeckPlanSlideRole = z.infer<typeof deckPlanSlideRoleSchema>;
export type DeckPlanRequiredItem = z.infer<typeof deckPlanRequiredItemSchema>;
export type DeckPlanVisualSuggestion = z.infer<typeof deckPlanVisualSuggestionSchema>;
export type DeckPlanSlide = z.infer<typeof deckPlanSlideSchema>;
export type DeckPlan = z.infer<typeof deckPlanSchema>;
export type CreatePlanRequest = z.infer<typeof createPlanRequestSchema>;
