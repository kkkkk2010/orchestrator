import assert from "node:assert/strict";
import { applyFillsByLocations, extractRemainingKeys, scanRemainingFillTokens } from "../templates/applyFills";
import { applyTypographyStandards, resolveThemeTypography } from "../templates/textPostprocess";
import { buildImagePromptFallback } from "../images/imagePlan";
import type { PlaceholderLocation } from "../templates/applyFills";

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
    const doc = {
      slides: [
        {
          elements: [{ text: "Title", style: {} }],
        },
      ],
    };
    const locations: PlaceholderLocation[] = [
      { key: "s1_title", slide: 1, elementIndex: 0, path: "slides[0].elements[0].text", rawSnippet: "{{s1_title}}" },
    ];
    const typography = resolveThemeTypography("teacher-dark", {});
    applyTypographyStandards({ doc, placeholderLocations: locations, themeTypography: typography });
    const style = (doc.slides[0].elements[0] as { style: Record<string, unknown> }).style;
    assert.equal(style.fontSize, 44);
    assert.equal(style.lineHeight, 1.05);
    assert.equal(style.color, "#FFFFFF");
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
};
