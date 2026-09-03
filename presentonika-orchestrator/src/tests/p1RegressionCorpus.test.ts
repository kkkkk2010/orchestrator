import assert from "node:assert/strict";
import { buildDeterministicDeckPlan, deckPlanSchema } from "../deckPlan";

const corpus = [
  { id: "history", topic: "Причины и последствия промышленной революции", subject: "history", grade: "8" },
  { id: "biology", topic: "Клеточное дыхание и роль митохондрий", subject: "biology", grade: "9" },
  { id: "physics", topic: "Законы Ньютона в повседневной жизни", subject: "physics", grade: "9" },
  { id: "geography", topic: "Климатические пояса России", subject: "geography", grade: "8" },
  { id: "literature", topic: "Образ Печорина в романе Герой нашего времени", subject: "literature", grade: "9" },
  { id: "informatics", topic: "Алгоритмы сортировки и их эффективность", subject: "informatics", grade: "9" },
  { id: "social", topic: "Права человека и гражданская ответственность", subject: "social studies", grade: "8" },
  { id: "mathematics", topic: "Квадратные уравнения и способы их решения", subject: "mathematics", grade: "8" },
] as const;

export const runP1RegressionCorpusTests = (): void => {
  assert.equal(corpus.length, 8);
  for (const fixture of corpus) {
    const plan = buildDeterministicDeckPlan({
      topic: fixture.topic,
      subject: fixture.subject,
      grade: fixture.grade,
      language: "ru",
      slideCount: 10,
      presentationType: "auto",
    });
    assert.equal(deckPlanSchema.safeParse(plan).success, true, `${fixture.id}: invalid deck plan`);
    assert.equal(plan.topic, fixture.topic);
    assert.equal(plan.slides.length, 10);
    assert.equal(plan.slides[0]?.slideType, "cover");
    assert.equal(plan.slides.at(-1)?.slideType, "summary");
    assert.equal(plan.slides.filter((slide) => slide.slideType === "summary").length, 1);
    assert.ok(new Set(plan.slides.map((slide) => slide.claim)).size >= 8, `${fixture.id}: repetitive claims`);
    assert.ok(plan.slides.every((slide) => slide.titleIntent.trim().length > 0), `${fixture.id}: empty title intent`);
  }
};
