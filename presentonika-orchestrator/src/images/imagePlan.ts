import { createHash } from "node:crypto";
import { z } from "zod";

export const imagePlanSlotSchema = z.object({
  slotId: z.string(),
  slide: z.number().int().positive(),
  element: z.number().int().nonnegative(),
  elementId: z.string().optional(),
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

type TargetSource = "auto" | "map" | "map_forced";

type TargetStatus = "ok" | "invalid";

export type ImageSlotTarget = {
  slide: number;
  originalIndex: number;
  slotId: string;
  elementId?: string;
  src?: string;
  source: TargetSource;
  status: TargetStatus;
  reasons: string[];
};

export type ResolvedImageSlotTarget = Omit<ImageSlotTarget, "status"> & {
  currentIndex?: number;
  status: "ok" | "invalid" | "dropped";
};

export type ImagePlanBuildDiagnostics = {
  mode: "auto_detect" | "map_only" | "mixed" | "disabled" | "empty";
  autoDetectedCount: number;
  mapBindingsCount: number;
  mergedTargetCount: number;
  resolvedOkCount: number;
  droppedCount: number;
  invalidCount: number;
  invalidReasons: Record<string, number>;
  finalSlotCount: number;
  targetsSample: Array<{
    slide: number;
    originalIndex: number;
    currentIndex?: number;
    slotId: string;
    elementId?: string;
    status: "ok" | "dropped" | "invalid";
    reasons: string[];
  }>;
};

const getSlides = (doc: unknown): unknown[] => {
  if (!doc || typeof doc !== "object") {
    return [];
  }

  const record = doc as Record<string, unknown>;
  if (Array.isArray(record.slides)) return record.slides;
  if (Array.isArray(record.pages)) return record.pages;
  return [];
};

const readNum = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

const trim = (value: string, max: number): string => (value.length > max ? value.slice(0, max) : value);

const resolveAspect = (params: { width: number | null; height: number | null }): ImagePlanSlot["aspect"] => {
  const width = params.width ?? 0;
  const height = params.height ?? 0;
  if (width <= 0 || height <= 0) return "any";
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
  if (normalized.includes("icon") || normalized.includes("logo")) return "icon";
  if (normalized.includes("hero")) return "hero";

  const width = params.width ?? 0;
  const height = params.height ?? 0;
  const area = width * height;
  const slideArea = params.slideWidth * params.slideHeight;
  if (slideArea > 0) {
    const ratio = area / slideArea;
    if (ratio > 0.25) return normalized.includes("photo") || normalized.includes("img") ? "photo" : "hero";
    if (ratio > 0.08) return "photo";
    if (ratio > 0) return "icon";
  }

  if (normalized.includes("photo") || normalized.includes("img")) return "photo";
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

const isImageElement = (elementNode: Record<string, unknown>): boolean => {
  const type = typeof elementNode.type === "string" ? elementNode.type.toLowerCase() : "";
  const kind = typeof elementNode.kind === "string" ? elementNode.kind.toLowerCase() : "";
  const src = typeof elementNode.src === "string" ? elementNode.src.toLowerCase() : "";
  return type === "image" || kind === "image" || src.includes("assets/images/") || src.endsWith(".png") || src.endsWith(".jpg");
};

const hasPlaceholderSignals = (elementNode: Record<string, unknown>, src: string): string[] => {
  const reasons: string[] = [];
  const meta = elementNode.meta && typeof elementNode.meta === "object" ? (elementNode.meta as Record<string, unknown>) : {};
  const metaPlaceholder = meta.placeholder;
  if (metaPlaceholder === true || typeof meta.placeholderKey === "string") reasons.push("meta_placeholder");

  const name = typeof elementNode.name === "string" ? elementNode.name.toLowerCase() : "";
  if (/placeholder|\bph\b|image_placeholder/i.test(name)) reasons.push("name_placeholder");

  const srcLc = src.toLowerCase();
  if (/placeholder|\bph\b|replace|dummy/.test(srcLc)) reasons.push("src_placeholder");

  if (Array.isArray(elementNode.tags) && elementNode.tags.some((item) => typeof item === "string" && item.toLowerCase() === "placeholder")) {
    reasons.push("tag_placeholder");
  }

  return reasons;
};

const isBackgroundOrDecor = (elementNode: Record<string, unknown>, src: string): boolean => {
  const srcLc = src.toLowerCase();
  if (/^backgrounds\/slide-\d+\.png$/.test(srcLc)) return true;
  if (srcLc.includes("/decor/") || srcLc.startsWith("decor/")) return true;

  const meta = elementNode.meta && typeof elementNode.meta === "object" ? (elementNode.meta as Record<string, unknown>) : {};
  const role = typeof meta.role === "string" ? meta.role.toLowerCase() : "";
  if (role === "decor") return true;
  if (meta.locked === true || elementNode.locked === true) return true;
  return false;
};

const safeSlotId = (value: string): string => value.replace(/[^a-zA-Z0-9_:-]/g, "_");

const deriveSlotId = (params: {
  elementNode: Record<string, unknown>;
  slide: number;
  originalIndex: number;
  elementId?: string;
}): string => {
  const meta = params.elementNode.meta && typeof params.elementNode.meta === "object"
    ? (params.elementNode.meta as Record<string, unknown>)
    : {};
  const placeholderKey = typeof meta.placeholderKey === "string" ? meta.placeholderKey.trim() : "";
  if (placeholderKey) return safeSlotId(placeholderKey);

  if (params.elementId) {
    if (/^[a-zA-Z0-9_:-]{1,32}$/.test(params.elementId)) {
      return `img_${params.elementId}`;
    }
    const digest = createHash("sha1").update(params.elementId).digest("hex").slice(0, 10);
    return `img_${digest}`;
  }

  return `s${params.slide}_e${params.originalIndex}`;
};

const targetKey = (target: { slide: number; elementId?: string; originalIndex: number }): string => {
  if (target.elementId) return `${target.slide}|id:${target.elementId}`;
  return `${target.slide}|idx:${target.originalIndex}`;
};

export const detectPlaceholderImageElements = (params: {
  doc: unknown;
  fallbackAllNonDecor: boolean;
}): ImageSlotTarget[] => {
  const targets: ImageSlotTarget[] = [];
  const slides = getSlides(params.doc);

  slides.forEach((slideUnknown, slideIdx0) => {
    const slide = slideIdx0 + 1;
    const slideNode = (slideUnknown && typeof slideUnknown === "object" ? slideUnknown : {}) as Record<string, unknown>;
    const elements = Array.isArray(slideNode.elements) ? slideNode.elements : [];

    elements.forEach((elementUnknown, elementIndex) => {
      const elementNode = (elementUnknown && typeof elementUnknown === "object" ? elementUnknown : {}) as Record<string, unknown>;
      if (!isImageElement(elementNode)) return;
      const src = typeof elementNode.src === "string" ? elementNode.src : "";

      const reasonFlags = hasPlaceholderSignals(elementNode, src);
      if (reasonFlags.length === 0) {
        if (!params.fallbackAllNonDecor) {
          return;
        }
        if (isBackgroundOrDecor(elementNode, src)) {
          return;
        }
        reasonFlags.push("fallback_non_decor");
      }

      const elementId = typeof elementNode.id === "string" ? elementNode.id : undefined;
      targets.push({
        slide,
        originalIndex: elementIndex,
        elementId,
        src,
        slotId: deriveSlotId({ elementNode, slide, originalIndex: elementIndex, elementId }),
        source: "auto",
        status: "ok",
        reasons: reasonFlags,
      });
    });
  });

  return targets;
};

export const collectImageTargetsFromMap = (params: { map: unknown; doc: unknown }): ImageSlotTarget[] => {
  const parsedMap = (params.map && typeof params.map === "object" ? params.map : {}) as ThemeMap;
  const slides = getSlides(params.doc);
  const targets: ImageSlotTarget[] = [];

  for (const [slideRaw, slideRule] of Object.entries(parsedMap.slides ?? {})) {
    const slide = Number.parseInt(slideRaw, 10);
    if (!Number.isInteger(slide) || slide <= 0) continue;

    const imageAt = slideRule?.imageAt;
    if (!imageAt || typeof imageAt !== "object") continue;

    const slideNode = (slides[slide - 1] && typeof slides[slide - 1] === "object" ? slides[slide - 1] : {}) as Record<string, unknown>;
    const elements = Array.isArray(slideNode.elements) ? slideNode.elements : [];

    for (const [elementRaw, slotRaw] of Object.entries(imageAt)) {
      const originalIndex = Number.parseInt(elementRaw, 10);
      const slotId = typeof slotRaw === "string" ? safeSlotId(slotRaw) : "";
      if (!Number.isInteger(originalIndex) || originalIndex < 0 || !slotId) {
        targets.push({
          slide,
          originalIndex,
          slotId,
          source: "map",
          status: "invalid",
          reasons: ["invalid_index_or_slot"],
        });
        continue;
      }

      const elementNode = (elements[originalIndex] && typeof elements[originalIndex] === "object"
        ? elements[originalIndex]
        : null) as Record<string, unknown> | null;

      if (!elementNode) {
        targets.push({
          slide,
          originalIndex,
          slotId,
          source: "map",
          status: "invalid",
          reasons: ["element_out_of_range"],
        });
        continue;
      }

      const elementId = typeof elementNode.id === "string" ? elementNode.id : undefined;
      targets.push({
        slide,
        originalIndex,
        slotId,
        elementId,
        src: typeof elementNode.src === "string" ? elementNode.src : undefined,
        source: "map",
        status: elementId ? "ok" : "invalid",
        reasons: elementId ? ["map_binding"] : ["missing_element_id"],
      });
    }
  }

  return targets;
};

export const collectMergedImageTargets = (params: {
  map: unknown;
  doc: unknown;
  autoDetect: boolean;
  fallbackAllNonDecor: boolean;
}): { targets: ImageSlotTarget[]; autoDetectedCount: number; mapBindingsCount: number } => {
  const autoTargets = params.autoDetect ? detectPlaceholderImageElements({ doc: params.doc, fallbackAllNonDecor: params.fallbackAllNonDecor }) : [];
  const mapTargets = collectImageTargetsFromMap({ map: params.map, doc: params.doc });

  const merged = new Map<string, ImageSlotTarget>();
  for (const target of autoTargets) {
    merged.set(targetKey(target), target);
  }

  for (const mapTarget of mapTargets) {
    const key = targetKey(mapTarget);
    const existing = merged.get(key);

    if (existing) {
      merged.set(key, {
        ...existing,
        slotId: mapTarget.slotId || existing.slotId,
        source: "map",
        reasons: [...new Set([...existing.reasons, "slot_overridden_by_map"])],
      });
      continue;
    }

    if (mapTarget.status === "ok") {
      merged.set(key, {
        ...mapTarget,
        source: "map_forced",
        reasons: [...new Set([...mapTarget.reasons, "forced_by_map"])],
      });
      continue;
    }

    merged.set(`${key}|invalid`, mapTarget);
  }

  return {
    targets: [...merged.values()],
    autoDetectedCount: autoTargets.length,
    mapBindingsCount: mapTargets.length,
  };
};

export const remapImageTargetsToDoc = (params: { targets: ImageSlotTarget[]; doc: unknown }): ResolvedImageSlotTarget[] => {
  const slides = getSlides(params.doc);

  return params.targets.map((target) => {
    if (target.status === "invalid") {
      return {
        ...target,
        status: "invalid",
      };
    }

    const slideNode = (slides[target.slide - 1] && typeof slides[target.slide - 1] === "object"
      ? slides[target.slide - 1]
      : {}) as Record<string, unknown>;
    const elements = Array.isArray(slideNode.elements) ? slideNode.elements : [];

    let currentIndex = -1;
    if (target.elementId) {
      currentIndex = elements.findIndex((element) => {
        if (!element || typeof element !== "object") return false;
        return (element as Record<string, unknown>).id === target.elementId;
      });
    }

    if (currentIndex < 0 && target.originalIndex >= 0 && target.originalIndex < elements.length) {
      currentIndex = target.originalIndex;
    }

    if (currentIndex < 0) {
      return {
        ...target,
        status: "dropped",
        reasons: [...target.reasons, "element_missing_after_variants"],
      };
    }

    return {
      ...target,
      currentIndex,
      status: "ok",
    };
  });
};


export const buildImagePromptFallback = (params: { topic: string; slideTitle: string; slideSummary: string; kind: ImagePlanSlot["kind"] }): { query: string; hint: string; negative: string[]; styleHint: string } => {
  const titleWords = params.slideTitle.split(/\s+/).filter(Boolean).slice(0, 10).join(" ");
  const summaryWords = params.slideSummary.split(/\s+/).filter(Boolean).slice(0, 3).join(" ");
  const query = [params.topic, titleWords, summaryWords, "фото"].filter((item) => item.length > 0).join(" ").replace(/\s+/g, " ").trim();
  return {
    query: trim(query, 180),
    hint: `Искать ${params.kind} по теме слайда; исключить watermark/lowres`,
    negative: ["watermark", "nsfw", "lowres", "logo", "text"],
    styleHint: styleFromKind(params.kind),
  };
};

export const buildImagePlanFromResolvedTargets = (params: {
  resolvedTargets: ResolvedImageSlotTarget[];
  doc: unknown;
  presentationId: number | string;
  themeId: string;
  topic: string;
  language: string | null;
}): ImagePlanV1 => {
  const base = params.topic.trim() || "презентация";
  const slides = getSlides(params.doc);

  const docRecord = (params.doc && typeof params.doc === "object" ? params.doc : {}) as Record<string, unknown>;
  const defaultSlideWidth = readNum(docRecord.width) ?? 1536;
  const defaultSlideHeight = readNum(docRecord.height) ?? 864;

  const slots: ImagePlanSlot[] = [];

  for (const target of params.resolvedTargets) {
    if (target.status !== "ok") continue;

    const slideNode = (slides[target.slide - 1] && typeof slides[target.slide - 1] === "object" ? slides[target.slide - 1] : {}) as Record<string, unknown>;
    const slideWidth = readNum(slideNode.width) ?? defaultSlideWidth;
    const slideHeight = readNum(slideNode.height) ?? defaultSlideHeight;
    const elements = Array.isArray(slideNode.elements) ? slideNode.elements : [];

    const elementNode = (elements[target.currentIndex ?? -1] && typeof elements[target.currentIndex ?? -1] === "object"
      ? elements[target.currentIndex ?? -1]
      : {}) as Record<string, unknown>;

    const width = readNum(elementNode.width);
    const height = readNum(elementNode.height);

    const aspect = resolveAspect({ width, height });
    const kind = resolveKind({ slotId: target.slotId, width, height, slideWidth, slideHeight });
    const semantic = semanticFromSlot(target.slotId, kind);
    const styleHint = styleFromKind(kind);
    const negative = kind === "icon"
      ? ["watermark", "nsfw", "lowres", "logo", "text"]
      : ["watermark", "nsfw", "lowres", "logo", "text"];
    const query = trim(`${base} слайд ${target.slide} ${semantic}`.trim(), 120);
    const hint = "Подбери изображение без watermark, high-res; проверь права";

    slots.push({
      slotId: target.slotId,
      slide: target.slide,
      element: target.currentIndex ?? 0,
      elementId: target.elementId,
      kind,
      query,
      hint,
      styleHint,
      negative,
      aspect,
      priority: priorityFromKind(kind),
      sourcePolicy: { mode: "user_confirmed", requireSourceOpen: true },
      suggestedCount: 8,
    });
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

export const buildImagePlanWithDiagnostics = (params: {
  map: unknown;
  originalDoc: unknown;
  currentDoc: unknown;
  presentationId: number | string;
  themeId: string;
  topic: string;
  language: string | null;
  autoDetect: boolean;
  fallbackAllNonDecor: boolean;
}): {
  imagePlan: ImagePlanV1;
  resolvedTargets: ResolvedImageSlotTarget[];
  diagnostics: ImagePlanBuildDiagnostics;
} => {
  const collected = collectMergedImageTargets({
    map: params.map,
    doc: params.originalDoc,
    autoDetect: params.autoDetect,
    fallbackAllNonDecor: params.fallbackAllNonDecor,
  });

  const resolvedTargets = remapImageTargetsToDoc({ targets: collected.targets, doc: params.currentDoc });
  const imagePlan = buildImagePlanFromResolvedTargets({
    resolvedTargets,
    doc: params.currentDoc,
    presentationId: params.presentationId,
    themeId: params.themeId,
    topic: params.topic,
    language: params.language,
  });

  const invalidReasons: Record<string, number> = {};
  for (const target of resolvedTargets) {
    if (target.status !== "invalid") continue;
    for (const reason of target.reasons) {
      invalidReasons[reason] = (invalidReasons[reason] ?? 0) + 1;
    }
  }

  const hasAuto = collected.autoDetectedCount > 0;
  const hasMap = collected.mapBindingsCount > 0;
  const mode: ImagePlanBuildDiagnostics["mode"] = !params.autoDetect && !hasMap
    ? "disabled"
    : (hasAuto && hasMap ? "mixed" : (hasAuto ? "auto_detect" : (hasMap ? "map_only" : "empty")));

  const diagnostics: ImagePlanBuildDiagnostics = {
    mode,
    autoDetectedCount: collected.autoDetectedCount,
    mapBindingsCount: collected.mapBindingsCount,
    mergedTargetCount: collected.targets.length,
    resolvedOkCount: resolvedTargets.filter((item) => item.status === "ok").length,
    droppedCount: resolvedTargets.filter((item) => item.status === "dropped").length,
    invalidCount: resolvedTargets.filter((item) => item.status === "invalid").length,
    invalidReasons,
    finalSlotCount: imagePlan.slots.length,
    targetsSample: resolvedTargets.slice(0, 50).map((target) => ({
      slide: target.slide,
      originalIndex: target.originalIndex,
      currentIndex: target.currentIndex,
      slotId: target.slotId,
      elementId: target.elementId,
      status: target.status,
      reasons: target.reasons,
    })),
  };

  return { imagePlan, resolvedTargets, diagnostics };
};

export const buildImagePlanFromMap = (params: {
  map: unknown;
  doc: unknown;
  presentationId: number | string;
  themeId: string;
  topic: string;
  language: string | null;
}): ImagePlanV1 => {
  return buildImagePlanWithDiagnostics({
    map: params.map,
    originalDoc: params.doc,
    currentDoc: params.doc,
    presentationId: params.presentationId,
    themeId: params.themeId,
    topic: params.topic,
    language: params.language,
    autoDetect: process.env.IMAGEPLAN_AUTO_DETECT !== "false",
    fallbackAllNonDecor: process.env.IMAGEPLAN_DETECT_FALLBACK_ALL_NON_DECOR !== "false",
  }).imagePlan;
};
