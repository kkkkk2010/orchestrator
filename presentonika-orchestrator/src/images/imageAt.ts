import type { ImagePlanSlot } from "./imagePlan";

export type ImageAtBinding = {
  slotId: string;
  kind?: ImagePlanSlot["kind"];
  aspect?: ImagePlanSlot["aspect"];
};

const safeSlotId = (value: string): string => value.replace(/[^a-zA-Z0-9_:-]/g, "_");

const parseKind = (value: unknown): ImagePlanSlot["kind"] | undefined => {
  return value === "hero" || value === "photo" || value === "icon" || value === "other" ? value : undefined;
};

const parseAspect = (value: unknown): ImagePlanSlot["aspect"] | undefined => {
  return value === "portrait" || value === "landscape" || value === "square" || value === "any" ? value : undefined;
};

export const parseImageAtBinding = (value: unknown): ImageAtBinding | null => {
  if (typeof value === "string") {
    const slotId = safeSlotId(value.trim());
    return slotId ? { slotId } : null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const slotIdRaw = typeof record.slotId === "string" ? record.slotId.trim() : "";
  const slotId = safeSlotId(slotIdRaw);
  if (!slotId) {
    return null;
  }

  return {
    slotId,
    kind: parseKind(record.kind),
    aspect: parseAspect(record.aspect),
  };
};
