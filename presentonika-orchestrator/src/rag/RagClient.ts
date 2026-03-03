import type { RagQueryResponse, RagRetrieveResponse } from "./schema";

export type RagRequestInput = {
  query: string;
  topK: number;
  minScore: number;
  collection: string;
  sourceUris?: string[];
};

export type RagRetrieveInput = RagRequestInput;

export type RagQueryInput = RagRequestInput & {
  mode?: "grounded";
  citationStyle?: "fragments";
  returnSources?: boolean;
};

export type RetrieveResult = RagRetrieveResponse;
export type QueryResult = RagQueryResponse;

export interface RagClient {
  retrieve(input: RagRetrieveInput): Promise<RetrieveResult>;
  query(input: RagQueryInput): Promise<QueryResult>;
  healthz(): Promise<boolean>;
  readyz(): Promise<boolean>;
}
