import type { RagRetrieveHit } from "./schema";

type AnyRecord = Record<string, unknown>;

const asRecord = (value: unknown): AnyRecord => (value && typeof value === "object" ? value as AnyRecord : {});

const asNumber = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const asString = (value: unknown): string | undefined => (typeof value === "string" && value.trim().length > 0 ? value : undefined);

const pickText = (row: AnyRecord): string | undefined => {
  const metadata = asRecord(row.metadata);
  return asString(row.text)
    || asString(row.content)
    || asString(row.chunk_text)
    || asString(row.page_content)
    || asString(metadata.text);
};

export const normalizeRagRetrieveResponse = (raw: unknown, maxContextChars = 12000): {
  ok: boolean;
  hitCount: number;
  hits: RagRetrieveHit[];
  contextText: string;
  warnings: string[];
} => {
  const warnings: string[] = [];
  const root = asRecord(raw);
  const candidates = Array.isArray(root.hits)
    ? root.hits
    : (Array.isArray(root.results)
      ? root.results
      : (Array.isArray(root.fragments) ? root.fragments : []));

  const hits: RagRetrieveHit[] = [];
  const contextParts: string[] = [];
  let usedChars = 0;

  for (const item of candidates) {
    if (!item || typeof item !== "object") { warnings.push("skip non-object hit"); continue; }
    const row = item as AnyRecord;
    const text = pickText(row) || "";
    if (!text) warnings.push(`hit[${hits.length}] has no text/content`);

    const hit: RagRetrieveHit = {
      fragment_id: asString(row.fragment_id) || asString(row.id) || `fragment_${hits.length + 1}`,
      source_uri: asString(row.source_uri) || asString(row.source) || "unknown",
      snippet: asString(row.snippet) || text || "",
      score: asNumber(row.score) ?? 0,
      text,
      title: asString(row.title),
      type: asString(row.type),
      page: asNumber(row.page),
      metadata: (row.metadata && typeof row.metadata === "object" ? row.metadata : undefined) as Record<string, unknown> | undefined,
    };

    hits.push(hit);

    if (text.length > 0) {
      const remaining = Math.max(0, maxContextChars - usedChars);
      if (remaining <= 0) continue;
      const chunk = text.slice(0, remaining);
      contextParts.push(chunk);
      usedChars += chunk.length;
    }
  }

  return {
    ok: true,
    hitCount: hits.length,
    hits,
    contextText: contextParts.join("\n").slice(0, maxContextChars),
    warnings,
  };
};
