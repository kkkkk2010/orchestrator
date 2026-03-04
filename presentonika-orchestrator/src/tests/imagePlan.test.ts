import assert from "node:assert/strict";
import {
  buildImagePlanWithDiagnostics,
  detectPlaceholderImageElements,
} from "../images/imagePlan";

export const runImagePlanTests = (): void => {
  const doc = {
    slides: [
      {
        width: 1536,
        height: 864,
        elements: [
          { id: "bg", type: "image", src: "backgrounds/slide-1.png", width: 1536, height: 864 },
          { id: "decor", type: "image", src: "decor/star.png", width: 100, height: 100, meta: { role: "decor" } },
          { id: "ph", type: "image", src: "assets/images/placeholder.png", width: 700, height: 400 },
        ],
      },
    ],
  };

  const detected = detectPlaceholderImageElements({ doc, fallbackAllNonDecor: true });
  assert.equal(detected.length, 1);
  assert.equal(detected[0].elementId, "ph");

  const map = {
    slides: {
      "1": {
        imageAt: {
          "2": "s1_hero",
        },
      },
    },
  };

  const built = buildImagePlanWithDiagnostics({
    map,
    originalDoc: doc,
    currentDoc: doc,
    presentationId: 1,
    themeId: "_example",
    topic: "Тема",
    language: "ru",
    autoDetect: true,
    fallbackAllNonDecor: true,
  });

  assert.equal(built.imagePlan.slots.length, 1);
  assert.equal(built.imagePlan.slots[0].slotId, "s1_hero");

  const droppedDoc = {
    slides: [
      {
        elements: [
          { id: "bg", type: "image", src: "backgrounds/slide-1.png" },
          { id: "decor", type: "image", src: "decor/star.png", meta: { role: "decor" } },
        ],
      },
    ],
  };

  const dropped = buildImagePlanWithDiagnostics({
    map,
    originalDoc: doc,
    currentDoc: droppedDoc,
    presentationId: 1,
    themeId: "_example",
    topic: "Тема",
    language: "ru",
    autoDetect: true,
    fallbackAllNonDecor: true,
  });

  assert.equal(dropped.imagePlan.slots.length, 0);
  assert.equal(dropped.diagnostics.droppedCount, 1);
};
