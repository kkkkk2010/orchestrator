import type { ContentQaIssue, ContentQaReport } from "./contentQa";

const repairableCodes = new Set([
  "bare_fact_without_meaning",
  "bullet_block_missing_newlines",
  "bullet_too_short",
  "comma_only_keywords",
  "conclusion_overclaim",
  "conclusion_not_answering_question",
  "deck_plan_conclusion_weak_answer",
  "deck_plan_hook_missing_problem",
  "disconnected_slide_sequence",
  "double_bullet_marker",
  "duplicated_goal_plan",
  "examples_count_low",
  "examples_not_argumentative",
  "examples_not_used_as_evidence",
  "generic_hook",
  "generic_title",
  "goals_not_matching_deck_plan",
  "instruction_mentions_options_but_no_options",
  "large_block_too_short",
  "memory_only_quiz",
  "multiple_bullets_on_one_line",
  "overloaded_keywords",
  "overclaim_risk",
  "quiz_not_testing_central_argument",
  "repeated_central_claim",
  "repeated_line",
  "required_count_mismatch",
  "title_sentence_like",
  "title_too_long",
  "too_few_bullets",
  "unsupported_goal_promise",
  "weak_exact_count_instruction",
  "weak_learning_verbs",
]);

const keySlot = (key: string): string => key.match(/^s\d+_(.+)$/i)?.[1]?.toLowerCase() || key.toLowerCase();
const keySlide = (key: string): number | undefined => {
  const match = key.match(/^s(\d+)_/i);
  return match?.[1] ? Number.parseInt(match[1], 10) : undefined;
};

const slotMatchesIssue = (slot: string, code: string): boolean => {
  if (code.includes("title")) return slot === "title" || slot === "subtitle";
  if (code.includes("goal") || code === "duplicated_goal_plan") return slot === "goals" || slot === "plan";
  if (code.includes("hook")) return slot.startsWith("hook_") || slot === "title";
  if (code.includes("example")) return slot === "examples";
  if (code.includes("quiz") || code === "memory_only_quiz" || code.includes("options")) return slot === "task" || slot === "questions" || /^q\d+$/.test(slot);
  if (code.includes("conclusion")) return slot === "summary";
  if (code.includes("keyword")) return slot === "keywords";
  if (code.includes("bullet") || code.includes("count") || code.includes("line")) {
    return slot === "bullets" || slot === "goals" || slot === "plan" || slot === "examples"
      || slot === "summary" || slot.includes("_bullets") || slot === "questions" || /^q\d+$/.test(slot);
  }
  return slot !== "sources" && slot !== "homework";
};

const candidateKeysForIssue = (issue: ContentQaIssue, fillKeys: string[]): string[] => {
  if (issue.key && fillKeys.includes(issue.key)) return [issue.key];
  if (!issue.slide) return [];
  const slideKeys = fillKeys.filter((key) => keySlide(key) === issue.slide);
  const matched = slideKeys.filter((key) => slotMatchesIssue(keySlot(key), issue.code));
  if (issue.code === "quiz_not_testing_central_argument" || issue.code === "memory_only_quiz") {
    return matched.sort((left, right) => {
      const rank = (key: string): number => /^q\d+$/.test(keySlot(key)) ? 0 : keySlot(key) === "questions" ? 1 : 2;
      return rank(left) - rank(right);
    });
  }
  return matched.length > 0 ? matched : slideKeys.filter((key) => keySlot(key) !== "sources");
};

export type ContentRepairPlan = {
  keys: string[];
  issues: ContentQaIssue[];
};

export const buildContentRepairPlan = (params: {
  report: ContentQaReport;
  fillKeys: string[];
  maxKeys: number;
}): ContentRepairPlan => {
  const keys: string[] = [];
  const issues: ContentQaIssue[] = [];

  for (const issue of params.report.issues) {
    if (!repairableCodes.has(issue.code)) continue;
    const candidates = candidateKeysForIssue(issue, params.fillKeys);
    let included = false;
    for (const key of candidates) {
      if (keys.includes(key)) {
        included = true;
        continue;
      }
      if (keys.length >= params.maxKeys) break;
      keys.push(key);
      included = true;
    }
    if (included) issues.push(issue);
    if (keys.length >= params.maxKeys) break;
  }

  return { keys, issues };
};
