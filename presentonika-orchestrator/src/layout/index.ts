import { buildLayoutCatalog } from "./catalog";
import { compileDocWithLayoutPlan } from "./compiler";
import { buildSlideLayoutPlan } from "./slidePlan";
import type { LayoutCompileDiagnostics } from "./types";

export const applyLayoutEngine = (params: {
  doc: unknown;
  map: unknown;
  seed: string;
}): LayoutCompileDiagnostics => {
  const catalog = buildLayoutCatalog({ doc: params.doc, map: params.map });
  const plan = buildSlideLayoutPlan({ doc: params.doc, catalog, seed: params.seed });
  return compileDocWithLayoutPlan({ doc: params.doc, catalog, plan });
};
