import assert from "node:assert/strict";
import { compileLayoutPresentation } from "../layouts/compiler";

export const runLayoutsCompilerTests = async (): Promise<void> => {
  const compiled = await compileLayoutPresentation({
    presentationId: 1,
    themeId: "teacher-dark",
    jobId: "test-layout-compiler",
    variation: true,
    legacyTemplateZipPath: "",
  });

  const slides = (compiled.doc as { slides: Array<{ elements: Array<{ text?: string }> }> }).slides;
  const allText = slides.flatMap((slide) => slide.elements.map((e) => e.text).filter((x): x is string => typeof x === "string")).join("\n");
  ["s1_title", "s5_bullets", "s10_sources"].forEach((key) => assert.ok(allText.includes(`{{${key}}}`)));
};
