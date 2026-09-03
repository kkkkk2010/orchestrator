import type { ImagePlanSlot } from "./imagePlan";

const STOP_WORDS = new Set([
  "и", "в", "на", "по", "для", "что", "это", "как", "при", "или", "а", "с", "к", "из", "о",
  "the", "of", "to", "for", "with",
]);

const GENERIC_SLIDE_WORDS = new Set([
  "презентация", "слайд", "тема", "урок", "знания", "проверка", "вопрос", "вопросы", "ответ", "ответы",
  "главное", "итог", "итоги", "вывод", "выводы", "понятие", "понятия", "материал", "информация",
]);

const ABSTRACT_WORDS = new Set([
  "важность", "значение", "развитие", "успех", "будущее", "влияние", "актуальность", "современный",
  "современная", "современное", "основной", "основная", "ключевой", "ключевая", "роль", "идея", "идеи",
]);

const ABSTRACT_WORD_STEMS = [
  "важност", "значени", "развити", "успех", "будущ", "влияни", "актуальност", "современн",
  "основн", "ключев", "рол", "иде", "обществ",
];

const VISUAL_MEDIUM_PATTERN = /(?:^|\s)(фото(?:графия)?|портрет|микрофотография|схема|диаграмма|инфографика|иллюстрация|рисунок|карта|таймлайн)(?:$|\s)/i;

const extractSlideFromKey = (key: string): number => {
  const match = key.match(/s(\d+)_/i);
  if (!match?.[1]) return 1;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const pickSlideType = (items: Array<{ key: string; value: string }>): string => {
  const joined = items.map((item) => `${item.key} ${item.value}`).join(" ").toLowerCase();
  if (joined.includes("step") || joined.includes("timeline") || joined.includes("chron")) return "chronology";
  if (/сравнен|comparison|left_|right_/.test(joined)) return "comparison";
  if (/этап|процесс|цикл|последовательност/.test(joined)) return "process";
  if (/проверка знаний|задани|тест|quiz|question|_q\d+/.test(joined)) return "task";
  if (joined.includes("example")) return "examples";
  if (joined.includes("fact") || joined.includes("keywords")) return "facts";
  if (joined.includes("definition")) return "definition";
  if (joined.includes("task") || joined.includes("homework")) return "task";
  if (joined.includes("summary") || joined.includes("sources") || joined.includes("meta")) return "summary";
  return "general";
};

const wordsFromText = (text: string): string[] => text
  .replace(/[^\p{L}\p{N}\s-]/gu, " ")
  .split(/\s+/)
  .map((word) => word.trim())
  .filter((word) => word.length > 0);

const keywordsFromText = (text: string): string[] => {
  const words = wordsFromText(text)
    .map((w) => w.toLowerCase())
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word) && !GENERIC_SLIDE_WORDS.has(word));

  const freq = new Map<string, number>();
  words.forEach((w) => freq.set(w, (freq.get(w) || 0) + 1));
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 10)
    .map(([word]) => word);
};

export const extractEntities = (summaryText: string): string[] => {
  const entities = new Set<string>();
  const years = summaryText.match(/\b(1[7-9]\d{2}|20\d{2})(?:[–-](1[7-9]\d{2}|20\d{2}))?\b/g) || [];
  years.forEach((year) => entities.add(year));

  const titleCase = summaryText.match(/\b[А-ЯЁA-Z][а-яёa-z]{3,}(?:\s+[А-ЯЁA-Z][а-яёa-z]{2,})*/g) || [];
  titleCase.forEach((item) => entities.add(item.trim()));

  const longTerms = wordsFromText(summaryText).filter((w) => w.length >= 6 && /[А-Яа-яA-Za-z]/.test(w));
  longTerms.slice(0, 8).forEach((term) => entities.add(term));

  return [...entities].slice(0, 8);
};

export type SlideSummary = {
  slide: number;
  title: string;
  keywords: string[];
  entities: string[];
  slideType: string;
  summary: string;
};

export const buildSlideSummaries = (fills: Record<string, string>, slideCount: number): Record<number, SlideSummary> => {
  const bySlide = new Map<number, Array<{ key: string; value: string }>>();

  for (const [key, value] of Object.entries(fills)) {
    const slide = extractSlideFromKey(key);
    if (!bySlide.has(slide)) bySlide.set(slide, []);
    bySlide.get(slide)?.push({ key, value });
  }

  const summaries: Record<number, SlideSummary> = {};
  for (let slide = 1; slide <= slideCount; slide += 1) {
    const items = bySlide.get(slide) || [];
    const title = items.find((item) => item.key.includes("_title"))?.value || "";
    const slideType = pickSlideType(items);
    const textBlob = items.map((item) => item.value).join(" ");
    const keywords = keywordsFromText(`${title} ${textBlob}`).slice(0, 6);
    const summaryRaw = `${title}. ${keywords.join(", ")}. Тип: ${slideType}`.replace(/\s+/g, " ").trim();
    const summary = summaryRaw.length > 220 ? summaryRaw.slice(0, 220).trim() : summaryRaw;
    const entities = extractEntities(summary);

    summaries[slide] = { slide, title, keywords, entities, slideType, summary };
  }

  return summaries;
};

