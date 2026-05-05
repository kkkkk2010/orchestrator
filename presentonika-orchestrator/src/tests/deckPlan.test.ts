import assert from "node:assert/strict";
import { buildDeterministicDeckPlan, buildPlannerPrompt, buildPlanForUi, deckPlanSchema, generateDeckPlan, normalizeLlmDeckPlanCandidate, slideTypeSlotContracts } from "../deckPlan";
import { createJobSchema } from "../schema";
import { buildUserPrompt } from "../llm/prompt";
import { runContentQa } from "../content/contentQa";
import type { ImagePlanV1 } from "../images/imagePlan";

const imagePlan: ImagePlanV1 = {
  version: 1,
  presentationId: 1,
  themeId: "teacher-dark",
  topic: "Александр Пушкин",
  language: "ru",
  createdAt: "2026-05-03T00:00:00.000Z",
  slots: [],
};

export const runDeckPlanTests = async (): Promise<void> => {
  const deckPlan = buildDeterministicDeckPlan({
    topic: "Александр Пушкин",
    subject: "literature",
    grade: "7",
    language: "ru",
    slideCount: 10,
    presentationType: "auto",
  });

  assert.equal(deckPlanSchema.safeParse(deckPlan).success, true);
  assert.equal(deckPlan.version, 1);
  assert.ok(deckPlan.centralQuestion.length > 0);
  assert.ok(deckPlan.thesis.length > 0);
  assert.equal(deckPlan.slides.length, 10);
  assert.equal(deckPlan.slides[7].slideType, "examples");
  assert.equal(deckPlan.slides[7].requiredItems[0].count, 4);
  assert.equal(slideTypeSlotContracts.cover.contentCountSlots.length, 0);
  assert.ok(slideTypeSlotContracts.quiz.allowedSlots.includes("q1"));
  const plannerPrompt = buildPlannerPrompt({
    topic: "Османская империя",
    subject: "history",
    grade: "7",
    language: "ru",
    slideCount: 10,
    presentationType: "auto",
  });
  assert.ok(plannerPrompt.includes("Use these slideType slot contracts exactly"));
  assert.ok(plannerPrompt.includes("cover: allowedSlots=title,subtitle,meta; contentCountSlots=none"));
  assert.ok(plannerPrompt.includes("Do NOT create requiredItems for title/subtitle/meta"));
  assert.ok(deckPlan.slides[0].titleIntent.includes("главный вопрос"));
  assert.ok(deckPlan.slides[1].mustAvoid.some((value) => value.includes("слабые глаголы")));
  assert.ok(deckPlan.slides[0].relationToNext?.includes("следующему шагу"));

  const invalid = deckPlanSchema.safeParse({
    ...deckPlan,
    slides: deckPlan.slides.slice(0, 9),
  });
  assert.equal(invalid.success, false);

  const planRequest = {
    topic: "Османская империя",
    subject: "history",
    grade: "7",
    language: "ru",
    slideCount: 10,
    presentationType: "auto" as const,
  };
  const rawLlmPlan = {
    ...deckPlan,
    topic: planRequest.topic,
    subject: planRequest.subject,
    grade: planRequest.grade,
    audience: null,
    presentationType: "causes_consequences",
    source: "llm",
    createdAt: "2000-01-01T00:00:00.000Z",
    slides: deckPlan.slides.map((slide) => {
      if (slide.slide === 1) {
        return {
          ...slide,
          relationToPrevious: null,
          titleIntent: null,
          mustInclude: [null, "главный вопрос"],
          requiredItems: [{ slot: "title", kind: "bullets", count: 1, exact: true }],
        };
      }
      if (slide.slide === 3) {
        return {
          ...slide,
          requiredItems: [{ slot: "title", kind: "question", count: 1, exact: true, description: "проблемный вопрос" }],
        };
      }
      if (slide.slide === 4) {
        return {
          ...slide,
          relationToPrevious: "",
          requiredItems: [
            { slot: "bullets", kind: "terms", count: 3, exact: true, description: "термины эпохи" },
            { kind: "map", count: 1, exact: false, description: "карта расширения империи" },
            { kind: "diagram", count: 1, exact: false, description: "схема управления" },
            { kind: "image", count: 1, exact: false, description: "изображение Стамбула" },
            { kind: "table", count: 1, exact: false, description: "таблица периодов" },
          ],
          visualSuggestions: [{ kind: "chart", description: null }],
        };
      }
      if (slide.slide === 5) {
        return { ...slide, requiredItems: [{ key: null, kind: "bullet", count: 5, exact: true, description: null }] };
      }
      if (slide.slide === 6) {
        return { ...slide, requiredItems: [{ slot: "title", kind: "bullets", count: 2, exact: true, description: "две стороны сравнения" }] };
      }
      if (slide.slide === 7) {
        const { slideType: _slideType, ...withoutSlideType } = slide;
        return { ...withoutSlideType, role: "development_over_time", requiredItems: [{ kind: "timeline", count: 4, exact: true, description: "текстовая последовательность этапов" }] };
      }
      if (slide.slide === 9) {
        return { ...slide, requiredItems: [{ kind: "question", count: 3, exact: true }] };
      }
      if (slide.slide === 10) {
        return {
          ...slide,
          role: "conclusion",
          titleIntent: "Домашнее задание и дополнительные источники",
          claim: "Закрепить вывод через задание и источники.",
          relationToNext: null,
        };
      }
      return slide;
    }),
  };
  const normalized = normalizeLlmDeckPlanCandidate(rawLlmPlan, planRequest);
  assert.equal(normalized.deckPlan.source, "llm");
  assert.equal(normalized.deckPlan.audience, undefined);
  assert.notEqual(normalized.deckPlan.createdAt, "2000-01-01T00:00:00.000Z");
  assert.equal(normalized.deckPlan.presentationType, "causes_consequences");
  assert.equal(normalized.deckPlan.slides[0].relationToPrevious, undefined);
  assert.equal(normalized.deckPlan.slides[0].titleIntent.length > 0, true);
  assert.equal(normalized.deckPlan.slides[0].requiredItems.length, 0);
  assert.equal(normalized.deckPlan.slides[2].requiredItems[0].slot, "hook_question");
  assert.equal(normalized.deckPlan.slides[2].requiredItems[0].kind, "questions");
  assert.equal(normalized.deckPlan.slides[3].requiredItems[0].slot, "keywords");
  assert.equal(normalized.deckPlan.slides[3].requiredItems[0].kind, "terms");
  assert.equal(normalized.deckPlan.slides[4].requiredItems[0].kind, "bullets");
  assert.equal(normalized.deckPlan.slides[4].requiredItems[0].slot, "bullets");
  assert.equal(normalized.deckPlan.slides[4].requiredItems[0].key, undefined);
  assert.equal(normalized.deckPlan.slides[4].requiredItems[0].description, undefined);
  assert.equal(normalized.deckPlan.slides[5].requiredItems[0].slot, "left_bullets");
  assert.equal(normalized.deckPlan.slides[5].requiredItems[1].slot, "right_bullets");
  assert.equal(normalized.deckPlan.slides[6].requiredItems[0].kind, "steps");
  assert.equal(normalized.deckPlan.slides[6].requiredItems[0].slot, "steps");
  assert.equal(normalized.deckPlan.slides[6].slideType, "timeline");
  assert.equal(normalized.deckPlan.slides[8].requiredItems[0].kind, "questions");
  assert.equal(normalized.deckPlan.slides[8].requiredItems[0].slot, "questions");
  assert.equal(normalized.deckPlan.slides[9].relationToNext, undefined);
  assert.equal(normalized.deckPlan.slides[9].role, "homework_sources");
  assert.equal(normalized.deckPlan.slides[9].claim.length > 0, true);
  assert.equal(normalized.deckPlan.slides[3].visualSuggestions.length, 5);
  assert.equal(normalized.normalization.applied, true);
  assert.equal(normalized.normalization.normalizedKindAliases, 4);
  assert.equal(normalized.normalization.movedVisualSuggestions, 4);
  assert.ok(normalized.normalization.droppedNonContentRequiredItems >= 1);
  assert.ok(normalized.normalization.remappedRequiredItems >= 4);
  assert.ok(normalized.normalization.slotContractWarnings.some((warning) => warning.includes("cover requiredItem")));
  assert.ok(normalized.normalization.normalizedNullOptionals >= 7);
  assert.ok(normalized.normalization.normalizedSlideTypes >= 1);
  assert.ok(normalized.normalization.normalizedSlideRoles >= 1);
  assert.ok(normalized.normalization.warnings.some((warning) => warning.includes("bullet -> bullets")));
  assert.ok(normalized.normalization.warnings.some((warning) => warning.includes("relationToPrevious")));
  assert.throws(() => normalizeLlmDeckPlanCandidate({ ...rawLlmPlan, centralQuestion: "", slides: [] }, planRequest));
  assert.throws(() => normalizeLlmDeckPlanCandidate({ ...rawLlmPlan, centralQuestion: null }, planRequest));
  const autoPlan = normalizeLlmDeckPlanCandidate({ ...rawLlmPlan, presentationType: "auto" }, planRequest);
  assert.equal(autoPlan.deckPlan.presentationType, "historical_overview");

  const uiPlan = buildPlanForUi(normalized.deckPlan, [{ code: "empty_must_include", severity: "warn", slide: 1, message: "example warning" }]);
  assert.equal(uiPlan.version, 1);
  assert.equal(uiPlan.topic, "Османская империя");
  assert.ok(uiPlan.editableFields.basic.includes("slides[].claim"));
  assert.ok(uiPlan.editableFields.advanced.includes("slides[].requiredItems"));
  assert.ok(uiPlan.hiddenFields.includes("deckPlanRoute"));
  assert.equal(uiPlan.slides[0].editable, true);
  assert.equal(uiPlan.uiWarnings[0].code, "empty_must_include");

  const jobWithPlan = createJobSchema.safeParse({
    presentationId: 123,
    userId: 1,
    topic: "Александр Пушкин",
    themeId: "teacher-dark",
    language: "ru",
    deckPlan: { ...deckPlan, source: "user_edited" },
    save: {
      endpoint: "https://example.com/save",
      presentationId: 123,
      saveToken: "token",
    },
  });
  assert.equal(jobWithPlan.success, true);

  const jobWithNormalizedPlan = createJobSchema.safeParse({
    presentationId: 124,
    userId: 1,
    topic: "Османская империя",
    themeId: "teacher-dark",
    language: "ru",
    deckPlan: normalized.deckPlan,
    save: {
      endpoint: "https://example.com/save",
      presentationId: 124,
      saveToken: "token",
    },
  });
  assert.equal(jobWithNormalizedPlan.success, true);

  const jobWithoutPlan = createJobSchema.safeParse({
    presentationId: 123,
    userId: 1,
    topic: "Александр Пушкин",
    themeId: "teacher-dark",
    language: "ru",
    save: {
      endpoint: "https://example.com/save",
      presentationId: 123,
      saveToken: "token",
    },
  });
  assert.equal(jobWithoutPlan.success, true);

  const prompt = buildUserPrompt({
    presentationId: 1,
    themeId: "teacher-dark",
    topic: "Александр Пушкин",
    language: "ru",
    fillKeys: ["s8_examples"],
    imagePlan,
    deckPlan,
    layoutContext: [
      { slide: 8, slideType: "examples", layoutId: "edu-examples-a", role: "examples", textDensity: "high" },
    ],
  });
  assert.ok(prompt.includes("DeckPlan source=deterministic"));
  assert.ok(prompt.includes(deckPlan.centralQuestion));
  assert.ok(prompt.includes(deckPlan.thesis));
  assert.ok(prompt.includes("current batch DeckPlan contract"));
  assert.ok(prompt.includes("s8_examples:exactly 4"));

  const dynamicPrompt = buildUserPrompt({
    presentationId: 1,
    themeId: "teacher-dark",
    topic: "Османская империя",
    language: "ru",
    fillKeys: ["s7_examples"],
    imagePlan: { ...imagePlan, topic: "Османская империя" },
    deckPlan: {
      ...deckPlan,
      slides: deckPlan.slides.map((slide) => slide.slide === 7
        ? { ...slide, slideType: "examples", requiredItems: [{ slot: "examples", kind: "examples", count: 4, exact: true }] }
        : slide),
    },
    layoutContext: [
      { slide: 7, slideType: "examples", layoutId: "edu-examples-a", role: "examples", textDensity: "high" },
    ],
  });
  assert.ok(dynamicPrompt.includes("s7_examples"));
  assert.ok(dynamicPrompt.includes("ровно 4 examples"));

  const previousPlanEnabled = process.env.PLAN_GENERATION_ENABLED;
  const previousPlanLlm = process.env.PLAN_LLM_ENABLED;
  process.env.PLAN_GENERATION_ENABLED = "true";
  process.env.PLAN_LLM_ENABLED = "false";
  const generated = await generateDeckPlan({
    ...planRequest,
  });
  assert.equal(generated.diagnostics.source, "deterministic");
  assert.equal(generated.diagnostics.llmUsed, false);
  assert.ok(generated.diagnostics.fallbackReason && generated.diagnostics.fallbackReason.length < 500);
  assert.equal(deckPlanSchema.safeParse(generated.deckPlan).success, true);
  if (previousPlanEnabled === undefined) delete process.env.PLAN_GENERATION_ENABLED;
  else process.env.PLAN_GENERATION_ENABLED = previousPlanEnabled;
  if (previousPlanLlm === undefined) delete process.env.PLAN_LLM_ENABLED;
  else process.env.PLAN_LLM_ENABLED = previousPlanLlm;

  const before = {
    s8_examples: "• Евгений Онегин • Капитанская дочка • Медный всадник",
    s10_summary: "• {{s10_summary}}\n• TEST_s10_summary\n• Выберите вариант ответа",
  };
  const beforeJson = JSON.stringify(before);
  const qa = runContentQa({
    fills: before,
    fillKeys: Object.keys(before),
    topic: "Александр Пушкин",
    deckPlan,
  });
  const codes = new Set(qa.issues.map((issue) => issue.code));
  assert.ok(codes.has("required_count_mismatch"));
  assert.ok(codes.has("multiple_bullets_on_one_line"));
  assert.ok(codes.has("bullet_block_missing_newlines"));
  assert.ok(codes.has("placeholder_token_left"));
  assert.ok(codes.has("test_prefix_leaked"));
  assert.ok(codes.has("instruction_mentions_options_but_no_options"));
  assert.equal(qa.stats.deckPlanPresent, true);
  assert.ok(qa.stats.planIssueCount > 0);
  assert.ok(qa.stats.formatIssueCount > 0);
  assert.equal(JSON.stringify(before), beforeJson);
};
