import { z } from "zod";

export const ragRetrieveHitSchema = z.object({
  fragment_id: z.string(),
  source_uri: z.string(),
  snippet: z.string(),
  score: z.number(),
  title: z.string().optional(),
  type: z.string().optional(),
  page: z.number().optional(),
  text: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const ragRetrieveResponseSchema = z.object({
  hits: z.array(ragRetrieveHitSchema),
});

export const ragQuerySourceSchema = z.object({
  n: z.number(),
  fragment_id: z.string(),
  source_uri: z.string(),
  snippet: z.string(),
  score: z.number(),
  page: z.number().optional(),
  type: z.string().optional(),
});

export const ragQueryResponseSchema = z.object({
  answer: z.string(),
  sources: z.array(ragQuerySourceSchema),
});

export type RagRetrieveHit = z.infer<typeof ragRetrieveHitSchema>;
export type RagRetrieveResponse = z.infer<typeof ragRetrieveResponseSchema>;
export type RagQuerySource = z.infer<typeof ragQuerySourceSchema>;
export type RagQueryResponse = z.infer<typeof ragQueryResponseSchema>;
