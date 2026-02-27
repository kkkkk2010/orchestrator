import { z } from "zod";

export const imagePlanSlotSchema = z.object({
  slotId: z.string(),
  slide: z.number().int().positive(),
  element: z.number().int().nonnegative(),
  kind: z.enum(["hero", "photo", "icon", "other"]),
  query: z.string(),
  hint: z.string().nullable(),
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

const inferKind = (slotId: string): ImagePlanSlot["kind"] => {
  const normalized = slotId.toLowerCase();
  if (normalized.includes("hero")) return "hero";
  if (normalized.includes("icon")) return "icon";
  if (normalized.includes("photo") || normalized.includes("img")) return "photo";
  return "other";
};

const trim = (value: string, max: number): string => value.length > max ? value.slice(0, max) : value;

export const buildImagePlanFromMap = (params: {
  map: unknown;
  presentationId: number | string;
  themeId: string;
  topic: string;
  language: string | null;
}): ImagePlanV1 => {
  const parsedMap = (params.map && typeof params.map === "object" ? params.map : {}) as ThemeMap;
  const base = params.topic.trim() || "презентация";

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

    for (const [elementRaw, slotRaw] of Object.entries(imageAt)) {
      const element = Number.parseInt(elementRaw, 10);
      const slotId = typeof slotRaw === "string" ? slotRaw : "";
      if (!Number.isInteger(element) || element < 0 || !slotId) {
        continue;
      }

      const query = trim(`${base} ${slotId.replace(/[_-]+/g, " ")}`.trim(), 120);
      slots.push({
        slotId,
        slide,
        element,
        kind: inferKind(slotId),
        query,
        hint: `Подбери изображение для: ${slotId}`,
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
