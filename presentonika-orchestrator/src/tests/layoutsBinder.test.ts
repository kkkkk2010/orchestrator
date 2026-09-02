import assert from "node:assert/strict";
import { getDynamicFillKey, getDynamicSlotBindings, getSlotBindings } from "../layouts/binder";

export const runLayoutsBinderTests = (): void => {
  assert.equal(getSlotBindings("cover").title, "s1_title");
  assert.equal(getSlotBindings("bullets").bullets, "s5_bullets");
  assert.equal(getSlotBindings("summary").sources, "s10_sources");
  assert.equal(getDynamicFillKey(7, "examples"), "s7_examples");
  assert.equal(getDynamicFillKey(8, "questions"), "s8_questions");
  assert.equal(getDynamicFillKey(9, "summary"), "s9_summary");
  const dynamic = getDynamicSlotBindings(8, ["title", "q1", "q2", "questions"]);
  assert.equal(dynamic.title, "s8_title");
  assert.equal(dynamic.q1, "s8_q1");
  assert.equal(dynamic.questions, "s8_questions");
};
