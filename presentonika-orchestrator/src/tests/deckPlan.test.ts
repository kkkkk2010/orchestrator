import assert from "node:assert/strict";
import { buildDeterministicDeckPlan, deckPlanSchema, generateDeckPlan } from "../deckPlan";
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
  assert.equal(deckPlan.slides[7].requiredItems[0].count, 4);

  const invalid = deckPlanSchema.safeParse({
    ...deckPlan,
    slides: deckPlan.slides.slice(0, 9),
  });
  assert.equal(invalid.success, false);

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

  const previousPlanEnabled = process.env.PLAN_GENERATION_ENABLED;
  const previousPlanLlm = process.env.PLAN_LLM_ENABLED;
  process.env.PLAN_GENERATION_ENABLED = "true";
  process.env.PLAN_LLM_ENABLED = "false";
  const generated = await generateDeckPlan({
    topic: "Османская империя",
    subject: "history",
    grade: "7",
    language: "ru",
    slideCount: 10,
    presentationType: "auto",
  });
  assert.equal(generated.diagnostics.source, "deterministic");
  assert.equal(generated.diagnostics.llmUsed, false);
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
