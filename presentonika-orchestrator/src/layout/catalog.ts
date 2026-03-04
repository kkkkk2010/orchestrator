import { extractPlaceholderLocations } from "../themes/parseDoc";
import type { LayoutCatalog, LayoutSlot, LayoutTemplate } from "./types";

const DEFAULT_TEXT_BBOX = { x: 80, y: 80, width: 1280, height: 80 };
const DEFAULT_IMAGE_BBOX = { x: 960, y: 180, width: 440, height: 400 };

const slotFromKey = (key: string): LayoutSlot => {
  const lower = key.toLowerCase();
  const type: "text" | "image" = lower.startsWith("img_") || lower.includes("image") ? "image" : "text";
  return {
    key,
    type,
    bbox: type === "image" ? DEFAULT_IMAGE_BBOX : DEFAULT_TEXT_BBOX,
  };
};

const buildFallbackTemplatesFromDoc = (doc: unknown): LayoutTemplate[] => {
  const bySlide = new Map<number, Set<string>>();
  const scan = extractPlaceholderLocations(doc);

  for (const location of scan.locations) {
    const existing = bySlide.get(location.slide) || new Set<string>();
    existing.add(location.key);
    bySlide.set(location.slide, existing);
  }

  return [...bySlide.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([slide, keys]) => ({
      id: `fallback-s${slide}`,
      slide,
      slots: [...keys].sort().map(slotFromKey),
    }));
};

export const buildLayoutCatalog = (params: {
  doc: unknown;
  map: unknown;
}): LayoutCatalog => {
  const mapRecord = (params.map && typeof params.map === "object" ? params.map : {}) as Record<string, unknown>;
  const rawLayouts = Array.isArray(mapRecord.layouts) ? mapRecord.layouts : [];

  const templates: LayoutTemplate[] = rawLayouts
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const id = typeof row.id === "string" && row.id.trim().length > 0 ? row.id : `layout-${index + 1}`;
      const slide = typeof row.slide === "number" && Number.isFinite(row.slide) ? row.slide : undefined;
      const slots = Array.isArray(row.slots) ? row.slots : [];

      const normalizedSlots: LayoutSlot[] = slots
        .map((slot) => {
          if (!slot || typeof slot !== "object") return null;
          const s = slot as Record<string, unknown>;
          const key = typeof s.key === "string" ? s.key : "";
          if (!key) return null;
          const type = s.type === "image" ? "image" : "text";
          const bboxRaw = (s.bbox && typeof s.bbox === "object" ? s.bbox : {}) as Record<string, unknown>;
          const bbox = {
            x: typeof bboxRaw.x === "number" ? bboxRaw.x : DEFAULT_TEXT_BBOX.x,
            y: typeof bboxRaw.y === "number" ? bboxRaw.y : DEFAULT_TEXT_BBOX.y,
            width: typeof bboxRaw.width === "number" ? bboxRaw.width : DEFAULT_TEXT_BBOX.width,
            height: typeof bboxRaw.height === "number" ? bboxRaw.height : DEFAULT_TEXT_BBOX.height,
          };
          return { key, type, bbox } as LayoutSlot;
        })
        .filter((slot): slot is LayoutSlot => slot !== null);

      if (normalizedSlots.length === 0) return null;
      return { id, slide, slots: normalizedSlots } as LayoutTemplate;
    })
    .filter((layout): layout is LayoutTemplate => layout !== null);

  if (templates.length > 0) {
    return { templates };
  }

  return {
    templates: buildFallbackTemplatesFromDoc(params.doc),
  };
};
