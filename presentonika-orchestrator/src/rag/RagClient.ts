import type { RagQueryResponse, RagRetrieveResponse } from "./schema";

export type RagRetrieveInput = {
  query: string;
  topK: number;
  minScore: number;
  collection: string;
};

export type RagQueryInput = {
  query: string;
  topK: number;
  minScore: number;
  collection: string;
  sourceUris?: string[];
  mode?: "grounded";
  citationStyle?: "fragments";
  returnSources?: boolean;
};

export type RetrieveResult = RagRetrieveResponse & { contextText: string; httpStatus?: number; warnings?: string[] };
export type QueryResult = RagQueryResponse & { httpStatus?: number };

export interface RagClient {
  retrieve(input: RagRetrieveInput): Promise<RetrieveResult>;
  query(input: RagQueryInput): Promise<QueryResult>;
  healthz(): Promise<boolean>;
  readyz(): Promise<boolean>;
}
