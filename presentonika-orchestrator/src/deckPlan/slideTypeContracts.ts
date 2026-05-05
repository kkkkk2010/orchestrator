import type { DeckPlanRequiredItem, DeckPlanSlideType } from "./schema";

export type SlideTypeSlotContract = {
  slideType: DeckPlanSlideType;
  allowedSlots: string[];
  contentCountSlots: string[];
  defaultRequiredItems?: DeckPlanRequiredItem[];
  notes: string[];
  fallback?: DeckPlanSlideType;
};

export const normalizeDeckPlanSlot = (slot?: string): string | undefined => slot
  ?.trim()
  .toLowerCase()
  .replace(/[^a-z0-9_]+/gi, "_")
  .replace(/_+/g, "_")
  .replace(/^_+|_+$/g, "");

export const nonCountedDeckPlanSlots = new Set([
  "title",
  "subtitle",
  "meta",
  "caption",
  "image",
  "sources",
  "homework",
  "task",
]);

export const slideTypeSlotContracts: Record<DeckPlanSlideType, SlideTypeSlotContract> = {
  cover: {
    slideType: "cover",
    allowedSlots: ["title", "subtitle", "meta"],
    contentCountSlots: [],
    notes: ["Do not create requiredItems for title/subtitle/meta."],
  },
  goals: {
    slideType: "goals",
    allowedSlots: ["title", "goals", "plan"],
    contentCountSlots: ["goals", "plan"],
    defaultRequiredItems: [
      { slot: "goals", kind: "bullets", count: 3, exact: true },
      { slot: "plan", kind: "route_items", count: 3, exact: true },
    ],
    notes: ["Goals and route are countable; title is not."],
  },
  hook: {
    slideType: "hook",
    allowedSlots: ["title", "hook_question", "hook_hint", "hook_fact", "hook_why"],
    contentCountSlots: ["hook_question"],
    defaultRequiredItems: [
      { slot: "hook_question", kind: "questions", count: 1, exact: true },
    ],
    notes: ["Problem questions belong to hook_question, not title."],
  },
  context: {
    slideType: "context",
    allowedSlots: ["title", "definition", "keywords"],
    contentCountSlots: ["definition", "keywords"],
    notes: ["Use definition for explanatory text and keywords for compact terms."],
  },
  definition: {
    slideType: "definition",
    allowedSlots: ["title", "definition", "keywords"],
    contentCountSlots: ["definition", "keywords"],
    notes: ["Terms belong to keywords; explanation belongs to definition."],
  },
  bullets: {
    slideType: "bullets",
    allowedSlots: ["title", "bullets"],
    contentCountSlots: ["bullets"],
    defaultRequiredItems: [
      { slot: "bullets", kind: "bullets", count: 5, exact: true },
    ],
    notes: ["Bullet counts apply only to bullets."],
  },
  comparison: {
    slideType: "comparison",
    allowedSlots: ["title", "left_title", "left_bullets", "right_title", "right_bullets"],
    contentCountSlots: ["left_bullets", "right_bullets"],
    defaultRequiredItems: [
      { slot: "left_bullets", kind: "bullets", count: 3, exact: true },
      { slot: "right_bullets", kind: "bullets", count: 3, exact: true },
    ],
    notes: ["Split comparison content into left/right bullet columns."],
  },
  twoCol: {
    slideType: "twoCol",
    allowedSlots: ["title", "left_title", "left_bullets", "right_title", "right_bullets"],
    contentCountSlots: ["left_bullets", "right_bullets"],
    defaultRequiredItems: [
      { slot: "left_bullets", kind: "bullets", count: 3, exact: true },
      { slot: "right_bullets", kind: "bullets", count: 3, exact: true },
    ],
    notes: ["Split two-column content into left/right bullet columns."],
  },
  steps: {
    slideType: "steps",
    allowedSlots: ["title", "steps", "step1", "step2", "step3", "step4"],
    contentCountSlots: ["steps", "step1", "step2", "step3", "step4"],
    defaultRequiredItems: [
      { slot: "steps", kind: "steps", count: 4, exact: true },
    ],
    notes: ["steps maps to split step keys when the layout uses step1..step4."],
  },
  timeline: {
    slideType: "timeline",
    allowedSlots: ["title", "steps", "step1", "step2", "step3", "step4"],
    contentCountSlots: ["steps", "step1", "step2", "step3", "step4"],
    defaultRequiredItems: [
      { slot: "steps", kind: "steps", count: 4, exact: true },
    ],
    notes: ["Timeline text belongs to steps/step1..step4."],
  },
  examples: {
    slideType: "examples",
    allowedSlots: ["title", "examples"],
    contentCountSlots: ["examples"],
    defaultRequiredItems: [
      { slot: "examples", kind: "examples", count: 4, exact: true },
    ],
    notes: ["Examples belong to examples and should support the claim."],
  },
  quiz: {
    slideType: "quiz",
    allowedSlots: ["title", "task", "questions", "q1", "q2", "q3"],
    contentCountSlots: ["questions", "q1", "q2", "q3"],
    defaultRequiredItems: [
      { slot: "questions", kind: "questions", count: 3, exact: true },
    ],
    notes: ["Questions map to questions or q1/q2/q3; task is not counted."],
  },
  summary: {
    slideType: "summary",
    allowedSlots: ["title", "summary", "homework", "sources"],
    contentCountSlots: ["summary"],
    defaultRequiredItems: [
      { slot: "summary", kind: "summary", count: 3, exact: true },
    ],
    notes: ["Summary is countable; homework and sources are allowed but not counted by default."],
  },
  visual_explanation: {
    slideType: "visual_explanation",
    allowedSlots: ["title", "definition", "bullets", "image", "caption"],
    contentCountSlots: ["definition", "bullets"],
    defaultRequiredItems: [
      { slot: "bullets", kind: "bullets", count: 3, exact: false },
    ],
    notes: ["Use definition or bullets for text; visual ideas belong to visualSuggestions."],
    fallback: "bullets",
  },
};

export const getSlideTypeContract = (slideType: DeckPlanSlideType): SlideTypeSlotContract => slideTypeSlotContracts[slideType];

export const isAllowedSlotForSlideType = (slideType: DeckPlanSlideType, slot?: string): boolean => {
  const normalized = normalizeDeckPlanSlot(slot);
  if (!normalized) return false;
  return getSlideTypeContract(slideType).allowedSlots.includes(normalized);
};

export const isCountableSlotForSlideType = (slideType: DeckPlanSlideType, slot?: string): boolean => {
  const normalized = normalizeDeckPlanSlot(slot);
  if (!normalized || nonCountedDeckPlanSlots.has(normalized)) return false;
  return getSlideTypeContract(slideType).contentCountSlots.includes(normalized);
};

export const slotContractsPromptText = (): string => Object.values(slideTypeSlotContracts)
  .map((contract) => [
    `${contract.slideType}: allowedSlots=${contract.allowedSlots.join(",")}; contentCountSlots=${contract.contentCountSlots.join(",") || "none"}`,
    contract.defaultRequiredItems?.length
      ? `defaults=${contract.defaultRequiredItems.map((item) => `${item.slot}:${item.kind}:${item.count}${item.exact ? ":exact" : ""}`).join(",")}`
      : "",
    contract.notes.length ? `notes=${contract.notes.join(" ")}` : "",
  ].filter(Boolean).join("; "))
  .join("\n");