const normalizeQuery = (query: string): string => query
  .toLowerCase()
  .replace(/[()\[\],.!?:;"'«»]/g, " ")
  .replace(/\b(слайд|фото|изображение)\b/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const slideTypeNoun = (slideType: string): string => {
  if (slideType === "chronology") return "архивная фотография";
  if (slideType === "examples" || slideType === "facts") return "документальная фотография";
  if (slideType === "definition") return "научная схема";
  if (slideType === "comparison") return "схема сравнения";
  if (slideType === "process") return "схема процесса";
  if (slideType === "summary") return "научная иллюстрация";
  return "";
};

const dedupeTokens = (text: string): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of wordsFromText(text)) {
    const normalized = token.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(token);
  }
  return out;
};

export const compressQuery = (query: string, _topicWords: string[]): { query: string; compressionApplied: boolean } => {
  const tokens = dedupeTokens(query)
    .filter((token) => !STOP_WORDS.has(token.toLowerCase()))
    .filter((token) => !GENERIC_SLIDE_WORDS.has(token.toLowerCase()));

  const strong = tokens.filter((token) => token.length > 2 || /\d/.test(token) || token === token.toUpperCase());
  let chosen = strong.length > 0 ? strong : tokens;

  if (chosen.length > 12) chosen = chosen.slice(0, 12);

  while (chosen.join(" ").length > 90 && chosen.length > 3) {
    chosen = chosen.slice(0, chosen.length - 1);
  }

  const out = chosen.join(" ").replace(/\s+/g, " ").trim();
  return { query: out.length > 0 ? out : query.slice(0, 90).trim(), compressionApplied: out !== query };
};

export const isGenericImageQuery = (query: string): boolean => {
  const meaningful = wordsFromText(query)
    .map((word) => word.toLowerCase())
    .filter((word) => !STOP_WORDS.has(word))
    .filter((word) => !GENERIC_SLIDE_WORDS.has(word))
    .filter((word) => !["фото", "фотография", "иллюстрация", "схема", "инфографика"].includes(word));
  const concrete = meaningful.filter(
    (word) => !ABSTRACT_WORDS.has(word) && !ABSTRACT_WORD_STEMS.some((stem) => word.startsWith(stem)),
  );
  return meaningful.length < 3 || concrete.length < 2;
};

const hasConcreteSignal = (query: string, keywords: string[], entities: string[]): boolean => {
  const q = normalizeQuery(query);
  if (entities.some((entity) => q.includes(entity.toLowerCase()))) return true;
  return keywords.some((keyword) => q.includes(keyword.toLowerCase()));
};

export const enforceImagePromptUniqueness = (
  slots: ImagePlanSlot[],
  slideSummaries: Record<number, SlideSummary>,
  topic: string
): { duplicatesBefore: number; duplicatesAfter: number; badGenericCount: number; compressionAppliedCount: number } => {
  const calcDuplicates = (): number => {
    const seen = new Set<string>();
    let dup = 0;
    for (const slot of slots) {
      const norm = normalizeQuery(slot.query);
      if (seen.has(norm)) dup += 1;
      seen.add(norm);
    }
    return dup;
  };

  const topicWords = wordsFromText(topic).map((word) => word.toLowerCase());
  const duplicatesBefore = calcDuplicates();
  let compressionAppliedCount = 0;
  let badGenericCount = 0;
  const used = new Set<string>();

  for (const slot of slots) {
    const summary = slideSummaries[slot.slide];
    const keywords = summary?.keywords || [];
    const entities = summary?.entities || [];
    const roleNoun = slideTypeNoun(summary?.slideType || "general");

    let nextQuery = slot.query || "";
    const compressedInitial = compressQuery(nextQuery, topicWords);
    nextQuery = compressedInitial.query;
    if (compressedInitial.compressionApplied) compressionAppliedCount += 1;

    let norm = normalizeQuery(nextQuery);
    if (used.has(norm) || !hasConcreteSignal(nextQuery, keywords, entities)) {
      const uniqueEntity = entities.find((entity) => !norm.includes(entity.toLowerCase()))
        || keywords.find((keyword) => !norm.includes(keyword.toLowerCase()))
        || roleNoun
        || `сюжет ${slot.slide}`;
      nextQuery = `${nextQuery} ${uniqueEntity} ${roleNoun}`.trim();
      const compressedAgain = compressQuery(nextQuery, topicWords);
      nextQuery = compressedAgain.query;
      if (compressedAgain.compressionApplied) compressionAppliedCount += 1;
      norm = normalizeQuery(nextQuery);
    }

    if (!hasConcreteSignal(nextQuery, keywords, entities)) {
      badGenericCount += 1;
      const fallbackEntity = entities[0] || keywords[0] || roleNoun;
      nextQuery = `${nextQuery} ${fallbackEntity}`.trim();
      const compressedFallback = compressQuery(nextQuery, topicWords);
      nextQuery = compressedFallback.query;
      if (compressedFallback.compressionApplied) compressionAppliedCount += 1;
      norm = normalizeQuery(nextQuery);
    }

    slot.query = nextQuery.slice(0, 90).trim();
    if (slot.hint) slot.hint = slot.hint.slice(0, 140).trim();
    used.add(norm);
  }

  const duplicatesAfter = calcDuplicates();
  return { duplicatesBefore, duplicatesAfter, badGenericCount, compressionAppliedCount };
};

export const applySlideTypeHeuristics = (query: string, slideType: string, kind?: ImagePlanSlot["kind"]): string => {
  if (VISUAL_MEDIUM_PATTERN.test(query)) return query;
  const suffix = slideTypeNoun(slideType);
  const kindSuffix = kind === "icon" ? "векторная иконка" : kind === "photo" ? "фотография" : kind === "hero" ? "иллюстрация" : "";
  const effectiveSuffix = suffix || kindSuffix;
  if (!effectiveSuffix) return query;
  const normalized = normalizeQuery(query);
  if (normalized.includes(effectiveSuffix.toLowerCase())) return query;
  return `${query} ${effectiveSuffix}`.trim();
};
