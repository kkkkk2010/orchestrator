const FILL_KEY_REGEX = /{{\s*([a-zA-Z0-9_:-]+)\s*}}/g;
const MISSING_KEYS_LIMIT = 50;

export type ApplyFillsStats = {
  replacedCount: number;
  missingKeys: string[];
};

const replaceFillTokens = (
  input: string,
  fills: Record<string, string>,
  missingKeysSet: Set<string>
): { output: string; replacedCount: number } => {
  let replacedCount = 0;

  const output = input.replace(FILL_KEY_REGEX, (full, key: string) => {
    const replacement = fills[key];
    if (typeof replacement === "string") {
      replacedCount += 1;
      return replacement;
    }

    if (missingKeysSet.size < MISSING_KEYS_LIMIT) {
      missingKeysSet.add(key);
    }

    return full;
  });

  return { output, replacedCount };
};

const walkAndReplace = (
  node: unknown,
  fills: Record<string, string>,
  missingKeysSet: Set<string>,
  visited: Set<object>
): number => {
  if (typeof node === "string") {
    return 0;
  }

  if (!node || typeof node !== "object") {
    return 0;
  }

  if (visited.has(node)) {
    return 0;
  }
  visited.add(node);

  let replacedCount = 0;

  if (Array.isArray(node)) {
    for (let index = 0; index < node.length; index += 1) {
      const value = node[index];

      if (typeof value === "string") {
        const replaced = replaceFillTokens(value, fills, missingKeysSet);
        node[index] = replaced.output;
        replacedCount += replaced.replacedCount;
        continue;
      }

      replacedCount += walkAndReplace(value, fills, missingKeysSet, visited);
    }

    return replacedCount;
  }

  const record = node as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const value = record[key];

    if (typeof value === "string") {
      const replaced = replaceFillTokens(value, fills, missingKeysSet);
      record[key] = replaced.output;
      replacedCount += replaced.replacedCount;
      continue;
    }

    replacedCount += walkAndReplace(value, fills, missingKeysSet, visited);
  }

  return replacedCount;
};

export const applyFills = (doc: unknown, fills: Record<string, string>): ApplyFillsStats => {
  const missingKeysSet = new Set<string>();
  const replacedCount = walkAndReplace(doc, fills, missingKeysSet, new Set<object>());

  return {
    replacedCount,
    missingKeys: [...missingKeysSet],
  };
};
