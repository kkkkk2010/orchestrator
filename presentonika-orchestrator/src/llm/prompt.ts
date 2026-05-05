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
  const slot = normalized.match(/^s\d+_(.+)$/)?.[1] || normalized;
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
  if (normalized === "s4_keywords") return "4-5 компактных термина по центральной линии; каждый термин <=3 слов, без длинных определений и мини-словарика";
  if (normalized === "s5_title") return "заголовок смысловых фактов, <=5 слов; избегай 'Ключевые факты'";
  if (normalized === "s5_bullets") return "ровно 5 пунктов, каждая строка с •; факт + значение, 12-22 слова; избегай абсолютов вроде первый/создал/основоположник, пиши осторожно: считается, во многом, сыграл роль";
  if (normalized === "s6_title") return "заголовок сравнения, <=5 слов";
  if (normalized.includes("left_title")) return "название левой колонки, <=4 слов";
  if (normalized.includes("right_title")) return "название правой колонки, <=4 слов";
  if (normalized.includes("left_bullets") || normalized.includes("right_bullets")) return "ровно 3 пункта колонки, каждая строка с •";
  if (normalized === "s7_title") return "заголовок этапов, <=5 слов";
  if (/s7_step\d+/.test(normalized)) return "1 этап: период + событие + значение, <=18 слов; не давай грубую датировку произведений, если точный диапазон сложнее";
  if (normalized === "s8_title") return "заголовок примеров, <=5 слов";
  if (normalized === "s8_examples") return "ровно 4 конкретных примера, каждая строка с •; произведение/пример + как он доказывает thesis, не просто список";
  if (normalized === "s9_title") return "заголовок проверки, <=5 слов";
  if (normalized === "s9_task") return "короткая инструкция к заданию";
  if (/s9_q\d+/.test(normalized)) return "1 проверочный вопрос по теме";
  if (normalized === "s10_title") return "заголовок итога, <=5 слов";
  if (normalized === "s10_summary") return "ровно 3 вывода, каждая строка с •; ответь на centralQuestion осторожно, без абсолютов создал/первый/навсегда";
  if (normalized === "s10_homework") return "1 домашнее задание, практическое";
  if (normalized === "s10_sources") return "1 строка источников";
  if (slot === "title") return "заголовок слайда, <=7 слов";
  if (slot === "subtitle") return "подзаголовок, <=12 слов";
  if (slot === "meta") return "1 смысловая рамка темы: что изучаем и почему это важно, 16-24 слова";
  if (slot === "goals") return "учебные цели, каждая строка с •; используй сильные глаголы: объяснить, сравнить, доказать, связать";
  if (slot === "plan") return "маршрут урока, каждая строка с •, без нумерации; план должен совпадать с DeckPlan";
  if (slot === "bullets") return "пункты, каждая строка с •; факт + значение, избегай абсолютов";
  if (slot === "examples") return "конкретные примеры, каждая строка с •; пример + как он доказывает тезис, не просто список";
  if (slot === "questions") return "вопросы на понимание, каждая строка с •; проверяй причинно-следственные связи, а не только память";
  if (/^q\d+$/.test(slot)) return "1 вопрос на понимание центральной линии, не только дата/имя";
  if (slot === "summary") return "выводы, каждая строка с •; ответь на centralQuestion осторожно, без абсолютов";
  if (slot === "homework") return "1 домашнее задание, практическое";
  if (slot === "sources") return "1 строка источников";
  if (/^step\d+$/.test(slot) || slot === "steps") return "этап: период/шаг + событие + значение; не давай грубую датировку, если не уверен";
  if (slot === "left_bullets" || slot === "right_bullets") return "пункты колонки, каждая строка с •";
  if (slot === "left_title" || slot === "right_title") return "название колонки, <=4 слов";
  if (slot === "definition") return "объясни роль, значение или контекст темы, не словарной статьей";
  if (slot === "keywords") return "4-5 компактных термина по центральной линии; без длинных определений";
  if (normalized.includes("title")) return "<=7 слов";
  if (normalized.includes("subtitle")) return "<=12 слов";
  if (normalized.includes("bullets")) return "до 5 пунктов, каждая строка с •";
  if (normalized.includes("sources")) return "1 строка источников";
  return "кратко, фактологично, без общих фраз";
};

const slideFromKey = (key: string): number | undefined => {
  const match = key.match(/^s(\d+)_/i);
  if (!match?.[1]) return undefined;
  const slide = Number.parseInt(match[1], 10);
  return Number.isFinite(slide) ? slide : undefined;
};

const slotFromKey = (key: string): string => key.match(/^s\d+_(.+)$/i)?.[1]?.toLowerCase() || key.toLowerCase();

