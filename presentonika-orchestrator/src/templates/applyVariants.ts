import { chooseVariant } from "./chooseVariant";

export type SeedContext = {
  presentationId: number;
};

export type ApplyVariantsStats = {
  droppedCount: number;
  droppedAtCount: number;
  droppedIds: string[];
  chosenVariants: Record<string, string>;
};

type VariantRule = {
  dropAt?: number[];
  drop?: string[];
};

type SlideRule = {
  variants?: Record<string, VariantRule>;
  imageAt?: Record<string, unknown>;
  choose?: unknown;
};

type VariantsMap = {
  slides?: Record<string, SlideRule>;
};

type ApplyVariantsOptions = {
  onDropAtOutOfRange?: (payload: { slideIndex: number; badIndex: number }) => void;
};

const DROP_IDS_LIMIT = 50;

const applyDropAtToSlide = (
  slideNode: unknown,
  dropAt: number[],
  slideIndex1Based: number,
  options?: ApplyVariantsOptions
): number => {
  if (!slideNode || typeof slideNode !== "object") {
    return 0;
  }

  const elements = (slideNode as { elements?: unknown }).elements;
  if (!Array.isArray(elements)) {
    return 0;
  }

  const sorted = [...dropAt].filter((index) => Number.isInteger(index)).sort((a, b) => b - a);

  let droppedAtCount = 0;
  for (const index of sorted) {
    if (index < 0 || index >= elements.length) {
      options?.onDropAtOutOfRange?.({ slideIndex: slideIndex1Based, badIndex: index });
      continue;
    }

    elements.splice(index, 1);
    droppedAtCount += 1;
  }

  return droppedAtCount;
};

const dropIdsFromNode = (
  node: unknown,
  dropSet: Set<string>,
  droppedIds: string[],
  visited: Set<object>
): number => {
  if (!node || typeof node !== "object") {
    return 0;
  }

  if (visited.has(node)) {
    return 0;
  }
  visited.add(node);

  let droppedCount = 0;

  if (Array.isArray(node)) {
    for (let index = node.length - 1; index >= 0; index -= 1) {
      const item = node[index];
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const id = (item as { id?: unknown }).id;
        if (typeof id === "string" && dropSet.has(id)) {
          node.splice(index, 1);
          droppedCount += 1;
          if (droppedIds.length < DROP_IDS_LIMIT) {
            droppedIds.push(id);
          }
          continue;
        }
      }

      droppedCount += dropIdsFromNode(item, dropSet, droppedIds, visited);
    }

    return droppedCount;
  }

  const record = node as Record<string, unknown>;
  for (const value of Object.values(record)) {
    droppedCount += dropIdsFromNode(value, dropSet, droppedIds, visited);
  }

  return droppedCount;
};

const getSlideContainers = (doc: unknown): unknown[] => {
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

  return [doc];
};

export const applyVariants = (
  doc: unknown,
  map: unknown,
  seedContext: SeedContext,
  fills: Record<string, string>,
  options?: ApplyVariantsOptions
): ApplyVariantsStats => {
  const droppedIds: string[] = [];
  const chosenVariants: Record<string, string> = {};
  let droppedCount = 0;
  let droppedAtCount = 0;

  const parsedMap = (map && typeof map === "object" ? map : {}) as VariantsMap;
  const slideContainers = getSlideContainers(doc);

  for (let slideIdx0 = 0; slideIdx0 < slideContainers.length; slideIdx0 += 1) {
    const slideIndex1Based = slideIdx0 + 1;
    const mapSlide = parsedMap.slides?.[String(slideIndex1Based)];
    if (!mapSlide?.variants) {
      continue;
    }

    const chosen = chooseVariant({
      slideIndex1: slideIndex1Based,
      mapSlide,
      presentationId: seedContext.presentationId,
      fills,
    });

    if (!chosen.chosen) {
      continue;
    }

    const variantRule = mapSlide.variants[chosen.chosen];
    if (!variantRule) {
      continue;
    }

    chosenVariants[String(slideIndex1Based)] = chosen.chosen;

    if (Array.isArray(variantRule.dropAt)) {
      const removedByIndex = applyDropAtToSlide(slideContainers[slideIdx0], variantRule.dropAt, slideIndex1Based, options);
      droppedAtCount += removedByIndex;
      droppedCount += removedByIndex;
    }

    if (Array.isArray(variantRule.drop) && variantRule.drop.length > 0) {
      const dropSet = new Set(variantRule.drop.filter((id) => typeof id === "string"));
      const removedById = dropIdsFromNode(slideContainers[slideIdx0], dropSet, droppedIds, new Set<object>());
      droppedCount += removedById;
    }
  }

  return {
    droppedCount,
    droppedAtCount,
    droppedIds,
    chosenVariants,
  };
};
