import assert from "node:assert/strict";
import { runContentQa } from "../content/contentQa";

export const runContentQaTests = (): void => {
  const fills = {
    s2_goals: "• Разобрать «Евгения Онегина: глава 1»\n• Ключевой термин и его значение.\n• Короткий вывод для закрепления материала.",
    s4_title: "Пушкин: Определение и термины",
    s4_keywords: "романтизм, реализм, литературный язык, поэма",
    s5_bullets: "• Родился 6 июня 1799 года в Москве.\n• Написал стихи.\n• Был поэтом.\n• Жил в России.\n• Умер на дуэли.",
    s8_examples: "• Лицей\n• Стихи",
    s10_summary: "{{s10_summary}}",
  };

  const report = runContentQa({
    fills,
    fillKeys: Object.keys(fills),
    topic: "Пушкин",
  });

  const codes = new Set(report.issues.map((issue) => issue.code));
  assert.ok(codes.has("generic_title"));
  assert.ok(codes.has("comma_only_keywords"));
  assert.ok(codes.has("bare_fact_without_meaning"));
  assert.ok(codes.has("bullet_too_short"));
  assert.ok(codes.has("unsupported_goal_promise"));
  assert.ok(codes.has("placeholder_leak"));
  assert.ok(report.score < 100);
};
