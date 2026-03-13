export const buildRagConfigLog = (params: {
  enabled: boolean;
  mode: "query" | "retrieve";
  collection: string;
  topK: number;
  minScore: number;
  timeoutMs: number;
}): string => `rag: enabled=${params.enabled} mode=${params.mode} collection=${params.collection} topK=${params.topK} minScore=${params.minScore} timeoutMs=${params.timeoutMs}`;

export const buildRagRequestLog = (params: {
  endpoint: "/retrieve" | "/query";
  querySnippet: string;
  topK: number;
  minScore: number;
  collection: string;
}): string => `rag.request: endpoint=${params.endpoint} querySnippet="${params.querySnippet}" topK=${params.topK} minScore=${params.minScore} collection=${params.collection}`;

export const buildRagResponseLog = (params: {
  ok: boolean;
  httpStatus?: number;
  hitCount: number;
  usedContextChars: number;
  elapsedMs: number;
}): string => `rag.response: ok=${params.ok} httpStatus=${params.httpStatus ?? "n/a"} hitCount=${params.hitCount} usedContextChars=${params.usedContextChars} elapsedMs=${params.elapsedMs}`;

export const buildRagHitsSampleLog = (sampleHits: Array<{ score?: number; source_uri?: string; fragment_id?: string }>): string => (
  `rag.hits.sample: ${JSON.stringify(sampleHits.slice(0, 3))}`
);

export const buildRagErrorLog = (message: string): string => `rag.error: ${message}`;
