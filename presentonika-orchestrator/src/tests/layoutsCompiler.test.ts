import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compileLayoutPresentation } from "../layouts/compiler";
import { buildDeterministicDeckPlan, type DeckPlan } from "../deckPlan";
import { buildGammaLayoutPacks } from "../tools/buildGammaLayouts";

export const runLayoutsCompilerTests = async (): Promise<void> => {
  const layoutsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "presentonika-gamma-layouts-"));
  const previousLayoutsDir = process.env.LAYOUT_ENGINE_DIR;
  await buildGammaLayoutPacks(layoutsRoot);
  process.env.LAYOUT_ENGINE_DIR = layoutsRoot;
  const basePlan = buildDeterministicDeckPlan({
    topic: "Османская империя",
    language: "ru",
    slideCount: 10,
    presentationType: "auto",
  });
  const deckPlan: DeckPlan = {
    ...basePlan,
    slides: basePlan.slides.map((slide) => {
      if (slide.slide === 5) {
        return { ...slide, slideType: "steps", role: "process", requiredItems: [{ slot: "steps", kind: "steps", count: 3, exact: true }] };
      }
      if (slide.slide === 7) {
        return { ...slide, slideType: "examples", role: "examples_as_evidence", requiredItems: [{ slot: "examples", kind: "examples", count: 4, exact: true }] };
      }
      if (slide.slide === 8) {
        return { ...slide, slideType: "quiz", role: "check_understanding", requiredItems: [{ slot: "questions", kind: "questions", count: 2, exact: true }] };
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

  const slides = (compiled.doc as { slides: Array<{ elements: Array<{ text?: string; x?: number; y?: number; meta?: Record<string, unknown> }> }> }).slides;
  const allText = slides.flatMap((slide) => slide.elements.map((e) => e.text).filter((x): x is string => typeof x === "string")).join("\n");
  ["s1_title", "s5_step1", "s5_step3", "s7_examples", "s8_q1", "s8_q2", "s9_summary"].forEach((key) => assert.ok(allText.includes(`{{${key}}}`)));
  assert.equal(allText.includes("{{s5_step4}}"), false);
  assert.equal(allText.includes("{{s8_q3}}"), false);
  assert.equal(compiled.diagnostics.dynamicPlanUsed, true);
  assert.equal(compiled.diagnostics.selectedLayouts.find((row) => row.slide === 7)?.slideType, "examples");
  assert.equal(compiled.diagnostics.selectedLayouts.find((row) => row.slide === 8)?.slideType, "quiz");
  assert.equal(compiled.diagnostics.selectedLayouts.find((row) => row.slide === 9)?.slideType, "summary");
  assert.ok(compiled.diagnostics.dynamicBindings?.some((binding) => binding.slide === 7 && binding.fillKey === "s7_examples"));
  assert.ok(compiled.diagnostics.dynamicBindings?.some((binding) => binding.slide === 8 && binding.fillKey === "s8_q1"));
  assert.ok(compiled.diagnostics.dynamicBindings?.some((binding) => binding.slide === 9 && binding.fillKey === "s9_summary"));
  assert.ok(compiled.diagnostics.repeatGroupAdaptations?.some((row) => row.slide === 5 && row.requested === 3 && row.rendered === 3));
  assert.ok(compiled.diagnostics.repeatGroupAdaptations?.some((row) => row.slide === 8 && row.requested === 2 && row.rendered === 2));

  const stepContainers = slides[4].elements.filter((element) => element.meta?.repeatGroup === "steps" && element.meta?.adaptiveRole === "container");
  assert.equal(stepContainers.length, 3);
  const stepX = stepContainers.map((element) => element.x ?? 0);
  if (new Set(stepX).size > 1) {
    assert.equal(stepX[2], (stepX[0] + stepX[1]) / 2);
  } else {
    assert.ok((stepContainers[0].y ?? 0) > 220);
  }

  const questionContainers = slides[7].elements.filter((element) => element.meta?.repeatGroup === "questions" && element.meta?.adaptiveRole === "container");
  assert.equal(questionContainers.length, 2);
  assert.ok((questionContainers[0].y ?? 0) > 366);
  assert.ok((questionContainers[1].y ?? 0) < 606);

  const slideOneImageAt = compiled.imageAtBySlide["1"];
  if (slideOneImageAt) {
    const firstIndex = Number.parseInt(Object.keys(slideOneImageAt)[0], 10);
    const slideOne = (compiled.doc as { slides: Array<{ elements: Array<{ type?: string; name?: string }> }> }).slides[0];
    assert.equal(slideOne.elements.some((element) => element.name === "theme_background"), false);
    assert.equal(slideOne.elements[firstIndex]?.type, "image");
  }

  if (previousLayoutsDir === undefined) delete process.env.LAYOUT_ENGINE_DIR;
  else process.env.LAYOUT_ENGINE_DIR = previousLayoutsDir;
  await fs.rm(layoutsRoot, { recursive: true, force: true });
};
