import assert from "node:assert/strict";
import { aggregateFillCounts, buildBatches } from "../llm/batching";
import { isRetryableLlmError } from "../llm/retry";

export const runLlmBatchingTests = (): void => {
  const fillKeys = Array.from({ length: 37 }, (_, index) => `s${Math.floor(index / 4) + 1}_k${index}`);
  const placeholdersBySlide: Record<string, { count: number; keys: string[] }> = {
    "1": { count: 10, keys: fillKeys.slice(0, 10) },
    "2": { count: 14, keys: fillKeys.slice(10, 24) },
    "3": { count: 13, keys: fillKeys.slice(24) },
  };

  const bySlide = buildBatches({
    fillKeys,
    placeholdersBySlide,
    maxKeysPerRequest: 12,
    mode: "bySlide",
  });

  assert.equal(bySlide.length, 5);
  assert.deepEqual(bySlide.map((batch) => batch.keys.length), [10, 12, 2, 12, 1]);

  const chunk = buildBatches({
    fillKeys,
    placeholdersBySlide,
    maxKeysPerRequest: 12,
    mode: "chunk",
  });

  assert.equal(chunk.length, 4);
  assert.deepEqual(chunk.map((batch) => batch.keys.length), [12, 12, 12, 1]);

  const abortError = new Error("The user aborted a request.");
  abortError.name = "AbortError";
  assert.equal(isRetryableLlmError(abortError, true), true);
  assert.equal(isRetryableLlmError(abortError, false), false);

  const counts = aggregateFillCounts(["a", "b", "c"], { a: "x", c: " y " });
  assert.equal(counts.receivedKeysCount, 2);
  assert.equal(counts.missingKeysCount, 1);
};
