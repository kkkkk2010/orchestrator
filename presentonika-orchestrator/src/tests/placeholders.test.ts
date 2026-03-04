import assert from "node:assert/strict";
import { extractPlaceholderLocations, normalizePlaceholders } from "../themes/parseDoc";

export const runPlaceholderTests = (): void => {
  const doc = {
    slides: [
      {
        elements: [
          {
            id: "t1",
            type: "text",
            runs: [
              { text: "{{" },
              { text: "s1_title" },
              { text: "}}" },
            ],
          },
        ],
      },
    ],
  };

  const before = extractPlaceholderLocations(doc).locations;
  assert.equal(before.length, 0);

  normalizePlaceholders(doc);
  const after = extractPlaceholderLocations(doc).locations;
  assert.equal(after.length, 1);
  assert.equal(after[0].key, "s1_title");
};
