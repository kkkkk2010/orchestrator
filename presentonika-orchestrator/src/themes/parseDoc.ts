import path from "node:path";

const FILL_KEY_REGEX = /{{\s*([a-zA-Z0-9_:-]+)\s*}}/g;

const walkNode = (
  node: unknown,
  onString: (value: string) => void,
  onObject: (value: Record<string, unknown>) => void,
  visited: Set<object>
): void => {
  if (typeof node === "string") {
    onString(node);
    return;
  }

  if (!node || typeof node !== "object") {
    return;
  }

  if (visited.has(node)) {
    return;
  }
  visited.add(node);

  if (Array.isArray(node)) {
    for (const item of node) {
      walkNode(item, onString, onObject, visited);
    }
    return;
  }

  const objectNode = node as Record<string, unknown>;
  onObject(objectNode);

  for (const value of Object.values(objectNode)) {
    walkNode(value, onString, onObject, visited);
  }
};

const maybeExtractImageSlot = (value: string): string | null => {
  const basename = path.basename(value);
  const name = basename.includes(".") ? basename.slice(0, basename.lastIndexOf(".")) : basename;

  if (name.startsWith("ph_")) {
    return name;
  }

  if (value.includes("/ph_")) {
    const matched = value.match(/ph_[a-zA-Z0-9_:-]+/);
    return matched?.[0] ?? null;
  }

  return null;
};

export const extractFillKeys = (doc: unknown): string[] => {
  const keys = new Set<string>();

  walkNode(
    doc,
    (value) => {
      FILL_KEY_REGEX.lastIndex = 0;
      let match = FILL_KEY_REGEX.exec(value);
      while (match) {
        keys.add(match[1]);
        match = FILL_KEY_REGEX.exec(value);
      }
    },
    () => undefined,
    new Set<object>()
  );

  return [...keys];
};

export const extractImageSlots = (doc: unknown): string[] => {
  const slots = new Set<string>();

  walkNode(
    doc,
    (value) => {
      const slot = maybeExtractImageSlot(value);
      if (slot) {
        slots.add(slot);
      }
    },
    (objectNode) => {
      if (objectNode.type !== "image") {
        return;
      }

      if (typeof objectNode.src === "string") {
        const slot = maybeExtractImageSlot(objectNode.src);
        if (slot) {
          slots.add(slot);
        }
      }
    },
    new Set<object>()
  );

  return [...slots];
};

export const inferSlideCount = (doc: unknown): number => {
  if (!doc || typeof doc !== "object") {
    return 0;
  }

  const record = doc as Record<string, unknown>;

  if (Array.isArray(record.slides)) {
    return record.slides.length;
  }

  if (Array.isArray(record.pages)) {
    return record.pages.length;
  }

  return 0;
};
