export const buildRagConfigLog = (params: {
  enabled: boolean;
  mode: "query" | "retrieve";
  collection: string;
  topK: number;
  minScore: number;
  timeoutMs: number;
}): string => (
  `rag: enabled=${params.enabled} mode=${params.mode} collection=${params.collection} topK=${params.topK} minScore=${params.minScore} timeoutMs=${params.timeoutMs}`
);

export const buildRagRequestLog = (params: { sourceUrisCount: number; querySnippet: string }): string => (
  `rag.request: sourceUrisCount=${params.sourceUrisCount} querySnippet=${params.querySnippet}`
);

export const buildRagResponseLog = (params: {
  ok: boolean;
  httpStatus?: number;
  hitCount: number;
  usedContextChars: number;
  elapsedMs: number;
  topSourcesSample: string[];
}): string => (
  `rag.response: ok=${params.ok} httpStatus=${params.httpStatus ?? "n/a"} hitCount=${params.hitCount} usedContextChars=${params.usedContextChars} elapsedMs=${params.elapsedMs} topSourcesSample=${params.topSourcesSample.join("|")}`
);
