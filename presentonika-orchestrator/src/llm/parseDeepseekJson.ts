const stripFencedBlock = (text: string): string | null => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (!fenced) {
    return null;
  }
  return fenced[1]?.trim() || null;
};

const extractBalancedJson = (text: string): string | null => {
  const start = text.indexOf("{");
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  let best: string | null = null;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        best = text.slice(start, index + 1);
      }
      if (depth < 0) {
        break;
      }
    }
  }

  return best;
};

const tryParse = (candidate: string): unknown => JSON.parse(candidate) as unknown;

export const parseDeepseekJson = (rawText: string): { parsed: unknown | null; parseError?: string } => {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { parsed: null, parseError: "LLMInvalidJSON: empty response" };
  }

  const candidates: string[] = [];

  const fenced = stripFencedBlock(trimmed);
  if (fenced) {
    candidates.push(fenced);
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    candidates.push(trimmed);
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  const balanced = extractBalancedJson(trimmed);
  if (balanced) {
    candidates.push(balanced);
  }

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);

    try {
      return { parsed: tryParse(candidate) };
    } catch {
      // try next candidate
    }
  }

  return { parsed: null, parseError: "LLMInvalidJSON: unable to parse JSON object" };
};
