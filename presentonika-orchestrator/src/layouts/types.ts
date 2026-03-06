export type SlideType =
  | "cover"
  | "goals"
  | "hook"
  | "definition"
  | "bullets"
  | "twoCol"
  | "steps"
  | "examples"
  | "quiz"
  | "summary";

export type LayoutTextSlot = {
  slotId: string;
  role: string;
  required: boolean;
  path: string;
};

export type LayoutImageSlot = {
  slotId: string;
  required: boolean;
  elementIndex: number;
  kind?: "hero" | "photo" | "icon" | "other";
  aspect?: "portrait" | "landscape" | "square" | "any";
};

export type LayoutPackManifest = {
  id: string;
  version: number;
  slideType: SlideType;
  tags?: string[];
  seedWeight?: number;
  textSlots: LayoutTextSlot[];
  imageSlots: LayoutImageSlot[];
  constraints?: {
    maxTextDensity?: "low" | "medium" | "high";
    supportsLongBullets?: boolean;
    supportsNoImage?: boolean;
  };
};

export type LayoutPack = {
  id: string;
  source: "layouts-local" | "layouts";
  rootDir: string;
  zipPath: string;
  manifestPath: string;
  manifest: LayoutPackManifest;
};

export type SlidePlanRow = {
  slide: number;
  slideType: SlideType;
};

export type SelectedLayout = {
  slide: number;
  slideType: SlideType;
  layoutId: string;
  source: "layouts-local" | "layouts" | "builtin";
  hadFallback: boolean;
};

export type LayoutEngineDiagnostics = {
  enabled: boolean;
  mode: "catalog" | "builtins" | "legacy_fallback";
  selectedLayouts: SelectedLayout[];
  missingLayoutTypes: string[];
  slotBindingWarnings: string[];
  mergedAssetsCount: number;
};
