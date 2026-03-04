import type { LayoutCatalog, LayoutCompileDiagnostics, LayoutSlot, SlideLayoutPlan } from "./types";

type AnyRecord = Record<string, unknown>;

const asRecord = (value: unknown): AnyRecord => (value && typeof value === "object" ? value as AnyRecord : {});

const ensureSlideElements = (slide: AnyRecord): unknown[] => {
  const elements = Array.isArray(slide.elements) ? slide.elements : [];
  slide.elements = elements;
  return elements;
};

const elementHasKey = (element: AnyRecord, key: string): boolean => {
  const text = typeof element.text === "string" ? element.text : "";
  if (text.includes(`{{${key}}}`)) return true;
  const meta = asRecord(element.meta);
  return meta.placeholderKey === key;
};

const createElementForSlot = (slot: LayoutSlot, slide: number): AnyRecord => {
  if (slot.type === "image") {
    return {
      id: `layout_s${slide}_${slot.key}`,
      type: "image",
      x: slot.bbox.x,
      y: slot.bbox.y,
      width: slot.bbox.width,
      height: slot.bbox.height,
      src: "assets/images/placeholder.png",
      meta: { placeholder: true, placeholderKey: slot.key },
    };
  }

  return {
    id: `layout_s${slide}_${slot.key}`,
    type: "text",
    x: slot.bbox.x,
    y: slot.bbox.y,
    width: slot.bbox.width,
    height: slot.bbox.height,
    text: `{{${slot.key}}}`,
  };
};

export const compileDocWithLayoutPlan = (params: {
  doc: unknown;
  catalog: LayoutCatalog;
  plan: SlideLayoutPlan[];
}): LayoutCompileDiagnostics => {
  const diagnostics: LayoutCompileDiagnostics = {
    selectedLayouts: [],
    insertedTextPlaceholders: 0,
    insertedImagePlaceholders: 0,
  };

  const root = asRecord(params.doc);
  const slides = Array.isArray(root.slides) ? root.slides : [];

  for (const row of params.plan) {
    const slide = asRecord(slides[row.slide - 1]);
    const elements = ensureSlideElements(slide);
    const template = params.catalog.templates.find((item) => item.id === row.templateId);
    if (!template) continue;

    diagnostics.selectedLayouts.push({ slide: row.slide, templateId: template.id });

    for (const slot of template.slots) {
      const alreadyExists = elements.some((element) => elementHasKey(asRecord(element), slot.key));
      if (alreadyExists) continue;
      elements.push(createElementForSlot(slot, row.slide));
      if (slot.type === "image") diagnostics.insertedImagePlaceholders += 1;
      else diagnostics.insertedTextPlaceholders += 1;
    }
  }

  root.slides = slides;
  return diagnostics;
};
