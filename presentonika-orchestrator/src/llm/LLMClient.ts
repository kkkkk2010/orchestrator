import type { ImagePlanV1 } from "../images/imagePlan";
import type { Citation } from "../rag/formatContext";

export type LLMGenerateInput = {
  presentationId: number | string;
  themeId: string;
  topic: string;
  language: string | null;
  fillKeys: string[];
  imagePlan: ImagePlanV1;
  chosenVariantsPreview?: Record<string, string>;
  mode?: "fills" | "targeted_fills" | "image_prompts";
  strictKeysRequired?: boolean;
  layoutContext?: Array<{
    slide: number;
    slideType: string;
    layoutId: string;
    role: string;
    textDensity: "low" | "medium" | "high";
  }>;
  imagePromptsInput?: Array<{
    slotId: string;
    slide: number;
    kind: "hero" | "photo" | "icon" | "other";
    aspect?: "portrait" | "landscape" | "square" | "any";
    slideType: string;
    title: string;
    keywords: string[];
    entities: string[];
    slideSummary: string;
  }>;
  rag?: {
    mode: "retrieve" | "query";
    contextText?: string;
    citations?: Citation[];
    answer?: string;
    sources?: Citation[];
    miniPrompt?: string;
  };
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
    parseOk?: boolean;
    parseError?: string;
    rawResponseText?: string;
  };
};

export interface LLMClient {
  generate(input: LLMGenerateInput): Promise<LLMGenerateOutput>;
}
