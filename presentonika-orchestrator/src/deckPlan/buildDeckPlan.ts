import { buildNarrativePlan, detectTopicKind, type TopicKind } from "../content/narrativePlan";
import type { CreatePlanRequest, DeckPlan, DeckPlanPresentationType, DeckPlanRequiredItem, DeckPlanSlide, DeckPlanSlideRole } from "./schema";

const roleBySlide: Record<number, DeckPlanSlideRole> = {
  1: "frame",
  2: "route",
  3: "problem_hook",
  4: "context",
  5: "evidence_mechanism",
  6: "comparison",
  7: "development_over_time",
  8: "examples_as_evidence",
  9: "check_understanding",
  10: "conclusion",
};

const requiredItemsForSlide = (slide: number, language: string): DeckPlanRequiredItem[] => {
  const ru = language.toLowerCase().startsWith("ru");
  switch (slide) {
    case 2:
      return [
        { key: "s2_goals", kind: "bullets", count: 3, exact: true, description: ru ? "что ученики должны понять" : "what students should understand" },
        { key: "s2_plan", kind: "route_items", count: 3, exact: true, description: ru ? "маршрут доказательства" : "route through the argument" },
      ];
    case 5:
      return [{ key: "s5_bullets", kind: "bullets", count: 5, exact: true, description: ru ? "факт плюс значение" : "fact plus significance" }];
    case 6:
      return [
        { key: "s6_left_bullets", kind: "bullets", count: 3, exact: true },
        { key: "s6_right_bullets", kind: "bullets", count: 3, exact: true },
      ];
    case 8:
      return [{ key: "s8_examples", kind: "examples", count: 4, exact: true, description: ru ? "примеры как доказательство тезиса" : "examples as evidence for the thesis" }];
    case 9:
      return [{ kind: "questions", count: 3, exact: true, description: ru ? "вопросы на понимание, а не только на память" : "questions that test understanding, not memory only" }];
    case 10:
      return [{ key: "s10_summary", kind: "summary", count: 3, exact: true, description: ru ? "выводы, отвечающие на главный вопрос" : "conclusions that answer the central question" }];
    default:
      return [];
  }
};

const presentationTypeForTopic = (topicKind: TopicKind, requested: DeckPlanPresentationType): DeckPlanPresentationType => {
  if (requested !== "auto") return requested;
  if (topicKind === "literary_figure") return "literary_analysis";
  if (topicKind === "person") return "biography_contribution";
  if (topicKind === "historical") return "causes_consequences";
  if (topicKind === "science") return "process";
  return "lesson";
};

const mustAvoidForSlide = (slide: number, topicKind: TopicKind, language: string): string[] => {
  const ru = language.toLowerCase().startsWith("ru");
  const common = ru
    ? [
      "не повторять тезис механически",
      "избегать неподтвержденных абсолютных утверждений",
    ]
    : [
      "do not repeat the thesis mechanically",
      "avoid unsupported absolute claims",
    ];
  if (ru) {
    if (slide === 2) return [...common, "слабые глаголы: познакомиться, узнать, рассмотреть, изучить"];
    if (slide === 3) return [...common, "шаблонный hook вроде почему это важно или гений или пророк"];
    if (slide === 4) return [...common, "словарное определение вместо контекста"];
    if (slide === 8) return [...common, "простой список примеров без доказательной роли"];
    if (slide === 9) return [...common, "вопросы только на даты и имена"];
    if (slide === 10) return [...common, "чрезмерно категоричный вывод"];
    if (topicKind === "literary_figure") return [...common, "утверждения вроде создал весь язык или был первым в истории"];
    return common;
  }
  if (slide === 2) return [...common, "weak verbs: познакомиться, узнать, рассмотреть, изучить"];
  if (slide === 3) return [...common, "generic hook such as почему это важно or гений или пророк"];
  if (slide === 4) return [...common, "dictionary-like definition slide"];
  if (slide === 8) return [...common, "simple list of examples without evidence value"];
  if (slide === 9) return [...common, "memory-only date/name questions"];
  if (slide === 10) return [...common, "overclaiming conclusion"];
  if (topicKind === "literary_figure") return [...common, "created the whole language / first ever claims"];
  return common;
};

const relationForSlide = (slide: number, slideCount: number, language: string, direction: "previous" | "next"): string | undefined => {
  if (direction === "previous" && slide <= 1) return undefined;
  if (direction === "next" && slide >= slideCount) return undefined;
  if (language.toLowerCase().startsWith("ru")) {
    return direction === "previous"
      ? "Продолжает предыдущий шаг сценария и добавляет новый аргумент."
      : "Подводит к следующему шагу сценария без повтора тезиса.";
  }
  return direction === "previous"
    ? "Continues the previous scenario step and adds a new argument."
    : "Sets up the next scenario step without repeating the thesis.";
};

