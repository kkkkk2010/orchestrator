import { buildNarrativePlan, type NarrativePlanContext } from "./narrativePlan";
import type { DeckPlan } from "../deckPlan";

export type ContentQaSeverity = "info" | "warn" | "error";
export type ContentQaLayer = "format" | "content" | "plan";

export type ContentQaIssue = {
  code: string;
  severity: ContentQaSeverity;
  layer?: ContentQaLayer;
  key?: string;
  slide?: number;
  message: string;
  sample?: string;
};

export type ContentQaReport = {
  score: number;
  issues: ContentQaIssue[];
  stats: {
    keysChecked: number;
    deckPlanPresent: boolean;
    missingCount: number;
    genericTitleCount: number;
    shortLargeBlockCount: number;
    bulletIssueCount: number;
    requiredCountMismatchCount: number;
    narrativeIssueCount: number;
    overclaimRiskCount: number;
    chronologyRiskCount: number;
    formatIssueCount: number;
    planIssueCount: number;
    repeatedLineCount: number;
    placeholderLeakCount: number;
  };
};

const slideFromKey = (key: string): number | undefined => {
  const match = key.match(/^s(\d+)_/i);
  return match ? Number.parseInt(match[1], 10) : undefined;
};

const compact = (value: string): string => value.replace(/\s+/g, " ").trim();

const linesOf = (value: string): string[] => value
  .split(/\r?\n/)
  .map((line) => compact(line.replace(/^[-*•]\s*/, "")))
  .filter(Boolean);

const words = (value: string): string[] => compact(value).split(/\s+/).filter(Boolean);

const normalize = (value: string): string => compact(value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " "));

const tokenize = (value: string): Set<string> => new Set(normalize(value)
  .split(/\s+/)
  .filter((word) => word.length > 3 && !stopWords.has(word)));

const overlapScore = (a: string, b: string): number => {
  const left = tokenize(a);
  const right = tokenize(b);
  if (left.size === 0 || right.size === 0) return 0;
  let hits = 0;
  for (const item of left) {
    if (right.has(item)) hits += 1;
  }
  return hits / Math.min(left.size, right.size);
};

const issueWeight = (severity: ContentQaSeverity): number => {
  if (severity === "error") return 18;
  if (severity === "warn") return 9;
  return 3;
};

const pushIssue = (issues: ContentQaIssue[], issue: ContentQaIssue): void => {
  const exists = issues.some((existing) => (
    existing.code === issue.code
    && existing.key === issue.key
    && existing.slide === issue.slide
    && existing.sample === issue.sample
  ));
  if (exists) return;
  issues.push(issue);
};

const stopWords = new Set([
  "это",
  "как",
  "что",
  "для",
  "или",
  "его",
  "её",
  "оно",
  "они",
  "тема",
  "темы",
  "слайд",
  "через",
  "один",
  "одна",
  "одного",
  "который",
  "которая",
  "почему",
]);

const genericTitlePatterns = [
  /определение\s+и\s+термины/i,
  /ключевые\s+факты/i,
  /основные\s+понятия/i,
  /:\s*определение\b/i,
  /что\s+такое\s+/i,
];

const genericHookPatterns = [
  /гений\s+или\s+пророк/i,
  /почему\s+.*важен/i,
  /солнце\s+русской\s+поэзии/i,
  /загадка\s+.*гения/i,
];

const weakLearningVerbs = [
  "познакомиться",
  "узнать",
  "рассмотреть",
  "изучить",
  "получить представление",
];

const exactLineCounts: Record<string, number> = {
  s2_goals: 3,
  s2_plan: 3,
  s5_bullets: 5,
  s6_left_bullets: 3,
  s6_right_bullets: 3,
  s8_examples: 4,
  s10_summary: 3,
};

const largeBlockMinimums: Record<string, { chars: number; bullets?: number; bulletWords?: number }> = {
  s2_goals: { chars: 110, bullets: 3, bulletWords: 7 },
  s2_plan: { chars: 90, bullets: 3, bulletWords: 6 },
  s5_bullets: { chars: 230, bullets: 5, bulletWords: 10 },
  s8_examples: { chars: 180, bullets: 4, bulletWords: 8 },
  s10_summary: { chars: 120, bullets: 3, bulletWords: 8 },
};

const significanceHints = [
  "важ",
  "знач",
  "поэтому",
  "потому",
  "это",
  "показывает",
  "объясняет",
  "позвол",
  "повли",
  "сформ",
  "привело",
  "из-за",
  "благодаря",
];

