import assert from "node:assert/strict";
import { selectLayoutTemplate } from "../layout/selector";

export const runLayoutSelectorTests = (): void => {
  const candidates = [
    { id: "alpha", slots: [] },
    { id: "beta", slots: [] },
    { id: "gamma", slots: [] },
  ];

  const first = selectLayoutTemplate({ candidates, seed: "p-42:s1" });
  const second = selectLayoutTemplate({ candidates, seed: "p-42:s1" });
  assert.equal(first.id, second.id);

  const third = selectLayoutTemplate({ candidates, seed: "p-42:s2" });
  assert.ok(["alpha", "beta", "gamma"].includes(third.id));
};
