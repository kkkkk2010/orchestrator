import { z } from "zod";
import type { LLMGenerateInput, LLMGenerateOutput } from "./LLMClient";

const llmRawSchema = z.object({
  fills: z.record(z.string()).default({}),
  imagePlanPatch: z
    .object({
      slots: z
        .array(
          z.object({
            slotId: z.string(),
            query: z.string().optional(),
            hint: z.string().optional(),
            styleHint: z.string().optional(),
            negative: z.array(z.string()).optional(),
          })
        )
        .default([]),
    })
    .optional(),
});

const trimMax = (value: string, max: number): string => {
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
};

export const parseAndNormalizeLLMOutput = (params: {
  raw: unknown;
  input: LLMGenerateInput;
  maxOutputChars: number;
}): LLMGenerateOutput => {
  const parsed = llmRawSchema.parse(params.raw);
  const outputRawText = JSON.stringify(parsed);
  if (outputRawText.length > params.maxOutputChars) {
    throw new Error(`LLMOutputTooLarge: ${outputRawText.length} > ${params.maxOutputChars}`);
  }

  const allowedFills = new Set(params.input.fillKeys);
  const fills: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed.fills)) {
    if (!allowedFills.has(key)) {
      continue;
    }
    fills[key] = trimMax(String(value), 2000);
  }

  const allowedSlots = new Set(params.input.imagePlan.slots.map((slot) => slot.slotId));
  const slots = (parsed.imagePlanPatch?.slots || [])
    .filter((slot: { slotId: string; query?: string; hint?: string; styleHint?: string; negative?: string[] }) =>
      allowedSlots.has(slot.slotId)
    )
    .map((slot: { slotId: string; query?: string; hint?: string; styleHint?: string; negative?: string[] }) => ({
      slotId: slot.slotId,
      query: slot.query ? trimMax(slot.query, 300) : undefined,
      hint: slot.hint ? trimMax(slot.hint, 400) : undefined,
      styleHint: slot.styleHint ? trimMax(slot.styleHint, 120) : undefined,
      negative: (slot.negative || [])
        .map((item: string) => trimMax(item, 40))
        .filter((item: string) => item.length > 0)
        .slice(0, 10),
    }));

  return {
    fills,
    imagePlanPatch: {
      slots,
    },
  };
};
