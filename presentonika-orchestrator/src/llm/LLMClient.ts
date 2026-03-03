import type { ImagePlanV1 } from "../images/imagePlan";

export type LLMGenerateInput = {
  presentationId: number | string;
  themeId: string;
  topic: string;
  language: string | null;
  fillKeys: string[];
  imagePlan: ImagePlanV1;
  chosenVariantsPreview?: Record<string, string>;
};

export type LLMGenerateOutput = {
  fills: Record<string, string>;
  imagePlanPatch?: {
    slots: Array<{
      slotId: string;
      query?: string;
      hint?: string;
      styleHint?: string;
      negative?: string[];
    }>;
  };
  meta?: {
    model: string;
    tokens?: number;
    latencyMs?: number;
    attempts?: number;
    error?: string;
  };
};

export interface LLMClient {
  generate(input: LLMGenerateInput): Promise<LLMGenerateOutput>;
}
