import assert from "node:assert/strict";
import { runContentQa } from "../content/contentQa";
import { buildDeterministicDeckPlan } from "../deckPlan";
import { normalizeBulletLineFormatting, normalizeDocumentBulletMarkers } from "../templates/textPostprocess";

const buildPushkinPlan = () => buildDeterministicDeckPlan({
  topic: "Александр Пушкин",
  subject: "literature",
  grade: "7",
  language: "ru",
  slideCount: 10,
  presentationType: "auto",
});

export const runContentQaTests = (): void => {
  const deckPlan = buildPushkinPlan();
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
    deckPlan,
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
  assert.ok(codes.has("quiz_not_testing_central_argument"));
  assert.ok(report.stats.requiredCountMismatchCount >= 1);
  assert.ok(report.stats.overclaimRiskCount >= 1);
  assert.ok(report.stats.chronologyRiskCount >= 1);
  assert.ok(report.stats.deckPlanIssueCount >= 1);
  assert.ok(report.stats.deckPlanRouteIssueCount >= 1);
  assert.equal("narrativeIssueCount" in report.stats, false);
  assert.ok(report.score < 100);
  assert.equal(report.issues.find((issue) => issue.code === "required_count_mismatch")?.severity, "error");

  const malformedPlan = {
    ...deckPlan,
    centralQuestion: "",
    thesis: "",
    slides: deckPlan.slides.map((slide, index) => index === 1 ? { ...slide, role: deckPlan.slides[0].role } : slide),
  };
  const malformedReport = runContentQa({
    fills,
    fillKeys: Object.keys(fills),
    topic: "Александр Пушкин",
    deckPlan: malformedPlan,
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
    deckPlan,
  });
  assert.ok(new Set(disconnected.issues.map((issue) => issue.code)).has("disconnected_slide_sequence"));

  const goodTitleReport = runContentQa({
    fills: {
      s4_title: "Эпоха и языковой разрыв",
      s4_definition: "Пушкин работал внутри культурной ситуации, где книжная традиция и живая речь требовали нового равновесия.",
    },
    fillKeys: ["s4_title", "s4_definition"],
    topic: "Александр Пушкин",
    deckPlan,
  });
  assert.equal(goodTitleReport.issues.some((issue) => issue.code === "generic_title" && issue.key === "s4_title"), false);

  const leakedIntentTitleReport = runContentQa({
    fills: { s1_title: "Представить тему и заинтересовать класс" },
    fillKeys: ["s1_title"],
    topic: "Клеточное дыхание",
    deckPlan,
  });
  assert.ok(leakedIntentTitleReport.issues.some((issue) => issue.code === "generic_title" && issue.key === "s1_title"));

  const cautiousReport = runContentQa({
    fills: {
      s5_bullets: "• Пушкин считается одной из ключевых фигур формирования современного литературного языка.\n• Он помог соединить живую речь и книжную традицию.\n• Его проза стала важным образцом исторического повествования.\n• Лирика показала точность простой речи.\n• Драматургия связала историю и конфликт личности.",
    },
    fillKeys: ["s5_bullets"],
    topic: "Александр Пушкин",
    deckPlan,
  });
  assert.equal(cautiousReport.issues.some((issue) => issue.code === "overclaim_risk"), false);

  const dynamicDeckPlan = buildDeterministicDeckPlan({
    topic: "Османская империя",
    language: "ru",
    slideCount: 10,
    presentationType: "auto",
  });
  dynamicDeckPlan.slides = dynamicDeckPlan.slides.map((slide) => {
    if (slide.slide === 7) return { ...slide, slideType: "examples" as const, role: "examples_as_evidence", requiredItems: [{ key: "Примеры", slot: "examples", kind: "examples" as const, count: 4, exact: true }] };
    if (slide.slide === 8) return { ...slide, slideType: "quiz" as const, role: "check_understanding", requiredItems: [{ slot: "questions", kind: "questions" as const, count: 3, exact: true }] };
    if (slide.slide === 9) return { ...slide, slideType: "timeline" as const, role: "development_over_time", requiredItems: [{ slot: "steps", kind: "steps" as const, count: 4, exact: true }] };
    if (slide.slide === 1) return { ...slide, requiredItems: [{ slot: "title", kind: "bullets" as const, count: 1, exact: true }] };
    return slide;
  });
  const dynamicReport = runContentQa({
    fills: {
      s1_title: "Османская империя",
      s7_examples: "• Янычары показывают военную организацию.\n• Стамбул раскрывает роль столицы.\n• Торговые пути объясняют ресурсы.",
      s8_q1: "В каком году была основана империя?",
      s8_q2: "Где находилась столица?",
      s8_q3: "Кто был правителем?",
      s9_step1: "• Возникновение бейлика и первые завоевания.",
      s9_step2: "• Взятие Константинополя меняет баланс сил.",
      s9_step3: "• Реформы помогают удерживать разные территории.",
    },
    fillKeys: ["s1_title", "s7_examples", "s8_q1", "s8_q2", "s8_q3", "s9_step1", "s9_step2", "s9_step3"],
    topic: "Османская империя",
    deckPlan: dynamicDeckPlan,
  });
  const dynamicIssues = dynamicReport.issues.filter((issue) => issue.code === "required_count_mismatch");
  assert.ok(dynamicIssues.some((issue) => issue.key === "s7_examples" && issue.slide === 7 && issue.expected === 4 && issue.actual === 3));
  assert.ok(dynamicIssues.some((issue) => issue.key === "s9_step1" && issue.slide === 9 && issue.expected === 4 && issue.actual === 3));
  assert.equal(dynamicIssues.some((issue) => issue.key === "s1_title"), false);
  assert.ok(dynamicReport.issues.some((issue) => issue.code === "memory_only_quiz" && issue.slide === 8));
  assert.ok(dynamicReport.issues.some((issue) => issue.code === "quiz_not_testing_central_argument" && issue.slide === 8));
  assert.equal(dynamicReport.issues.some((issue) => issue.slide === 9 && `${issue.sample || ""}`.includes("check understanding")), false);
  assert.equal(dynamicReport.issues.some((issue) => `${issue.key || ""}` === "s8_examples" || `${issue.key || ""}` === "s9_summary"), false);

  const termsDeckPlan = buildDeterministicDeckPlan({
    topic: "Османская империя",
    language: "ru",
    slideCount: 10,
    presentationType: "auto",
  });
  termsDeckPlan.slides = termsDeckPlan.slides.map((slide) => ({
    ...slide,
    requiredItems: slide.slide === 4
      ? [{ slot: "keywords", kind: "terms" as const, count: 3, exact: true }]
      : [],
  }));
  const commaTermsReport = runContentQa({
    fills: {
      s4_keywords: "Анатолийский бейлик, Гази, Сельджуки, Византия",
    },
    fillKeys: ["s4_keywords"],
    topic: "Османская империя",
    deckPlan: termsDeckPlan,
  });
  assert.equal(commaTermsReport.issues.some((issue) => issue.code === "required_count_mismatch" && issue.key === "s4_keywords"), false);
  assert.equal(commaTermsReport.issues.some((issue) => issue.code === "too_few_bullets" && issue.key === "s4_keywords"), false);
  assert.ok(commaTermsReport.score >= 80);

  const fiveTermsReport = runContentQa({
    fills: {
      s4_keywords: "Анатолийский бейлик, Гази, Сельджуки, Византия, Миллетная система",
    },
    fillKeys: ["s4_keywords"],
    topic: "Османская империя",
    deckPlan: termsDeckPlan,
  });
  assert.equal(fiveTermsReport.issues.some((issue) => issue.code === "required_count_mismatch" && issue.key === "s4_keywords"), false);
  assert.equal(fiveTermsReport.issues.some((issue) => issue.code === "comma_only_keywords" && issue.key === "s4_keywords"), false);

  const exactTwoBulletsPlan = {
    ...termsDeckPlan,
    slides: termsDeckPlan.slides.map((slide) => slide.slide === 9
      ? { ...slide, slideType: "bullets" as const, role: "application", requiredItems: [{ slot: "bullets", kind: "bullets" as const, count: 2, exact: true }] }
      : slide),
  };
  const exactTwoBulletsReport = runContentQa({
    fills: {
      s9_bullets: "• Нарисуйте схему вулкана и подпишите все основные части.\n• Найдите действующий вулкан России и опишите последствия извержения.",
    },
    fillKeys: ["s9_bullets"],
    topic: "Вулканы",
    deckPlan: exactTwoBulletsPlan,
  });
  assert.equal(exactTwoBulletsReport.issues.some((issue) => issue.code === "too_few_bullets" && issue.key === "s9_bullets"), false);

  const hookFactWithMeaningReport = runContentQa({
    fills: {
      s3_hook_fact: "Около 1500 вулканов считаются активными.",
      s3_hook_why: "Поэтому наблюдения помогают заранее снижать риск.",
    },
    fillKeys: ["s3_hook_fact", "s3_hook_why"],
    topic: "Вулканы",
    deckPlan: termsDeckPlan,
  });
  assert.equal(hookFactWithMeaningReport.issues.some((issue) => issue.code === "bare_fact_without_meaning" && issue.key === "s3_hook_fact"), false);

  const tooManyTermsReport = runContentQa({
    fills: {
      s4_keywords: "Анатолийский бейлик, Гази, Сельджуки, Византия, Миллетная система, Стамбул, Янычары",
    },
    fillKeys: ["s4_keywords"],
    topic: "Османская империя",
    deckPlan: termsDeckPlan,
  });
  const tooManyTermsMismatch = tooManyTermsReport.issues.find((issue) => issue.code === "required_count_mismatch" && issue.key === "s4_keywords");
  assert.equal(tooManyTermsMismatch?.actual, 7);
  assert.deepEqual(tooManyTermsMismatch?.expected, { preferredMin: 3, preferredMax: 5 });
  assert.equal(tooManyTermsMismatch?.severity, "warn");

  const bulletTermsReport = runContentQa({
    fills: {
      s4_keywords: "• Анатолийский бейлик\n• Гази\n• Сельджуки",
    },
    fillKeys: ["s4_keywords"],
    topic: "Османская империя",
    deckPlan: termsDeckPlan,
  });
  assert.equal(bulletTermsReport.issues.some((issue) => issue.code === "required_count_mismatch" && issue.key === "s4_keywords"), false);

  const closingPlan = buildDeterministicDeckPlan({
    topic: "Османская империя",
    language: "ru",
    slideCount: 10,
    presentationType: "auto",
  });
  closingPlan.slides = closingPlan.slides.map((slide) => {
    if (slide.slide === 9) return { ...slide, slideType: "summary" as const, role: "conclusion", requiredItems: [] };
    if (slide.slide === 10) return { ...slide, slideType: "summary" as const, role: "homework_sources", titleIntent: "Домашнее задание и дополнительные источники", claim: "Закрепить вывод через задание и источники.", requiredItems: [] };
    return { ...slide, requiredItems: [] };
  });
  const closingReport = runContentQa({
    fills: {
      s9_summary: "• Империя выросла благодаря военной организации.\n• Управление помогало удерживать территории.\n• Кризисы показали пределы системы.",
      s10_homework: "Сравните причины подъёма и ослабления империи.",
      s10_sources: "Источники: школьный учебник истории, исторические карты.",
    },
    fillKeys: ["s9_summary", "s10_homework", "s10_sources"],
    topic: "Османская империя",
    deckPlan: closingPlan,
  });
  assert.equal(closingReport.issues.some((issue) => issue.code === "repeated_slide_purpose"), false);

  const normalized = normalizeBulletLineFormatting("• A. • B. • C.");
  assert.equal(normalized.value, "• A.\n• B.\n• C.");
  assert.equal(normalized.changed, true);
  const double = normalizeBulletLineFormatting("• • A");
  assert.equal(double.value, "• A");
  assert.equal(double.changed, true);
  const document = { slides: [{ elements: [{ type: "text", text: "• • Проверь себя" }, { type: "text", text: "Без изменений" }] }] };
  assert.equal(normalizeDocumentBulletMarkers(document), 1);
  assert.equal(document.slides[0].elements[0].text, "• Проверь себя");
  const tooFew = normalizeBulletLineFormatting("• A. • B.");
  assert.equal(tooFew.value.split("\n").length, 2);
};
