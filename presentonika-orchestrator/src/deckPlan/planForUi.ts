import type { DeckPlan, DeckPlanRequiredItem, DeckPlanVisualSuggestion } from "./schema";
import type { PlanDiagnosticWarning } from "./planner";

export type DeckPlanUiWarning = {
  code: string;
  severity: "info" | "warn";
  slide?: number;
  message: string;
};

export type DeckPlanForUiSlide = {
  slide: number;
  slideType: DeckPlan["slides"][number]["slideType"];
  role: string;
  titleIntent: string;
  claim: string;
  mustInclude: string[];
  mustAvoid: string[];
  expectedEvidence: string[];
  requiredItems: DeckPlanRequiredItem[];
  visualSuggestions: DeckPlanVisualSuggestion[];
  editable: true;
};

export type DeckPlanForUi = {
  version: 1;
  topic: string;
  subject?: string;
  grade?: string;
  language: string;
  slideCount: number;
  presentationType: DeckPlan["presentationType"];
  centralQuestion: string;
  thesis: string;
  audience?: string;
  slides: DeckPlanForUiSlide[];
  editableFields: {
    basic: string[];
    advanced: string[];
  };
  hiddenFields: string[];
  uiWarnings: DeckPlanUiWarning[];
};

export const buildPlanForUi = (deckPlan: DeckPlan, warnings: PlanDiagnosticWarning[] = []): DeckPlanForUi => ({
  version: 1,
  topic: deckPlan.topic,
  subject: deckPlan.subject,
  grade: deckPlan.grade,
  language: deckPlan.language,
  slideCount: deckPlan.slideCount,
  presentationType: deckPlan.presentationType,
  centralQuestion: deckPlan.centralQuestion,
  thesis: deckPlan.thesis,
  audience: deckPlan.audience,
  slides: deckPlan.slides.map((slide) => ({
    slide: slide.slide,
    slideType: slide.slideType,
    role: slide.role,
    titleIntent: slide.titleIntent,
    claim: slide.claim,
    mustInclude: slide.mustInclude,
    mustAvoid: slide.mustAvoid,
    expectedEvidence: slide.expectedEvidence,
    requiredItems: slide.requiredItems,
    visualSuggestions: slide.visualSuggestions,
    editable: true,
  })),
  editableFields: {
    basic: [
      "centralQuestion",
      "thesis",
      "presentationType",
      "slides[].slideType",
      "slides[].role",
      "slides[].titleIntent",
      "slides[].claim",
      "slides[].mustInclude",
      "slides[].mustAvoid",
    ],
    advanced: [
      "slides[].requiredItems",
      "slides[].visualSuggestions",
    ],
  },
  hiddenFields: [
    "selectedLayoutId",
    "resolvedLayoutSlideType",
    "fillKeys",
    "deckPlanRoute",
    "diagnostics",
    "layoutIds",
    "imageAt",
  ],
  uiWarnings: warnings.map((warning) => ({
    code: warning.code,
    severity: warning.severity,
    slide: warning.slide,
    message: warning.message,
  })),
});
