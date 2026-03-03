import fs from "node:fs/promises";
import path from "node:path";
import type { RagQuerySource, RagRetrieveHit } from "./schema";

export type RagArtifactInput = {
  jobId: string;
  mode: "retrieve" | "query";
  query: string;
  collection: string;
  sourceUris?: string[];
  topK: number;
  minScore: number;
  hits?: RagRetrieveHit[];
  sources?: RagQuerySource[];
};

export const writeRagArtifacts = async (input: RagArtifactInput): Promise<{ ragTmpPath: string; ragJsonString: string }> => {
  const ragData = {
    version: 1,
    mode: input.mode,
    query: input.query,
    collection: input.collection,
    sourceUris: input.sourceUris || [],
    topK: input.topK,
    minScore: input.minScore,
    hits: input.hits || [],
    sources: input.sources || [],
    createdAt: new Date().toISOString(),
  };

  const ragJsonString = JSON.stringify(ragData, null, 2);
  const ragTmpPath = path.resolve(".tmp", input.jobId, "rag.json");

  await fs.mkdir(path.dirname(ragTmpPath), { recursive: true });
  await fs.writeFile(ragTmpPath, ragJsonString, "utf8");

  return {
    ragTmpPath,
    ragJsonString,
  };
};
