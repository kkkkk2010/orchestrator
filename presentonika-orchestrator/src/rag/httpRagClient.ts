import { sleep } from "../util/sleep";
import type { QueryResult, RagClient, RagQueryInput, RagRetrieveInput, RetrieveResult } from "./RagClient";
import { ragQueryResponseSchema } from "./schema";
import { normalizeRagRetrieveResponse } from "./normalize";

export class RagHttpError extends Error {
  readonly stage: string;
  readonly status: number | null;

  constructor(message: string, params: { stage: string; status: number | null }) {
    super(message);
    this.name = "RagHttpError";
    this.stage = params.stage;
    this.status = params.status;
  }
}

const RETRYABLE_STATUS = new Set([429, 502, 503]);
const normalizeBaseUrl = (url: string): string => url.replace(/\/+$/, "");

const isRetryableNetworkError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("econnrefused") || message.includes("enotfound") || message.includes("etimedout") || message.includes("fetch failed") || message.includes("network");
};

const calcRetryDelayMs = (attempt: number, baseDelayMs: number): number => {
  const backoff = Math.min(5000, baseDelayMs * (2 ** Math.max(0, attempt - 1)));
  return backoff + Math.floor(Math.random() * 150);
};

export const buildRetrieveRequestBody = (input: RagRetrieveInput): Record<string, unknown> => ({
  query: input.query,
  top_k: input.topK,
  min_score: input.minScore,
  collection: input.collection,
  return_text: true,
});

export class HttpRagClient implements RagClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;

  constructor() {
    this.baseUrl = normalizeBaseUrl(process.env.RAG_BASE_URL || "http://localhost:8000");
    this.apiKey = process.env.RAG_API_KEY || "";
    this.timeoutMs = Number.parseInt(process.env.RAG_TIMEOUT_MS || "15000", 10);
    this.maxRetries = Number.parseInt(process.env.RAG_MAX_RETRIES || "2", 10);
    this.retryBaseDelayMs = Number.parseInt(process.env.RAG_RETRY_BASE_DELAY_MS || "400", 10);
  }

  private async request(params: {
    path: string;
    body?: Record<string, unknown>;
    method?: "GET" | "POST";
    stage: string;
  }): Promise<{ json: unknown; status: number }> {
    const method = params.method || "POST";

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(`${this.baseUrl}${params.path}`, {
          method,
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": this.apiKey,
          },
          body: method === "POST" ? JSON.stringify(params.body || {}) : undefined,
          signal: controller.signal,
        });

        const text = await response.text();
        if (!response.ok) {
          const err = new RagHttpError(`RagRequestFailed(${params.stage}): ${response.status} ${text.slice(0, 300).replace(/\s+/g, " ")}`, { stage: params.stage, status: response.status });
          if (attempt < this.maxRetries && RETRYABLE_STATUS.has(response.status)) {
            await sleep(calcRetryDelayMs(attempt + 1, this.retryBaseDelayMs));
            continue;
          }
          throw err;
        }

        return { json: text ? JSON.parse(text) as unknown : {}, status: response.status };
      } catch (error) {
        if (error instanceof RagHttpError) throw error;
        if (attempt < this.maxRetries && isRetryableNetworkError(error)) {
          await sleep(calcRetryDelayMs(attempt + 1, this.retryBaseDelayMs));
          continue;
        }
        throw new RagHttpError(`RagRequestFailed(${params.stage}): ${error instanceof Error ? error.message : String(error)}`, { stage: params.stage, status: null });
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new RagHttpError(`RagRequestFailed(${params.stage}): retry limit reached`, { stage: params.stage, status: null });
  }

  async retrieve(input: RagRetrieveInput): Promise<RetrieveResult> {
    const response = await this.request({
      path: "/retrieve",
      stage: "retrieve",
      body: buildRetrieveRequestBody(input),
    });

    const normalized = normalizeRagRetrieveResponse(response.json, Number.parseInt(process.env.RAG_MAX_CONTEXT_CHARS || "12000", 10));
    return { hits: normalized.hits, contextText: normalized.contextText, warnings: normalized.warnings, httpStatus: response.status };
  }

  async query(input: RagQueryInput): Promise<QueryResult> {
    const response = await this.request({
      path: "/query",
      stage: "query",
      body: {
        query: input.query,
        top_k: input.topK,
        min_score: input.minScore,
        mode: input.mode || "grounded",
        citation_style: input.citationStyle || "fragments",
        return_sources: input.returnSources ?? true,
        collection: input.collection,
        source_uris: input.sourceUris,
      },
    });
    const parsed = ragQueryResponseSchema.parse(response.json);
    return { ...parsed, httpStatus: response.status };
  }

  async healthz(): Promise<boolean> {
    try { await this.request({ path: "/healthz", method: "GET", stage: "healthz" }); return true; } catch { return false; }
  }
  async readyz(): Promise<boolean> {
    try { await this.request({ path: "/readyz", method: "GET", stage: "readyz" }); return true; } catch { return false; }
  }
}
