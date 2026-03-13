import assert from "node:assert/strict";
import { buildRetrieveRequestBody } from "../rag/httpRagClient";
import { normalizeRagRetrieveResponse } from "../rag/normalize";
import { buildRagHitsSampleLog, buildRagResponseLog } from "../rag/logging";

export const runRagRetrieveTests = (): void => {
  {
    const body = buildRetrieveRequestBody({ query: "османская империя", topK: 15, minScore: 0.45, collection: "default" });
    assert.deepEqual(body, {
      query: "османская империя",
      top_k: 15,
      min_score: 0.45,
      collection: "default",
      return_text: true,
    });
  }

  {
    const a = normalizeRagRetrieveResponse({ hits: [{ fragment_id: "f1", source_uri: "u1", text: "t1", score: 0.9 }] }, 1000);
    assert.equal(a.hitCount, 1);
    assert.ok(a.contextText.includes("t1"));

    const b = normalizeRagRetrieveResponse({ results: [{ id: "f2", source: "u2", content: "t2", score: 0.8 }] }, 1000);
    assert.equal(b.hitCount, 1);
    assert.ok(b.contextText.includes("t2"));

    const c = normalizeRagRetrieveResponse({ fragments: [{ fragment_id: "f3", source_uri: "u3", metadata: { text: "t3" } }] }, 1000);
    assert.equal(c.hitCount, 1);
    assert.ok(c.contextText.includes("t3"));
  }

  {
    const log = buildRagResponseLog({ ok: true, httpStatus: 200, hitCount: 3, usedContextChars: 500, elapsedMs: 20 });
    const sample = buildRagHitsSampleLog([{ score: 0.8, source_uri: "a", fragment_id: "b" }]);
    assert.ok(log.includes("rag.response:"));
    assert.ok(sample.includes("rag.hits.sample:"));
  }
};
