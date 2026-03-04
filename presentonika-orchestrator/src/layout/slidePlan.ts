import { extractPlaceholderLocations } from "../themes/parseDoc";
import { selectLayoutTemplate } from "./selector";
import type { LayoutCatalog, SlideLayoutPlan } from "./types";

export const buildSlideLayoutPlan = (params: {
  doc: unknown;
  catalog: LayoutCatalog;
  seed: string;
}): SlideLayoutPlan[] => {
  const placeholders = extractPlaceholderLocations(params.doc).locations;
  const keysBySlide = new Map<number, Set<string>>();

  for (const location of placeholders) {
    const set = keysBySlide.get(location.slide) || new Set<string>();
    set.add(location.key);
    keysBySlide.set(location.slide, set);
  }

  const plans: SlideLayoutPlan[] = [];

  for (const [slide, keysSet] of [...keysBySlide.entries()].sort((a, b) => a[0] - b[0])) {
    const keys = [...keysSet].sort();
    const strictCandidates = params.catalog.templates.filter((template) => {
      if (template.slide !== undefined && template.slide !== slide) return false;
      const slotKeys = new Set(template.slots.map((slot) => slot.key));
      return keys.every((key) => slotKeys.has(key));
    });

    const fallbackCandidates = strictCandidates.length > 0
      ? strictCandidates
      : params.catalog.templates.filter((template) => template.slide === undefined || template.slide === slide);

    if (fallbackCandidates.length === 0) {
      continue;
    }

    const selected = selectLayoutTemplate({
      candidates: fallbackCandidates,
      seed: `${params.seed}:s${slide}`,
    });

    plans.push({
      slide,
      templateId: selected.id,
      requiredTextKeys: keys.filter((key) => !key.startsWith("img_")),
    });
  }

  return plans;
};
