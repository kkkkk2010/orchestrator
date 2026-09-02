export type PlaceholdersBySlide = Record<string, { count: number; keys: string[] }>;

export type LlmBatch = {
  index: number;
  slide?: number;
  keys: string[];
};

const chunk = (keys: string[], maxSize: number): string[][] => {
  const out: string[][] = [];
  for (let index = 0; index < keys.length; index += maxSize) {
    out.push(keys.slice(index, index + maxSize));
  }
  return out;
};

export const buildBatches = (params: {
  fillKeys: string[];
  placeholdersBySlide: PlaceholdersBySlide;
  maxKeysPerRequest: number;
  mode: "bySlide" | "chunk";
}): LlmBatch[] => {
  const max = Math.max(1, params.maxKeysPerRequest);

  if (params.mode === "chunk") {
    return chunk(params.fillKeys, max).map((keys, idx) => ({
      index: idx + 1,
      keys,
    }));
  }

  const used = new Set<string>();
  const batches: LlmBatch[] = [];

  const slideNumbers = Object.keys(params.placeholdersBySlide)
    .map((key) => Number.parseInt(key, 10))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  for (const slide of slideNumbers) {
    const entry = params.placeholdersBySlide[String(slide)];
    if (!entry) {
      continue;
    }

    const keys = entry.keys.filter((key) => params.fillKeys.includes(key));
    if (keys.length === 0) {
      continue;
    }

    for (const key of keys) {
      used.add(key);
    }

    for (const keysChunk of chunk(keys, max)) {
      batches.push({
        index: batches.length + 1,
        slide,
        keys: keysChunk,
      });
    }
  }

  const remaining = params.fillKeys.filter((key) => !used.has(key));
  for (const keysChunk of chunk(remaining, max)) {
    batches.push({
      index: batches.length + 1,
      keys: keysChunk,
    });
  }

  return batches;
};

export const aggregateFillCounts = (fillKeys: string[], llmFills: Record<string, string>): { receivedKeysCount: number; missingKeysCount: number } => {
  const received = fillKeys.filter((key) => typeof llmFills[key] === "string" && llmFills[key].trim().length > 0);
  return {
    receivedKeysCount: received.length,
    missingKeysCount: Math.max(0, fillKeys.length - received.length),
  };
};
