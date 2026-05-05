import assert from "node:assert/strict";
import { compileLayoutPresentation } from "../layouts/compiler";
import { buildDeterministicDeckPlan, type DeckPlan } from "../deckPlan";

export const runLayoutsCompilerTests = async (): Promise<void> => {
  const basePlan = buildDeterministicDeckPlan({
    topic: "Османская империя",
    language: "ru",
    slideCount: 10,
    presentationType: "auto",
  });
  const deckPlan: DeckPlan = {
    ...basePlan,
    slides: basePlan.slides.map((slide) => {
      if (slide.slide === 7) {
        return { ...slide, slideType: "examples", role: "examples_as_evidence", requiredItems: [{ slot: "examples", kind: "examples", count: 4, exact: true }] };
      }
      if (slide.slide === 8) {
        return { ...slide, slideType: "quiz", role: "check_understanding", requiredItems: [{ slot: "questions", kind: "questions", count: 3, exact: true }] };
      }
      if (slide.slide === 9) {
        return { ...slide, slideType: "summary", role: "conclusion", requiredItems: [{ slot: "summary", kind: "summary", count: 3, exact: true }] };
      }
      return slide;
    }),
  };
  const compiled = await compileLayoutPresentation({
    presentationId: 1,
    themeId: "teacher-dark",
    jobId: "test-layout-compiler",
    variation: true,
    legacyTemplateZipPath: "",
    deckPlan,
  });

  const slides = (compiled.doc as { slides: Array<{ elements: Array<{ text?: string }> }> }).slides;
  const allText = slides.flatMap((slide) => slide.elements.map((e) => e.text).filter((x): x is string => typeof x === "string")).join("\n");
  ["s1_title", "s5_bullets", "s7_examples", "s8_q1", "s9_summary"].forEach((key) => assert.ok(allText.includes(`{{${key}}}`)));
  assert.equal(compiled.diagnostics.dynamicPlanUsed, true);
  assert.equal(compiled.diagnostics.selectedLayouts.find((row) => row.slide === 7)?.slideType, "examples");
  assert.equal(compiled.diagnostics.selectedLayouts.find((row) => row.slide === 8)?.slideType, "quiz");
  assert.equal(compiled.diagnostics.selectedLayouts.find((row) => row.slide === 9)?.slideType, "summary");
  assert.ok(compiled.diagnostics.dynamicBindings?.some((binding) => binding.slide === 7 && binding.fillKey === "s7_examples"));
  assert.ok(compiled.diagnostics.dynamicBindings?.some((binding) => binding.slide === 8 && binding.fillKey === "s8_q1"));
  assert.ok(compiled.diagnostics.dynamicBindings?.some((binding) => binding.slide === 9 && binding.fillKey === "s9_summary"));

  const slideOneImageAt = compiled.imageAtBySlide["1"];
  if (slideOneImageAt) {
    const firstIndex = Number.parseInt(Object.keys(slideOneImageAt)[0], 10);
    const slideOne = (compiled.doc as { slides: Array<{ elements: Array<{ type?: string; name?: string }> }> }).slides[0];
    assert.equal(slideOne.elements.some((element) => element.name === "theme_background"), false);
    assert.equal(slideOne.elements[firstIndex]?.type, "image");
  }
};
