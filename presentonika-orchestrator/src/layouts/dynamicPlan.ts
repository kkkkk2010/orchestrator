import type { DeckPlan, DeckPlanRequiredItem } from "../deckPlan";
import type { SlidePlanRow, SlideType } from "./types";

const defaultSlotsBySlideType: Record<SlideType, string[]> = {
  cover: ["title", "subtitle", "meta"],
  goals: ["title", "goals", "plan"],
  hook: ["title", "hook_question", "hook_hint", "hook_fact", "hook_why"],
  context: ["title", "definition", "keywords"],
  definition: ["title", "definition", "keywords"],
  bullets: ["title", "bullets"],
  visual_explanation: ["title", "bullets"],
  comparison: ["title", "left_title", "left_bullets", "right_title", "right_bullets"],
  twoCol: ["title", "left_title", "left_bullets", "right_title", "right_bullets"],
  steps: ["title", "step1", "step2", "step3", "step4"],
  timeline: ["title", "step1", "step2", "step3", "step4"],
  examples: ["title", "examples"],
  quiz: ["title", "task", "q1", "q2", "q3"],
  summary: ["title", "summary", "homework", "sources"],
};

const kindSlots = (item: DeckPlanRequiredItem): string[] => {
  if (item.slot) return [item.slot];
  const keySuffix = item.key?.match(/^s\d+_(.+)$/i)?.[1];
  if (keySuffix) return [keySuffix];
  switch (item.kind) {
    case "bullets": return ["bullets"];
    case "examples": return ["examples"];
    case "questions": return ["q1", "q2", "q3"];
    case "terms": return ["keywords"];
    case "steps": return ["step1", "step2", "step3", "step4"];
    case "summary": return ["summary"];
    case "route_items": return ["plan"];
    default: return [];
  }
};

export type CompiledSlidePlanRow = SlidePlanRow & {
  role: string;
  claim: string;
  titleIntent: string;
  requiredItems: DeckPlanRequiredItem[];
  expectedEvidence: string[];
  slotsNeeded: string[];
};

export type DynamicSlidePlanDiagnostics = {
  dynamicPlanUsed: true;
  deckPlanSlideCount: number;
  compiledSlideTypes: Array<{ slide: number; slideType: SlideType; role?: string }>;
  fallbackSlotInferences: Array<{ slide: number; slideType: SlideType; slots: string[] }>;
  unsupportedSlideTypes: string[];
};

export const getDefaultSlotsForSlideType = (slideType: SlideType): string[] => defaultSlotsBySlideType[slideType] || ["title", "bullets"];

export const buildDynamicSlidePlan = (deckPlan: DeckPlan): { rows: CompiledSlidePlanRow[]; diagnostics: DynamicSlidePlanDiagnostics } => {
  const fallbackSlotInferences: DynamicSlidePlanDiagnostics["fallbackSlotInferences"] = [];
  const unsupportedSlideTypes: string[] = [];

  const rows = deckPlan.slides
    .slice()
    .sort((a, b) => a.slide - b.slide)
    .map((slide) => {
      const defaults = getDefaultSlotsForSlideType(slide.slideType as SlideType);
      if (defaults.length === 0) unsupportedSlideTypes.push(String(slide.slideType));
      const requiredSlots = slide.requiredItems.flatMap(kindSlots);
      const slotsNeeded = [...new Set(["title", ...defaults, ...requiredSlots])];
      fallbackSlotInferences.push({ slide: slide.slide, slideType: slide.slideType as SlideType, slots: slotsNeeded });
      return {
        slide: slide.slide,
        slideType: slide.slideType as SlideType,
        role: slide.role,
        claim: slide.claim,
        titleIntent: slide.titleIntent,
        requiredSlotIds: slotsNeeded,
        requiredItems: slide.requiredItems,
        expectedEvidence: slide.expectedEvidence,
        slotsNeeded,
      };
    });

  return {
    rows,
    diagnostics: {
      dynamicPlanUsed: true,
      deckPlanSlideCount: deckPlan.slideCount,
      compiledSlideTypes: rows.map((row) => ({ slide: row.slide, slideType: row.slideType, role: row.role })),
      fallbackSlotInferences,
      unsupportedSlideTypes,
    },
  };
};
