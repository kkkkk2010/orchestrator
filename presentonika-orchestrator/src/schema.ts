import { z } from "zod";

export const createJobSchema = z.object({
  presentationId: z.number(),
  userId: z.number(),
  topic: z.string().min(1),
  themeId: z.string().min(1),
  language: z.string().optional(),
  debug: z
    .object({
      fills: z.record(z.string()).optional(),
    })
    .optional(),
  rag: z
    .object({
      collection: z.string().min(1).optional(),
      sourceUris: z.array(z.string().min(1)).optional(),
      topK: z.number().int().positive().optional(),
      minScore: z.number().min(0).max(1).optional(),
      mode: z.enum(["retrieve", "query"]).optional(),
    })
    .optional(),
  save: z.object({
    endpoint: z.string().min(1).url(),
    presentationId: z.number(),
    saveToken: z.string().min(1),
  }),
});

export type CreateJobPayload = z.infer<typeof createJobSchema>;
