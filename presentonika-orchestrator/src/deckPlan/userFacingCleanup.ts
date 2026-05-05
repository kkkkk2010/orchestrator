import type { DeckPlanSlide } from "./schema";

export type UserFacingCleanupWarning = {
  code: string;
  severity: "info" | "warn";
  slide?: number;
  message: string;
  sample?: string;
};

export const hasCjkScript = (value: string): boolean => /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/u.test(value);

export const hasIncompatibleScriptForLanguage = (language: string, value: string): boolean => (
  language.toLowerCase().startsWith("ru") && hasCjkScript(value)
);

const isHomeworkSourcesSlide = (slide: Pick<DeckPlanSlide, "slideType" | "role" | "titleIntent" | "claim">): boolean => (
  slide.slideType === "summary"
  && /homework_sources|homework|sources|closing|домаш|источник|закреп|дополнитель/i.test(`${slide.role} ${slide.titleIntent} ${slide.claim}`)
);

const fallbackBySlideTypeRu = (slide: DeckPlanSlide): string[] => {
  switch (slide.slideType) {
    case "cover":
      return ["Название темы", "Главный вопрос урока", "Краткий визуальный образ темы"];
    case "goals":
      return ["3 цели урока", "Короткий маршрут объяснения", "Связь целей с главным вопросом"];
    case "hook":
      return ["Проблемный вопрос", "Короткая интрига темы", "Связь вопроса с дальнейшим объяснением"];
    case "context":
    case "definition":
      return ["Ключевой контекст", "Основные термины простым языком", "Связь с главным вопросом"];
    case "bullets":
      return ["Главные идеи с объяснением значения", "Причинно-следственные связи", "Факты без чрезмерных обобщений"];
    case "comparison":
    case "twoCol":
      return ["Две стороны сравнения", "Критерии сравнения", "Вывод из сравнения"];
    case "steps":
    case "timeline":
      return ["Ключевые этапы с датами", "Значение каждого этапа", "Причинно-следственные связи"];
    case "examples":
      return ["Конкретные примеры", "Объяснение, что доказывает каждый пример", "Связь с тезисом урока"];
    case "quiz":
      return ["3 вопроса на понимание", "Вопросы не только на память", "Проверка центрального аргумента"];
    case "summary":
      return isHomeworkSourcesSlide(slide)
        ? ["Домашнее задание или следующий шаг", "Дополнительные источники по теме", "Короткое закрепление вывода"]
        : ["3 главных вывода", "Ответ на центральный вопрос", "Домашнее задание или следующий шаг, если уместно"];
    case "visual_explanation":
      return ["Главная схема или визуальный образ", "Краткое объяснение элементов", "Связь визуала с тезисом"];
    default:
      return ["Главная мысль слайда", "Связь с темой урока", "Короткий вывод"];
  }
};

const fallbackBySlideTypeEn = (slide: DeckPlanSlide): string[] => {
  switch (slide.slideType) {
    case "cover":
      return ["Topic title", "Central lesson question", "Brief visual anchor"];
    case "goals":
      return ["3 lesson goals", "Short route of explanation", "Connection to the central question"];
    case "timeline":
    case "steps":
      return ["Key stages", "Meaning of each stage", "Cause-and-effect links"];
    case "examples":
      return ["Concrete examples", "What each example proves", "Connection to the lesson thesis"];
    case "quiz":
      return ["3 understanding questions", "Questions beyond memory", "Check of the central argument"];
    case "summary":
      return isHomeworkSourcesSlide(slide)
        ? ["Homework or next step", "Additional sources", "Short consolidation of the conclusion"]
        : ["3 main conclusions", "Answer to the central question", "Homework or next step if useful"];
    default:
      return ["Main slide idea", "Connection to the lesson route", "Short takeaway"];
  }
};

const requiredItemHintRu = (kind: string): string | undefined => {
  switch (kind) {
    case "terms":
      return "Ключевые термины без длинного словарика";
    case "examples":
      return "Примеры как доказательство тезиса";
    case "questions":
      return "Вопросы на понимание, а не только на память";
    case "steps":
      return "Этапы и значение каждого шага";
    case "route_items":
      return "Маршрут объяснения";
    case "bullets":
      return "Смысловые пункты с объяснением значения";
    case "summary":
      return "Краткий вывод по слайду";
    default:
      return undefined;
  }
};

const requiredItemHintEn = (kind: string): string | undefined => {
  switch (kind) {
    case "terms":
      return "Compact key terms";
    case "examples":
      return "Examples as evidence for the thesis";
    case "questions":
      return "Understanding questions, not only memory checks";
    case "steps":
      return "Stages and the meaning of each step";
    case "route_items":
      return "Route of explanation";
    case "bullets":
      return "Meaningful points with explanation";
    case "summary":
      return "Short slide conclusion";
    default:
      return undefined;
  }
};

const unique = (items: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items.map((value) => value.trim()).filter(Boolean)) {
    const normalized = item.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(item);
  }
  return out;
};

export const fallbackMustIncludeForSlide = (slide: DeckPlanSlide, language: string): string[] => {
  const ru = language.toLowerCase().startsWith("ru");
  const base = ru ? fallbackBySlideTypeRu(slide) : fallbackBySlideTypeEn(slide);
  const itemHints = slide.requiredItems
    .map((item) => (ru ? requiredItemHintRu(item.kind) : requiredItemHintEn(item.kind)))
    .filter((item): item is string => Boolean(item));
  const visualHint = slide.visualSuggestions.length > 0
    ? (ru ? "Визуальная опора для темы" : "Visual support for the topic")
    : undefined;
  return unique([...base, ...itemHints, visualHint || ""]).slice(0, 4);
};

export const sanitizeUserFacingText = (params: {
  value: string;
  fallback: string;
  language: string;
  path: string;
  slide?: number;
  warnings?: UserFacingCleanupWarning[];
}): string => {
  const value = params.value.trim();
  if (!hasIncompatibleScriptForLanguage(params.language, value)) return value;
  params.warnings?.push({
    code: "language_script_mismatch",
    severity: "warn",
    slide: params.slide,
    message: `${params.path} contains characters outside the requested language script; deterministic fallback was used.`,
    sample: value.slice(0, 120),
  });
  return params.fallback;
};

export const sanitizeUserFacingArray = (params: {
  values: string[];
  fallbackValues: string[];
  language: string;
  path: string;
  slide?: number;
  warnings?: UserFacingCleanupWarning[];
  maxItems?: number;
}): string[] => {
  const kept: string[] = [];
  for (const value of params.values) {
    if (hasIncompatibleScriptForLanguage(params.language, value)) {
      params.warnings?.push({
        code: "language_script_mismatch",
        severity: "warn",
        slide: params.slide,
        message: `${params.path} contains characters outside the requested language script; item was removed.`,
        sample: value.slice(0, 120),
      });
      continue;
    }
    if (value.trim()) kept.push(value.trim());
  }
  const result = kept.length > 0 ? kept : params.fallbackValues;
  return unique(result).slice(0, params.maxItems || 10);
};
