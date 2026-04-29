import assert from "node:assert/strict";
import path from "node:path";
import { getThemeDir } from "../themes/themeStore";

export const runThemeStoreTests = (): void => {
  assert.equal(path.basename(getThemeDir("_example")), "_example");
  assert.equal(path.basename(getThemeDir("teacher-dark")), "teacher-dark");
  assert.equal(path.basename(getThemeDir("teacher_light")), "teacher_light");

  ["../secret", "..\\secret", "/tmp/x", "nested/theme"].forEach((themeId) => {
    assert.throws(() => getThemeDir(themeId), /ThemeIdInvalid/);
  });
};
