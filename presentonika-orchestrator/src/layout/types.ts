export type LayoutBBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LayoutSlot = {
  key: string;
  type: "text" | "image";
  bbox: LayoutBBox;
};

export type LayoutTemplate = {
  id: string;
  slide?: number;
  slots: LayoutSlot[];
};

export type LayoutCatalog = {
  templates: LayoutTemplate[];
};

export type SlideLayoutPlan = {
  slide: number;
  templateId: string;
  requiredTextKeys: string[];
};

export type LayoutCompileDiagnostics = {
  selectedLayouts: Array<{ slide: number; templateId: string }>;
  insertedTextPlaceholders: number;
  insertedImagePlaceholders: number;
};
