import assert from "node:assert/strict";
import { compileLayoutPresentation } from "../layouts/compiler";

export const runLayoutsWorkerSmokeTests = async (): Promise<void> => {
  const prev = process.env.LAYOUT_ENGINE_DIR;
  process.env.LAYOUT_ENGINE_DIR = ".tmp/no-layouts-here";
  const compiled = await compileLayoutPresentation({
    presentationId: 99,
    themeId: "teacher-light",
    jobId: "test-layout-worker-smoke",
    variation: true,
    legacyTemplateZipPath: "",
  });
  process.env.LAYOUT_ENGINE_DIR = prev;

  assert.equal(compiled.diagnostics.mode, "builtins");
  assert.equal(compiled.diagnostics.selectedLayouts.length, 10);
};
