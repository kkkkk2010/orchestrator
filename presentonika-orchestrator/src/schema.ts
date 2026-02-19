import { z } from "zod";

export const createJobSchema = z.object({
  presentationId: z.number(),
  userId: z.number(),
  topic: z.string().min(1),
  themeId: z.string().min(1),
  language: z.string().optional(),
  save: z.object({
    endpoint: z.string().min(1).url(),
    presentationId: z.number(),
    saveToken: z.string().min(1),
  }),
});

export type CreateJobPayload = z.infer<typeof createJobSchema>;
