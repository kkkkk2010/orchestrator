import assert from "node:assert/strict";
import { buildNarrativePlan } from "../content/narrativePlan";
import { buildUserPrompt } from "../llm/prompt";
import type { ImagePlanV1 } from "../images/imagePlan";

export const runNarrativePlanTests = (): void => {
  const plan = buildNarrativePlan({
    topic: "Александр Пушкин",
    selectedLayouts: [
      { slide: 1, slideType: "cover", layoutId: "edu-cover-a" },
      { slide: 8, slideType: "examples", layoutId: "edu-examples-a" },
    ],
  });

  assert.equal(plan.topicKind, "literary_figure");
  assert.ok(plan.centralQuestion.includes("точкой сборки"));
  assert.ok(plan.thesis.includes("живую речь"));
  assert.equal(plan.slides.length, 10);
  assert.equal(new Set(plan.slides.map((slide) => slide.purpose)).size, 10);

  const imagePlan: ImagePlanV1 = {
    version: 1,
    presentationId: 1,
    themeId: "teacher-dark",
    topic: "Александр Пушкин",
    language: "ru",
    createdAt: "2026-04-29T00:00:00.000Z",
    slots: [],
  };

  const prompt = buildUserPrompt({
    presentationId: 1,
    themeId: "teacher-dark",
    topic: "Александр Пушкин",
    language: "ru",
    fillKeys: ["s8_examples"],
    imagePlan,
    narrativePlan: plan,
    layoutContext: [
      { slide: 8, slideType: "examples", layoutId: "edu-examples-a", role: "give examples", textDensity: "high" },
    ],
  });

  assert.ok(prompt.includes("centralQuestion:"));
  assert.ok(prompt.includes("thesis:"));
  assert.ok(prompt.includes("slide-by-slide narrativePlan"));
  assert.ok(prompt.includes("current batch narrative relation"));
  assert.ok(prompt.includes("Examples must support the thesis"));
};
