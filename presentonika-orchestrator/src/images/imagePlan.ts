import { z } from "zod";

export const imagePlanSlotSchema = z.object({
  slotId: z.string(),
  slide: z.number().int().positive(),
  element: z.number().int().nonnegative(),
  kind: z.enum(["hero", "photo", "icon", "other"]),
  query: z.string(),
  hint: z.string().nullable(),
  styleHint: z.string().optional(),
  negative: z.array(z.string()).optional(),
  aspect: z.enum(["portrait", "landscape", "square", "any"]).optional(),
  priority: z.number().int().min(1).max(5).optional(),
  sourcePolicy: z
    .object({
      mode: z.literal("user_confirmed"),
      requireSourceOpen: z.boolean().optional(),
    })
    .optional(),
  suggestedCount: z.number().int().min(5).max(10).optional(),
});

export const imagePlanSchema = z.object({
  version: z.literal(1),
  presentationId: z.union([z.number(), z.string()]),
  themeId: z.string(),
  topic: z.string(),
  language: z.string().nullable(),
  createdAt: z.string(),
  slots: z.array(imagePlanSlotSchema),
});

export type ImagePlanSlot = z.infer<typeof imagePlanSlotSchema>;
export type ImagePlanV1 = z.infer<typeof imagePlanSchema>;

type SlideRule = {
  imageAt?: Record<string, string>;
};

type ThemeMap = {
  slides?: Record<string, SlideRule>;
};

const getSlides = (doc: unknown): unknown[] => {
  if (!doc || typeof doc !== "object") {
    return [];
  }

  const record = doc as Record<string, unknown>;
  if (Array.isArray(record.slides)) {
    return record.slides;
  }

  if (Array.isArray(record.pages)) {
    return record.pages;
  }

  return [];
};

const readNum = (value: unknown): number | null => {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const resolveAspect = (params: { width: number | null; height: number | null }): ImagePlanSlot["aspect"] => {
  const width = params.width ?? 0;
  const height = params.height ?? 0;
  if (width <= 0 || height <= 0) {
    return "any";
  }

  const ratio = width / height;
  if (ratio > 1.15) return "landscape";
  if (ratio < 0.85) return "portrait";
  return "square";
};

const resolveKind = (params: {
  slotId: string;
  width: number | null;
  height: number | null;
  slideWidth: number;
  slideHeight: number;
}): ImagePlanSlot["kind"] => {
  const normalized = params.slotId.toLowerCase();
  if (normalized.includes("icon") || normalized.includes("logo")) {
    return "icon";
  }

  if (normalized.includes("hero")) {
    return "hero";
  }

  const width = params.width ?? 0;
  const height = params.height ?? 0;
  const largeByWidth = params.slideWidth > 0 && width / params.slideWidth > 0.4;
  const largeByHeight = params.slideHeight > 0 && height / params.slideHeight > 0.4;
  if (largeByWidth || largeByHeight) {
    return normalized.includes("photo") || normalized.includes("img") ? "photo" : "hero";
  }

  if (normalized.includes("photo") || normalized.includes("img")) {
    return "photo";
  }

  return "other";
};

const semanticFromSlot = (slotId: string, kind: ImagePlanSlot["kind"]): string => {
  const normalized = slotId.toLowerCase();
  if (normalized.includes("hero") || normalized.includes("cover")) return "обложка";
  if (normalized.includes("icon") || normalized.includes("logo")) return "иконка";
  if (normalized.includes("photo") || normalized.includes("img")) return "фото";
  if (kind === "icon") return "иконка";
  if (kind === "hero" || kind === "photo") return "ключевая иллюстрация";
  return slotId.replace(/[_-]+/g, " ");
};

const styleFromKind = (kind: ImagePlanSlot["kind"]): string => {
  if (kind === "icon") return "flat vector";
  if (kind === "hero") return "minimal";
  if (kind === "photo") return "photo";
  return "minimal";
};

const priorityFromKind = (kind: ImagePlanSlot["kind"]): number => {
  if (kind === "hero") return 5;
  if (kind === "photo") return 4;
  if (kind === "icon") return 2;
  return 3;
};

const trim = (value: string, max: number): string => (value.length > max ? value.slice(0, max) : value);

export const buildImagePlanFromMap = (params: {
  map: unknown;
  doc: unknown;
  presentationId: number | string;
  themeId: string;
  topic: string;
  language: string | null;
}): ImagePlanV1 => {
  const parsedMap = (params.map && typeof params.map === "object" ? params.map : {}) as ThemeMap;
  const base = params.topic.trim() || "презентация";
  const slides = getSlides(params.doc);

  const docRecord = (params.doc && typeof params.doc === "object" ? params.doc : {}) as Record<string, unknown>;
  const defaultSlideWidth = readNum(docRecord.width) ?? 1536;
  const defaultSlideHeight = readNum(docRecord.height) ?? 864;

  const slots: ImagePlanSlot[] = [];

  for (const [slideRaw, slideRule] of Object.entries(parsedMap.slides ?? {})) {
    const slide = Number.parseInt(slideRaw, 10);
    if (!Number.isInteger(slide) || slide <= 0) {
      continue;
    }

    const imageAt = slideRule?.imageAt;
    if (!imageAt || typeof imageAt !== "object") {
      continue;
    }

    const slideNode = (slides[slide - 1] && typeof slides[slide - 1] === "object" ? slides[slide - 1] : {}) as Record<string, unknown>;
    const slideWidth = readNum(slideNode.width) ?? defaultSlideWidth;
    const slideHeight = readNum(slideNode.height) ?? defaultSlideHeight;
    const elements = Array.isArray(slideNode.elements) ? slideNode.elements : [];

    for (const [elementRaw, slotRaw] of Object.entries(imageAt)) {
      const element = Number.parseInt(elementRaw, 10);
      const slotId = typeof slotRaw === "string" ? slotRaw : "";
      if (!Number.isInteger(element) || element < 0 || !slotId) {
        continue;
      }

      const elementNode = (elements[element] && typeof elements[element] === "object" ? elements[element] : {}) as Record<string, unknown>;
      const width = readNum(elementNode.width);
      const height = readNum(elementNode.height);

      const aspect = resolveAspect({ width, height });
      const kind = resolveKind({ slotId, width, height, slideWidth, slideHeight });
      const semantic = semanticFromSlot(slotId, kind);
      const styleHint = styleFromKind(kind);
      const negative = kind === "icon"
        ? ["watermark", "nsfw", "lowres", "photo background"]
        : ["watermark", "nsfw", "lowres"];
      const query = trim(`${base} ${semantic} слайд ${slide}`.trim(), 120);
      const hint = `Подбери изображение: ${semantic}; стиль: ${styleHint}; избегать: ${negative.join(", ")}`;

      slots.push({
        slotId,
        slide,
        element,
        kind,
        query,
        hint,
        styleHint,
        negative,
        aspect,
        priority: priorityFromKind(kind),
        sourcePolicy: { mode: "user_confirmed", requireSourceOpen: true },
        suggestedCount: kind === "icon" ? 6 : 8,
      });
    }
  }

  const result: ImagePlanV1 = {
    version: 1,
    presentationId: params.presentationId,
    themeId: params.themeId,
    topic: params.topic,
    language: params.language,
    createdAt: new Date().toISOString(),
    slots,
  };

  return imagePlanSchema.parse(result);
};
