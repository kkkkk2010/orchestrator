import type { SlideType } from "./types";

const BINDINGS: Record<SlideType, Record<string, string>> = {
  cover: { title: "s1_title", subtitle: "s1_subtitle", meta: "s1_meta" },
  goals: { title: "s2_title", goals: "s2_goals", plan: "s2_plan" },
  hook: { title: "s3_title", hook_question: "s3_hook_question", hook_hint: "s3_hook_hint", hook_fact: "s3_hook_fact", hook_why: "s3_hook_why" },
  context: { title: "s4_title", definition: "s4_definition", keywords: "s4_keywords" },
  definition: { title: "s4_title", definition: "s4_definition", keywords: "s4_keywords" },
  bullets: { title: "s5_title", bullets: "s5_bullets" },
  visual_explanation: { title: "s5_title", bullets: "s5_bullets" },
  comparison: { title: "s6_title", left_title: "s6_left_title", left_bullets: "s6_left_bullets", right_title: "s6_right_title", right_bullets: "s6_right_bullets" },
  twoCol: { title: "s6_title", left_title: "s6_left_title", left_bullets: "s6_left_bullets", right_title: "s6_right_title", right_bullets: "s6_right_bullets" },
  steps: { title: "s7_title", step1: "s7_step1", step2: "s7_step2", step3: "s7_step3", step4: "s7_step4" },
  timeline: { title: "s7_title", step1: "s7_step1", step2: "s7_step2", step3: "s7_step3", step4: "s7_step4" },
  examples: { title: "s8_title", examples: "s8_examples" },
  quiz: { title: "s9_title", task: "s9_task", q1: "s9_q1", q2: "s9_q2", q3: "s9_q3" },
  summary: { title: "s10_title", summary: "s10_summary", homework: "s10_homework", sources: "s10_sources" },
};

const REQUIRED: Record<SlideType, string[]> = {
  cover: ["title"],
  goals: ["title", "goals", "plan"],
  hook: ["title"],
  context: ["title", "definition"],
  definition: ["title", "definition"],
  bullets: ["title", "bullets"],
  visual_explanation: ["title", "bullets"],
  comparison: ["title", "left_title", "left_bullets", "right_title", "right_bullets"],
  twoCol: ["title", "left_title", "left_bullets", "right_title", "right_bullets"],
  steps: ["title", "step1", "step2", "step3", "step4"],
  timeline: ["title", "step1", "step2", "step3", "step4"],
  examples: ["title", "examples"],
  quiz: ["title", "task", "q1", "q2", "q3"],
  summary: ["title", "summary", "sources"],
};

export const getSlotBindings = (slideType: SlideType): Record<string, string> => BINDINGS[slideType];
export const getRequiredSlotIds = (slideType: SlideType): string[] => REQUIRED[slideType];

export const normalizeSlotName = (slotId: string): string => slotId
  .trim()
  .replace(/[^a-zA-Z0-9_ -]+/g, "_")
  .replace(/[\s-]+/g, "_")
  .replace(/_+/g, "_")
  .replace(/^_+|_+$/g, "")
  .toLowerCase();

export const getDynamicFillKey = (slide: number, slotId: string): string => {
  const slotName = normalizeSlotName(slotId) || "text";
  return `s${slide}_${slotName}`;
};

export const getDynamicSlotBindings = (slide: number, slotIds: string[]): Record<string, string> => {
  const bindings: Record<string, string> = {};
  for (const slotId of slotIds) {
    bindings[slotId] = getDynamicFillKey(slide, slotId);
  }
  return bindings;
};
