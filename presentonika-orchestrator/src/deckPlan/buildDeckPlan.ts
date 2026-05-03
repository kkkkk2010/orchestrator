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

const requiredItemsForSlide = (slide: number): DeckPlanRequiredItem[] => {
  switch (slide) {
    case 2:
      return [
        { key: "s2_goals", kind: "bullets", count: 3, exact: true, description: "what students should understand" },
        { key: "s2_plan", kind: "route_items", count: 3, exact: true, description: "route through the argument" },
      ];
    case 5:
      return [{ key: "s5_bullets", kind: "bullets", count: 5, exact: true, description: "fact plus significance" }];
    case 6:
      return [
        { key: "s6_left_bullets", kind: "bullets", count: 3, exact: true },
        { key: "s6_right_bullets", kind: "bullets", count: 3, exact: true },
      ];
    case 8:
      return [{ key: "s8_examples", kind: "examples", count: 4, exact: true, description: "examples as evidence for the thesis" }];
    case 9:
      return [{ kind: "questions", count: 3, exact: true, description: "questions that test understanding, not memory only" }];
    case 10:
      return [{ key: "s10_summary", kind: "summary", count: 3, exact: true, description: "conclusions that answer the central question" }];
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

const mustAvoidForSlide = (slide: number, topicKind: TopicKind): string[] => {
  const common = [
    "do not repeat the thesis mechanically",
    "avoid unsupported absolute claims",
  ];
  if (slide === 2) return [...common, "weak verbs: познакомиться, узнать, рассмотреть, изучить"];
  if (slide === 3) return [...common, "generic hook such as почему это важно or гений или пророк"];
  if (slide === 4) return [...common, "dictionary-like definition slide"];
  if (slide === 8) return [...common, "simple list of examples without evidence value"];
  if (slide === 9) return [...common, "memory-only date/name questions"];
  if (slide === 10) return [...common, "overclaiming conclusion"];
  if (topicKind === "literary_figure") return [...common, "created the whole language / first ever claims"];
  return common;
};

const titleIntentForRole = (role: DeckPlanSlideRole): string => {
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
  const presentationType = presentationTypeForTopic(topicKind, request.presentationType || "auto");
  const slides: DeckPlanSlide[] = [];

  for (let index = 0; index < slideCount; index += 1) {
    const slideNumber = index + 1;
    const narrativeSlide = narrative.slides[index] || narrative.slides[narrative.slides.length - 1];
    const role = roleBySlide[slideNumber] || (slideNumber === slideCount ? "conclusion" : "evidence_mechanism");
    slides.push({
      slide: slideNumber,
      role,
      titleIntent: titleIntentForRole(role),
      claim: narrativeSlide?.focus || `Advance the central question on slide ${slideNumber}.`,
      mustInclude: narrativeSlide?.expectedKeywords?.slice(0, 5) || [],
      mustAvoid: mustAvoidForSlide(slideNumber, topicKind),
      requiredItems: requiredItemsForSlide(slideNumber),
      expectedEvidence: narrativeSlide?.expectedKeywords?.slice(0, 5) || [],
      relationToPrevious: narrativeSlide?.relationToPrevious,
      relationToNext: narrativeSlide?.relationToNext,
    });
  }

  return {
    version: 1,
    topic: request.topic,
    subject: request.subject,
    grade: request.grade,
    language: request.language || "ru",
    slideCount,
    presentationType,
    centralQuestion: narrative.centralQuestion,
    thesis: narrative.thesis,
    audience: [request.subject, request.grade].filter(Boolean).join(", ") || "school learners",
    slides,
    globalRules: [
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
