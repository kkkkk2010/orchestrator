import type { LLMGenerateInput } from "./LLMClient";

export const buildSystemPrompt = (): string => {
  return [
    "Ты генерируешь контент для слайдов и подсказки для подбора изображений.",
    "Верни СТРОГО JSON по требуемой схеме.",
    "Никакого текста вне JSON.",
  ].join(" ");
};

const summarizeKey = (key: string): string => {
  if (key.includes("goals")) return `${key}: цели урока`;
  if (key.includes("plan")) return `${key}: план урока`;
  if (key.includes("hook")) return `${key}: вовлекающий блок`;
  if (key.includes("bullets")) return `${key}: тезисы списком`;
  if (key.includes("summary")) return `${key}: краткое резюме`;
  if (key.includes("homework")) return `${key}: домашнее задание`;
  if (key.includes("sources")) return `${key}: источники`;
  return `${key}: текст слайда`;
};

const buildRagRuleHints = (input: LLMGenerateInput): string[] => {
  if (!input.rag) {
    return [];
  }

  return [
    "Используй факты только из источников, где возможно.",
    "Для спорных фактов добавляй ссылку вида [n].",
    "Для s10_sources собери ссылки только на основе citations/sources: source_uri + page + fragment_id.",
  ];
};

const buildRagContext = (input: LLMGenerateInput): string | undefined => {
  if (!input.rag) {
    return undefined;
  }

  if (input.rag.contextText) {
    return `ИСТОЧНИКИ (цитировать как [1], [2] ...):\n${input.rag.contextText}`;
  }

  if (input.rag.answer && input.rag.sources?.length) {
    const sourcesText = input.rag.sources
      .map((source) => {
        const page = typeof source.page === "number" ? ` (p.${source.page})` : "";
        return `[${source.n}] ${source.source_uri}${page} score=${source.score.toFixed(2)}: ${source.snippet}`;
      })
      .join("\n");

    return `RAG_ANSWER:\n${input.rag.answer}\n\nИСТОЧНИКИ (цитировать как [1], [2] ...):\n${sourcesText}`;
  }

  return undefined;
};

export const buildUserPrompt = (input: LLMGenerateInput): string => {
  const lang = input.language || "ru";
  const slots = input.imagePlan.slots.map((slot: LLMGenerateInput["imagePlan"]["slots"][number]) => ({
    slotId: slot.slotId,
    kind: slot.kind,
    aspect: slot.aspect ?? "any",
    query: slot.query,
    hint: slot.hint,
    styleHint: slot.styleHint,
    negative: slot.negative,
  }));

  return JSON.stringify(
    {
      task: "generate_presentation_content_and_image_hints",
      requirements: {
        language: lang,
        responseFormat: {
          fills: "Record<string,string>",
          imagePlanPatch: {
            slots: [{ slotId: "string", query: "string?", hint: "string?", styleHint: "string?", negative: ["string"] }],
          },
        },
        style: [
          "compact",
          "no fluff",
          "for bullets prefer lines with '-' or '•'",
          "for s10_sources provide 3-6 generic source references without fake precise URLs",
          ...buildRagRuleHints(input),
        ],
      },
      context: {
        topic: input.topic,
        themeId: input.themeId,
        presentationId: input.presentationId,
        fillKeys: input.fillKeys.map(summarizeKey),
        imageSlots: slots,
        groundingContext: buildRagContext(input),
      },
      outputRule: "Strict JSON only",
    },
    null,
    2
  );
};
