import type { ImagePlanSlot } from "./imagePlan";

const STOP_WORDS = new Set(["и", "в", "на", "по", "для", "что", "это", "как", "при", "или", "а", "с", "к", "из", "о", "the", "of", "to", "for", "with"]);

const extractSlideFromKey = (key: string): number => {
  const match = key.match(/s(\d+)_/i);
  if (!match?.[1]) return 1;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const pickSlideType = (keys: string[]): string => {
  const joined = keys.join(" ").toLowerCase();
  if (joined.includes("step") || joined.includes("timeline") || joined.includes("chron")) return "chronology";
  if (joined.includes("example")) return "examples";
  if (joined.includes("fact") || joined.includes("keywords")) return "facts";
  if (joined.includes("definition")) return "definition";
  if (joined.includes("task") || joined.includes("homework")) return "task";
  if (joined.includes("summary") || joined.includes("sources") || joined.includes("meta")) return "summary";
  return "general";
};

const keywordsFromText = (text: string): string[] => {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 3 && !STOP_WORDS.has(word));

  const freq = new Map<string, number>();
  words.forEach((w) => freq.set(w, (freq.get(w) || 0) + 1));
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 8)
    .map(([word]) => word);
};

export type SlideSummary = {
  slide: number;
  title: string;
  keywords: string[];
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
    const slideType = pickSlideType(items.map((item) => item.key));
    const textBlob = items.map((item) => item.value).join(" ");
    const keywords = keywordsFromText(textBlob).slice(0, 6);
    const summaryRaw = `${title}. ${keywords.join(", ")}. Тип: ${slideType}`.replace(/\s+/g, " ").trim();
    summaries[slide] = {
      slide,
      title,
      keywords,
      slideType,
      summary: summaryRaw.length > 220 ? `${summaryRaw.slice(0, 219)}…` : summaryRaw,
    };
  }

  return summaries;
};

const normalizeQuery = (query: string): string => query
  .toLowerCase()
  .replace(/[()\[\],.!?:;"'«»]/g, " ")
  .replace(/\b(слайд|фото|изображение)\b/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const slideTypeHint = (slideType: string): string => {
  if (slideType === "chronology") return "таймлайн";
  if (slideType === "examples") return "иллюстрация";
  if (slideType === "facts") return "документ";
  if (slideType === "definition") return "схема";
  if (slideType === "task") return "инфографика";
  return "официальное фото";
};

export const enforceImagePromptUniqueness = (slots: ImagePlanSlot[], slideSummaries: Record<number, SlideSummary>): { duplicatesBefore: number; duplicatesAfter: number } => {
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

  const duplicatesBefore = calcDuplicates();
  const used = new Set<string>();

  for (const slot of slots) {
    const summary = slideSummaries[slot.slide];
    const keys = summary?.keywords || [];
    let next = slot.query.trim();
    if (next.length > 90) next = next.slice(0, 90).trim();

    const norm = normalizeQuery(next);
    if (used.has(norm)) {
      const missingKeyword = keys.find((keyword) => !norm.includes(keyword.toLowerCase()));
      const roleSuffix = slideTypeHint(summary?.slideType || "general");
      next = `${next} ${missingKeyword || roleSuffix}`.trim();
    }

    const norm2 = normalizeQuery(next);
    if (used.has(norm2)) {
      const kindSuffix = slot.kind === "icon" ? "иконка" : roleSuffixFromKind(slot.kind);
      next = `${next} ${kindSuffix}`.trim();
    }

    slot.query = next.length > 90 ? `${next.slice(0, 89)}…` : next;
    if (slot.hint && slot.hint.length > 140) slot.hint = `${slot.hint.slice(0, 139)}…`;
    used.add(normalizeQuery(slot.query));
  }

  const duplicatesAfter = calcDuplicates();
  return { duplicatesBefore, duplicatesAfter };
};

const roleSuffixFromKind = (kind: ImagePlanSlot["kind"]): string => {
  if (kind === "hero") return "портрет";
  if (kind === "icon") return "символ";
  if (kind === "photo") return "документ";
  return "иллюстрация";
};

export const applySlideTypeHeuristics = (query: string, slideType: string): string => {
  const suffix = slideTypeHint(slideType);
  if (query.toLowerCase().includes(suffix.toLowerCase())) return query;
  return `${query} ${suffix}`.trim();
};
