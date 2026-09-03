import assert from "node:assert/strict";
import { selectLayoutForSlide } from "../layouts/selector";
import { inferContentDensityFromFills } from "../layouts/dynamicPlan";

export const runLayoutsSelectorTests = (): void => {
  const row = { slide: 1, slideType: "cover" as const };
  const candidates = [
    { id: "cover-a", manifest: { textSlots: [{ slotId: "title" }] } },
    { id: "cover-b", manifest: { textSlots: [{ slotId: "title" }] } },
  ] as Array<{ id: string; manifest: { textSlots: Array<{ slotId: string }> } }>;

  const a = selectLayoutForSlide({ presentationId: 7, themeId: "teacher-dark", row, candidates: candidates as never, variation: true });
  const b = selectLayoutForSlide({ presentationId: 7, themeId: "teacher-dark", row, candidates: candidates as never, variation: true });
  assert.equal(a?.id, b?.id);

  const densityCandidates = [
    { id: "goals-compact", manifest: { textSlots: [{ slotId: "title" }, { slotId: "goals" }, { slotId: "plan" }], constraints: { preferredTextDensity: "low" } } },
    { id: "goals-dense", manifest: { textSlots: [{ slotId: "title" }, { slotId: "goals" }, { slotId: "plan" }], constraints: { preferredTextDensity: "high" } } },
  ];
  const compact = selectLayoutForSlide({
    presentationId: 7,
    themeId: "teacher-dark",
    row: { slide: 2, slideType: "goals", contentDensity: "low" },
    candidates: densityCandidates as never,
    variation: true,
  });
  const dense = selectLayoutForSlide({
    presentationId: 7,
    themeId: "teacher-dark",
    row: { slide: 2, slideType: "goals", contentDensity: "high" },
    candidates: densityCandidates as never,
    variation: true,
  });
  assert.equal(compact?.id, "goals-compact");
  assert.equal(dense?.id, "goals-dense");

  const actualDensity = inferContentDensityFromFills({
    s1_title: "Короткий заголовок",
    s2_title: "Плотный материал",
    s2_bullets: Array.from({ length: 7 }, (_, index) => `• Содержательный пункт ${index + 1} с подробным объяснением причин, механизма и последствий`).join("\n"),
  }, 2);
  assert.equal(actualDensity[1], "low");
  assert.equal(actualDensity[2], "high");
};
