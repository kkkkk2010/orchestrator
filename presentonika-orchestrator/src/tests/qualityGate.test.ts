import assert from "node:assert/strict";
import { applyFillsByLocations, extractRemainingKeys, scanRemainingFillTokens } from "../templates/applyFills";
import { applyTypographyStandards, generateLocalFallback, normalizeText, resolveThemeTypography } from "../templates/textPostprocess";
import { buildImagePromptFallback } from "../images/imagePlan";
import { applySlideTypeHeuristics, compressQuery, enforceImagePromptUniqueness, isGenericImageQuery } from "../images/imagePrompts";
import { findMissingSkeletonKeys } from "../tools/templateQa";
import type { PlaceholderLocation } from "../templates/applyFills";
import type { ImagePlanSlot } from "../images/imagePlan";

export const runQualityGateTests = (): void => {
  {
    const examples = normalizeText("s7_examples", [
      "• Первый пример подтверждает тезис.",
      "• Второй пример показывает следствие.",
      "• Третий пример раскрывает механизм.",
      "• Четвертый пример связывает факт и вывод.",
    ].join("\n"));
    assert.equal(examples.split("\n").length, 4);
  }

  {
    const keys = extractRemainingKeys([
      { path: "slides[0].elements[0].text", snippet: "TEST_s5_title {{ s10_title }}" },
      { path: "slides[1].elements[0].text", snippet: "TEST_s5_title TEST_s9_body" },
    ]);
    assert.deepEqual(keys.sort(), ["s10_title", "s5_title", "s9_body"]);
  }

  {
    const doc = {
      slides: Array.from({ length: 12 }, (_, index) => ({
        elements: [{ text: `TEST_s${index + 1}_title` }],
      })),
    };

    const remaining = scanRemainingFillTokens(doc);
    assert.equal(remaining.remainingSamples.length, 10);
    assert.equal(remaining.remainingTestTokensCount, 12);
    const expectedKeys = Array.from({ length: 12 }, (_, index) => `s${index + 1}_title`).sort();
    assert.deepEqual(remaining.remainingKeys.sort(), expectedKeys);
    assert.deepEqual(extractRemainingKeys(remaining.remainingSamples).sort(), expectedKeys);
  }

  {
    const doc = {
      slides: [{ elements: [{ text: "{{s1_title}} {{s2_title}}" }] }],
    };
    const locations: PlaceholderLocation[] = [
      { key: "s1_title", slide: 1, elementIndex: 0, path: "slides[0].elements[0].text", rawSnippet: "{{s1_title}}" },
      { key: "s2_title", slide: 1, elementIndex: 0, path: "slides[0].elements[0].text", rawSnippet: "{{s2_title}}" },
    ];

    applyFillsByLocations(doc, locations, { s1_title: "A", s2_title: "B" });
    const remaining = scanRemainingFillTokens(doc);
    assert.equal(remaining.remainingMustacheTokensCount, 0);
    assert.equal(remaining.remainingTestTokensCount, 0);
    assert.deepEqual(remaining.remainingKeys, []);
  }

  {
    const previousScale = process.env.TYPOGRAPHY_SCALE;
    process.env.TYPOGRAPHY_SCALE = "1.35";
    const doc = {
      slides: [{ elements: [{ text: "Title", style: {} }] }],
    };
    const locations: PlaceholderLocation[] = [
      { key: "s1_title", slide: 1, elementIndex: 0, path: "slides[0].elements[0].text", rawSnippet: "{{s1_title}}" },
    ];
    const typography = resolveThemeTypography("teacher-dark", {});
    applyTypographyStandards({ doc, placeholderLocations: locations, themeTypography: typography });
    const style = (doc.slides[0].elements[0] as { style: Record<string, unknown> }).style;
    assert.equal(typography.scale, 1.35);
    assert.equal(style.fontFamily, "Manrope");
    assert.equal(Number(style.fontSize), 76);
    if (previousScale === undefined) delete process.env.TYPOGRAPHY_SCALE;
    else process.env.TYPOGRAPHY_SCALE = previousScale;
  }

  {
    const slideContext = {
      titleIntent: "Два этапа фотосинтеза",
      claim: "Оба этапа работают как единая система.",
      mustInclude: ["Световая фаза запасает энергию.", "Темновая фаза использует эту энергию."],
      expectedEvidence: ["Связь между АТФ и синтезом глюкозы."],
    };
    const step3 = normalizeText("s2_step3", generateLocalFallback({ key: "s2_step3", topic: "Фотосинтез", slideNumber: 2, slideContext }));
    const step4 = normalizeText("s2_step4", generateLocalFallback({ key: "s2_step4", topic: "Фотосинтез", slideNumber: 2, slideContext }));
    assert.notEqual(step3, step4);
    assert.match(step3, /единая система/);
    assert.match(step4, /АТФ/);
  }

  {
    const fallback = buildImagePromptFallback({
      topic: "Выборы США",
      slideTitle: "Инаугурация Дональда Трампа",
      slideSummary: "церемония 2017 вашингтон капитолий",
      kind: "photo",
    });
    assert.ok(!fallback.query.includes("slide"));
    assert.ok(fallback.query.includes("Инаугурация"));
  }

  {
    const fallback = buildImagePromptFallback({
      topic: "Клеточное дыхание",
      slideTitle: "Проверка знаний",
      slideSummary: "Ученик отвечает на вопросы про митохондрии, дыхание и АТФ",
      kind: "hero",
      language: "ru",
    });
    assert.match(fallback.query, /^ученик решает тест/i);
    assert.match(fallback.query, /клеточное дыхание/i);
    assert.match(fallback.query, /биология класс/i);
    assert.doesNotMatch(fallback.query, /презентация|проверка знаний|слайд/i);
    assert.doesNotMatch(fallback.query, /[A-Za-z]/);
    assert.match(fallback.hint, /Ученик выполняет учебное задание/);
  }

  {
    const compressed = compressQuery("Клеточное дыхание митохондрия АТФ научная схема", []);
    assert.match(compressed.query, /Клеточное дыхание/);
    assert.match(compressed.query, /АТФ/);
    assert.equal(applySlideTypeHeuristics(compressed.query, "general", "hero"), compressed.query);
    assert.equal(isGenericImageQuery("Презентация Проверка знаний фото"), true);
    assert.equal(isGenericImageQuery("Важность развития современного общества иллюстрация"), true);
    assert.equal(isGenericImageQuery(compressed.query), false);
  }

  {
    const slots: ImagePlanSlot[] = [
      { slotId: "a", slide: 1, element: 0, kind: "photo", query: "Трамп инаугурация", hint: "x", aspect: "landscape" },
      { slotId: "b", slide: 2, element: 1, kind: "photo", query: "Трамп инаугурация", hint: "x", aspect: "landscape" },
    ];
    const dedup = enforceImagePromptUniqueness(slots, {
      1: { slide: 1, title: "Инаугурация", keywords: ["2017", "вашингтон"], entities: ["2017"], slideType: "facts", summary: "Инаугурация 2017" },
      2: { slide: 2, title: "Митинги", keywords: ["митинг", "речь"], entities: ["митинг"], slideType: "examples", summary: "Митинги и выступления" },
    }, "Тема урока");
    assert.ok(dedup.duplicatesBefore > 0);
    assert.equal(dedup.duplicatesAfter, 0);
  }

  {
    const missing = findMissingSkeletonKeys(["s1_title", "s1_subtitle"]);
    assert.ok(missing.includes("s10_sources"));
  }
};