const titleIntentForRole = (role: DeckPlanSlideRole, language: string): string => {
  if (language.toLowerCase().startsWith("ru")) {
    switch (role) {
      case "frame": return "Поставить главный вопрос и рамку урока.";
      case "route": return "Показать, что поймём и каким маршрутом докажем.";
      case "problem_hook": return "Открыть конкретную проблему или парадокс.";
      case "context": return "Объяснить контекст, нужный для аргумента.";
      case "evidence_mechanism": return "Показать главный механизм или доказательство.";
      case "comparison": return "Сравнить этапы, стороны или модели для прояснения тезиса.";
      case "development_over_time": return "Показать развитие как осмысленную последовательность.";
      case "examples_as_evidence": return "Использовать примеры как доказательство тезиса.";
      case "check_understanding": return "Проверить понимание центрального аргумента.";
      case "conclusion": return "Ответить на главный вопрос без чрезмерных обобщений.";
    }
  }

  switch (role) {
    case "frame": return "Set the central question and lesson frame.";
    case "route": return "Show what we will understand and how we will prove it.";
    case "problem_hook": return "Open a concrete problem or paradox.";
    case "context": return "Explain the context needed for the argument.";
    case "evidence_mechanism": return "Show the main mechanism or evidence.";
    case "comparison": return "Compare stages, sides, or models to clarify the thesis.";
    case "development_over_time": return "Trace development as a meaningful sequence.";
    case "examples_as_evidence": return "Use examples as evidence for the thesis.";
    case "check_understanding": return "Check understanding of the central argument.";
    case "conclusion": return "Answer the central question without overclaiming.";
  }
};

export const buildDeterministicDeckPlan = (request: CreatePlanRequest, source: "deterministic" | "user_edited" = "deterministic"): DeckPlan => {
  const topicKind = detectTopicKind(request.topic);
  const narrative = buildNarrativePlan({ topic: request.topic });
  const slideCount = request.slideCount || 10;
  const language = request.language || "ru";
  const ru = language.toLowerCase().startsWith("ru");
  const presentationType = presentationTypeForTopic(topicKind, request.presentationType || "auto");
  const slides: DeckPlanSlide[] = [];

  for (let index = 0; index < slideCount; index += 1) {
    const slideNumber = index + 1;
    const narrativeSlide = narrative.slides[index] || narrative.slides[narrative.slides.length - 1];
    const role = roleBySlide[slideNumber] || (slideNumber === slideCount ? "conclusion" : "evidence_mechanism");
    slides.push({
      slide: slideNumber,
      role,
      titleIntent: titleIntentForRole(role, language),
      claim: narrativeSlide?.focus || `Advance the central question on slide ${slideNumber}.`,
      mustInclude: narrativeSlide?.expectedKeywords?.slice(0, 5) || [],
      mustAvoid: mustAvoidForSlide(slideNumber, topicKind, language),
      requiredItems: requiredItemsForSlide(slideNumber, language),
      expectedEvidence: narrativeSlide?.expectedKeywords?.slice(0, 5) || [],
      visualSuggestions: [],
      relationToPrevious: relationForSlide(slideNumber, slideCount, language, "previous") || narrativeSlide?.relationToPrevious,
      relationToNext: relationForSlide(slideNumber, slideCount, language, "next") || narrativeSlide?.relationToNext,
    });
  }

  return {
    version: 1,
    topic: request.topic,
    subject: request.subject,
    grade: request.grade,
    language,
    slideCount,
    presentationType,
    centralQuestion: narrative.centralQuestion,
    thesis: narrative.thesis,
    audience: ru
      ? [
        request.subject ? `предмет: ${request.subject}` : "",
        request.grade ? `класс: ${request.grade}` : "",
      ].filter(Boolean).join(", ") || "школьники"
      : [request.subject, request.grade].filter(Boolean).join(", ") || "school learners",
    slides,
    globalRules: ru
      ? [
        "Рассматривать презентацию как единый урок, а не набор отдельных слайдов.",
        "Каждый слайд должен продвигать главный вопрос.",
        "Не повторять тезис на каждом слайде.",
        "Использовать осторожные академические формулировки для фактов.",
        "Примеры должны работать как доказательство, а не как простой список.",
      ]
      : [
        "Treat the deck as one coherent lesson, not independent slides.",
        "Each slide must advance the central question.",
        "Do not repeat the thesis on every slide.",
        "Use cautious academic wording for factual claims.",
        "Examples must work as evidence, not as a plain list.",
      ],
    source,
    createdAt: new Date().toISOString(),
  };
};
