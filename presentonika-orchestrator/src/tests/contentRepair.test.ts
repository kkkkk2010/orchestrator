import assert from "node:assert/strict";
import { buildContentRepairPlan } from "../content/contentRepair";
import { buildItemizedRepairKeys, composeExactBulletBlock, splitContentItems } from "../content/exactCountRepair";
import type { ContentQaReport } from "../content/contentQa";
import { buildSystemPrompt, buildUserPrompt } from "../llm/prompt";

const report = (issues: ContentQaReport["issues"]): ContentQaReport => ({
  score: 68,
  issues,
  stats: {
    keysChecked: 4,
    deckPlanPresent: true,
    missingCount: 0,
    genericTitleCount: 0,
    shortLargeBlockCount: 0,
    bulletIssueCount: 0,
    requiredCountMismatchCount: 0,
    routeIssueCount: 0,
    deckPlanRouteIssueCount: 0,
    deckPlanIssueCount: 0,
    overclaimRiskCount: 0,
    chronologyRiskCount: 0,
    formatIssueCount: 0,
    planIssueCount: 0,
    repeatedLineCount: 0,
    placeholderLeakCount: 0,
  },
});

export const runContentRepairTests = (): void => {
  const itemKeys = buildItemizedRepairKeys("s8_examples", 4);
  assert.deepEqual(itemKeys, ["s8_examples__item1", "s8_examples__item2", "s8_examples__item3", "s8_examples__item4"]);
  assert.deepEqual(splitContentItems("• Первый пример\n• Второй пример"), ["Первый пример", "Второй пример"]);
  assert.equal(composeExactBulletBlock({
    [itemKeys[0]]: "• Первый пример",
    [itemKeys[1]]: "Второй пример",
    [itemKeys[2]]: "Третий пример",
    [itemKeys[3]]: "Четвертый пример",
  }, itemKeys).split("\n").length, 4);
  assert.throws(() => composeExactBulletBlock({ [itemKeys[0]]: "Первый пример" }, itemKeys));

  const plan = buildContentRepairPlan({
    report: report([
      { code: "examples_not_argumentative", severity: "warn", slide: 8, message: "Примеры не поддерживают тезис" },
      { code: "quiz_not_testing_central_argument", severity: "warn", slide: 9, message: "Вопросы проверяют только память" },
      { code: "chronology_risk", severity: "warn", key: "s7_step1", slide: 7, message: "Нужна проверка даты" },
      { code: "bare_fact_without_meaning", severity: "warn", key: "s7_step1", slide: 7, message: "Нужно значение факта" },
      { code: "overclaim_risk", severity: "warn", key: "s5_bullets", slide: 5, message: "Сильное утверждение" },
    ]),
    fillKeys: ["s5_bullets", "s7_step1", "s8_title", "s8_examples", "s9_task", "s9_q1", "s9_q2", "s9_q3"],
    maxKeys: 8,
  });

  assert.deepEqual(plan.keys, ["s8_examples", "s9_q1", "s9_q2", "s9_q3", "s9_task", "s7_step1", "s5_bullets"]);
  assert.equal(plan.issues.length, 4);

  const imagePlan = {
    version: 1 as const,
    presentationId: 1,
    themeId: "teacher-light",
    topic: "Тема",
    language: "ru",
    createdAt: "2026-07-29T00:00:00.000Z",
    slots: [],
  };
  const prompt = buildUserPrompt({
    presentationId: 1,
    themeId: "teacher-light",
    topic: "Тема",
    language: "ru",
    fillKeys: ["s8_examples"],
    imagePlan,
    mode: "content_repair",
    repairContext: {
      currentFills: { s8_examples: "• Первый пример" },
      issues: [{ code: "examples_not_argumentative", slide: 8, message: "Нужна связь с тезисом" }],
    },
  });
  assert.ok(buildSystemPrompt("content_repair").includes("только в переданных полях"));
  assert.ok(prompt.includes("examples_not_argumentative"));
  assert.ok(prompt.includes("• Первый пример"));
  assert.ok(prompt.includes("Исправь только перечисленные проблемы"));
  assert.ok(prompt.includes("это подтверждает"));
  assert.ok(prompt.includes("не копируй titleIntent"));
  assert.ok(prompt.includes("Почему/Как/Объясните/Свяжите"));
};
