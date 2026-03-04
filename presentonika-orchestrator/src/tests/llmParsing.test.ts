import assert from "node:assert/strict";
import { parseDeepseekJson } from "../llm/parseDeepseekJson";
import { mergeFills } from "../llm/mergeFills";
import { applyFills } from "../templates/applyFills";

export const runLlmParsingTests = (): void => {
  const fenced = parseDeepseekJson("```json\n{\"fills\":{\"s1_title\":\"Hello\"}}\n```");
  assert.ok(fenced.parsed);

  const wrapped = parseDeepseekJson("Вот JSON: {\"fills\":{\"s1_title\":\"Hello\"}} спасибо");
  assert.ok(wrapped.parsed);

  const invalid = parseDeepseekJson("not json at all");
  assert.equal(invalid.parsed, null);
  assert.ok(invalid.parseError);

  const merged = mergeFills(["s1_title", "s1_subtitle"], { s1_title: "Real" });
  assert.equal(merged.s1_title, "Real");
  assert.equal(merged.s1_subtitle, "TEST_s1_subtitle");

  const doc = {
    slides: [
      {
        elements: [
          { text: "{{s1_title}}" },
          { runs: [{ text: "{{s1_subtitle}}" }] },
        ],
      },
    ],
  };

  applyFills(doc, {
    s1_title: "Title",
    s1_subtitle: "Subtitle",
  });

  assert.equal((doc.slides[0].elements[0] as { text: string }).text, "Title");
  assert.equal((doc.slides[0].elements[1] as { runs: Array<{ text: string }> }).runs[0].text, "Subtitle");
};
