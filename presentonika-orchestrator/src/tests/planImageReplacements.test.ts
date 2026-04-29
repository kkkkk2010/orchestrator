import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { planImageReplacements } from "../images/planImageReplacements";

export const runPlanImageReplacementsTests = async (): Promise<void> => {
  const themeDir = await fs.mkdtemp(path.join(os.tmpdir(), "image-replacements-"));
  await fs.mkdir(path.join(themeDir, "test-images"), { recursive: true });
  await fs.writeFile(path.join(themeDir, "test-images", "hero.jpg"), "hero");
  await fs.writeFile(path.join(themeDir, "test-images", "photo.jpg"), "photo");

  const doc = {
    slides: [
      {
        elements: [
          { id: "hero", type: "image", src: "assets/images/hero.png" },
          { id: "photo", type: "image", src: "assets/images/photo.png" },
        ],
      },
    ],
  };

  const plan = await planImageReplacements({
    doc,
    themeDir,
    map: {
      slides: {
        "1": {
          imageAt: {
            "0": "hero_slot",
            "1": { slotId: "photo_slot", kind: "photo", aspect: "landscape" },
          },
        },
      },
    },
  });

  assert.equal(plan.plannedCount, 2);
  assert.equal(plan.missing.length, 0);
  assert.equal(plan.replacements["assets/images/hero.png"].endsWith(path.join("test-images", "hero.jpg")), true);
  assert.equal(plan.replacements["assets/images/photo.png"].endsWith(path.join("test-images", "photo.jpg")), true);
};
