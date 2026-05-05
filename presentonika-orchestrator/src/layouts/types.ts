export type SlideType =
  | "cover"
  | "goals"
  | "hook"
  | "context"
  | "definition"
  | "bullets"
  | "comparison"
  | "twoCol"
  | "steps"
  | "timeline"
  | "examples"
  | "quiz"
  | "summary"
  | "visual_explanation";

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
  role?: string;
  claim?: string;
  titleIntent?: string;
  requiredSlotIds?: string[];
};

export type SelectedLayout = {
  slide: number;
  slideType: SlideType;
  resolvedSlideType?: SlideType;
  layoutId: string;
  source: "layouts-local" | "layouts" | "builtin";
  hadFallback: boolean;
  fallbackSlideType?: SlideType;
};

export type LayoutEngineDiagnostics = {
  enabled: boolean;
  mode: "catalog" | "builtins" | "legacy_fallback";
  dynamicPlanUsed?: boolean;
  deckPlanSlideCount?: number;
  compiledSlideTypes?: Array<{ slide: number; slideType: SlideType; role?: string; layoutSlideType?: SlideType }>;
  fallbackSlideTypeMappings?: Array<{ slide: number; requested: SlideType; resolved: SlideType; reason: string }>;
  fallbackSlotInferences?: Array<{ slide: number; slideType: SlideType; slots: string[] }>;
  unsupportedSlideTypes?: string[];
  dynamicBindings?: Array<{ slide: number; slotName: string; fillKey: string }>;
  missingSlotBindings?: string[];
  duplicateFillKeys?: string[];
  legacyEmergencyFallbackUsed?: boolean;
  selectedLayouts: SelectedLayout[];
  missingLayoutTypes: string[];
  slotBindingWarnings: string[];
  mergedAssetsCount: number;
};
