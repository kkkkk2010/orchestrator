import { z } from "zod";
import { deckPlanSchema } from "./deckPlan";

const saveEndpointSchema = z.string().min(1).url().superRefine((value, context) => {
  if (process.env.NODE_ENV !== "production") return;
  const endpoint = new URL(value);
  const allowedOrigins = (process.env.ORCHESTRATOR_SAVE_ENDPOINT_ORIGINS || "https://www.presentonika.ru")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (endpoint.protocol !== "https:" || !allowedOrigins.includes(endpoint.origin)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "save.endpoint origin is not allowed" });
  }
});

export const createJobSchema = z.object({
  presentationId: z.number().int().positive(),
  userId: z.number().int().positive(),
  requestId: z.string().trim().min(8).max(96).regex(/^[a-zA-Z0-9._:-]+$/).optional(),
  topic: z.string().trim().min(1).max(500),
  themeId: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  language: z.string().optional(),
  deckPlan: deckPlanSchema.optional(),
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
    endpoint: saveEndpointSchema,
    presentationId: z.number().int().positive(),
    saveToken: z.string().min(1).max(1024),
  }),
}).superRefine((value, context) => {
  if (value.presentationId !== value.save.presentationId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["save", "presentationId"],
      message: "save.presentationId must match presentationId",
    });
  }
});

export type CreateJobPayload = z.infer<typeof createJobSchema>;
