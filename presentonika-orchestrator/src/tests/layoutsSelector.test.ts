import assert from "node:assert/strict";
import { selectLayoutForSlide } from "../layouts/selector";

export const runLayoutsSelectorTests = (): void => {
  const row = { slide: 1, slideType: "cover" as const };
  const candidates = [
    { id: "cover-a", manifest: { textSlots: [{ slotId: "title" }] } },
    { id: "cover-b", manifest: { textSlots: [{ slotId: "title" }] } },
  ] as Array<{ id: string; manifest: { textSlots: Array<{ slotId: string }> } }>;

  const a = selectLayoutForSlide({ presentationId: 7, themeId: "teacher-dark", row, candidates: candidates as never, variation: true });
  const b = selectLayoutForSlide({ presentationId: 7, themeId: "teacher-dark", row, candidates: candidates as never, variation: true });
  assert.equal(a?.id, b?.id);
};