const overclaimPatterns = [
  /\bперв(ым|ая|ое|ые)\b/i,
  /создал(?:а|и)?\s+(?:русский\s+)?литературный\s+язык/i,
  /создал(?:а|и)?\s+современн(?:ый|ого)\s+русск(?:ий|ого)\s+литературн(?:ый|ого)\s+язык/i,
  /сформировал(?:а|и)?\s+современн(?:ый|ого)\s+русск(?:ий|ого)\s+литературн(?:ый|ого)\s+язык/i,
  /основал(?:а|и)?\s+.*\b(?:жанр|направление|литературу)\b/i,
  /основоположник/i,
  /перевернул(?:а|и)?\s+.*\b(?:язык|литературу)\b/i,
  /определил(?:а|и)?\s+навсегда/i,
  /единственн/i,
  /без\s+него\s+не\s+было\s+бы/i,
];

const cautionMarkers = [
  "считается",
  "одной из",
  "одним из",
  "во многом",
  "помог",
  "помогла",
  "сыграл",
  "сыграла",
  "подготовил",
  "подготовила",
  "стал важным",
  "стал поворотной",
];

const memoryOnlyQuizPatterns = [
  /в\s+каком\s+году/i,
  /когда\s+(?:родился|произошло|был[аио]?)/i,
  /где\s+(?:родился|произошло|находится)/i,
  /какое\s+произведение/i,
  /как\s+звали/i,
  /кто\s+(?:был|является)/i,
];

const understandingQuizPatterns = [
  /почему/i,
  /как\s+/i,
  /объясн/i,
  /сравн/i,
  /связ/i,
  /докаж/i,
  /сделай\s+вывод/i,
  /какое\s+значение/i,
];

const evidenceHints = [
  "показывает",
  "доказывает",
  "подтверждает",
  "раскрывает",
  "видно",
  "помогает понять",
  "пример",
  "через",
];

const hasRiskyOverclaim = (line: string): boolean => {
  const normalized = line.toLowerCase();
  if (cautionMarkers.some((marker) => normalized.includes(marker))) return false;
  return overclaimPatterns.some((pattern) => pattern.test(line));
};

const hasChronologyRisk = (line: string): boolean => {
  const normalized = line.toLowerCase();
  const onegin = /евгени[йя]\s+онегин/i.test(line);
  if (onegin && /1830-[еx]|1830-х|в\s+1830/i.test(normalized) && !/(1823|1831|1833|1823\s*[–-]\s*1831)/.test(normalized)) {
    return true;
  }
  return false;
};

const hasSignificance = (value: string): boolean => {
  const lc = value.toLowerCase();
  return significanceHints.some((hint) => lc.includes(hint));
};

const hasBareFactShape = (value: string): boolean => {
  const lc = value.toLowerCase();
  return /(\b\d{3,4}\b|январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)/i.test(lc)
    && words(value).length < 13
    && !hasSignificance(value);
};

const isCommaOnlyKeywords = (key: string, value: string): boolean => {
  if (!key.toLowerCase().includes("keywords")) return false;
  const parts = value.split(",").map((part) => compact(part)).filter(Boolean);
  if (parts.length < 4) return false;
  const withoutCommas = compact(value.replace(/,/g, " "));
  return !/[.!?;:]/.test(value) && words(withoutCommas).length <= parts.length + 2;
};

const isOverloadedKeywords = (key: string, value: string): boolean => {
  if (!key.toLowerCase().includes("keywords")) return false;
  const parts = value.split(/[;,]/).map((part) => compact(part)).filter(Boolean);
  if (parts.length > 5) return true;
  return parts.some((part) => words(part).length > 5) || value.length > 180;
};

