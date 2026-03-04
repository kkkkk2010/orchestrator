import assert from "node:assert/strict";
import { parseDeepseekJson } from "../llm/parseDeepseekJson";
import { mergeFills } from "../llm/mergeFills";
import { applyFillsByLocations, scanRemainingFillTokens } from "../templates/applyFills";

export const runLlmParsingTests = (): void => {
  const fenced = parseDeepseekJson("```json\n{\"fills\":{\"s1_title\":\"Hello\"}}\n```");
  assert.ok(fenced.parsed);

  const wrapped = parseDeepseekJson("Вот JSON: {\"fills\":{\"s1_title\":\"Hello\"}} спасибо");
  assert.ok(wrapped.parsed);

  const invalid = parseDeepseekJson("not json at all");
  assert.equal(invalid.parsed, null);
  assert.ok(invalid.parseError);

  const merged = mergeFills(["s1_title", "s1_subtitle"], { s1_title: "  Real  " });
  assert.equal(merged.s1_title, "  Real  ");
  assert.equal(merged.s1_subtitle, "TEST_s1_subtitle");

  const doc = {
    slides: [
      {
        elements: [
          { text: "TEST_s3_title" },
          { runs: [{ text: "{{s3_title}}" }] },
        ],
      },
    ],
  };

  const locations = [
    { key: "s3_title", slide: 1, elementIndex: 0, path: "slides[0].elements[0].text", rawSnippet: "TEST_s3_title" },
    { key: "s3_title", slide: 1, elementIndex: 1, path: "slides[0].elements[1].runs[0].text", rawSnippet: "{{s3_title}}" },
  ];

  applyFillsByLocations(doc, locations, { s3_title: "Реальный заголовок" });

  assert.equal((doc.slides[0].elements[0] as { text: string }).text, "Реальный заголовок");
  assert.equal((doc.slides[0].elements[1] as { runs: Array<{ text: string }> }).runs[0].text, "Реальный заголовок");

  const tokenDoc = {
    text: "TEST_s3_title",
    nested: { v: "{{s4_title}}" },
  };

  const tokenStats = scanRemainingFillTokens(tokenDoc);
  assert.equal(tokenStats.remainingTestTokensCount, 1);
  assert.equal(tokenStats.remainingMustacheTokensCount, 1);
};
