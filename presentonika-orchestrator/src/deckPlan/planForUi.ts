import type { DeckPlan, DeckPlanRequiredItem, DeckPlanVisualSuggestion } from "./schema";
import type { PlanDiagnosticWarning } from "./planner";
import {
  fallbackMustIncludeForSlide,
  hasIncompatibleScriptForLanguage,
  sanitizeUserFacingArray,
  sanitizeUserFacingText,
  type UserFacingCleanupWarning,
} from "./userFacingCleanup";

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

const toUiWarning = (warning: PlanDiagnosticWarning | UserFacingCleanupWarning): DeckPlanUiWarning => ({
  code: warning.code,
  severity: warning.severity,
  slide: warning.slide,
  message: warning.message,
});

const sanitizeOptionalUiText = (params: {
  value?: string;
  language: string;
  path: string;
  slide?: number;
  warnings: UserFacingCleanupWarning[];
}): string | undefined => {
  if (!params.value) return undefined;
  if (!hasIncompatibleScriptForLanguage(params.language, params.value)) return params.value;
  params.warnings.push({
    code: "language_script_mismatch",
    severity: "warn",
    slide: params.slide,
    message: `${params.path} contains characters outside the requested language script; item was removed.`,
    sample: params.value.slice(0, 120),
  });
  return undefined;
};

export const buildPlanForUi = (deckPlan: DeckPlan, warnings: PlanDiagnosticWarning[] = []): DeckPlanForUi => {
  const cleanupWarnings: UserFacingCleanupWarning[] = [];
  const language = deckPlan.language;
  const centralQuestionFallback = language.toLowerCase().startsWith("ru")
    ? `Почему тема «${deckPlan.topic}» важна для понимания урока?`
    : `Why does "${deckPlan.topic}" matter for this lesson?`;
  const thesisFallback = language.toLowerCase().startsWith("ru")
    ? `${deckPlan.topic}: объяснить ключевые причины, механизмы и выводы через связный маршрут урока.`
    : `${deckPlan.topic}: explain the key causes, mechanisms, and conclusions through a coherent lesson route.`;
  const slides = deckPlan.slides.map((slide): DeckPlanForUiSlide => ({
    slide: slide.slide,
    slideType: slide.slideType,
    role: sanitizeUserFacingText({
      value: slide.role,
      fallback: slide.slideType,
      language,
      path: `slides.${slide.slide}.role`,
      slide: slide.slide,
      warnings: cleanupWarnings,
    }),
    titleIntent: sanitizeUserFacingText({
      value: slide.titleIntent,
      fallback: fallbackMustIncludeForSlide(slide, language)[0] || "Slide purpose",
      language,
      path: `slides.${slide.slide}.titleIntent`,
      slide: slide.slide,
      warnings: cleanupWarnings,
    }),
    claim: sanitizeUserFacingText({
      value: slide.claim,
      fallback: language.toLowerCase().startsWith("ru") ? "Продвинуть главный вопрос урока." : "Advance the central lesson question.",
      language,
      path: `slides.${slide.slide}.claim`,
      slide: slide.slide,
      warnings: cleanupWarnings,
    }),
    mustInclude: sanitizeUserFacingArray({
      values: slide.mustInclude,
      fallbackValues: fallbackMustIncludeForSlide(slide, language),
      language,
      path: `slides.${slide.slide}.mustInclude`,
      slide: slide.slide,
      warnings: cleanupWarnings,
      maxItems: 4,
    }),
    mustAvoid: sanitizeUserFacingArray({
      values: slide.mustAvoid,
      fallbackValues: [],
      language,
      path: `slides.${slide.slide}.mustAvoid`,
      slide: slide.slide,
      warnings: cleanupWarnings,
    }),
    expectedEvidence: sanitizeUserFacingArray({
      values: slide.expectedEvidence,
      fallbackValues: [],
      language,
      path: `slides.${slide.slide}.expectedEvidence`,
      slide: slide.slide,
      warnings: cleanupWarnings,
    }),
    requiredItems: slide.requiredItems.map((item) => ({
      ...item,
      description: sanitizeOptionalUiText({
        value: item.description,
        language,
        path: `slides.${slide.slide}.requiredItems.description`,
        slide: slide.slide,
        warnings: cleanupWarnings,
      }),
    })),
    visualSuggestions: slide.visualSuggestions.flatMap((suggestion) => {
      const description = sanitizeOptionalUiText({
        value: suggestion.description,
        language,
        path: `slides.${slide.slide}.visualSuggestions.description`,
        slide: slide.slide,
        warnings: cleanupWarnings,
      });
      return description ? [{ ...suggestion, description }] : [];
    }),
    editable: true,
  }));

  return {
    version: 1,
    topic: deckPlan.topic,
    subject: deckPlan.subject,
    grade: deckPlan.grade,
    language: deckPlan.language,
    slideCount: deckPlan.slideCount,
    presentationType: deckPlan.presentationType,
    centralQuestion: sanitizeUserFacingText({
      value: deckPlan.centralQuestion,
      fallback: centralQuestionFallback,
      language,
      path: "centralQuestion",
      warnings: cleanupWarnings,
    }),
    thesis: sanitizeUserFacingText({
      value: deckPlan.thesis,
      fallback: thesisFallback,
      language,
      path: "thesis",
      warnings: cleanupWarnings,
    }),
    audience: deckPlan.audience,
    slides,
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
    uiWarnings: [
      ...warnings.filter((warning) => warning.code !== "empty_must_include").map(toUiWarning),
      ...cleanupWarnings.map(toUiWarning),
    ],
  };
};
