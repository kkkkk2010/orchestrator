import { z } from "zod";

export const deckPlanPresentationTypeSchema = z.enum([
  "auto",
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

export const deckPlanSlideRoleSchema = z.enum([
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
]);

export const deckPlanRequiredItemSchema = z.object({
  key: z.string().min(1).optional(),
  kind: z.enum(["bullets", "examples", "questions", "terms", "steps", "summary", "route_items"]),
  count: z.number().int().min(1).max(12),
  exact: z.boolean().default(true),
  description: z.string().max(240).optional(),
});

const requiredItemsSchema = z.preprocess((value) => value ?? [], z.array(deckPlanRequiredItemSchema).max(8));

export const deckPlanSlideSchema = z.object({
  slide: z.number().int().min(1).max(50),
  role: deckPlanSlideRoleSchema,
  titleIntent: z.string().min(1).max(180),
  claim: z.string().min(1).max(420),
  mustInclude: z.array(z.string().min(1).max(180)).max(10).default([]),
  mustAvoid: z.array(z.string().min(1).max(180)).max(10).default([]),
  requiredItems: requiredItemsSchema,
  expectedEvidence: z.array(z.string().min(1).max(180)).max(10).default([]),
  relationToPrevious: z.string().max(240).optional(),
  relationToNext: z.string().max(240).optional(),
});

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
export type DeckPlanSlideRole = z.infer<typeof deckPlanSlideRoleSchema>;
export type DeckPlanRequiredItem = z.infer<typeof deckPlanRequiredItemSchema>;
export type DeckPlanSlide = z.infer<typeof deckPlanSlideSchema>;
export type DeckPlan = z.infer<typeof deckPlanSchema>;
export type CreatePlanRequest = z.infer<typeof createPlanRequestSchema>;
