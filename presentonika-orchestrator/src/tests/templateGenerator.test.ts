import assert from "node:assert/strict";
import { buildGeneratedDoc } from "../tools/templateGenerate";
import { extractFillKeys } from "../themes/parseDoc";
import { REQUIRED_SKELETON_KEYS } from "../tools/skeletonKeys";
import { compressQuery } from "../images/imagePrompts";
import { buildRagConfigLog, buildRagRequestLog, buildRagResponseLog } from "../rag/logging";

export const runTemplateGeneratorTests = (): void => {
  {
    const fixture = {
      slides: [
        {
          elements: [
            { id: "t1", type: "text", text: "demo", style: {} },
            { id: "i1", type: "image", src: "assets/images/sample.png" },
          ],
        },
      ],
    };

    const generated = buildGeneratedDoc(fixture);
    const keys = extractFillKeys(generated);
    for (const key of REQUIRED_SKELETON_KEYS) {
      assert.ok(keys.includes(key), `missing key ${key}`);
    }
  }

  {
    const result = compressQuery("Позолоченный век США США путь к власти путь путь Standard Oil монополия 1900", ["Позолоченный", "век", "США"]);
    assert.ok(!result.query.includes("..."));
    assert.ok(!/\bСША\s+США\b/.test(result.query));
    assert.ok(result.query.length <= 90);
  }

  {
    const cfg = buildRagConfigLog({ enabled: true, mode: "retrieve", collection: "default", topK: 8, minScore: 0.5, timeoutMs: 15000 });
    const req = buildRagRequestLog({ sourceUrisCount: 2, querySnippet: "тема урока: test" });
    const res = buildRagResponseLog({ ok: true, hitCount: 5, usedContextChars: 1234, elapsedMs: 150, topSourcesSample: ["a", "b"] });
    assert.ok(cfg.includes("enabled=true"));
    assert.ok(req.includes("sourceUrisCount=2"));
    assert.ok(res.includes("hitCount=5"));
  }
};
