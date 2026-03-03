import { sleep } from "../util/sleep";
import type { QueryResult, RagClient, RagQueryInput, RagRetrieveInput, RetrieveResult } from "./RagClient";
import { ragQueryResponseSchema, ragRetrieveResponseSchema } from "./schema";

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
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("etimedout") ||
    message.includes("fetch failed") ||
    message.includes("network")
  );
};

const calcRetryDelayMs = (attempt: number, baseDelayMs: number): number => {
  const backoff = Math.min(5000, baseDelayMs * (2 ** Math.max(0, attempt - 1)));
  const jitter = Math.floor(Math.random() * 150);
  return backoff + jitter;
};

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

  private async request<T>(params: {
    path: string;
    body?: Record<string, unknown>;
    method?: "GET" | "POST";
    stage: string;
    parse: (json: unknown) => T;
  }): Promise<T> {
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
          const shortBody = text.slice(0, 300).replace(/\s+/g, " ");
          const error = new RagHttpError(`RagRequestFailed(${params.stage}): ${response.status} ${shortBody}`, {
            stage: params.stage,
            status: response.status,
          });

          if (attempt < this.maxRetries && RETRYABLE_STATUS.has(response.status)) {
            await sleep(calcRetryDelayMs(attempt + 1, this.retryBaseDelayMs));
            continue;
          }

          throw error;
        }

        const json = text ? (JSON.parse(text) as unknown) : {};
        return params.parse(json);
      } catch (error) {
        if (error instanceof RagHttpError) {
          throw error;
        }

        if (attempt < this.maxRetries && isRetryableNetworkError(error)) {
          await sleep(calcRetryDelayMs(attempt + 1, this.retryBaseDelayMs));
          continue;
        }

        const message = error instanceof Error ? error.message : String(error);
        throw new RagHttpError(`RagRequestFailed(${params.stage}): ${message}`, {
          stage: params.stage,
          status: null,
        });
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new RagHttpError(`RagRequestFailed(${params.stage}): retry limit reached`, {
      stage: params.stage,
      status: null,
    });
  }

  async retrieve(input: RagRetrieveInput): Promise<RetrieveResult> {
    return this.request({
      path: "/retrieve",
      stage: "retrieve",
      body: {
        query: input.query,
        top_k: input.topK,
        min_score: input.minScore,
        collection: input.collection,
        source_uris: input.sourceUris,
      },
      parse: (json) => ragRetrieveResponseSchema.parse(json),
    });
  }

  async query(input: RagQueryInput): Promise<QueryResult> {
    return this.request({
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
      parse: (json) => ragQueryResponseSchema.parse(json),
    });
  }

  async healthz(): Promise<boolean> {
    try {
      await this.request({
        path: "/healthz",
        method: "GET",
        stage: "healthz",
        parse: () => true,
      });
      return true;
    } catch {
      return false;
    }
  }

  async readyz(): Promise<boolean> {
    try {
      await this.request({
        path: "/readyz",
        method: "GET",
        stage: "readyz",
        parse: () => true,
      });
      return true;
    } catch {
      return false;
    }
  }
}
