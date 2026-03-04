import assert from "node:assert/strict";
import { applyFillsByLocations, extractRemainingKeys, scanRemainingFillTokens } from "../templates/applyFills";
import { applyTypographyStandards, resolveThemeTypography } from "../templates/textPostprocess";
import { buildImagePromptFallback } from "../images/imagePlan";
import { enforceImagePromptUniqueness } from "../images/imagePrompts";
import { findMissingSkeletonKeys } from "../tools/templateQa";
import type { PlaceholderLocation } from "../templates/applyFills";
import type { ImagePlanSlot } from "../images/imagePlan";

export const runQualityGateTests = (): void => {
  {
    const keys = extractRemainingKeys([
      { path: "slides[0].elements[0].text", snippet: "TEST_s5_title {{ s10_title }}" },
      { path: "slides[1].elements[0].text", snippet: "TEST_s5_title TEST_s9_body" },
    ]);
    assert.deepEqual(keys.sort(), ["s10_title", "s5_title", "s9_body"]);
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
  }

  {
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
    assert.ok(Number(style.fontSize) >= 80);
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
    const slots: ImagePlanSlot[] = [
      { slotId: "a", slide: 1, element: 0, kind: "photo", query: "Трамп инаугурация", hint: "x", aspect: "landscape" },
      { slotId: "b", slide: 2, element: 1, kind: "photo", query: "Трамп инаугурация", hint: "x", aspect: "landscape" },
    ];
    const dedup = enforceImagePromptUniqueness(slots, {
      1: { slide: 1, title: "Инаугурация", keywords: ["2017", "вашингтон"], entities: ["2017"], slideType: "facts", summary: "Инаугурация 2017" },
      2: { slide: 2, title: "Митинги", keywords: ["митинг", "речь"], entities: ["митинг"], slideType: "examples", summary: "Митинги и выступления" },
    });
    assert.ok(dedup.duplicatesBefore > 0);
    assert.equal(dedup.duplicatesAfter, 0);
  }

  {
    const missing = findMissingSkeletonKeys(["s1_title", "s1_subtitle"]);
    assert.ok(missing.includes("s10_sources"));
  }
};
