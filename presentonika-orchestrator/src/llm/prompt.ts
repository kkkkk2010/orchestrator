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
  const normalized = key.toLowerCase();
  if (normalized === "s1_title") return "название темы, <=5 слов";
  if (normalized === "s1_subtitle") return "сильный подзаголовок, <=7 слов, не повторяй title";
  if (normalized === "s1_meta") return "1 смысловая рамка темы: что изучаем и почему это важно, 16-24 слова";
  if (normalized === "s2_title") return "заголовок целей, <=5 слов";
  if (normalized === "s2_goals") return "ровно 3 учебные цели, каждая строка с •; не обещай разбор конкретных произведений/глав, если deck дальше их не раскрывает";
  if (normalized === "s2_plan") return "ровно 3 пункта плана урока, каждая строка с •, без нумерации; план должен совпадать со структурой 10 слайдов";
  if (normalized === "s3_title") return "цепляющий заголовок, <=7 слов";
  if (normalized === "s3_hook_question") return "1 интригующий вопрос";
  if (normalized === "s3_hook_hint") return "1 короткая подсказка/ответ";
  if (normalized === "s3_hook_fact") return "1 точный факт с датой/масштабом";
  if (normalized === "s3_hook_why") return "1 фраза почему это важно";
  if (normalized === "s4_title") return "смысловой заголовок роли/контекста, <=5 слов; избегай 'Определение и термины'";
  if (normalized === "s4_definition") return "объясни роль, значение или контекст темы, 24-38 слов; для человека не пиши как словарную статью";
  if (normalized === "s4_keywords") return "5-7 терминов с короткими пояснениями, через точки с запятой; не просто список слов через запятую";
  if (normalized === "s5_title") return "заголовок смысловых фактов, <=5 слов; избегай 'Ключевые факты'";
  if (normalized === "s5_bullets") return "ровно 5 пунктов, каждая строка с •; в каждом пункте факт + почему он важен, 12-22 слова";
  if (normalized === "s6_title") return "заголовок сравнения, <=5 слов";
  if (normalized.includes("left_title")) return "название левой колонки, <=4 слов";
  if (normalized.includes("right_title")) return "название правой колонки, <=4 слов";
  if (normalized.includes("left_bullets") || normalized.includes("right_bullets")) return "ровно 3 пункта колонки, каждая строка с •";
  if (normalized === "s7_title") return "заголовок этапов, <=5 слов";
  if (/s7_step\d+/.test(normalized)) return "1 этап: дата/период + событие + значение, <=18 слов";
  if (normalized === "s8_title") return "заголовок примеров, <=5 слов";
  if (normalized === "s8_examples") return "ровно 4 конкретных примера, каждая строка с •; пример + что он показывает";
  if (normalized === "s9_title") return "заголовок проверки, <=5 слов";
  if (normalized === "s9_task") return "короткая инструкция к заданию";
  if (/s9_q\d+/.test(normalized)) return "1 проверочный вопрос по теме";
  if (normalized === "s10_title") return "заголовок итога, <=5 слов";
  if (normalized === "s10_summary") return "3 вывода, каждая строка с •; каждый вывод объясняет значение, не повторяет факты";
  if (normalized === "s10_homework") return "1 домашнее задание, практическое";
  if (normalized === "s10_sources") return "1 строка источников";
  if (normalized.includes("title")) return "<=7 слов";
  if (normalized.includes("subtitle")) return "<=12 слов";
  if (normalized.includes("bullets")) return "до 5 пунктов, каждая строка с •";
  if (normalized.includes("sources")) return "1 строка источников";
  return "кратко, фактологично, без общих фраз";
};

const slideContext = (keys: string[]): string => {
  const slide = keys
    .map((key) => key.match(/^s(\d+)_/i)?.[1])
    .find(Boolean);

  switch (slide) {
    case "1": return "slide 1 = обложка: тема, подзаголовок, одна вводная фраза.";
    case "2": return "slide 2 = цели и план: обещай только то, что реально раскрывается на следующих слайдах.";
    case "3": return "slide 3 = hook: заинтересуй вопросом, фактом и значимостью.";
    case "4": return "slide 4 = контекст/значение: объясни роль темы, а не словарное определение.";
    case "5": return "slide 5 = смысловые факты: каждый факт должен объяснять значение или последствие.";
    case "6": return "slide 6 = сравнение двух сторон/периодов/явлений.";
    case "7": return "slide 7 = последовательность этапов.";
    case "8": return "slide 8 = примеры.";
    case "9": return "slide 9 = проверка знаний.";
    case "10": return "slide 10 = итог, домашнее задание, источники.";
    default: return "";
  }
};

const deterministicDeckContext = (input: LLMGenerateInput): string => {
  const rows = (input.layoutContext || [])
    .map((row) => `slide ${row.slide}: type=${row.slideType}, layoutId=${row.layoutId}, role=${row.role}, density=${row.textDensity}`)
    .join("; ");

  return [
    "Deck architecture: 10-slide teacher deck = cover, goals/plan, hook, context, facts, comparison, timeline/steps, examples, quiz, summary.",
    rows ? `Selected layouts: ${rows}` : "",
    "Use the selected slide role and text density when filling blocks. Bigger text blocks need explanation, not 2-3 dry fragments.",
    "For each factual bullet prefer: fact + meaning/consequence. If exact numbers are uncertain, do not invent precise quantities.",
    "Avoid generic headings: Определение и термины; Ключевые факты; Основные понятия; <topic>: определение.",
  ].filter(Boolean).join("\n");
};

const buildImagePromptsUserPrompt = (input: LLMGenerateInput): string => {
  const slots = (input.imagePromptsInput || []).map((slot) => (
    `${slot.slotId}: slide=${slot.slide}, type=${slot.slideType}, kind=${slot.kind}, aspect=${slot.aspect || "any"}, title=${slot.title}, keywords=${slot.keywords.join(",")}, entities=${slot.entities.join(",")}, summary=${slot.slideSummary}`
  ));

  return [
    `topic: ${input.topic || "презентация"}`,
    `themeId: ${input.themeId}`,
    `language: ${input.language || "ru"}`,
    "Верни mapping slotId -> {query,hint} в imagePlanPatch.slots.",
    "query MUST include >=1 entity или keyword и быть уникальным среди слотов после нормализации.",
    "query<=90, hint<=140, без кавычек, без двоеточий.",
    "Запрещены повторы слов и повтор topic topic.",
    "Фраза официальное фото без уточнения запрещена: нужен entity/year/place/event.",
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
    buildRagContext(input),
    `topic: ${input.topic || "презентация"}`,
    `language: ${input.language || "ru"}`,
    deterministicDeckContext(input),
    slideContext(input.fillKeys),
    "Пиши содержательно и фактологично. Запрещены generic-фразы вроде: ключевой термин и его значение; короткий вывод; главная мысль по теме.",
    "Не смешивай несколько пунктов в одной строке. Не используй нумерацию внутри строк.",
    `keys: ${keysWithRules.join("; ")}`,
    "fills ДОЛЖЕН содержать ВСЕ перечисленные keys и ТОЛЬКО перечисленные keys.",
  ].filter((line) => line.trim().length > 0).join("\n");
};
