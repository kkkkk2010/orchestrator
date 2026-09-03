import { createHash } from "node:crypto";
import { getRequiredSlotIds } from "./binder";
import type { LayoutPack, SlidePlanRow } from "./types";

const hashScore = (seed: string): number => {
  const hex = createHash("sha1").update(seed).digest("hex").slice(0, 8);
  return Number.parseInt(hex, 16);
};

const densityRank = (value: "low" | "medium" | "high" | undefined): number => {
  if (value === "low") return 0;
  if (value === "high") return 2;
  return 1;
};

export const selectLayoutForSlide = (params: {
  presentationId: number;
  themeId: string;
  row: SlidePlanRow;
  candidates: LayoutPack[];
  variation: boolean;
}): LayoutPack | null => {
  const required = getRequiredSlotIds(params.row.slideType);
  const compatible = params.candidates.filter((pack) => {
    const slotIds = new Set(pack.manifest.textSlots.map((slot) => slot.slotId));
    return required.every((slotId) => slotIds.has(slotId));
  });
  if (compatible.length === 0) return null;
  const targetDensity = densityRank(params.row.contentDensity);
  const closestDistance = Math.min(...compatible.map((pack) => Math.abs(
    densityRank(pack.manifest.constraints?.preferredTextDensity || pack.manifest.constraints?.maxTextDensity) - targetDensity,
  )));
  const densityCompatible = compatible.filter((pack) => Math.abs(
    densityRank(pack.manifest.constraints?.preferredTextDensity || pack.manifest.constraints?.maxTextDensity) - targetDensity,
  ) === closestDistance);
  if (!params.variation) return densityCompatible[0];

  const weighted = densityCompatible.flatMap((pack) => Array(Math.max(1, pack.manifest.seedWeight || 1)).fill(pack));
  let selected = weighted[0];
  let best = -1;
  for (let i = 0; i < weighted.length; i += 1) {
    const pack = weighted[i];
    const score = hashScore(`${params.presentationId}:${params.themeId}:${params.row.slide}:${params.row.slideType}:${pack.id}:${i}`);
    if (score > best) {
      best = score;
      selected = pack;
    }
  }
  return selected;
};
