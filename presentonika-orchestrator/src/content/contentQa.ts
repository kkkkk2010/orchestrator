import { buildNarrativePlan, type NarrativePlanContext } from "./narrativePlan";

export type ContentQaSeverity = "info" | "warn" | "error";

export type ContentQaIssue = {
  code: string;
  severity: ContentQaSeverity;
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
    missingCount: number;
    genericTitleCount: number;
    shortLargeBlockCount: number;
    bulletIssueCount: number;
    requiredCountMismatchCount: number;
    narrativeIssueCount: number;
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
  /основал(?:а|и)?\s+.*\b(?:жанр|направление|литературу)\b/i,
  /определил(?:а|и)?\s+навсегда/i,
  /единственн/i,
  /без\s+него\s+не\s+было\s+бы/i,
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
    "важен",
    "влияние на культуру",
    "центральная фигура",
    "создал язык",
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
    if (owners.length >= 4) {
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
  if (exampleLines.length > 0 && exampleLines.filter((line) => includesAny(line, evidenceHints)).length < Math.ceil(exampleLines.length / 2)) {
    pushIssue(issues, {
      code: "examples_not_used_as_evidence",
      severity: "warn",
      key: "s8_examples",
      slide: 8,
      message: "Examples are listed without showing how they support the thesis.",
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
        key,
        slide,
        message: "Generated fill still contains a placeholder token or TEST_ prefix.",
        sample: value.slice(0, 120),
      });
    }

    if (normalizedKey.includes("title") && genericTitlePatterns.some((pattern) => pattern.test(value))) {
      pushIssue(issues, {
        code: "generic_title",
        severity: "warn",
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
        key,
        slide,
        message: `Expected exactly ${exactCount} lines, got ${bulletLines.length}.`,
        sample: value.slice(0, 120),
      });
    }

    if (largeBlock?.bullets && bulletLines.length < largeBlock.bullets) {
      pushIssue(issues, {
        code: "too_few_bullets",
        severity: "warn",
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
        key,
        slide,
        message: "Fact is stated without explaining why it matters.",
        sample: bareFact,
      });
    }

    const overclaim = [value, ...bulletLines].find((line) => overclaimPatterns.some((pattern) => pattern.test(line)));
    if (overclaim) {
      pushIssue(issues, {
        code: "overclaim_risk",
        severity: "warn",
        key,
        slide,
        message: "Text uses a risky absolute claim; prefer cautious wording unless sourced.",
        sample: overclaim.slice(0, 140),
      });
    }

    if (normalizedKey === "s2_goals") {
      const weakLine = bulletLines.find((line) => weakLearningVerbs.some((verb) => normalize(line).includes(normalize(verb))));
      if (weakLine) {
        pushIssue(issues, {
          code: "weak_learning_verbs",
          severity: "warn",
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
      slide: 9,
      message: `Expected exactly 3 quiz questions, got ${quizKeys.length}.`,
      sample: quizKeys.join(", "),
    });
  }

  assessNarrative({ fills: params.fills, plan, issues });

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
    "quiz_not_testing_narrative",
    "disconnected_slide_sequence",
  ]);

  return {
    score,
    issues,
    stats: {
      keysChecked: params.fillKeys.length,
      missingCount: issues.filter((issue) => issue.code === "missing_field").length,
      genericTitleCount: issues.filter((issue) => issue.code === "generic_title" || issue.code === "generic_hook").length,
      shortLargeBlockCount: issues.filter((issue) => issue.code === "large_block_too_short").length,
      bulletIssueCount: issues.filter((issue) => issue.code === "too_few_bullets" || issue.code === "bullet_too_short").length,
      requiredCountMismatchCount: issues.filter((issue) => issue.code === "required_count_mismatch").length,
      narrativeIssueCount: issues.filter((issue) => narrativeCodes.has(issue.code)).length,
      repeatedLineCount,
      placeholderLeakCount: issues.filter((issue) => issue.code === "placeholder_leak").length,
    },
  };
};
