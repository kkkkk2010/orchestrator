import type { LLMGenerateInput } from "./LLMClient";

export const buildSystemPrompt = (): string => {
  return [
    "Ты методист. Генерируешь короткие тексты для слайдов.",
    "Верни только JSON: { fills: {key:value}, imagePlanPatch?: { slots: [...] } }.",
    "Никакого текста вне JSON.",
  ].join(" ");
};

const buildRagContext = (input: LLMGenerateInput): string => {
  if (!input.rag) {
    return "";
  }

  const miniPrompt = input.rag.miniPrompt ||
    "Сначала используй источники. Если не хватает данных — дополни общими знаниями без выдуманных ссылок [n].";

  if (input.rag.contextText) {
    return `RAG:\n${miniPrompt}\n${input.rag.contextText}`;
  }

  if (input.rag.answer) {
    return `RAG:\n${miniPrompt}\n${input.rag.answer}`;
  }

  return `RAG:\n${miniPrompt}\n(источники пусты)`;
};

const keyRule = (key: string): string => {
  if (key.includes("title")) return "<=7 слов";
  if (key.includes("subtitle")) return "<=12 слов";
  if (key.includes("bullets")) return "до 5 пунктов, строки с '-'";
  if (key.includes("sources")) return "3-6 общих источников";
  return "кратко";
};

export const buildUserPrompt = (input: LLMGenerateInput): string => {
  const keysWithRules = input.fillKeys.map((key) => `${key}: ${keyRule(key)}`);

  return [
    `topic: ${input.topic || "презентация"}`,
    `language: ${input.language || "ru"}`,
    `keys: ${keysWithRules.join("; ")}`,
    buildRagContext(input),
    "Верни JSON объект. fills должен содержать ТОЛЬКО перечисленные keys.",
  ]
    .filter((line) => line.trim().length > 0)
    .join("\n");
};
