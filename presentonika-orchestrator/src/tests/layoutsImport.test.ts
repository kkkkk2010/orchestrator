import assert from "node:assert/strict";
import { scaffoldManifestFromDoc } from "../layouts/importLayout";

export const runLayoutsImportTests = (): void => {
  const doc = {
    slides: [
      {
        elements: [
          { type: "text", text: "{{slot:title}}" },
          { type: "text", text: "{{slot:subtitle}}" },
          { type: "image", src: "assets/images/pic.png" },
        ],
      },
    ],
  };

  const manifest = scaffoldManifestFromDoc({ doc, id: "x", slideType: "cover" });
  const slotIds = manifest.textSlots.map((slot) => slot.slotId);
  assert.ok(slotIds.includes("title"));
  assert.ok(slotIds.includes("subtitle"));
  assert.ok(manifest.imageSlots.length >= 1);
};
