import type { LLMGenerateInput } from "./LLMClient";

export const buildSystemPrompt = (mode: LLMGenerateInput["mode"] = "fills"): string => {
  if (mode === "image_prompts") {
    return [
      "Ты редактор поисковых image-prompts для презентаций.",
      "Верни только JSON: { imagePlanPatch: { slots: [{slotId, query, hint, styleHint?, negative?}] } }.",
      "Без текста вне JSON.",
    ].join(" ");
  }

  const strict = mode === "targeted_fills"
    ? "Верни JSON строго со всеми ключами. НЕЛЬЗЯ пропускать ключи. Если не знаешь — пиши коротко нейтрально."
    : "Верни JSON: { fills: {key:value}, imagePlanPatch?: { slots: [...] } }.";

  return [
    "Ты методист. Генерируешь короткие тексты для слайдов.",
    strict,
    "Никакого текста вне JSON.",
  ].join(" ");
};

const buildRagContext = (input: LLMGenerateInput): string => {
  if (!input.rag) {
    return "";
  }

  const miniPrompt = input.rag.miniPrompt || "Сначала используй источники, если доступны.";
  if (input.rag.contextText) return `RAG:\n${miniPrompt}\n${input.rag.contextText}`;
  if (input.rag.answer) return `RAG:\n${miniPrompt}\n${input.rag.answer}`;
  return "";
};

const keyRule = (key: string): string => {
  if (key.includes("title")) return "<=7 слов";
  if (key.includes("subtitle")) return "<=12 слов";
  if (key.includes("bullets")) return "до 6 пунктов, каждая строка с •";
  if (key.includes("sources")) return "1 строка источников";
  return "кратко";
};

const buildImagePromptsUserPrompt = (input: LLMGenerateInput): string => {
  const slots = (input.imagePromptsInput || []).map((slot) => (
    `${slot.slotId}: slide=${slot.slide}, kind=${slot.kind}, aspect=${slot.aspect || "any"}, summary=${slot.slideSummary}`
  ));

  return [
    `topic: ${input.topic || "презентация"}`,
    `themeId: ${input.themeId}`,
    `language: ${input.language || "ru"}`,
    "Для каждого slotId верни конкретный query и 1-строчный hint.",
    "Query должен содержать 1-2 конкретные сущности/события/атрибуты со слайда.",
    "Все query должны быть уникальны (no duplicates).",
    "Ограничения: query<=90, hint<=140, без кавычек и без двоеточий.",
    "Избегай слов путь/фото как единственного уточнения; нужна конкретика (год/место/роль/событие).",
    "negative обязательно: [\"watermark\",\"nsfw\",\"lowres\",\"logo\",\"text\"]",
    `slots: ${slots.join("; ")}`,
  ].join("\n");
};

export const buildUserPrompt = (input: LLMGenerateInput): string => {
  const mode = input.mode || "fills";
  if (mode === "image_prompts") {
    return buildImagePromptsUserPrompt(input);
  }

  const keysWithRules = input.fillKeys.map((key) => `${key}: ${keyRule(key)}`);

  return [
    `topic: ${input.topic || "презентация"}`,
    `language: ${input.language || "ru"}`,
    `keys: ${keysWithRules.join("; ")}`,
    buildRagContext(input),
    input.strictKeysRequired ? "fills ДОЛЖЕН содержать ВСЕ перечисленные keys." : "fills должен содержать ТОЛЬКО перечисленные keys.",
  ].filter((line) => line.trim().length > 0).join("\n");
};