const itemMatchesKey = (slide: number, slot: string, key: string, item: NonNullable<LLMGenerateInput["deckPlan"]>["slides"][number]["requiredItems"][number]): boolean => {
  if (item.key === key) return true;
  if (item.slot && `s${slide}_${item.slot.toLowerCase()}` === key.toLowerCase()) return true;
  if (item.slot?.toLowerCase() === slot) return true;
  if (item.kind === "examples" && slot === "examples") return true;
  if (item.kind === "questions" && (slot === "questions" || /^q\d+$/.test(slot))) return true;
  if (item.kind === "bullets" && slot.includes("bullets")) return true;
  if (item.kind === "summary" && slot === "summary") return true;
  if (item.kind === "steps" && (slot === "steps" || /^step\d+$/.test(slot))) return true;
  if (item.kind === "route_items" && slot === "plan") return true;
  if (item.kind === "terms" && slot === "keywords") return true;
  return false;
};

const deckPlanRuleForKey = (input: LLMGenerateInput, key: string): string => {
  const slideNo = slideFromKey(key);
  if (!slideNo || !input.deckPlan) return "";
  const slide = input.deckPlan.slides.find((item) => item.slide === slideNo);
  if (!slide) return "";
  const slot = slotFromKey(key);
  const item = slide.requiredItems.find((required) => itemMatchesKey(slideNo, slot, key, required));
  const countRule = item
    ? `${item.exact ? "ровно" : "примерно"} ${item.count} ${item.kind}`
    : "";
  const lineRule = item && item.kind === "terms"
    ? `Для ${key}: ${item.exact ? "ровно" : "примерно"} ${item.count} компактных термина; можно через запятую или отдельными строками, без длинных определений.`
    : item && ["bullets", "examples", "questions", "steps", "summary", "route_items"].includes(item.kind)
    ? `Для ${key}: ${item.exact ? "ровно" : "примерно"} ${item.count} строк; каждая строка начинается с "• "; не ставь несколько • в одной строке.`
    : "";
  const contract = [
    `DeckPlan slide ${slideNo}: slideType=${slide.slideType}; role=${slide.role}; claim=${slide.claim}`,
    countRule ? `Для ${key}: ${countRule}.` : "",
    lineRule,
    slide.mustInclude.length > 0 ? `Включи: ${slide.mustInclude.join(", ")}.` : "",
    slide.mustAvoid.length > 0 ? `Избегай: ${slide.mustAvoid.join(", ")}.` : "",
  ].filter(Boolean).join(" ");
  return contract;
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

  const deckPlan = input.deckPlan;
  const narrative = input.deckPlan ? undefined : input.narrativePlan;
  const currentSlides = new Set((input.layoutContext || [])
    .map((row) => row.slide)
    .concat(input.fillKeys.map((key) => Number.parseInt(key.match(/^s(\d+)_/i)?.[1] || "", 10)).filter(Number.isFinite)));
  const deckPlanSlides = deckPlan?.slides
    .map((slide) => {
      const required = slide.requiredItems.length > 0
        ? ` required=${slide.requiredItems.map((item) => `${item.key || item.slot || item.kind}:${item.exact ? "exactly " : ""}${item.count}`).join(",")}`
        : "";
      return `${slide.slide}. slideType=${slide.slideType}; role=${slide.role}; titleIntent=${slide.titleIntent}; claim=${slide.claim}; include=${slide.mustInclude.join(", ")}; avoid=${slide.mustAvoid.join(", ")}; evidence=${slide.expectedEvidence.join(", ")};${required}`;
    })
    .join("; ");
  const currentDeckPlanSlides = deckPlan?.slides
    .filter((slide) => currentSlides.size === 0 || currentSlides.has(slide.slide))
    .map((slide) => {
      const required = slide.requiredItems.length > 0
        ? `requiredItems=${slide.requiredItems.map((item) => `${item.key || item.slot || item.kind}:${item.exact ? "exactly " : ""}${item.count}`).join(", ")}`
        : "requiredItems=none";
      return [
        `current slide ${slide.slide}: slideType=${slide.slideType}; role=${slide.role}; claim=${slide.claim}; ${required}`,
        `mustInclude=${slide.mustInclude.join(", ") || "none"}`,
        `mustAvoid=${slide.mustAvoid.join(", ") || "none"}`,
        slide.relationToPrevious ? `previous=${slide.relationToPrevious}` : "",
        slide.relationToNext ? `next=${slide.relationToNext}` : "",
      ].filter(Boolean).join("; ");
    })
    .join("\n");
  const slidePlan = narrative?.slides
    .map((slide) => `${slide.slide}. ${slide.purpose}: ${slide.focus}`)
    .join("; ");
  const currentPlan = narrative?.slides
    .filter((slide) => currentSlides.size === 0 || currentSlides.has(slide.slide))
    .map((slide) => [
      `current slide ${slide.slide}: purpose=${slide.purpose}; function=${slide.functionLabel}; focus=${slide.focus}`,
      slide.relationToPrevious ? `previous=${slide.relationToPrevious}` : "",
      slide.relationToNext ? `next=${slide.relationToNext}` : "",
    ].filter(Boolean).join("; "))
    .join("\n");

  return [
    deckPlan
      ? "Deck architecture is dynamic: DeckPlan slide order and slideType are the only scenario source. Do not assume fixed slide numbers for examples, quiz, timeline, or summary."
      : "Use the provided narrative/layout context to keep the deck coherent.",
    deckPlan ? `DeckPlan source=${deckPlan.source}; presentationType=${deckPlan.presentationType}` : "",
    deckPlan ? `centralQuestion: ${deckPlan.centralQuestion}` : (narrative ? `centralQuestion: ${narrative.centralQuestion}` : ""),
    deckPlan ? `thesis: ${deckPlan.thesis}` : (narrative ? `thesis: ${narrative.thesis}` : ""),
    deckPlanSlides ? `DeckPlan slide contracts: ${deckPlanSlides}` : "",
    currentDeckPlanSlides ? `current batch DeckPlan contract:\n${currentDeckPlanSlides}` : "",
    deckPlan ? `DeckPlan globalRules: ${deckPlan.globalRules.join(" | ")}` : "",
    slidePlan ? `slide-by-slide narrativePlan: ${slidePlan}` : "",
    currentPlan ? `current batch narrative relation:\n${currentPlan}` : "",
    rows ? `Selected layouts: ${rows}` : "",
    "Use the selected slide role and text density when filling blocks. Bigger text blocks need explanation, not 2-3 dry fragments.",
    "For each factual bullet prefer: fact + meaning/consequence. If exact numbers are uncertain, do not invent precise quantities.",
    "Factual caution: avoid overclaims such as первый, создал современный язык, основоположник, перевернул язык, определил навсегда. Prefer: считается одной из ключевых фигур, во многом закрепил, помог соединить, сыграл центральную роль, подготовил почву.",
    "Exact counts are mandatory from DeckPlan for the actual dynamic keys in this batch.",
    "For bullet-like keys (goals, plan, bullets, examples, questions, steps, summary): every item must be on its own line, every item must start with \"• \", never put multiple bullet markers on one line.",
    "Keep keywords compact: 4-5 short terms only, tied to the narrative; no long glossary definitions.",
    "For chronology, use known ranges or avoid precise dating when unsure; do not compress complex work periods into misleading decades.",
    "Avoid generic headings: Определение и термины; Ключевые факты; Основные понятия; <topic>: определение.",
    "Treat the deck as one coherent lesson, not independent slides.",
    "Each slide must advance the central argument; do not restate the same central claim on every slide.",
    deckPlan
      ? "Route/goals slides define the route; hook slides open the problem; examples, quiz, timeline, and summary must appear only where DeckPlan puts them. Summary/conclusion slides must answer the centralQuestion."
      : "Slide 2 defines the route; later slides must follow it. Slide 3 opens the problem; slides 4-8 develop it. Slide 10 answers the centralQuestion.",
    "Examples must support the thesis, not just list works/facts. Quiz questions must test the argument and sequence, not isolated trivia.",
    narrative ? `antiRepetitionRules: ${narrative.antiRepetitionRules.join(" | ")}` : "",
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

  const keysWithRules = input.fillKeys.map((key) => {
    const deckRule = deckPlanRuleForKey(input, key);
    return `${key}: ${[keyRule(key), deckRule].filter(Boolean).join(" | ")}`;
  });

  return [
    buildRagContext(input),
    `topic: ${input.topic || "презентация"}`,
    `language: ${input.language || "ru"}`,
    deterministicDeckContext(input),
    input.deckPlan ? "" : slideContext(input.fillKeys),
    "Пиши содержательно и фактологично. Запрещены generic-фразы вроде: ключевой термин и его значение; короткий вывод; главная мысль по теме.",
    "Не смешивай несколько пунктов в одной строке. Не используй нумерацию внутри строк.",
    `keys: ${keysWithRules.join("; ")}`,
    "fills ДОЛЖЕН содержать ВСЕ перечисленные keys и ТОЛЬКО перечисленные keys.",
  ].filter((line) => line.trim().length > 0).join("\n");
};
