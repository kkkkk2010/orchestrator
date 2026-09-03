import assert from "node:assert/strict";
import { adaptLayoutToContent } from "../layouts/contentAware";
import { measureTextBlock } from "../layouts/textMetrics";

export const runContentAwareLayoutTests = (): void => {
  const doc = {
    slides: [{
      elements: [
        { type: "shape", x: 80, y: 220, width: 600, height: 500, meta: { adaptiveGroup: "card_a", adaptiveRole: "container", adaptiveMinHeight: 180, adaptiveMaxHeight: 500, adaptiveBottomPadding: 32, adaptiveFlow: "stack", adaptiveOrder: 1 } },
        { type: "shape", x: 88, y: 230, width: 600, height: 500, meta: { adaptiveGroup: "card_a", adaptiveRole: "shadow" } },
        { type: "text", x: 110, y: 300, width: 520, height: 300, text: "• Короткий пункт\n• Ещё один пункт", style: { fontSize: 21, lineHeight: 1.25 }, meta: { adaptiveGroup: "card_a", adaptiveRole: "content" } },
        { type: "shape", x: 80, y: 750, width: 600, height: 180, meta: { adaptiveGroup: "card_b", adaptiveRole: "container", adaptiveMinHeight: 120, adaptiveMaxHeight: 220, adaptiveBottomPadding: 24, adaptiveFlow: "stack", adaptiveOrder: 2 } },
        { type: "text", x: 110, y: 790, width: 520, height: 80, text: "Ключевое понятие", style: { fontSize: 23, lineHeight: 1.2 }, meta: { adaptiveGroup: "card_b", adaptiveRole: "content" } },
      ],
    }],
  };

  const stats = adaptLayoutToContent(doc);
  const elements = doc.slides[0].elements;
  assert.equal(stats.groupsFound, 2);
  assert.equal(stats.groupsCompacted, 2);
  assert.equal(elements[0].height, 180);
  assert.equal(elements[1].height, 180);
  assert.equal(elements[3].y, 430);
  assert.equal(elements[4].y, 470);
  assert.equal(stats.overflowRiskCount, 0);

  const timelineMetrics = measureTextBlock(
    "• Поздний период (III–V вв.): уменьшение масштабов, укрепление стен, использование старых материалов.",
    292,
    { fontFamily: "Inter", fontSize: 18, lineHeight: 1.24 },
  );
  assert.equal(timelineMetrics.lineCount, 5);
  assert.equal(Math.round(timelineMetrics.height), 112);
  assert.equal(timelineMetrics.usedFallbackFont, false);

  const titleDoc = {
    slides: [{
      width: 1536,
      height: 864,
      elements: [
        { id: "title", type: "text", x: 80, y: 92, width: 1376, height: 92, text: "Как технологии изменили жизнь древнего римского города", style: { fontFamily: "Manrope", fontSize: 56, lineHeight: 1.04, bold: true }, meta: { slotId: "title" } },
        { id: "card", type: "shape", x: 80, y: 222, width: 660, height: 300, meta: {} },
      ],
    }],
  };
  const titleStats = adaptLayoutToContent(titleDoc);
  assert.equal(titleStats.titlesAdjusted, 1);
  assert.ok(titleDoc.slides[0].elements[0].height >= 120);
  assert.ok(titleDoc.slides[0].elements[1].y > 222);
  assert.equal(titleStats.fontFallbackCount, 0);
};
