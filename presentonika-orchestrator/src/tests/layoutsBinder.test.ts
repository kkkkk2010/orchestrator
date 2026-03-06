import assert from "node:assert/strict";
import { getSlotBindings } from "../layouts/binder";

export const runLayoutsBinderTests = (): void => {
  assert.equal(getSlotBindings("cover").title, "s1_title");
  assert.equal(getSlotBindings("bullets").bullets, "s5_bullets");
  assert.equal(getSlotBindings("summary").sources, "s10_sources");
};
