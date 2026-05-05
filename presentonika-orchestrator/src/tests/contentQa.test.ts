import assert from "node:assert/strict";
import { runContentQa } from "../content/contentQa";
import { buildNarrativePlan } from "../content/narrativePlan";
import { buildDeterministicDeckPlan } from "../deckPlan";

export const runContentQaTests = (): void => {
  const plan = buildNarrativePlan({ topic: "Александр Пушкин" });
  const fills = {
    s1_title: "Александр Пушкин",
    s1_meta: "Пушкин важен для литературного языка.",
    s2_goals: "• Познакомиться с правилами футбола\n• Узнать состав команды\n• Рассмотреть схему турнира",
    s2_plan: "• Правила футбола\n• Состав команды\n• Схема турнира",
    s3_title: "Пушкин: гений или пророк?",
    s3_hook_question: "Почему он важен?",
    s3_hook_hint: "Пушкин важен для литературного языка.",
    s4_title: "Пушкин: Определение и термины",
    s4_definition: "Быт купцов и торговые пути никак не объясняют язык, жанры или литературную роль.",
    s4_keywords: "романтизм, реализм, литературный язык, поэма, роман, герой",
    s5_title: "Ключевые факты",
    s5_bullets: "• Родился 6 июня 1799 года в Москве.\n• Пушкин первым создал русский литературный язык.\n• Пушкин важен для литературного языка.\n• Был поэтом.\n• Умер на дуэли.",
    s6_title: "Пушкин важен",
    s6_left_bullets: "• Пушкин важен для литературного языка.\n• Романтизм.\n• Поэзия.",
    s6_right_bullets: "• Пушкин важен для литературного языка.\n• Реализм.\n• Проза.",
    s7_title: "Этапы",
    s7_step1: "1830-е: «Евгений Онегин» закрепляет зрелый стиль.",
    s7_step2: "Юг",
    s8_title: "Произведения",
    s8_examples: "• Евгений Онегин\n• Капитанская дочка\n• Борис Годунов",
    s9_title: "Проверка",
    s9_q1: "В каком году родился Пушкин?",
    s9_q2: "Какое произведение считается главным?",
    s10_title: "Итог",
    s10_summary: "• Пушкин создал современный русский литературный язык.\n• Выучите названия.\n• Повторите биографию.",
    s10_sources: "Источники: учебник, энциклопедии, официальные документы, проверенные обзоры.",
  };
  const before = JSON.stringify(fills);

  const report = runContentQa({
    fills,
    fillKeys: Object.keys(fills),
    topic: "Александр Пушкин",
    narrativePlan: plan,
  });

  assert.equal(JSON.stringify(fills), before);
  const codes = new Set(report.issues.map((issue) => issue.code));
  assert.ok(codes.has("generic_title"));
  assert.ok(codes.has("generic_hook"));
  assert.ok(codes.has("comma_only_keywords"));
  assert.ok(codes.has("overloaded_keywords"));
  assert.ok(codes.has("bare_fact_without_meaning"));
  assert.ok(codes.has("bullet_too_short"));
  assert.ok(codes.has("required_count_mismatch"));
  assert.ok(codes.has("weak_exact_count_instruction"));
  assert.ok(codes.has("examples_count_low"));
  assert.ok(codes.has("examples_not_argumentative"));
  assert.ok(codes.has("weak_learning_verbs"));
  assert.ok(codes.has("overclaim_risk"));
  assert.ok(codes.has("chronology_risk"));
  assert.ok(codes.has("conclusion_overclaim"));
  assert.ok(codes.has("memory_only_quiz"));
  assert.ok(codes.has("generic_sources"));
  assert.ok(codes.has("repeated_central_claim"));
  assert.ok(codes.has("duplicated_goal_plan"));
  assert.ok(codes.has("conclusion_not_answering_question"));
  assert.ok(codes.has("goals_not_matching_narrative_plan"));
  assert.ok(codes.has("hook_not_connected_to_following_slides"));
  assert.ok(codes.has("examples_not_used_as_evidence"));
  assert.ok(codes.has("quiz_not_testing_narrative"));
  assert.ok(report.stats.requiredCountMismatchCount >= 1);
  assert.ok(report.stats.overclaimRiskCount >= 1);
  assert.ok(report.stats.chronologyRiskCount >= 1);
  assert.ok(report.stats.narrativeIssueCount >= 1);
  assert.ok(report.score < 100);
  assert.equal(report.issues.find((issue) => issue.code === "required_count_mismatch")?.severity, "error");

  const malformedPlan = {
    ...plan,
    centralQuestion: "",
    thesis: "",
    slides: plan.slides.map((slide, index) => index === 1 ? { ...slide, purpose: plan.slides[0].purpose } : slide),
  };
  const malformedReport = runContentQa({
    fills,
    fillKeys: Object.keys(fills),
    topic: "Александр Пушкин",
    narrativePlan: malformedPlan,
  });
  const malformedCodes = new Set(malformedReport.issues.map((issue) => issue.code));
  assert.ok(malformedCodes.has("no_central_question"));
  assert.ok(malformedCodes.has("missing_thesis"));
  assert.ok(malformedCodes.has("repeated_slide_purpose"));

  const disconnected = runContentQa({
    fills: {
      s3_title: "Футбол и правила игры",
      s4_title: "Клеточное дыхание",
      s5_bullets: "• Морская навигация требует карт и компаса.\n• Корабли используют порты для торговли.\n• Погода влияет на маршрут путешествия.\n• Команды распределяют обязанности на палубе.\n• Шторм меняет скорость движения.",
      s6_left_bullets: "• Геометрия изучает фигуры.\n• Угол измеряется в градусах.\n• Площадь зависит от формы.",
      s6_right_bullets: "• Рецепт описывает продукты.\n• Температура меняет тесто.\n• Время выпечки важно.",
      s7_step1: "Почва удерживает влагу.",
      s8_examples: "• Планета\n• Орбита\n• Спутник\n• Телескоп",
      s9_q1: "В каком году произошло событие?",
      s9_q2: "Где это было?",
      s9_q3: "Кто участвовал?",
      s10_summary: "• Запомните список.\n• Повторите даты.\n• Ответьте письменно.",
    },
    fillKeys: ["s3_title", "s4_title", "s5_bullets", "s6_left_bullets", "s6_right_bullets", "s7_step1", "s8_examples", "s9_q1", "s9_q2", "s9_q3", "s10_summary"],
    topic: "Александр Пушкин",
    narrativePlan: plan,
  });
  assert.ok(new Set(disconnected.issues.map((issue) => issue.code)).has("disconnected_slide_sequence"));

  const goodTitleReport = runContentQa({
    fills: {
      s4_title: "Эпоха и языковой разрыв",
      s4_definition: "Пушкин работал внутри культурной ситуации, где книжная традиция и живая речь требовали нового равновесия.",
    },
    fillKeys: ["s4_title", "s4_definition"],
    topic: "Александр Пушкин",
    narrativePlan: plan,
  });
  assert.equal(goodTitleReport.issues.some((issue) => issue.code === "generic_title" && issue.key === "s4_title"), false);

  const cautiousReport = runContentQa({
    fills: {
      s5_bullets: "• Пушкин считается одной из ключевых фигур формирования современного литературного языка.\n• Он помог соединить живую речь и книжную традицию.\n• Его проза стала важным образцом исторического повествования.\n• Лирика показала точность простой речи.\n• Драматургия связала историю и конфликт личности.",
    },
    fillKeys: ["s5_bullets"],
    topic: "Александр Пушкин",
    narrativePlan: plan,
  });
  assert.equal(cautiousReport.issues.some((issue) => issue.code === "overclaim_risk"), false);

  const dynamicDeckPlan = buildDeterministicDeckPlan({
    topic: "Османская империя",
    language: "ru",
    slideCount: 10,
    presentationType: "auto",
  });
  dynamicDeckPlan.slides = dynamicDeckPlan.slides.map((slide) => slide.slide === 7
    ? { ...slide, slideType: "examples", role: "examples_as_evidence", requiredItems: [{ slot: "examples", kind: "examples", count: 4, exact: true }] }
    : slide);
  const dynamicReport = runContentQa({
    fills: {
      s7_examples: "• Янычары показывают военную организацию.\n• Стамбул раскрывает роль столицы.\n• Торговые пути объясняют ресурсы.",
    },
    fillKeys: ["s7_examples"],
    topic: "Османская империя",
    deckPlan: dynamicDeckPlan,
  });
  const dynamicIssues = dynamicReport.issues.filter((issue) => issue.code === "required_count_mismatch");
  assert.ok(dynamicIssues.some((issue) => issue.key === "s7_examples" && issue.slide === 7));
};
