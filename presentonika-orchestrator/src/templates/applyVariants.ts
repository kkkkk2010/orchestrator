export type SeedContext = {
  presentationId: number;
};

export type ApplyVariantsStats = {
  droppedCount: number;
  droppedIds: string[];
};

type VariantRule = {
  drop?: string[];
};

type SlideRule = {
  variants?: Record<string, VariantRule>;
};

type VariantsMap = {
  slides?: Record<string, SlideRule>;
};

const DROP_IDS_LIMIT = 50;

const hashString = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const pickVariantName = (presentationId: number, slideIndex: number): "A" | "B" => {
  const hash = hashString(`${presentationId}${slideIndex}`);
  return hash % 2 === 0 ? "A" : "B";
};

const getSlideDropSet = (map: VariantsMap, presentationId: number, slideIndex: number): Set<string> => {
  const slides = map.slides;
  if (!slides) {
    return new Set<string>();
  }

  const byOneBasedIndex = slides[String(slideIndex + 1)];
  const byZeroBasedIndex = slides[String(slideIndex)];
  const slideRule = byOneBasedIndex ?? byZeroBasedIndex;

  if (!slideRule?.variants) {
    return new Set<string>();
  }

  const variantName = pickVariantName(presentationId, slideIndex);
  const variantRule = slideRule.variants[variantName];

  if (!variantRule?.drop) {
    return new Set<string>();
  }

  return new Set(variantRule.drop.filter((id) => typeof id === "string"));
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

export const applyVariants = (doc: unknown, map: unknown, seedContext: SeedContext): ApplyVariantsStats => {
  const droppedIds: string[] = [];
  let droppedCount = 0;

  const parsedMap = (map && typeof map === "object" ? map : {}) as VariantsMap;
  const slideContainers = getSlideContainers(doc);

  for (let slideIndex = 0; slideIndex < slideContainers.length; slideIndex += 1) {
    const dropSet = getSlideDropSet(parsedMap, seedContext.presentationId, slideIndex);
    if (dropSet.size === 0) {
      continue;
    }

    droppedCount += dropIdsFromNode(slideContainers[slideIndex], dropSet, droppedIds, new Set<object>());
  }

  return {
    droppedCount,
    droppedIds,
  };
};
