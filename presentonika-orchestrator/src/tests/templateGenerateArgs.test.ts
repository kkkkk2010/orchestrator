import assert from "node:assert/strict";
import { parseTemplateGenerateArgs } from "../tools/templateGenerate";

export const runTemplateGenerateArgTests = (): void => {
  {
    const parsed = parseTemplateGenerateArgs(["teacher-dark", "--write"]);
    assert.equal(parsed.themeId, "teacher-dark");
    assert.equal(parsed.write, true);
  }

  {
    const parsed = parseTemplateGenerateArgs(["--", "teacher-dark", "--", "--write"]);
    assert.equal(parsed.themeId, "teacher-dark");
    assert.equal(parsed.write, true);
  }

  {
    const parsed = parseTemplateGenerateArgs(["--write"]);
    assert.equal(parsed.themeId, null);
    assert.equal(parsed.write, true);
  }
};
