const FILL_KEY_REGEX = /{{\s*([a-zA-Z0-9_:-]+)\s*}}/g;
const MISSING_KEYS_LIMIT = 50;

export type PlaceholderLocation = {
  key: string;
  slide: number;
  elementIndex: number;
  path: string;
  rawSnippet: string;
};

export type ApplyFillsStats = {
  replacedCount: number;
  missingKeys: string[];
};

export type RemainingTokenSample = {
  path: string;
  snippet: string;
};

export type RemainingTokenStats = {
  remainingTestTokensCount: number;
  remainingMustacheTokensCount: number;
  remainingSamples: RemainingTokenSample[];
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

const parsePathSegments = (path: string): Array<string | number> => {
  const segments: Array<string | number> = [];
  const matcher = /([^[.\]]+)|\[(\d+)\]/g;
  let match = matcher.exec(path);
  while (match) {
    if (match[1]) {
      segments.push(match[1]);
    } else if (match[2]) {
      segments.push(Number.parseInt(match[2], 10));
    }
    match = matcher.exec(path);
  }
  return segments;
};

export const getAtPath = (root: unknown, path: string): unknown => {
  const segments = parsePathSegments(path);
  let cursor: unknown = root;

  for (const segment of segments) {
    if (typeof segment === "number") {
      if (!Array.isArray(cursor) || segment < 0 || segment >= cursor.length) {
        return undefined;
      }
      cursor = cursor[segment];
      continue;
    }

    if (!cursor || typeof cursor !== "object") {
      return undefined;
    }

    cursor = (cursor as Record<string, unknown>)[segment];
  }

  return cursor;
};

export const setAtPath = (root: unknown, path: string, value: unknown): boolean => {
  const segments = parsePathSegments(path);
  if (segments.length === 0) {
    return false;
  }

  let cursor: unknown = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];

    if (typeof segment === "number") {
      if (!Array.isArray(cursor) || segment < 0 || segment >= cursor.length) {
        return false;
      }
      cursor = cursor[segment];
      continue;
    }

    if (!cursor || typeof cursor !== "object") {
      return false;
    }

    cursor = (cursor as Record<string, unknown>)[segment];
  }

  const lastSegment = segments[segments.length - 1];
  if (typeof lastSegment === "number") {
    if (!Array.isArray(cursor) || lastSegment < 0 || lastSegment >= cursor.length) {
      return false;
    }
    cursor[lastSegment] = value;
    return true;
  }

  if (!cursor || typeof cursor !== "object") {
    return false;
  }

  (cursor as Record<string, unknown>)[lastSegment] = value;
  return true;
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const applyFillsByLocations = (
  doc: unknown,
  placeholderLocations: PlaceholderLocation[],
  fills: Record<string, string>
): ApplyFillsStats => {
  const missingKeysSet = new Set<string>();
  let replacedCount = 0;

  for (const location of placeholderLocations) {
    const replacement = fills[location.key];
    if (typeof replacement !== "string") {
      if (missingKeysSet.size < MISSING_KEYS_LIMIT) {
        missingKeysSet.add(location.key);
      }
      continue;
    }

    const current = getAtPath(doc, location.path);
    if (typeof current !== "string") {
      continue;
    }

    const escapedKey = escapeRegex(location.key);
    const tokenRegex = new RegExp(`{{\\s*${escapedKey}\\s*}}|TEST_<${escapedKey}>|TEST_${escapedKey}`, "g");
    const matches = current.match(tokenRegex);
    if (!matches || matches.length === 0) {
      continue;
    }

    const next = current.replace(tokenRegex, replacement);
    if (next !== current && setAtPath(doc, location.path, next)) {
      replacedCount += matches.length;
    }
  }

  return {
    replacedCount,
    missingKeys: [...missingKeysSet],
  };
};

export const scanRemainingFillTokens = (doc: unknown, maxSamples = 10): RemainingTokenStats => {
  let remainingTestTokensCount = 0;
  let remainingMustacheTokensCount = 0;
  const remainingSamples: RemainingTokenSample[] = [];
  const visited = new Set<object>();

  const walk = (node: unknown, path: string): void => {
    if (typeof node === "string") {
      const testCount = (node.match(/TEST_[a-zA-Z0-9_:-]+/g) || []).length;
      const mustacheCount = (node.match(/{{\s*[a-zA-Z0-9_:-]+\s*}}/g) || []).length;

      remainingTestTokensCount += testCount;
      remainingMustacheTokensCount += mustacheCount;

      if ((testCount > 0 || mustacheCount > 0) && remainingSamples.length < maxSamples) {
        remainingSamples.push({
          path,
          snippet: node.slice(0, 200),
        });
      }
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
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }

    Object.entries(node as Record<string, unknown>).forEach(([key, value]) => {
      walk(value, path ? `${path}.${key}` : key);
    });
  };

  walk(doc, "");

  return {
    remainingTestTokensCount,
    remainingMustacheTokensCount,
    remainingSamples,
  };
};

export const applyFills = (doc: unknown, fills: Record<string, string>): ApplyFillsStats => {
  const missingKeysSet = new Set<string>();
  const replacedCount = walkAndReplace(doc, fills, missingKeysSet, new Set<object>());

  return {
    replacedCount,
    missingKeys: [...missingKeysSet],
  };
};
