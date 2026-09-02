import type { RagQuerySource, RagRetrieveHit } from "./schema";

export type Citation = {
  n: number;
  fragment_id: string;
  source_uri: string;
  page?: number;
  score: number;
  snippet: string;
};

const trimSnippet = (input: string): string => {
  const normalized = input.replace(/\s+/g, " ").trim();
  if (normalized.length <= 500) {
    return normalized;
  }
  return `${normalized.slice(0, 500)}…`;
};

const buildLine = (citation: Citation): string => {
  const pagePart = typeof citation.page === "number" ? ` (p.${citation.page})` : "";
  return `[${citation.n}] ${citation.source_uri}${pagePart} score=${citation.score.toFixed(2)}: ${citation.snippet}`;
};

export const formatRetrieveContext = (
  hits: RagRetrieveHit[],
  maxChars: number,
  maxHits: number
): { contextText: string; citations: Citation[] } => {
  const lines: string[] = [];
  const citations: Citation[] = [];

  for (const hit of hits.slice(0, maxHits)) {
    const citation: Citation = {
      n: citations.length + 1,
      fragment_id: hit.fragment_id,
      source_uri: hit.source_uri,
      page: hit.page,
      score: hit.score,
      snippet: trimSnippet(hit.snippet || hit.text || ""),
    };

    if (!citation.snippet) {
      continue;
    }

    const nextLine = buildLine(citation);
    const candidate = [...lines, nextLine].join("\n");
    if (candidate.length > maxChars) {
      break;
    }

    lines.push(nextLine);
    citations.push(citation);
  }

  return {
    contextText: lines.join("\n"),
    citations,
  };
};

export const formatQuerySourcesAsCitations = (sources: RagQuerySource[]): Citation[] => {
  return sources.map((source) => ({
    n: source.n,
    fragment_id: source.fragment_id,
    source_uri: source.source_uri,
    page: source.page,
    score: source.score,
    snippet: trimSnippet(source.snippet),
  }));
};
