import { isCountableSlotForSlideType, nonCountedDeckPlanSlots, normalizeDeckPlanSlot, type DeckPlan, type DeckPlanRequiredItem, type DeckPlanSlide } from "../deckPlan";

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
  expected?: unknown;
  actual?: unknown;
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
    routeIssueCount: number;
    deckPlanRouteIssueCount: number;
    deckPlanIssueCount: number;
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

const slotFromKey = (key: string): string => key.match(/^s\d+_(.+)$/i)?.[1]?.toLowerCase() || key.toLowerCase();

const dynamicFillKey = (slide: number, slot: string): string => `s${slide}_${slot.toLowerCase().replace(/[^a-z0-9_]+/gi, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "")}`;

const compact = (value: string): string => value.replace(/\s+/g, " ").trim();

const linesOf = (value: string): string[] => value
  .split(/\r?\n/)
  .map((line) => compact(line.replace(/^[-*•]\s*/, "")))
  .filter(Boolean);

const termsOf = (value: string): string[] => value
  .split(/\r?\n|[;,]/)
  .flatMap((part) => part.split(/(?:^|\s)[-•]\s+/))
  .map((part) => compact(part.replace(/^[-*•]\s*/, "")))
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

const issueWeight = (issue: ContentQaIssue): number => {
  if (issue.severity === "error") {
    if (issue.code === "required_count_mismatch" || issue.code === "weak_exact_count_instruction") return 7;
    if (issue.code === "missing_field" || issue.code === "placeholder_leak" || issue.code === "placeholder_token_left" || issue.code === "test_prefix_leaked") return 14;
    return 8;
  }
  if (issue.severity === "warn") return 3;
  return 1;
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

const largeBlockMinimumsBySlot: Record<string, { chars: number; bullets?: number; bulletWords?: number }> = {
  goals: { chars: 90, bullets: 3, bulletWords: 6 },
  plan: { chars: 80, bullets: 3, bulletWords: 5 },
  bullets: { chars: 130, bullets: 3, bulletWords: 8 },
  left_bullets: { chars: 70, bullets: 2, bulletWords: 5 },
  right_bullets: { chars: 70, bullets: 2, bulletWords: 5 },
  examples: { chars: 120, bullets: 3, bulletWords: 7 },
  questions: { chars: 70, bullets: 2, bulletWords: 5 },
  steps: { chars: 90, bullets: 3, bulletWords: 6 },
  summary: { chars: 90, bullets: 3, bulletWords: 7 },
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

const importantQuestionWords = (value: string): string[] => [...tokenize(value)].slice(0, 10);

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

const keyLooksDynamic = (key?: string): boolean => typeof key === "string" && /^s\d+_[a-z0-9_]+$/i.test(key);

const slotForRequiredItem = (item: DeckPlanRequiredItem, slide?: DeckPlanSlide): string | undefined => {
  const slot = normalizeDeckPlanSlot(item.slot);
  if (slot && nonCountedDeckPlanSlots.has(slot)) return undefined;
  if (slot && slide && isCountableSlotForSlideType(slide.slideType, slot)) return slot;

  const keySlot = keyLooksDynamic(item.key) ? slotFromKey(item.key || "") : undefined;
  if (keySlot && nonCountedDeckPlanSlots.has(keySlot)) return undefined;
  if (keySlot && slide && isCountableSlotForSlideType(slide.slideType, keySlot)) return keySlot;

  if (item.kind === "examples") return "examples";
  if (item.kind === "questions") return "questions";
  if (item.kind === "steps") return "steps";
  if (item.kind === "summary") return "summary";
  if (item.kind === "route_items") return "plan";
  if (item.kind === "bullets") return slot ? undefined : "bullets";
  return undefined;
};

const countLinesOrKeys = (params: {
  fills: Record<string, string>;
  slide: number;
  slot: string;
  item: DeckPlanRequiredItem;
}): { matched: boolean; count: number; sample: string; key?: string } => {
  const { fills, slide, slot, item } = params;
  const directKey = dynamicFillKey(slide, slot);
  const itemKey = keyLooksDynamic(item.key) ? item.key : undefined;
  const candidateKeys = [...new Set([directKey, itemKey].filter((key): key is string => Boolean(key)))];

  for (const key of candidateKeys) {
    const value = fills[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return { matched: true, count: item.kind === "terms" ? termsOf(value).length : linesOf(value).length, sample: value.slice(0, 160), key };
    }
  }

  if (slot === "questions") {
    const keys = Object.keys(fills)
      .filter((key) => new RegExp(`^s${slide}_q\\d+$`, "i").test(key) && fills[key]?.trim())
      .sort();
    if (keys.length > 0) return { matched: true, count: keys.length, sample: keys.join(", "), key: keys[0] };
  }

  if (slot === "steps") {
    const keys = Object.keys(fills)
      .filter((key) => new RegExp(`^s${slide}_step\\d+$`, "i").test(key) && fills[key]?.trim())
      .sort();
    if (keys.length > 0) return { matched: true, count: keys.length, sample: keys.join(", "), key: keys[0] };
  }

  return { matched: false, count: 0, sample: candidateKeys.join(", ") || `${slide}:${slot}`, key: directKey };
};

const slideText = (fills: Record<string, string>, slide: number): string => Object.entries(fills)
  .filter(([key]) => slideFromKey(key) === slide)
  .map(([, value]) => value)
  .join("\n");

const slideFillKeys = (fills: Record<string, string>, slide: number): string[] => Object.keys(fills)
  .filter((key) => slideFromKey(key) === slide)
  .sort();

const isConclusionSlide = (slide: DeckPlanSlide): boolean => (
  slide.slideType === "summary"
  || /conclusion|summary|итог|вывод|заключ/i.test(slide.role)
);

const isHomeworkSourcesSlide = (slide: DeckPlanSlide): boolean => (
  /homework_sources|homework|sources|closing|домаш|источник|закреп|дополнитель/i.test(`${slide.role} ${slide.titleIntent} ${slide.claim}`)
);

const isAllowedRepeatedPurpose = (previous: DeckPlanSlide | undefined, current: DeckPlanSlide): boolean => {
  if (!previous) return false;
  return previous.slideType === "summary"
    && current.slideType === "summary"
    && isConclusionSlide(previous)
    && isHomeworkSourcesSlide(current);
};

const assessDeckPlanAdherence = (params: {
  deckPlan: DeckPlan;
  fills: Record<string, string>;
  issues: ContentQaIssue[];
}): void => {
  const { deckPlan, fills, issues } = params;
  const slides = slideTextMap(fills);

  if (!deckPlan.centralQuestion.trim()) {
    pushIssue(issues, {
      code: "no_central_question",
      severity: "error",
      layer: "plan",
      message: "DeckPlan does not define a central question.",
    });
  }

  if (!deckPlan.thesis.trim()) {
    pushIssue(issues, {
      code: "missing_thesis",
      severity: "error",
      layer: "plan",
      message: "DeckPlan does not define a thesis.",
    });
  }

  const roleOwners = new Map<string, number>();
  for (const slide of deckPlan.slides) {
    const role = normalize(slide.role);
    const previous = roleOwners.get(role);
    if (previous && previous !== slide.slide) {
      const previousSlide = deckPlan.slides.find((item) => item.slide === previous);
      if (isAllowedRepeatedPurpose(previousSlide, slide)) {
        continue;
      }
      pushIssue(issues, {
        code: "repeated_slide_purpose",
        severity: "warn",
        layer: "plan",
        slide: slide.slide,
        message: `DeckPlan slide role repeats slide ${previous}.`,
        sample: slide.role,
      });
    } else {
      roleOwners.set(role, slide.slide);
    }
  }

  for (const slide of deckPlan.slides) {
    for (const item of slide.requiredItems) {
      if (!item.exact) continue;
      const slot = slotForRequiredItem(item, slide);
      if (!slot) continue;
      const counted = countLinesOrKeys({ fills, slide: slide.slide, slot, item });
      if (!counted.matched) {
        pushIssue(issues, {
          code: "required_slot_unbound",
          severity: "warn",
          layer: "plan",
          key: counted.key,
          slide: slide.slide,
          message: `DeckPlan required item could not be mapped to a generated fill slot: ${slot}.`,
          sample: counted.sample,
          expected: { slot, kind: item.kind, count: item.count },
          actual: "missing_slot",
        });
        continue;
      }
      if (counted.count !== item.count) {
        const severity: ContentQaSeverity = item.kind === "terms" && counted.count >= item.count && counted.count <= 5 ? "warn" : "error";
        pushIssue(issues, {
          code: "required_count_mismatch",
          severity,
          layer: "plan",
          key: counted.key,
          slide: slide.slide,
          message: `DeckPlan requires exactly ${item.count} ${item.kind}, got ${counted.count}.`,
          sample: counted.sample,
          expected: item.count,
          actual: counted.count,
        });
        pushIssue(issues, {
          code: "weak_exact_count_instruction",
          severity,
          layer: "plan",
          key: counted.key,
          slide: slide.slide,
          message: `Prompt/budget says exactly ${item.count}, but output has ${counted.count}.`,
          sample: counted.sample,
          expected: item.count,
          actual: counted.count,
        });
      }
    }
  }

  const hookSlide = deckPlan.slides.find((slide) => slide.slideType === "hook");
  if (hookSlide) {
    const hookText = slides.get(hookSlide.slide) || "";
    if (hookText.trim() && !/[?？]/.test(hookText) && overlapScore(hookText, deckPlan.centralQuestion) < 0.08) {
      pushIssue(issues, {
        code: "deck_plan_hook_missing_problem",
        severity: "warn",
        layer: "plan",
        slide: hookSlide.slide,
        message: "DeckPlan expects this hook slide to open a problem/question, but the hook is weak.",
        sample: hookText.slice(0, 160),
      });
    }
  }

  const goalsSlide = deckPlan.slides.find((slide) => slide.slideType === "goals");
  if (goalsSlide) {
    const goalsRoute = slideText(fills, goalsSlide.slide);
    const plannedRoute = deckPlan.slides
      .filter((slide) => slide.slide !== goalsSlide.slide && slide.slideType !== "cover")
      .map((slide) => `${slide.claim} ${slide.mustInclude.join(" ")}`)
      .join("\n");
    if (goalsRoute.trim() && plannedRoute.trim() && overlapScore(goalsRoute, plannedRoute) < 0.08) {
      pushIssue(issues, {
        code: "goals_not_matching_deck_plan",
        severity: "warn",
        layer: "plan",
        key: slideFillKeys(fills, goalsSlide.slide)[0],
        slide: goalsSlide.slide,
        message: "Goals/route slide has weak overlap with DeckPlan slide claims.",
        sample: goalsRoute.slice(0, 160),
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
        layer: "content",
        message: "The same central claim appears across too many slides instead of developing the argument.",
        sample: `${signal}: slides ${owners.join(", ")}`,
      });
    }
  }

  for (const slide of deckPlan.slides.filter((item) => item.slideType === "examples")) {
    const key = dynamicFillKey(slide.slide, "examples");
    const examples = fills[key] || "";
    const exampleLines = linesOf(examples);
    const expected = slide.requiredItems.find((item) => item.exact && slotForRequiredItem(item, slide) === "examples")?.count;
    if (examples.trim() && expected && exampleLines.length < expected) {
      pushIssue(issues, {
        code: "examples_count_low",
        severity: "error",
        layer: "plan",
        key,
        slide: slide.slide,
        message: `Examples slide should contain exactly ${expected} examples; got ${exampleLines.length}.`,
        sample: examples.slice(0, 160),
        expected,
        actual: exampleLines.length,
      });
    }
    if (exampleLines.length > 0 && exampleLines.filter((line) => includesAny(line, evidenceHints)).length < Math.ceil(exampleLines.length / 2)) {
      pushIssue(issues, {
        code: "examples_not_used_as_evidence",
        severity: "warn",
        layer: "content",
        key,
        slide: slide.slide,
        message: "Examples are listed without showing how they support the thesis.",
        sample: examples.slice(0, 160),
      });
    }
  }

  for (const slide of deckPlan.slides.filter((item) => item.slideType === "quiz")) {
    const quizText = slideText(fills, slide.slide);
    if (!quizText.trim()) continue;
    const quizLines = linesOf(quizText);
    const understandingCount = quizLines.filter((line) => understandingQuizPatterns.some((pattern) => pattern.test(line))).length;
    if (understandingCount < Math.min(2, quizLines.length) || overlapScore(quizText, `${deckPlan.centralQuestion} ${deckPlan.thesis}`) < 0.06) {
      pushIssue(issues, {
        code: "quiz_not_testing_narrative",
        severity: "warn",
        layer: "content",
        slide: slide.slide,
        message: "Quiz does not sufficiently test the central argument and slide sequence.",
        sample: quizText.slice(0, 160),
      });
    }
  }

  for (const slide of deckPlan.slides.filter(isConclusionSlide)) {
    const conclusion = slideText(fills, slide.slide);
    if (!conclusion.trim()) continue;
    const conclusionRiskLine = linesOf(conclusion).find(hasRiskyOverclaim) || (hasRiskyOverclaim(conclusion) ? conclusion : "");
    if (conclusionRiskLine) {
      pushIssue(issues, {
        code: "conclusion_overclaim",
        severity: "warn",
        layer: "content",
        slide: slide.slide,
        message: "Conclusion answers too categorically; use cautious academic wording.",
        sample: conclusionRiskLine.slice(0, 160),
      });
    }

    const questionWords = importantQuestionWords(`${deckPlan.centralQuestion} ${deckPlan.thesis}`);
    const matchedQuestionWords = questionWords.filter((word) => normalize(conclusion).includes(word));
    if (matchedQuestionWords.length < 2 && !includesAny(conclusion, ["ответ", "вывод", "значит", "потому", "следовательно"])) {
      pushIssue(issues, {
        code: "conclusion_not_answering_question",
        severity: "warn",
        layer: "plan",
        slide: slide.slide,
        message: "Conclusion does not clearly answer the DeckPlan central question.",
        sample: conclusion.slice(0, 160),
      });
    }
    if (overlapScore(conclusion, `${deckPlan.centralQuestion} ${deckPlan.thesis}`) < 0.06) {
      pushIssue(issues, {
        code: "deck_plan_conclusion_weak_answer",
        severity: "warn",
        layer: "plan",
        slide: slide.slide,
        message: "Conclusion has weak relation to DeckPlan central question/thesis.",
        sample: conclusion.slice(0, 160),
      });
    }
  }

  const weakPairs = deckPlan.slides
    .slice(1)
    .map((slide, index) => [deckPlan.slides[index], slide] as const)
    .filter(([left, right]) => {
      const a = slides.get(left.slide) || "";
      const b = slides.get(right.slide) || "";
      return a.trim() && b.trim() && overlapScore(a, b) < 0.04;
    });
  if (weakPairs.length >= 3) {
    pushIssue(issues, {
      code: "disconnected_slide_sequence",
      severity: "info",
      layer: "plan",
      message: "Several neighboring DeckPlan slides have weak lexical connection, which may indicate a broken lesson route.",
      sample: weakPairs.map(([left, right]) => `${left.slide}-${right.slide}`).join(", "),
    });
  }
};

const calculateContentQualityScore = (issues: ContentQaIssue[], keysChecked: number): number => {
  const missingCount = issues.filter((issue) => issue.code === "missing_field").length;
  const criticalFormatCount = issues.filter((issue) => (
    issue.code === "placeholder_leak"
    || issue.code === "placeholder_token_left"
    || issue.code === "test_prefix_leaked"
  )).length;
  const requiredCountMismatchCount = issues.filter((issue) => issue.code === "required_count_mismatch" && issue.severity === "error").length;
  const penalty = issues.reduce((sum, issue) => sum + issueWeight(issue), 0);
  let score = Math.max(0, Math.min(100, 100 - penalty));

  const manyMissing = missingCount >= Math.max(3, Math.ceil(keysChecked * 0.25));
  const nearlyAllMissing = keysChecked > 0 && missingCount >= Math.ceil(keysChecked * 0.8);
  if (nearlyAllMissing) return 0;
  if (manyMissing || criticalFormatCount >= 3) score = Math.min(score, 19);
  else if (criticalFormatCount > 0) score = Math.min(score, 49);
  else if (requiredCountMismatchCount >= 4) score = Math.min(score, 49);
  else if (requiredCountMismatchCount >= 2) score = Math.min(score, 69);

  if (!manyMissing && criticalFormatCount === 0 && requiredCountMismatchCount < 4) {
    score = Math.max(score, 20);
  }

  return score;
};

export const runContentQa = (params: {
  fills: Record<string, string>;
  fillKeys: string[];
  topic: string;
  deckPlan?: DeckPlan;
}): ContentQaReport => {
  const issues: ContentQaIssue[] = [];
  const lineOwners = new Map<string, string>();
  let repeatedLineCount = 0;

  for (const key of params.fillKeys) {
    const value = typeof params.fills[key] === "string" ? params.fills[key].trim() : "";
    const normalizedKey = key.toLowerCase();
    const slot = slotFromKey(key);
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

    const deckPlanSlide = params.deckPlan?.slides.find((item) => item.slide === slide);

    if ((deckPlanSlide?.slideType === "hook" || slot.includes("hook")) && genericHookPatterns.some((pattern) => pattern.test(value))) {
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

    const largeBlock = largeBlockMinimumsBySlot[slot];
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

    if (normalizedKey === "s2_goals" || slot === "goals") {
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

    if ((deckPlanSlide?.slideType === "quiz" || slot === "questions" || /_q\d+$/i.test(normalizedKey)) && (slot === "questions" || /_q\d+$/i.test(normalizedKey))) {
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

    if (slot === "examples") {
      const exampleLines = linesOf(value);
      if (exampleLines.length > 0 && exampleLines.filter((line) => includesAny(line, evidenceHints)).length < Math.ceil(exampleLines.length / 2)) {
        pushIssue(issues, {
          code: "examples_not_argumentative",
          severity: "warn",
          layer: "content",
          key,
          slide,
          message: "Examples should explicitly work as evidence for the thesis.",
          sample: value.slice(0, 160),
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

  const goalsSlideNo = params.deckPlan?.slides.find((slide) => slide.slideType === "goals")?.slide ?? 2;
  const goalsKeys = Object.keys(params.fills).filter((key) => {
    const slot = slotFromKey(key);
    return slideFromKey(key) === goalsSlideNo && (slot === "goals" || slot === "plan");
  });
  const goalsValues = goalsKeys.map((key) => params.fills[key]).filter((value): value is string => typeof value === "string");
  const s2 = goalsValues.join("\n");
  const downstream = Object.entries(params.fills)
    .filter(([key]) => (slideFromKey(key) ?? 0) > goalsSlideNo)
    .map(([, value]) => value)
    .join("\n")
    .toLowerCase();
  for (const promise of extractSpecificPromises(s2)) {
    if (!downstream.includes(promise)) {
      pushIssue(issues, {
        code: "unsupported_goal_promise",
        severity: "warn",
        layer: "content",
        key: goalsKeys[0],
        slide: goalsSlideNo,
        message: "Goals promise a specific analysis that is not supported by later slides.",
        sample: promise,
      });
    }
  }

  const goalsKey = goalsKeys.find((key) => slotFromKey(key) === "goals");
  const planKey = goalsKeys.find((key) => slotFromKey(key) === "plan");
  if (goalsKey && planKey && overlapScore(params.fills[goalsKey], params.fills[planKey]) > 0.55) {
    pushIssue(issues, {
      code: "duplicated_goal_plan",
      severity: "warn",
      layer: "plan",
      key: planKey,
      slide: goalsSlideNo,
      message: "Goals and plan duplicate each other instead of separating what to understand and how to get there.",
      sample: `${params.fills[goalsKey].slice(0, 80)} / ${params.fills[planKey].slice(0, 80)}`,
    });
  }

  if (params.deckPlan) {
    assessDeckPlanAdherence({ deckPlan: params.deckPlan, fills: params.fills, issues });
  }

  const score = calculateContentQualityScore(issues, params.fillKeys.length);
  const routeCodes = new Set([
    "no_central_question",
    "missing_thesis",
    "slide_not_advancing_argument",
    "repeated_slide_purpose",
    "repeated_central_claim",
    "duplicated_goal_plan",
    "conclusion_not_answering_question",
    "goals_not_matching_narrative_plan",
    "goals_not_matching_deck_plan",
    "hook_not_connected_to_following_slides",
    "deck_plan_hook_missing_problem",
    "deck_plan_route_mismatch",
    "deck_plan_conclusion_weak_answer",
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
      routeIssueCount: issues.filter((issue) => routeCodes.has(issue.code)).length,
      deckPlanRouteIssueCount: issues.filter((issue) => routeCodes.has(issue.code)).length,
      deckPlanIssueCount: issues.filter((issue) => issue.layer === "plan").length,
      overclaimRiskCount: issues.filter((issue) => issue.code === "overclaim_risk" || issue.code === "conclusion_overclaim").length,
      chronologyRiskCount: issues.filter((issue) => issue.code === "chronology_risk").length,
      formatIssueCount: issues.filter((issue) => issue.layer === "format").length,
      planIssueCount: issues.filter((issue) => issue.layer === "plan").length,
      repeatedLineCount,
      placeholderLeakCount: issues.filter((issue) => issue.code === "placeholder_leak").length,
    },
  };
};
