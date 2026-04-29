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

const issueWeight = (severity: ContentQaSeverity): number => {
  if (severity === "error") return 18;
  if (severity === "warn") return 9;
  return 3;
};

const pushIssue = (issues: ContentQaIssue[], issue: ContentQaIssue): void => {
  issues.push(issue);
};

const genericTitlePatterns = [
  /определение\s+и\s+термины/i,
  /ключевые\s+факты/i,
  /основные\s+понятия/i,
  /:\s*определение\b/i,
  /что\s+такое\s+/i,
];

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

export const runContentQa = (params: {
  fills: Record<string, string>;
  fillKeys: string[];
  topic: string;
}): ContentQaReport => {
  const issues: ContentQaIssue[] = [];
  const lineOwners = new Map<string, string>();
  let repeatedLineCount = 0;

  for (const key of params.fillKeys) {
    const value = typeof params.fills[key] === "string" ? params.fills[key].trim() : "";
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

    if (key.toLowerCase().includes("title") && genericTitlePatterns.some((pattern) => pattern.test(value))) {
      pushIssue(issues, {
        code: "generic_title",
        severity: "warn",
        key,
        slide,
        message: "Title is too generic for a teacher deck.",
        sample: value,
      });
    }

    const largeBlock = largeBlockMinimums[key.toLowerCase()];
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

  const penalty = issues.reduce((sum, issue) => sum + issueWeight(issue.severity), 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));

  return {
    score,
    issues,
    stats: {
      keysChecked: params.fillKeys.length,
      missingCount: issues.filter((issue) => issue.code === "missing_field").length,
      genericTitleCount: issues.filter((issue) => issue.code === "generic_title").length,
      shortLargeBlockCount: issues.filter((issue) => issue.code === "large_block_too_short").length,
      bulletIssueCount: issues.filter((issue) => issue.code === "too_few_bullets" || issue.code === "bullet_too_short").length,
      repeatedLineCount,
      placeholderLeakCount: issues.filter((issue) => issue.code === "placeholder_leak").length,
    },
  };
};