const extractSpecificPromises = (value: string): string[] => {
  const promises = new Set<string>();
  const quoted = value.match(/[«"][^»"]{4,80}[»"]/g) || [];
  for (const item of quoted) {
    promises.add(item.replace(/[«»"]/g, "").toLowerCase());
  }

  const chapterMentions = value.match(/[а-яёa-z0-9\s-]{3,50}:\s*(глава|акт|часть|параграф)\s*\d+/gi) || [];
  for (const item of chapterMentions) {
    promises.add(item.toLowerCase());
  }

  return [...promises];
};

const slideTextMap = (fills: Record<string, string>): Map<number, string> => {
  const out = new Map<number, string>();
  for (const [key, value] of Object.entries(fills)) {
    const slide = slideFromKey(key);
    if (!slide || typeof value !== "string") continue;
    out.set(slide, `${out.get(slide) || ""}\n${value}`);
  }
  return out;
};

const importantQuestionWords = (plan: NarrativePlanContext): string[] => {
  return [...tokenize(`${plan.centralQuestion} ${plan.thesis}`)].slice(0, 10);
};

const includesAny = (value: string, needles: string[]): boolean => {
  const normalized = normalize(value);
  return needles.some((needle) => normalized.includes(normalize(needle)));
};

const bulletMarkerCount = (value: string): number => (value.match(/•/g) || []).length;

const hasOptions = (value: string): boolean => /(^|\n)\s*(?:[A-DА-Г][).]|[1-4][).])\s+\S/i.test(value);

const addFormatIssues = (params: {
  value: string;
  key: string;
  slide?: number;
  issues: ContentQaIssue[];
}): void => {
  const { value, key, slide, issues } = params;
  if (/•\s*•/.test(value)) {
    pushIssue(issues, {
      code: "double_bullet_marker",
      severity: "warn",
      layer: "format",
      key,
      slide,
      message: "Bullet line contains a duplicated bullet marker.",
      sample: value.slice(0, 120),
    });
  }

  const lines = value.split(/\r?\n/);
  if (lines.some((line) => bulletMarkerCount(line) > 1)) {
    pushIssue(issues, {
      code: "multiple_bullets_on_one_line",
      severity: "warn",
      layer: "format",
      key,
      slide,
      message: "Multiple bullet markers appear on one line.",
      sample: value.slice(0, 120),
    });
  }

  if (bulletMarkerCount(value) >= 3 && lines.filter((line) => line.includes("•")).length <= 1) {
    pushIssue(issues, {
      code: "bullet_block_missing_newlines",
      severity: "warn",
      layer: "format",
      key,
      slide,
      message: "Bullet block appears to miss newlines between items.",
      sample: value.slice(0, 120),
    });
  }

  if (/\{\{[^}]+\}\}/.test(value)) {
    pushIssue(issues, {
      code: "placeholder_token_left",
      severity: "error",
      layer: "format",
      key,
      slide,
      message: "Mustache placeholder token remains in generated content.",
      sample: value.slice(0, 120),
    });
  }

  if (/TEST_/i.test(value)) {
    pushIssue(issues, {
      code: "test_prefix_leaked",
      severity: "error",
      layer: "format",
      key,
      slide,
      message: "TEST_ fallback prefix leaked into generated content.",
      sample: value.slice(0, 120),
    });
  }

  if (/выберите\s+вариант/i.test(value) && !hasOptions(value)) {
    pushIssue(issues, {
      code: "instruction_mentions_options_but_no_options",
      severity: "warn",
      layer: "format",
      key,
      slide,
      message: "Instruction mentions answer options, but no options are listed.",
      sample: value.slice(0, 120),
    });
  }

  if (key.toLowerCase().includes("title")) {
    const wordCount = words(value).length;
    if (wordCount > 10) {
      pushIssue(issues, {
        code: "title_too_long",
        severity: "info",
        layer: "format",
        key,
        slide,
        message: "Title is too long for a slide title.",
        sample: value.slice(0, 120),
      });
    }
    if (wordCount > 7 && /[.!?]$/.test(value.trim())) {
      pushIssue(issues, {
        code: "title_sentence_like",
        severity: "info",
        layer: "format",
        key,
        slide,
        message: "Title looks like a full sentence.",
        sample: value.slice(0, 120),
      });
    }
  }
};

const countForRequiredItem = (params: {
  deckPlan: DeckPlan;
  fills: Record<string, string>;
  slide: number;
  key?: string;
  kind: string;
}): { count: number; sample: string } => {
  if (params.key && typeof params.fills[params.key] === "string") {
    const value = params.fills[params.key];
    return { count: linesOf(value).length, sample: value.slice(0, 160) };
  }

  if (params.kind === "questions") {
    const keys = Object.keys(params.fills).filter((key) => new RegExp(`^s${params.slide}_q\\d+$`, "i").test(key) && params.fills[key]?.trim());
    return { count: keys.length, sample: keys.join(", ") };
  }

  const slideText = Object.entries(params.fills)
    .filter(([key]) => slideFromKey(key) === params.slide)
    .map(([, value]) => value)
    .join("\n");
  return { count: linesOf(slideText).length, sample: slideText.slice(0, 160) };
};

const assessDeckPlanAdherence = (params: {
  deckPlan: DeckPlan;
  fills: Record<string, string>;
  issues: ContentQaIssue[];
}): void => {
  const { deckPlan, fills, issues } = params;
  const slides = slideTextMap(fills);

  for (const slide of deckPlan.slides) {
    for (const item of slide.requiredItems) {
      if (!item.exact) continue;
      const counted = countForRequiredItem({
        deckPlan,
        fills,
        slide: slide.slide,
        key: item.key,
        kind: item.kind,
      });
      if (counted.count !== item.count) {
        pushIssue(issues, {
          code: "required_count_mismatch",
          severity: "error",
          layer: "plan",
          key: item.key,
          slide: slide.slide,
          message: `DeckPlan requires exactly ${item.count} ${item.kind}, got ${counted.count}.`,
          sample: counted.sample,
        });
      }
    }
  }

  const hookText = slides.get(3) || "";
  if (hookText.trim() && !/[?？]/.test(hookText) && overlapScore(hookText, deckPlan.centralQuestion) < 0.08) {
    pushIssue(issues, {
      code: "deck_plan_hook_missing_problem",
      severity: "warn",
      layer: "plan",
      slide: 3,
      message: "DeckPlan expects slide 3 to open a problem/question, but the hook is weak.",
      sample: hookText.slice(0, 160),
    });
  }

  const goalsRoute = `${fills.s2_goals || ""}\n${fills.s2_plan || ""}`;
  const plannedRoute = deckPlan.slides.slice(3, 8).map((slide) => `${slide.claim} ${slide.mustInclude.join(" ")}`).join("\n");
  if (goalsRoute.trim() && overlapScore(goalsRoute, plannedRoute) < 0.08) {
    pushIssue(issues, {
      code: "deck_plan_route_mismatch",
      severity: "warn",
      layer: "plan",
      key: "s2_goals",
      slide: 2,
      message: "Slide 2 route has weak overlap with DeckPlan slide claims.",
      sample: goalsRoute.slice(0, 160),
    });
  }

  const conclusion = `${fills.s10_title || ""}\n${fills.s10_summary || ""}`;
  if (conclusion.trim() && overlapScore(conclusion, `${deckPlan.centralQuestion} ${deckPlan.thesis}`) < 0.08) {
    pushIssue(issues, {
      code: "deck_plan_conclusion_weak_answer",
      severity: "warn",
      layer: "plan",
      slide: 10,
      message: "Conclusion has weak relation to DeckPlan central question/thesis.",
      sample: conclusion.slice(0, 160),
    });
  }
};

const assessNarrative = (params: {
  fills: Record<string, string>;
  plan: NarrativePlanContext;
  issues: ContentQaIssue[];
}): void => {
  const { fills, plan, issues } = params;
  const slides = slideTextMap(fills);

  if (!plan.centralQuestion.trim()) {
    pushIssue(issues, {
      code: "no_central_question",
      severity: "error",
      message: "Narrative plan does not define a central question.",
    });
  }

  if (!plan.thesis.trim()) {
    pushIssue(issues, {
      code: "missing_thesis",
      severity: "error",
      message: "Narrative plan does not define a thesis.",
    });
  }

  const purposeOwners = new Map<string, number>();
  for (const slide of plan.slides) {
    const previous = purposeOwners.get(slide.purpose);
    if (previous && previous !== slide.slide) {
      pushIssue(issues, {
        code: "repeated_slide_purpose",
        severity: "warn",
        slide: slide.slide,
        message: `Slide purpose repeats slide ${previous}.`,
        sample: slide.purpose,
      });
    } else {
      purposeOwners.set(slide.purpose, slide.slide);
    }
  }

  for (const slide of plan.slides) {
    const text = slides.get(slide.slide) || "";
    if (!text.trim()) continue;
    const keywordHit = slide.expectedKeywords.some((keyword) => normalize(text).includes(normalize(keyword)));
    const focusOverlap = overlapScore(text, slide.focus);
    if (!keywordHit && focusOverlap < 0.12) {
      pushIssue(issues, {
        code: "slide_not_advancing_argument",
        severity: "info",
        slide: slide.slide,
        message: "Slide content has weak deterministic overlap with its narrative purpose.",
        sample: `${slide.purpose}: ${slide.focus}`,
      });
    }
  }

  const slideSignals = new Map<string, number[]>();
  const repeatedSignals = [
    "литературный язык",
    "точка сборки",
    "важен",
    "влияние на культуру",
    "центральная фигура",
    "создал язык",
    "создал современный язык",
    "создал современный русский литературный язык",
    "соединил живую речь",
    "живую речь и высокий стиль",
    "изменил литературу",
  ];
  for (const [slide, text] of slides.entries()) {
    for (const signal of repeatedSignals) {
      if (normalize(text).includes(normalize(signal))) {
        slideSignals.set(signal, [...(slideSignals.get(signal) || []), slide]);
      }
    }
  }
  for (const [signal, owners] of slideSignals.entries()) {
    if (owners.length >= 3) {
      pushIssue(issues, {
        code: "repeated_central_claim",
        severity: "warn",
        message: "The same central claim appears across too many slides instead of developing the argument.",
        sample: `${signal}: slides ${owners.join(", ")}`,
      });
    }
  }

  const goalsPlan = `${fills.s2_goals || ""}\n${fills.s2_plan || ""}`;
  const routeKeywords = plan.slides.slice(3, 8).flatMap((slide) => slide.expectedKeywords);
  if (goalsPlan.trim() && !includesAny(goalsPlan, routeKeywords)) {
    pushIssue(issues, {
      code: "goals_not_matching_narrative_plan",
      severity: "warn",
      key: "s2_goals",
      slide: 2,
      message: "Goals and plan do not reflect the narrative route for slides 4-8.",
      sample: goalsPlan.slice(0, 160),
    });
  }

  const hook = `${fills.s3_title || ""}\n${fills.s3_hook_question || ""}\n${fills.s3_hook_hint || ""}\n${fills.s3_hook_fact || ""}\n${fills.s3_hook_why || ""}`;
  const following = [4, 5, 6, 7, 8].map((slide) => slides.get(slide) || "").join("\n");
  const genericHook = genericHookPatterns.some((pattern) => pattern.test(hook));
  if (hook.trim() && following.trim() && (genericHook || (overlapScore(hook, following) < 0.08 && overlapScore(hook, plan.centralQuestion) < 0.12))) {
    pushIssue(issues, {
      code: "hook_not_connected_to_following_slides",
      severity: "warn",
      slide: 3,
      message: "Hook is weakly connected to the following narrative slides.",
      sample: hook.slice(0, 160),
    });
  }

  const examples = fills.s8_examples || "";
  const exampleLines = linesOf(examples);
  if (exampleLines.length > 0 && exampleLines.length < 4) {
    pushIssue(issues, {
      code: "examples_count_low",
      severity: "error",
      key: "s8_examples",
      slide: 8,
      message: `Examples slide should contain exactly 4 examples; got ${exampleLines.length}.`,
      sample: examples.slice(0, 160),
    });
  }
  if (exampleLines.length > 0 && exampleLines.filter((line) => includesAny(line, evidenceHints)).length < Math.ceil(exampleLines.length / 2)) {
    pushIssue(issues, {
      code: "examples_not_used_as_evidence",
      severity: "warn",
      key: "s8_examples",
      slide: 8,
      message: "Examples are listed without showing how they support the thesis.",
      sample: examples.slice(0, 160),
    });
    pushIssue(issues, {
      code: "examples_not_argumentative",
      severity: "warn",
      key: "s8_examples",
      slide: 8,
      message: "Examples should explicitly work as evidence for the thesis.",
      sample: examples.slice(0, 160),
    });
  }

  const quizText = [fills.s9_task, fills.s9_q1, fills.s9_q2, fills.s9_q3].filter(Boolean).join("\n");
  if (quizText.trim()) {
    const quizLines = linesOf(quizText);
    const understandingCount = quizLines.filter((line) => understandingQuizPatterns.some((pattern) => pattern.test(line))).length;
    if (understandingCount < 2 || overlapScore(quizText, `${plan.centralQuestion} ${plan.thesis}`) < 0.08) {
      pushIssue(issues, {
        code: "quiz_not_testing_narrative",
        severity: "warn",
        slide: 9,
        message: "Quiz does not sufficiently test the central argument and slide sequence.",
        sample: quizText.slice(0, 160),
      });
    }
  }

  const conclusion = `${fills.s10_title || ""}\n${fills.s10_summary || ""}`;
  const conclusionRiskLine = linesOf(conclusion).find(hasRiskyOverclaim) || (hasRiskyOverclaim(conclusion) ? conclusion : "");
  if (conclusionRiskLine) {
    pushIssue(issues, {
      code: "conclusion_overclaim",
      severity: "warn",
      slide: 10,
      message: "Conclusion answers too categorically; use cautious academic wording.",
      sample: conclusionRiskLine.slice(0, 160),
    });
  }
  const questionWords = importantQuestionWords(plan);
  const matchedQuestionWords = questionWords.filter((word) => normalize(conclusion).includes(word));
  if (conclusion.trim() && matchedQuestionWords.length < 2 && !includesAny(conclusion, ["ответ", "вывод", "значит", "потому", "следовательно"])) {
    pushIssue(issues, {
      code: "conclusion_not_answering_question",
      severity: "warn",
      slide: 10,
      message: "Conclusion does not clearly answer the central question.",
      sample: conclusion.slice(0, 160),
    });
  }

  const sequencePairs = [[3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10]];
  const weakPairs = sequencePairs.filter(([left, right]) => {
    const a = slides.get(left) || "";
    const b = slides.get(right) || "";
    return a.trim() && b.trim() && overlapScore(a, b) < 0.04;
  });
  if (weakPairs.length >= 3) {
    pushIssue(issues, {
      code: "disconnected_slide_sequence",
      severity: "info",
      message: "Several neighboring slides have weak lexical connection, which may indicate a broken lesson route.",
      sample: weakPairs.map(([left, right]) => `${left}-${right}`).join(", "),
    });
  }
};

export const runContentQa = (params: {
  fills: Record<string, string>;
  fillKeys: string[];
  topic: string;
  deckPlan?: DeckPlan;
  narrativePlan?: NarrativePlanContext;
}): ContentQaReport => {
  const issues: ContentQaIssue[] = [];
  const lineOwners = new Map<string, string>();
  const plan = params.narrativePlan || buildNarrativePlan({ topic: params.topic });
  let repeatedLineCount = 0;

  for (const key of params.fillKeys) {
    const value = typeof params.fills[key] === "string" ? params.fills[key].trim() : "";
    const normalizedKey = key.toLowerCase();
    const slide = slideFromKey(key);

    if (!value) {
      pushIssue(issues, {
        code: "missing_field",
        severity: "error",
        key,
        slide,
        message: "Required fill is empty or missing.",
      });
      continue;
    }

    if (/\{\{[^}]+\}\}|TEST_/i.test(value)) {
      pushIssue(issues, {
        code: "placeholder_leak",
        severity: "error",
        layer: "format",
        key,
        slide,
        message: "Generated fill still contains a placeholder token or TEST_ prefix.",
        sample: value.slice(0, 120),
      });
    }
    addFormatIssues({ value, key, slide, issues });

    if (normalizedKey.includes("title") && genericTitlePatterns.some((pattern) => pattern.test(value))) {
      pushIssue(issues, {
        code: "generic_title",
        severity: "warn",
        layer: "content",
        key,
        slide,
        message: "Title is too generic for a teacher deck.",
        sample: value,
      });
    }

    if (slide === 3 && genericHookPatterns.some((pattern) => pattern.test(value))) {
      pushIssue(issues, {
        code: "generic_hook",
        severity: "warn",
        layer: "content",
        key,
        slide,
        message: "Hook is formulaic and does not open a specific problem.",
        sample: value,
      });
    }

    const largeBlock = largeBlockMinimums[normalizedKey];
    if (largeBlock && compact(value).length < largeBlock.chars) {
      pushIssue(issues, {
        code: "large_block_too_short",
        severity: "warn",
        layer: "content",
        key,
        slide,
        message: `Large text block is too short; expected at least ${largeBlock.chars} chars.`,
        sample: value.slice(0, 120),
      });
    }

    const bulletLines = linesOf(value);
    const exactCount = exactLineCounts[normalizedKey];
    if (exactCount !== undefined && bulletLines.length !== exactCount) {
      pushIssue(issues, {
        code: "required_count_mismatch",
        severity: "error",
        layer: "format",
        key,
        slide,
        message: `Expected exactly ${exactCount} lines, got ${bulletLines.length}.`,
        sample: value.slice(0, 120),
      });
      pushIssue(issues, {
        code: "weak_exact_count_instruction",
        severity: "error",
        layer: "format",
        key,
        slide,
        message: `Prompt/budget says exactly ${exactCount}, but output has ${bulletLines.length}.`,
        sample: value.slice(0, 120),
      });
    }

    if (largeBlock?.bullets && bulletLines.length < largeBlock.bullets) {
      pushIssue(issues, {
        code: "too_few_bullets",
        severity: "warn",
        layer: "content",
        key,
        slide,
        message: `Expected at least ${largeBlock.bullets} bullet lines.`,
        sample: value.slice(0, 120),
      });
    }

    if (largeBlock?.bulletWords) {
      const shortBullets = bulletLines.filter((line) => words(line).length < (largeBlock.bulletWords ?? 0));
      if (shortBullets.length > 0) {
        pushIssue(issues, {
          code: "bullet_too_short",
          severity: "warn",
          layer: "content",
          key,
          slide,
          message: `${shortBullets.length} bullet lines are below the expected density.`,
          sample: shortBullets.slice(0, 2).join(" | "),
        });
      }
    }

    const bareFact = bulletLines.find(hasBareFactShape);
    if (bareFact) {
      pushIssue(issues, {
        code: "bare_fact_without_meaning",
        severity: "warn",
        layer: "content",
        key,
        slide,
        message: "Fact is stated without explaining why it matters.",
        sample: bareFact,
      });
    }

    const overclaim = [value, ...bulletLines].find(hasRiskyOverclaim);
    if (overclaim) {
      pushIssue(issues, {
        code: "overclaim_risk",
        severity: "warn",
        layer: "content",
        key,
        slide,
        message: "Text uses a risky absolute claim; prefer cautious wording unless sourced.",
        sample: overclaim.slice(0, 140),
      });
    }

    const chronologyRisk = [value, ...bulletLines].find(hasChronologyRisk);
    if (chronologyRisk) {
      pushIssue(issues, {
        code: "chronology_risk",
        severity: "warn",
        layer: "content",
        key,
        slide,
        message: "Chronology may be oversimplified or misleading; use a range or avoid precise dating.",
        sample: chronologyRisk.slice(0, 160),
      });
    }

    if (normalizedKey === "s2_goals") {
      const weakLine = bulletLines.find((line) => weakLearningVerbs.some((verb) => normalize(line).includes(normalize(verb))));
      if (weakLine) {
        pushIssue(issues, {
          code: "weak_learning_verbs",
          severity: "warn",
          layer: "content",
          key,
          slide,
          message: "Learning goal uses weak formal verbs instead of explanation/proof/comparison verbs.",
          sample: weakLine,
        });
      }
    }

    if (isCommaOnlyKeywords(key, value)) {
      pushIssue(issues, {
        code: "comma_only_keywords",
        severity: "warn",
        layer: "content",
        key,
        slide,
        message: "Keywords block is only a comma-separated word list and carries little teaching value.",
        sample: value,
      });
    }

    if (isOverloadedKeywords(key, value)) {
      pushIssue(issues, {
        code: "overloaded_keywords",
        severity: "warn",
        layer: "content",
        key,
        slide,
        message: "Keywords block is overloaded for a presentation slide.",
        sample: value.slice(0, 160),
      });
    }

    if (normalizedKey.includes("sources") && /официальные\s+документы|проверенные\s+обзоры|учебник,\s*энциклопедии/i.test(value)) {
      pushIssue(issues, {
        code: "generic_sources",
        severity: "warn",
        layer: "content",
        key,
        slide,
        message: "Sources look generic or mismatched to the topic.",
        sample: value,
      });
    }

    if (slide === 9 && /_q\d+$/i.test(normalizedKey)) {
      const memoryOnly = memoryOnlyQuizPatterns.some((pattern) => pattern.test(value));
      const understanding = understandingQuizPatterns.some((pattern) => pattern.test(value));
      if (memoryOnly && !understanding) {
        pushIssue(issues, {
          code: "memory_only_quiz",
          severity: "warn",
          layer: "content",
          key,
          slide,
          message: "Quiz question checks isolated memory instead of understanding.",
          sample: value,
        });
      }
    }

    for (const line of bulletLines) {
      const normalized = line.toLowerCase();
      if (normalized.length < 8) continue;
      const previousKey = lineOwners.get(normalized);
      if (previousKey && previousKey !== key) {
        repeatedLineCount += 1;
        pushIssue(issues, {
          code: "repeated_line",
          severity: "info",
          layer: "content",
          key,
          slide,
          message: `Line repeats content already used in ${previousKey}.`,
          sample: line,
        });
      } else {
        lineOwners.set(normalized, key);
      }
    }
  }

  const s2 = [params.fills.s2_goals, params.fills.s2_plan].filter((value): value is string => typeof value === "string").join("\n");
  const downstream = Object.entries(params.fills)
    .filter(([key]) => (slideFromKey(key) ?? 0) >= 3)
    .map(([, value]) => value)
    .join("\n")
    .toLowerCase();
  for (const promise of extractSpecificPromises(s2)) {
    if (!downstream.includes(promise)) {
      pushIssue(issues, {
        code: "unsupported_goal_promise",
        severity: "warn",
        layer: "content",
        key: "s2_goals",
        slide: 2,
        message: "Goals promise a specific analysis that is not supported by later slides.",
        sample: promise,
      });
    }
  }

  if (params.fills.s2_goals && params.fills.s2_plan && overlapScore(params.fills.s2_goals, params.fills.s2_plan) > 0.55) {
    pushIssue(issues, {
      code: "duplicated_goal_plan",
      severity: "warn",
      layer: "plan",
      key: "s2_plan",
      slide: 2,
      message: "Goals and plan duplicate each other instead of separating what to understand and how to get there.",
      sample: `${params.fills.s2_goals.slice(0, 80)} / ${params.fills.s2_plan.slice(0, 80)}`,
    });
  }

  const quizKeys = params.fillKeys.filter((key) => /^s9_q\d+$/i.test(key) && typeof params.fills[key] === "string" && params.fills[key].trim().length > 0);
  if (quizKeys.length > 0 && quizKeys.length !== 3) {
    pushIssue(issues, {
      code: "required_count_mismatch",
      severity: "error",
      layer: "format",
      slide: 9,
      message: `Expected exactly 3 quiz questions, got ${quizKeys.length}.`,
      sample: quizKeys.join(", "),
    });
    pushIssue(issues, {
      code: "weak_exact_count_instruction",
      severity: "error",
      layer: "format",
      slide: 9,
      message: `Prompt/budget says exactly 3 quiz questions, but output has ${quizKeys.length}.`,
      sample: quizKeys.join(", "),
    });
  }

  assessNarrative({ fills: params.fills, plan, issues });
  if (params.deckPlan) {
    assessDeckPlanAdherence({ deckPlan: params.deckPlan, fills: params.fills, issues });
  }

  const penalty = issues.reduce((sum, issue) => sum + issueWeight(issue.severity), 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const narrativeCodes = new Set([
    "no_central_question",
    "missing_thesis",
    "slide_not_advancing_argument",
    "repeated_slide_purpose",
    "repeated_central_claim",
    "duplicated_goal_plan",
    "conclusion_not_answering_question",
    "goals_not_matching_narrative_plan",
    "hook_not_connected_to_following_slides",
    "examples_not_used_as_evidence",
    "examples_not_argumentative",
    "quiz_not_testing_narrative",
    "disconnected_slide_sequence",
  ]);

  return {
    score,
    issues,
    stats: {
      keysChecked: params.fillKeys.length,
      deckPlanPresent: Boolean(params.deckPlan),
      missingCount: issues.filter((issue) => issue.code === "missing_field").length,
      genericTitleCount: issues.filter((issue) => issue.code === "generic_title" || issue.code === "generic_hook").length,
      shortLargeBlockCount: issues.filter((issue) => issue.code === "large_block_too_short").length,
      bulletIssueCount: issues.filter((issue) => issue.code === "too_few_bullets" || issue.code === "bullet_too_short").length,
      requiredCountMismatchCount: issues.filter((issue) => issue.code === "required_count_mismatch").length,
      narrativeIssueCount: issues.filter((issue) => narrativeCodes.has(issue.code)).length,
      overclaimRiskCount: issues.filter((issue) => issue.code === "overclaim_risk" || issue.code === "conclusion_overclaim").length,
      chronologyRiskCount: issues.filter((issue) => issue.code === "chronology_risk").length,
      formatIssueCount: issues.filter((issue) => issue.layer === "format").length,
      planIssueCount: issues.filter((issue) => issue.layer === "plan").length,
      repeatedLineCount,
      placeholderLeakCount: issues.filter((issue) => issue.code === "placeholder_leak").length,
    },
  };
};
