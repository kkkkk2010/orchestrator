import path from "node:path";
import fs from "node:fs/promises";
import { parseImageAtBinding } from "./imageAt";

type ImageAtRule = Record<string, unknown>;

type SlideRule = {
  imageAt?: ImageAtRule;
};

type ThemeMap = {
  slides?: Record<string, SlideRule>;
};

export type ImageReplacementMissing = {
  slide: number;
  element: number;
  slot: string;
  reason: string;
};

export type ImageReplacementPlan = {
  replacements: Record<string, string>;
  plannedCount: number;
  replacedCount: number;
  missing: ImageReplacementMissing[];
};

const pickTestImageFileName = (slotName: string): string => {
  const normalized = slotName.toLowerCase();

  if (normalized.includes("hero")) {
    return "hero.jpg";
  }

  if (normalized.includes("photo")) {
    return "photo.jpg";
  }

  if (normalized.includes("icon")) {
    return "icon.png";
  }

  return "hero.jpg";
};

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
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

export const planImageReplacements = async ({
  doc,
  map,
  themeDir,
}: {
  doc: unknown;
  map: unknown;
  themeDir: string;
}): Promise<ImageReplacementPlan> => {
  const replacements: Record<string, string> = {};
  const missing: ImageReplacementMissing[] = [];

  const parsedMap = (map && typeof map === "object" ? map : {}) as ThemeMap;
  const slides = getSlides(doc);

  for (const [slideIndexRaw, slideRule] of Object.entries(parsedMap.slides ?? {})) {
    const slideIndex1Based = Number.parseInt(slideIndexRaw, 10);
    if (!Number.isInteger(slideIndex1Based) || slideIndex1Based <= 0) {
      continue;
    }

    const imageAt = slideRule.imageAt;
    if (!imageAt || typeof imageAt !== "object") {
      continue;
    }

    const slideIdx0 = slideIndex1Based - 1;
    const slide = slides[slideIdx0] as { elements?: unknown } | undefined;
    const elements = Array.isArray(slide?.elements) ? slide.elements : null;

    for (const [elementIndexRaw, slotNameRaw] of Object.entries(imageAt)) {
      const elementIndex = Number.parseInt(elementIndexRaw, 10);
      const binding = parseImageAtBinding(slotNameRaw);
      const slotName = binding?.slotId ?? "";

      if (!Number.isInteger(elementIndex) || elementIndex < 0 || !binding) {
        missing.push({
          slide: slideIndex1Based,
          element: elementIndex,
          slot: slotName,
          reason: !binding ? "invalid_slot" : "invalid_element_index",
        });
        continue;
      }

      if (!elements || elementIndex >= elements.length) {
        missing.push({
          slide: slideIndex1Based,
          element: elementIndex,
          slot: slotName,
          reason: "element_out_of_range",
        });
        continue;
      }

      const element = elements[elementIndex] as { type?: unknown; src?: unknown } | undefined;
      if (!element || element.type !== "image") {
        missing.push({
          slide: slideIndex1Based,
          element: elementIndex,
          slot: slotName,
          reason: "element_not_image",
        });
        continue;
      }

      if (typeof element.src !== "string" || element.src.length === 0) {
        missing.push({
          slide: slideIndex1Based,
          element: elementIndex,
          slot: slotName,
          reason: "missing_src",
        });
        continue;
      }

      const testImageFileName = binding.kind === "icon"
        ? "icon.png"
        : binding.kind === "photo"
          ? "photo.jpg"
          : pickTestImageFileName(slotName);
      const localFilePath = path.resolve(themeDir, "test-images", testImageFileName);

      if (!(await fileExists(localFilePath))) {
        missing.push({
          slide: slideIndex1Based,
          element: elementIndex,
          slot: slotName,
          reason: `test_image_missing:${testImageFileName}`,
        });
        continue;
      }

      replacements[element.src] = localFilePath;
    }
  }

  return {
    replacements,
    plannedCount: Object.keys(replacements).length,
    replacedCount: 0,
    missing,
  };
};
