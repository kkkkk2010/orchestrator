import path from "node:path";

const FILL_KEY_REGEX = /{{\s*([a-zA-Z0-9_:-]+)\s*}}/g;

export type PlaceholderLocation = {
  key: string;
  slide: number;
  elementIndex: number;
  path: string;
  rawSnippet: string;
};

const getSlides = (doc: unknown): unknown[] => {
  if (!doc || typeof doc !== "object") return [];
  const record = doc as Record<string, unknown>;
  if (Array.isArray(record.slides)) return record.slides;
  if (Array.isArray(record.pages)) return record.pages;
  return [];
};

const maybeExtractImageSlot = (value: string): string | null => {
  const basename = path.basename(value);
  const name = basename.includes(".") ? basename.slice(0, basename.lastIndexOf(".")) : basename;

  if (name.startsWith("ph_")) return name;
  if (value.includes("/ph_")) {
    const matched = value.match(/ph_[a-zA-Z0-9_:-]+/);
    return matched?.[0] ?? null;
  }
  return null;
};

const normalizeInString = (value: string): string => value.replace(FILL_KEY_REGEX, (_raw, key: string) => `{{${key}}}`);

const normalizeSplitRuns = (node: unknown): number => {
  if (!node || typeof node !== "object") return 0;

  let changes = 0;
  const visited = new Set<object>();
  const walk = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (visited.has(value as object)) return;
    visited.add(value as object);

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        const current = value[i];
        if (current && typeof current === "object" && typeof (current as Record<string, unknown>).text === "string") {
          const arr = value as Array<Record<string, unknown>>;
          const startText = (arr[i].text as string);
          if (/^\s*{{\s*$/.test(startText)) {
            let j = i + 1;
            let keyParts = "";
            while (j < arr.length) {
              const txt = typeof arr[j].text === "string" ? (arr[j].text as string) : "";
              if (/^\s*}}\s*$/.test(txt)) {
                if (/^[a-zA-Z0-9_:-]+$/.test(keyParts)) {
                  arr[i].text = `{{${keyParts}}}`;
                  for (let k = i + 1; k <= j; k += 1) {
                    arr[k].text = "";
                  }
                  changes += 1;
                }
                break;
              }

              const part = txt.trim();
              if (!/^[a-zA-Z0-9_:-]+$/.test(part)) {
                break;
              }
              keyParts += part;
              j += 1;
            }
          }
        }

        walk(current);
      }
      return;
    }

    const record = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(record)) {
      if (typeof child === "string") {
        const normalized = normalizeInString(child);
        if (normalized !== child) {
          record[key] = normalized;
          changes += 1;
        }
      } else {
        walk(child);
      }
    }
  };

  walk(node);
  return changes;
};

export const normalizePlaceholders = (doc: unknown): { normalizedCount: number } => {
  const normalizedCount = normalizeSplitRuns(doc);
  return { normalizedCount };
};

export const extractPlaceholderLocations = (doc: unknown): { locations: PlaceholderLocation[]; elementsScanned: number } => {
  const slides = getSlides(doc);
  const locations: PlaceholderLocation[] = [];
  let elementsScanned = 0;

  const walk = (value: unknown, pathPrefix: string, slide: number, elementIndex: number, visited: Set<object>): void => {
    if (typeof value === "string") {
      FILL_KEY_REGEX.lastIndex = 0;
      let match = FILL_KEY_REGEX.exec(value);
      while (match) {
        locations.push({
          key: match[1],
          slide,
          elementIndex,
          path: pathPrefix,
          rawSnippet: value.slice(0, 200),
        });
        match = FILL_KEY_REGEX.exec(value);
      }
      return;
    }

    if (!value || typeof value !== "object") return;
    if (visited.has(value as object)) return;
    visited.add(value as object);

    if (Array.isArray(value)) {
      value.forEach((item, idx) => walk(item, `${pathPrefix}[${idx}]`, slide, elementIndex, visited));
      return;
    }

    const record = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(record)) {
      walk(child, `${pathPrefix}.${key}`, slide, elementIndex, visited);
    }
  };

  slides.forEach((slideUnknown, slideIdx0) => {
    const slide = slideIdx0 + 1;
    const slideRecord = (slideUnknown && typeof slideUnknown === "object" ? slideUnknown : {}) as Record<string, unknown>;
    const elements = Array.isArray(slideRecord.elements) ? slideRecord.elements : [];

    elements.forEach((element, elementIndex) => {
      elementsScanned += 1;
      walk(element, `slides[${slideIdx0}].elements[${elementIndex}]`, slide, elementIndex, new Set<object>());
    });
  });

  return { locations, elementsScanned };
};

export const extractFillKeys = (doc: unknown): string[] => {
  const locations = extractPlaceholderLocations(doc).locations;
  return [...new Set(locations.map((item) => item.key))];
};

export const extractImageSlots = (doc: unknown): string[] => {
  const slots = new Set<string>();
  const visited = new Set<object>();

  const walkNode = (node: unknown): void => {
    if (typeof node === "string") {
      const slot = maybeExtractImageSlot(node);
      if (slot) slots.add(slot);
      return;
    }
    if (!node || typeof node !== "object") return;
    if (visited.has(node as object)) return;
    visited.add(node as object);

    if (Array.isArray(node)) {
      node.forEach(walkNode);
      return;
    }

    const objectNode = node as Record<string, unknown>;
    if (objectNode.type === "image" && typeof objectNode.src === "string") {
      const slot = maybeExtractImageSlot(objectNode.src);
      if (slot) slots.add(slot);
    }

    Object.values(objectNode).forEach(walkNode);
  };

  walkNode(doc);
  return [...slots];
};

export const inferSlideCount = (doc: unknown): number => getSlides(doc).length;
