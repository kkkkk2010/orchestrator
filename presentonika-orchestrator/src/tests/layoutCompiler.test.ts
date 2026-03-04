import assert from "node:assert/strict";
import { buildLayoutCatalog } from "../layout/catalog";
import { compileDocWithLayoutPlan } from "../layout/compiler";
import { buildSlideLayoutPlan } from "../layout/slidePlan";

const baseDoc = {
  slides: [
    {
      elements: [
        { type: "text", text: "{{s1_title}}" },
      ],
    },
  ],
};

export const runLayoutCompilerTests = (): void => {
  const doc = JSON.parse(JSON.stringify(baseDoc));
  const catalog = buildLayoutCatalog({ doc, map: {} });
  const plan = buildSlideLayoutPlan({ doc, catalog, seed: "demo" });
  const diagnostics = compileDocWithLayoutPlan({ doc, catalog, plan });

  assert.ok(diagnostics.selectedLayouts.length >= 1);
  const firstSlide = (doc.slides[0] as { elements: Array<{ text?: string }> });
  const hasTitle = firstSlide.elements.some((element) => element.text === "{{s1_title}}");
  assert.equal(hasTitle, true);
};
