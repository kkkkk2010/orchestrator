import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import yazl from "yazl";
import type { LayoutPackManifest, SlideType } from "../layouts/types";

const WIDTH = 1536;
const HEIGHT = 864;
const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==",
  "base64",
);

type ElementRow = Record<string, unknown> & {
  id: string;
  type: "text" | "image" | "shape";
  meta?: Record<string, unknown>;
};

type LayoutDefinition = {
  slideType: SlideType;
  variant: LayoutVariant;
  elements: ElementRow[];
  maxTextDensity: "low" | "medium" | "high";
  preferredTextDensity: "low" | "medium" | "high";
  supportsLongBullets: boolean;
};

type LayoutVariant = "a" | "b" | "c";

type AdaptiveRole = "container" | "shadow" | "content" | "fixed" | "stretch";

type AdaptiveOptions = {
  adaptiveGroup?: string;
  adaptiveRole?: AdaptiveRole;
  adaptiveMinHeight?: number;
  adaptiveMaxHeight?: number;
  adaptiveBottomPadding?: number;
  adaptiveFlow?: string;
  adaptiveOrder?: number;
  adaptiveBalance?: string;
};

const meta = (values: Record<string, unknown>): Record<string, unknown> => values;

const shape = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  role: "surface" | "surfaceAlt" | "accent" | "accentSoft" | "highlight" | "highlightSoft" | "border" | "inverse" | "shadow",
  options: { radius?: number; opacity?: number; repeatGroup?: string; repeatIndex?: number; mediaGroup?: string; decorative?: boolean } & AdaptiveOptions = {},
): ElementRow => ({
  id,
  type: "shape",
  shapeType: "roundRect",
  x,
  y,
  width,
  height,
  style: {
    cornerRadius: options.radius ?? 28,
    ...(typeof options.opacity === "number" ? { opacity: options.opacity } : {}),
  },
  meta: meta({
    layoutThemeRole: role,
    ...(options.decorative ? { layoutRole: "decorative" } : {}),
    ...(options.repeatGroup ? { repeatGroup: options.repeatGroup, repeatIndex: options.repeatIndex } : {}),
    ...(options.mediaGroup ? { mediaGroup: options.mediaGroup } : {}),
    ...(options.adaptiveGroup ? { adaptiveGroup: options.adaptiveGroup } : {}),
    ...(options.adaptiveRole ? { adaptiveRole: options.adaptiveRole } : {}),
    ...(typeof options.adaptiveMinHeight === "number" ? { adaptiveMinHeight: options.adaptiveMinHeight } : {}),
    ...(typeof options.adaptiveMaxHeight === "number" ? { adaptiveMaxHeight: options.adaptiveMaxHeight } : {}),
    ...(typeof options.adaptiveBottomPadding === "number" ? { adaptiveBottomPadding: options.adaptiveBottomPadding } : {}),
    ...(options.adaptiveFlow ? { adaptiveFlow: options.adaptiveFlow } : {}),
    ...(typeof options.adaptiveOrder === "number" ? { adaptiveOrder: options.adaptiveOrder } : {}),
    ...(options.adaptiveBalance ? { adaptiveBalance: options.adaptiveBalance } : {}),
  }),
});

const slot = (
  slotId: string,
  role: string,
  x: number,
  y: number,
  width: number,
  height: number,
  options: { required?: boolean; bold?: boolean; align?: "left" | "center" | "right"; repeatGroup?: string; repeatIndex?: number } & AdaptiveOptions = {},
): ElementRow => ({
  id: `t_${slotId}`,
  type: "text",
  x,
  y,
  width,
  height,
  text: `{{slot:${slotId}}}`,
  style: {
    ...(options.bold ? { bold: true } : {}),
    ...(options.align ? { align: options.align } : {}),
  },
  meta: meta({
    layoutRole: role,
    slotId,
    required: options.required !== false,
    ...(options.repeatGroup ? { repeatGroup: options.repeatGroup, repeatIndex: options.repeatIndex } : {}),
    ...(options.adaptiveGroup ? { adaptiveGroup: options.adaptiveGroup } : {}),
    ...(options.adaptiveRole ? { adaptiveRole: options.adaptiveRole } : {}),
  }),
});

const fixedText = (
  id: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  textRole: "accent" | "onAccent" | "onHighlight" | "onInverse" | "muted",
  options: { fontSize?: number; bold?: boolean; align?: "left" | "center" | "right"; repeatGroup?: string; repeatIndex?: number } & AdaptiveOptions = {},
): ElementRow => ({
  id,
  type: "text",
  x,
  y,
  width,
  height,
  text,
  style: {
    fontFamily: "Inter",
    fontSize: options.fontSize ?? 17,
    lineHeight: 1,
    ...(options.bold !== false ? { bold: true } : {}),
    ...(options.align ? { align: options.align } : {}),
  },
  meta: meta({
    layoutTextRole: textRole,
    ...(options.repeatGroup ? { repeatGroup: options.repeatGroup, repeatIndex: options.repeatIndex } : {}),
    ...(options.adaptiveGroup ? { adaptiveGroup: options.adaptiveGroup } : {}),
    ...(options.adaptiveRole ? { adaptiveRole: options.adaptiveRole } : {}),
  }),
});

const card = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  role: "surface" | "surfaceAlt" | "accentSoft" | "highlightSoft",
  options: {
    radius?: number;
    minHeight: number;
    maxHeight: number;
    bottomPadding?: number;
    flow?: string;
    order?: number;
    balance?: string;
    repeatGroup?: string;
    repeatIndex?: number;
  },
): ElementRow[] => {
  const adaptive = {
    adaptiveGroup: id,
    adaptiveMinHeight: options.minHeight,
    adaptiveMaxHeight: options.maxHeight,
    adaptiveBottomPadding: options.bottomPadding ?? 36,
    adaptiveFlow: options.flow,
    adaptiveOrder: options.order,
    adaptiveBalance: options.balance,
    repeatGroup: options.repeatGroup,
    repeatIndex: options.repeatIndex,
  };
  return [
    shape(`${id}_shadow_ambient`, x + 2, y + 3, width, height, "shadow", {
      radius: options.radius ?? 28,
      opacity: 0.08,
      ...adaptive,
      adaptiveRole: "shadow",
    }),
    shape(`${id}_shadow_drop`, x + 6, y + 9, width, height, "shadow", {
      radius: options.radius ?? 28,
      opacity: 0.13,
      ...adaptive,
      adaptiveRole: "shadow",
    }),
    shape(id, x, y, width, height, role, {
      radius: options.radius ?? 28,
      ...adaptive,
      adaptiveRole: "container",
    }),
  ];
};

const image = (id: string, x: number, y: number, width: number, height: number, aspect: "portrait" | "landscape" = "landscape"): ElementRow => ({
  id,
  type: "image",
  name: "hero",
  x,
  y,
  width,
  height,
  src: "assets/images/ph_hero.png",
  objectFit: "cover",
  style: { borderRadius: 28, objectFit: "cover" },
  meta: meta({ placeholder: true, placeholderKey: "hero", layoutRole: "media", aspect, mediaGroup: id }),
});

const imageGroup = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  aspect: "portrait" | "landscape" = "landscape",
): ElementRow[] => [
  shape(`${id}_backdrop`, x, y, width, height, "accentSoft", { radius: 28, mediaGroup: id, decorative: true }),
  shape(`${id}_panel_a`, x + width * 0.08, y + height * 0.10, width * 0.46, height * 0.36, "surfaceAlt", { radius: 22, mediaGroup: id, decorative: true }),
  shape(`${id}_panel_b`, x + width * 0.60, y + height * 0.12, width * 0.28, height * 0.24, "highlightSoft", { radius: 18, mediaGroup: id, decorative: true }),
  shape(`${id}_rail_a`, x + width * 0.10, y + height * 0.52, width * 0.34, 10, "accent", { radius: 5, mediaGroup: id, decorative: true }),
  shape(`${id}_rail_b`, x + width * 0.50, y + height * 0.52, width * 0.20, 10, "highlight", { radius: 5, mediaGroup: id, decorative: true }),
  shape(`${id}_panel_c`, x + width * 0.10, y + height * 0.60, width * 0.78, height * 0.24, "surface", { radius: 20, mediaGroup: id, decorative: true }),
  image(id, x, y, width, height, aspect),
];

const accentRule = (id: string, x = 80, y = 72, width = 72): ElementRow => shape(id, x, y, width, 8, "accent", { radius: 4, decorative: true });

const mainTitle = (): ElementRow => slot("title", "title", 80, 92, 1376, 92, { bold: true });

const cover = (variant: LayoutVariant): LayoutDefinition => {
  if (variant === "c") {
    return {
      slideType: "cover",
      variant,
      maxTextDensity: "medium",
      preferredTextDensity: "low",
      supportsLongBullets: false,
      elements: [
        shape("media_shadow", 620, 92, 836, 704, "shadow", { radius: 36, opacity: 0.16, decorative: true }),
        ...imageGroup("i_hero", 610, 80, 846, 704, "landscape"),
        shape("panel_shadow", 90, 168, 700, 544, "shadow", { radius: 34, opacity: 0.15, decorative: true }),
        shape("cover_panel", 80, 154, 700, 544, "surface", { radius: 34 }),
        shape("brand_chip", 112, 190, 190, 46, "accent", { radius: 23 }),
        fixedText("brand_label", "PRESENTONIKA", 132, 204, 150, 22, "onAccent", { fontSize: 15 }),
        slot("title", "title", 112, 284, 610, 176, { bold: true }),
        slot("subtitle", "subtitle", 112, 490, 590, 88, { required: false }),
        slot("meta", "meta", 112, 624, 580, 48, { required: false }),
      ],
    };
  }
  const media = variant === "a" ? { x: 914, textX: 80 } : { x: 80, textX: 700 };
  return {
    slideType: "cover",
    variant,
    maxTextDensity: "medium",
    preferredTextDensity: "low",
    supportsLongBullets: false,
    elements: [
      shape("media_shadow", media.x + 10, 122, 542, 620, "shadow", { radius: 34, opacity: 0.16 }),
      shape("media_frame", media.x - 14, 96, 542, 620, "accentSoft", { radius: 34 }),
      shape("brand_chip", media.textX, 92, 190, 46, "accent", { radius: 23 }),
      ...imageGroup("i_hero", media.x, 110, 520, 610, "portrait"),
      fixedText("brand_label", "PRESENTONIKA", media.textX + 20, 106, 150, 22, "onAccent", { fontSize: 15 }),
      slot("title", "title", media.textX, 190, 770, 190, { bold: true }),
      slot("subtitle", "subtitle", media.textX, 410, 720, 104, { required: false }),
      slot("meta", "meta", media.textX, 610, 700, 60, { required: false }),
    ],
  };
};

const goals = (variant: "a" | "b"): LayoutDefinition => ({
  slideType: "goals",
  variant,
  maxTextDensity: "medium",
  preferredTextDensity: variant === "a" ? "low" : "high",
  supportsLongBullets: false,
  elements: variant === "a"
    ? [
        accentRule("title_rule"),
        ...card("goals_card", 80, 222, 660, 512, "surface", { radius: 30, minHeight: 246, maxHeight: 430, bottomPadding: 42, balance: "goals_row" }),
        ...card("plan_card", 780, 222, 676, 512, "surfaceAlt", { radius: 30, minHeight: 246, maxHeight: 430, bottomPadding: 42, balance: "goals_row" }),
        shape("goals_chip", 112, 250, 62, 62, "accent", { radius: 20, adaptiveGroup: "goals_card", adaptiveRole: "fixed" }),
        shape("plan_chip", 812, 250, 62, 62, "highlight", { radius: 20, adaptiveGroup: "plan_card", adaptiveRole: "fixed" }),
        fixedText("goals_no", "01", 112, 270, 62, 24, "onAccent", { fontSize: 18, align: "center", adaptiveGroup: "goals_card", adaptiveRole: "fixed" }),
        fixedText("plan_no", "02", 812, 270, 62, 24, "onHighlight", { fontSize: 18, align: "center", adaptiveGroup: "plan_card", adaptiveRole: "fixed" }),
        mainTitle(),
        slot("goals", "bullets", 120, 344, 560, 330, { adaptiveGroup: "goals_card", adaptiveRole: "content" }),
        slot("plan", "bullets", 820, 344, 570, 330, { adaptiveGroup: "plan_card", adaptiveRole: "content" }),
      ]
    : [
        accentRule("title_rule"),
        ...card("goals_card", 80, 236, 1376, 202, "surface", { radius: 28, minHeight: 176, maxHeight: 246, bottomPadding: 30, flow: "goals_stack", order: 1 }),
        ...card("plan_card", 80, 476, 1376, 202, "surfaceAlt", { radius: 28, minHeight: 176, maxHeight: 246, bottomPadding: 30, flow: "goals_stack", order: 2 }),
        shape("goals_chip", 108, 267, 72, 140, "accent", { radius: 22, adaptiveGroup: "goals_card", adaptiveRole: "fixed" }),
        shape("plan_chip", 108, 507, 72, 140, "highlight", { radius: 22, adaptiveGroup: "plan_card", adaptiveRole: "fixed" }),
        fixedText("goals_no", "01", 108, 322, 72, 30, "onAccent", { fontSize: 19, align: "center", adaptiveGroup: "goals_card", adaptiveRole: "fixed" }),
        fixedText("plan_no", "02", 108, 562, 72, 30, "onHighlight", { fontSize: 19, align: "center", adaptiveGroup: "plan_card", adaptiveRole: "fixed" }),
        mainTitle(),
        slot("goals", "bullets", 220, 270, 1160, 130, { adaptiveGroup: "goals_card", adaptiveRole: "content" }),
        slot("plan", "bullets", 220, 510, 1160, 130, { adaptiveGroup: "plan_card", adaptiveRole: "content" }),
      ],
});

const hook = (variant: "a" | "b"): LayoutDefinition => {
  const mediaX = variant === "a" ? 910 : 80;
  const contentX = variant === "a" ? 80 : 662;
  return {
    slideType: "hook",
    variant,
    maxTextDensity: "medium",
    preferredTextDensity: "low",
    supportsLongBullets: false,
    elements: [
      accentRule("title_rule"),
      ...card("question_card", contentX, 214, 760, 186, "accentSoft", { radius: 30, minHeight: 154, maxHeight: 220, bottomPadding: 28 }),
      ...card("hint_card", contentX, 436, 236, 276, "surface", { radius: 26, minHeight: 188, maxHeight: 276, bottomPadding: 28, balance: "hook_tiles" }),
      ...card("fact_card", contentX + 262, 436, 236, 276, "surfaceAlt", { radius: 26, minHeight: 188, maxHeight: 276, bottomPadding: 28, balance: "hook_tiles" }),
      ...card("why_card", contentX + 524, 436, 236, 276, "highlightSoft", { radius: 26, minHeight: 188, maxHeight: 276, bottomPadding: 28, balance: "hook_tiles" }),
      shape("media_shadow", mediaX + 9, 224, 546, 498, "shadow", { radius: 32, opacity: 0.15 }),
      ...imageGroup("i_hero", mediaX, 214, 546, 498, "portrait"),
      fixedText("question_label", "ВОПРОС", contentX + 34, 242, 130, 22, "accent", { fontSize: 15, adaptiveGroup: "question_card", adaptiveRole: "fixed" }),
      fixedText("hint_label", "ПОДСКАЗКА", contentX + 28, 464, 170, 22, "accent", { fontSize: 14, adaptiveGroup: "hint_card", adaptiveRole: "fixed" }),
      fixedText("fact_label", "ФАКТ", contentX + 290, 464, 150, 22, "accent", { fontSize: 14, adaptiveGroup: "fact_card", adaptiveRole: "fixed" }),
      fixedText("why_label", "ПОЧЕМУ ЭТО ВАЖНО", contentX + 552, 464, 180, 22, "accent", { fontSize: 13, adaptiveGroup: "why_card", adaptiveRole: "fixed" }),
      mainTitle(),
      slot("hook_question", "sectionTitle", contentX + 34, 282, 690, 86, { bold: true, adaptiveGroup: "question_card", adaptiveRole: "content" }),
      slot("hook_hint", "body", contentX + 28, 510, 180, 176, { adaptiveGroup: "hint_card", adaptiveRole: "content" }),
      slot("hook_fact", "body", contentX + 290, 510, 180, 176, { adaptiveGroup: "fact_card", adaptiveRole: "content" }),
      slot("hook_why", "body", contentX + 552, 510, 180, 176, { adaptiveGroup: "why_card", adaptiveRole: "content" }),
    ],
  };
};

const definition = (variant: LayoutVariant): LayoutDefinition => {
  if (variant === "c") {
    return {
      slideType: "definition",
      variant,
      maxTextDensity: "medium",
      preferredTextDensity: "low",
      supportsLongBullets: false,
      elements: [
        accentRule("title_rule"),
        shape("media_shadow", 86, 222, 1376, 226, "shadow", { radius: 30, opacity: 0.14, decorative: true }),
        ...imageGroup("i_hero", 80, 212, 1376, 226, "landscape"),
        ...card("definition_card", 80, 474, 876, 260, "surface", { radius: 28, minHeight: 180, maxHeight: 260, bottomPadding: 34, balance: "definition_c_row" }),
        ...card("keywords_card", 988, 474, 468, 260, "accentSoft", { radius: 28, minHeight: 180, maxHeight: 260, bottomPadding: 34, balance: "definition_c_row" }),
        fixedText("definition_label", "КЛЮЧЕВАЯ МЫСЛЬ", 114, 506, 230, 22, "accent", { fontSize: 15, adaptiveGroup: "definition_card", adaptiveRole: "fixed" }),
        fixedText("keywords_label", "ОПОРНЫЕ ПОНЯТИЯ", 1022, 506, 240, 22, "accent", { fontSize: 14, adaptiveGroup: "keywords_card", adaptiveRole: "fixed" }),
        mainTitle(),
        slot("definition", "body", 114, 558, 808, 132, { adaptiveGroup: "definition_card", adaptiveRole: "content" }),
        slot("keywords", "body", 1022, 558, 400, 132, { adaptiveGroup: "keywords_card", adaptiveRole: "content" }),
      ],
    };
  }
  const mediaX = variant === "a" ? 930 : 80;
  const contentX = variant === "a" ? 80 : 656;
  return {
    slideType: "definition",
    variant,
    maxTextDensity: "high",
    preferredTextDensity: "medium",
    supportsLongBullets: false,
    elements: [
      accentRule("title_rule"),
      ...card("definition_card", contentX, 222, 800, 286, "surface", { radius: 30, minHeight: 190, maxHeight: 354, bottomPadding: 38, flow: "definition_stack", order: 1 }),
      ...card("keywords_card", contentX, 538, 800, 176, "accentSoft", { radius: 28, minHeight: 142, maxHeight: 222, bottomPadding: 28, flow: "definition_stack", order: 2 }),
      shape("media_shadow", mediaX + 9, 232, 526, 492, "shadow", { radius: 32, opacity: 0.15 }),
      ...imageGroup("i_hero", mediaX, 222, 526, 492, "portrait"),
      fixedText("definition_label", "КЛЮЧЕВАЯ МЫСЛЬ", contentX + 34, 250, 230, 22, "accent", { fontSize: 15, adaptiveGroup: "definition_card", adaptiveRole: "fixed" }),
      fixedText("keywords_label", "ОПОРНЫЕ ПОНЯТИЯ", contentX + 34, 566, 240, 22, "accent", { fontSize: 14, adaptiveGroup: "keywords_card", adaptiveRole: "fixed" }),
      mainTitle(),
      slot("definition", "body", contentX + 34, 302, 730, 162, { adaptiveGroup: "definition_card", adaptiveRole: "content" }),
      slot("keywords", "body", contentX + 34, 614, 730, 64, { adaptiveGroup: "keywords_card", adaptiveRole: "content" }),
    ],
  };
};

const mediaBody = (slideType: "bullets" | "examples" | "visual_explanation", variant: LayoutVariant): LayoutDefinition => {
  const mediaX = variant === "a" ? 930 : 80;
  const contentX = variant === "a" ? 80 : 656;
  const contentSlot = slideType === "examples" ? "examples" : "bullets";
  const contentLabel = slideType === "examples"
    ? "ПРИМЕРЫ И ДОКАЗАТЕЛЬСТВА"
    : slideType === "visual_explanation"
      ? "КАК ЭТО УСТРОЕНО"
      : "ГЛАВНОЕ";
  if (variant === "c") {
    return {
      slideType,
      variant,
      maxTextDensity: "medium",
      preferredTextDensity: "low",
      supportsLongBullets: false,
      elements: [
        accentRule("title_rule"),
        shape("media_shadow", 86, 224, 1376, 230, "shadow", { radius: 30, opacity: 0.14, decorative: true }),
        ...imageGroup("i_hero", 80, 214, 1376, 230, "landscape"),
        ...card("content_card", 80, 474, 1376, 284, "surface", { radius: 30, minHeight: 176, maxHeight: 284, bottomPadding: 38 }),
        shape("content_accent", 80, 474, 14, 284, slideType === "bullets" ? "accent" : "highlight", { radius: 7, adaptiveGroup: "content_card", adaptiveRole: "stretch", decorative: true }),
        fixedText("content_label", contentLabel, 124, 506, 340, 22, "accent", { fontSize: 14, adaptiveGroup: "content_card", adaptiveRole: "fixed" }),
        mainTitle(),
        slot(contentSlot, "bullets", 124, 556, 1280, 160, { adaptiveGroup: "content_card", adaptiveRole: "content" }),
      ],
    };
  }
  return {
    slideType,
    variant,
    maxTextDensity: "high",
    preferredTextDensity: slideType === "examples" ? "high" : "medium",
    supportsLongBullets: true,
    elements: [
      accentRule("title_rule"),
      ...card("content_card", contentX, 218, 800, 506, "surface", { radius: 30, minHeight: 238, maxHeight: 506, bottomPadding: 48 }),
      shape("content_accent", contentX, 218, 12, 506, slideType === "bullets" ? "accent" : "highlight", { radius: 6, adaptiveGroup: "content_card", adaptiveRole: "stretch" }),
      shape("media_shadow", mediaX + 9, 228, 526, 506, "shadow", { radius: 32, opacity: 0.15 }),
      ...imageGroup("i_hero", mediaX, 218, 526, 506, "portrait"),
      fixedText("content_label", contentLabel, contentX + 42, 250, 330, 22, "accent", { fontSize: 14, adaptiveGroup: "content_card", adaptiveRole: "fixed" }),
      mainTitle(),
      slot(contentSlot, "bullets", contentX + 42, 304, 718, 360, { adaptiveGroup: "content_card", adaptiveRole: "content" }),
    ],
  };
};

const twoCol = (variant: LayoutVariant): LayoutDefinition => ({
  slideType: "twoCol",
  variant,
  maxTextDensity: "high",
  preferredTextDensity: "medium",
  supportsLongBullets: true,
  elements: variant === "c"
    ? [
        accentRule("title_rule"),
        ...card("comparison_panel", 80, 222, 1376, 504, "surface", { radius: 30, minHeight: 340, maxHeight: 504, bottomPadding: 42 }),
        shape("left_header", 102, 246, 642, 62, "accentSoft", { radius: 20, decorative: true }),
        shape("right_header", 792, 246, 642, 62, "highlightSoft", { radius: 20, decorative: true }),
        shape("comparison_divider", 767, 330, 2, 210, "border", { radius: 1, decorative: true }),
        shape("left_marker", 136, 278, 72, 10, "accent", { radius: 5, decorative: true }),
        shape("right_marker", 826, 278, 72, 10, "highlight", { radius: 5, decorative: true }),
        mainTitle(),
        slot("left_title", "sectionTitle", 136, 320, 560, 68, { bold: true, adaptiveGroup: "comparison_panel", adaptiveRole: "content" }),
        slot("left_bullets", "bullets", 136, 410, 560, 238, { adaptiveGroup: "comparison_panel", adaptiveRole: "content" }),
        slot("right_title", "sectionTitle", 826, 320, 560, 68, { bold: true, adaptiveGroup: "comparison_panel", adaptiveRole: "content" }),
        slot("right_bullets", "bullets", 826, 410, 560, 238, { adaptiveGroup: "comparison_panel", adaptiveRole: "content" }),
      ]
    : variant === "a"
    ? [
        accentRule("title_rule"),
        ...card("left_card", 80, 220, 650, 510, "surface", { radius: 30, minHeight: 270, maxHeight: 510, bottomPadding: 48, balance: "two_col_row" }),
        ...card("right_card", 806, 220, 650, 510, "surfaceAlt", { radius: 30, minHeight: 270, maxHeight: 510, bottomPadding: 48, balance: "two_col_row" }),
        shape("left_marker", 112, 252, 60, 12, "accent", { radius: 6, adaptiveGroup: "left_card", adaptiveRole: "fixed" }),
        shape("right_marker", 838, 252, 60, 12, "highlight", { radius: 6, adaptiveGroup: "right_card", adaptiveRole: "fixed" }),
        mainTitle(),
        slot("left_title", "sectionTitle", 112, 294, 560, 74, { bold: true, adaptiveGroup: "left_card", adaptiveRole: "content" }),
        slot("left_bullets", "bullets", 112, 390, 560, 280, { adaptiveGroup: "left_card", adaptiveRole: "content" }),
        slot("right_title", "sectionTitle", 838, 294, 560, 74, { bold: true, adaptiveGroup: "right_card", adaptiveRole: "content" }),
        slot("right_bullets", "bullets", 838, 390, 560, 280, { adaptiveGroup: "right_card", adaptiveRole: "content" }),
      ]
    : [
        accentRule("title_rule"),
        ...card("left_tint", 104, 244, 642, 462, "accentSoft", { radius: 26, minHeight: 250, maxHeight: 462, bottomPadding: 46, balance: "comparison_row" }),
        ...card("right_tint", 790, 244, 642, 462, "highlightSoft", { radius: 26, minHeight: 250, maxHeight: 462, bottomPadding: 46, balance: "comparison_row" }),
        mainTitle(),
        slot("left_title", "sectionTitle", 138, 282, 560, 74, { bold: true, adaptiveGroup: "left_tint", adaptiveRole: "content" }),
        slot("left_bullets", "bullets", 138, 384, 560, 270, { adaptiveGroup: "left_tint", adaptiveRole: "content" }),
        slot("right_title", "sectionTitle", 824, 282, 560, 74, { bold: true, adaptiveGroup: "right_tint", adaptiveRole: "content" }),
        slot("right_bullets", "bullets", 824, 384, 560, 270, { adaptiveGroup: "right_tint", adaptiveRole: "content" }),
      ],
});

const steps = (variant: LayoutVariant): LayoutDefinition => {
  const elements: ElementRow[] = [accentRule("title_rule")];
  if (variant === "c") {
    elements.push(shape("timeline_rail", 158, 332, 1220, 8, "accentSoft", { radius: 4, decorative: true }));
    [80, 424, 768, 1112].forEach((x, index) => {
      const n = index + 1;
      elements.push(
        ...card(`step_card_${n}`, x, 270, 316, 440, index % 2 === 0 ? "surface" : "surfaceAlt", { radius: 28, minHeight: 220, maxHeight: 340, bottomPadding: 34, balance: "steps_c_row", repeatGroup: "steps", repeatIndex: n }),
        shape(`step_chip_${n}`, x + 24, 300, 64, 64, n === 4 ? "highlight" : "accent", { radius: 20, repeatGroup: "steps", repeatIndex: n, adaptiveGroup: `step_card_${n}`, adaptiveRole: "fixed" }),
        fixedText(`step_no_${n}`, String(n).padStart(2, "0"), x + 24, 321, 64, 22, n === 4 ? "onHighlight" : "onAccent", { fontSize: 17, align: "center", repeatGroup: "steps", repeatIndex: n, adaptiveGroup: `step_card_${n}`, adaptiveRole: "fixed" }),
        slot(`step${n}`, "step", x + 24, 398, 268, 250, { repeatGroup: "steps", repeatIndex: n, adaptiveGroup: `step_card_${n}`, adaptiveRole: "content" }),
      );
    });
  } else if (variant === "a") {
    elements.push(
      shape("media_shadow", 1052, 230, 404, 504, "shadow", { radius: 32, opacity: 0.15 }),
      ...imageGroup("i_hero", 1042, 220, 414, 504, "portrait"),
    );
    const positions = [[80, 220], [556, 220], [80, 484], [556, 484]] as const;
    positions.forEach(([x, y], index) => {
      const n = index + 1;
      const isLeft = index % 2 === 0;
      const row = index < 2 ? 1 : 2;
      elements.push(
        ...card(`step_card_${n}`, x, y, 430, 240, index % 2 === 0 ? "surface" : "surfaceAlt", { radius: 28, minHeight: 154, maxHeight: 230, bottomPadding: 32, balance: `steps_row_${row}`, flow: isLeft ? "steps_left" : "steps_right", order: row, repeatGroup: "steps", repeatIndex: n }),
        shape(`step_chip_${n}`, x + 28, y + 28, 52, 52, n === 4 ? "highlight" : "accent", { radius: 18, repeatGroup: "steps", repeatIndex: n, adaptiveGroup: `step_card_${n}`, adaptiveRole: "fixed" }),
        fixedText(`step_no_${n}`, String(n).padStart(2, "0"), x + 28, y + 45, 52, 22, n === 4 ? "onHighlight" : "onAccent", { fontSize: 16, align: "center", repeatGroup: "steps", repeatIndex: n, adaptiveGroup: `step_card_${n}`, adaptiveRole: "fixed" }),
        slot(`step${n}`, "step", x + 102, y + 34, 292, 164, { repeatGroup: "steps", repeatIndex: n, adaptiveGroup: `step_card_${n}`, adaptiveRole: "content" }),
      );
    });
  } else {
    elements.push(...imageGroup("i_hero", 1166, 220, 290, 500, "portrait"));
    const ys = [220, 348, 476, 604];
    ys.forEach((y, index) => {
      const n = index + 1;
      elements.push(
        ...card(`step_card_${n}`, 80, y, 1046, 104, index % 2 === 0 ? "surface" : "surfaceAlt", { radius: 24, minHeight: 92, maxHeight: 132, bottomPadding: 22, flow: "steps_list", order: n, repeatGroup: "steps", repeatIndex: n }),
        shape(`step_chip_${n}`, 104, y + 20, 64, 64, n === 4 ? "highlight" : "accent", { radius: 20, repeatGroup: "steps", repeatIndex: n, adaptiveGroup: `step_card_${n}`, adaptiveRole: "fixed" }),
        fixedText(`step_no_${n}`, String(n).padStart(2, "0"), 104, y + 41, 64, 22, n === 4 ? "onHighlight" : "onAccent", { fontSize: 17, align: "center", repeatGroup: "steps", repeatIndex: n, adaptiveGroup: `step_card_${n}`, adaptiveRole: "fixed" }),
        slot(`step${n}`, "step", 198, y + 24, 880, 58, { repeatGroup: "steps", repeatIndex: n, adaptiveGroup: `step_card_${n}`, adaptiveRole: "content" }),
      );
    });
  }
  elements.push(mainTitle());
  return { slideType: "steps", variant, elements, maxTextDensity: "medium", preferredTextDensity: variant === "c" ? "low" : variant === "a" ? "medium" : "high", supportsLongBullets: false };
};

const quiz = (variant: "a" | "b"): LayoutDefinition => {
  const mediaX = variant === "a" ? 80 : 976;
  const contentX = variant === "a" ? 600 : 80;
  const elements: ElementRow[] = [
    accentRule("title_rule"),
    ...card("task_card", contentX, 216, 856, 112, "accentSoft", { radius: 26, minHeight: 104, maxHeight: 132, bottomPadding: 20 }),
    shape("media_shadow", mediaX + 9, 226, 480, 506, "shadow", { radius: 32, opacity: 0.15 }),
    ...imageGroup("i_hero", mediaX, 216, 480, 506, "portrait"),
    fixedText("task_label", "ЗАДАНИЕ", contentX + 30, 242, 130, 22, "accent", { fontSize: 14, adaptiveGroup: "task_card", adaptiveRole: "fixed" }),
    slot("task", "task", contentX + 170, 235, 640, 62, { adaptiveGroup: "task_card", adaptiveRole: "content" }),
  ];
  [366, 486, 606].forEach((y, index) => {
    const n = index + 1;
    elements.push(
      ...card(`question_card_${n}`, contentX, y, 856, 96, index === 2 ? "highlightSoft" : "surface", { radius: 24, minHeight: 92, maxHeight: 126, bottomPadding: 20, flow: "quiz_questions", order: n, repeatGroup: "questions", repeatIndex: n }),
      shape(`question_chip_${n}`, contentX + 22, y + 20, 56, 56, index === 2 ? "highlight" : "accent", { radius: 18, repeatGroup: "questions", repeatIndex: n, adaptiveGroup: `question_card_${n}`, adaptiveRole: "fixed" }),
      fixedText(`question_no_${n}`, String(n).padStart(2, "0"), contentX + 22, y + 38, 56, 22, index === 2 ? "onHighlight" : "onAccent", { fontSize: 15, align: "center", repeatGroup: "questions", repeatIndex: n, adaptiveGroup: `question_card_${n}`, adaptiveRole: "fixed" }),
      slot(`q${n}`, "question", contentX + 102, y + 20, 710, 56, { repeatGroup: "questions", repeatIndex: n, adaptiveGroup: `question_card_${n}`, adaptiveRole: "content" }),
    );
  });
  elements.push(mainTitle());
  return { slideType: "quiz", variant, elements, maxTextDensity: "medium", preferredTextDensity: "medium", supportsLongBullets: false };
};

const summary = (variant: LayoutVariant): LayoutDefinition => {
  if (variant === "c") {
    return {
      slideType: "summary",
      variant,
      maxTextDensity: "high",
      preferredTextDensity: "medium",
      supportsLongBullets: true,
      elements: [
        accentRule("title_rule"),
        ...card("summary_card", 80, 220, 920, 300, "surface", { radius: 30, minHeight: 220, maxHeight: 300, bottomPadding: 38 }),
        shape("media_shadow", 1040, 230, 416, 290, "shadow", { radius: 30, opacity: 0.14, decorative: true }),
        ...imageGroup("i_hero", 1030, 220, 426, 290, "landscape"),
        ...card("homework_card", 80, 552, 650, 154, "highlightSoft", { radius: 26, minHeight: 120, maxHeight: 154, bottomPadding: 26, balance: "summary_c_bottom" }),
        ...card("sources_card", 762, 552, 694, 154, "surfaceAlt", { radius: 26, minHeight: 120, maxHeight: 154, bottomPadding: 24, balance: "summary_c_bottom" }),
        fixedText("summary_label", "ИТОГ", 114, 250, 120, 22, "accent", { fontSize: 14, adaptiveGroup: "summary_card", adaptiveRole: "fixed" }),
        fixedText("homework_label", "СЛЕДУЮЩИЙ ШАГ", 112, 580, 210, 22, "accent", { fontSize: 14, adaptiveGroup: "homework_card", adaptiveRole: "fixed" }),
        fixedText("sources_label", "ИСТОЧНИКИ", 794, 580, 180, 22, "accent", { fontSize: 14, adaptiveGroup: "sources_card", adaptiveRole: "fixed" }),
        mainTitle(),
        slot("summary", "summary", 114, 302, 852, 164, { adaptiveGroup: "summary_card", adaptiveRole: "content" }),
        slot("homework", "homework", 112, 624, 586, 50, { required: false, adaptiveGroup: "homework_card", adaptiveRole: "content" }),
        slot("sources", "sources", 794, 624, 630, 50, { adaptiveGroup: "sources_card", adaptiveRole: "content" }),
      ],
    };
  }
  const mediaX = variant === "a" ? 900 : 80;
  const contentX = variant === "a" ? 80 : 656;
  return {
    slideType: "summary",
    variant,
    maxTextDensity: "high",
    preferredTextDensity: "medium",
    supportsLongBullets: true,
    elements: [
      accentRule("title_rule"),
      ...card("summary_card", contentX, 220, 760, 318, "surface", { radius: 30, minHeight: 240, maxHeight: 318, bottomPadding: 38, flow: "summary_stack", order: 1 }),
      ...card("homework_card", contentX, 558, 760, 142, "highlightSoft", { radius: 28, minHeight: 132, maxHeight: 142, bottomPadding: 24, flow: "summary_stack", order: 2 }),
      shape("media_shadow", mediaX + 9, 230, 556, 354, "shadow", { radius: 32, opacity: 0.15 }),
      ...card("sources_card", mediaX, 616, 556, 84, "surfaceAlt", { radius: 22, minHeight: 80, maxHeight: 116, bottomPadding: 18 }),
      ...imageGroup("i_hero", mediaX, 220, 556, 354, "landscape"),
      fixedText("summary_label", "ИТОГ", contentX + 34, 248, 120, 22, "accent", { fontSize: 14, adaptiveGroup: "summary_card", adaptiveRole: "fixed" }),
      fixedText("homework_label", "СЛЕДУЮЩИЙ ШАГ", contentX + 34, 584, 210, 22, "accent", { fontSize: 14, adaptiveGroup: "homework_card", adaptiveRole: "fixed" }),
      mainTitle(),
      slot("summary", "summary", contentX + 34, 300, 690, 194, { adaptiveGroup: "summary_card", adaptiveRole: "content" }),
      slot("homework", "homework", contentX + 34, 626, 690, 42, { required: false, adaptiveGroup: "homework_card", adaptiveRole: "content" }),
      slot("sources", "sources", mediaX + 24, 638, 508, 42, { adaptiveGroup: "sources_card", adaptiveRole: "content" }),
    ],
  };
};

const context = (variant: LayoutVariant): LayoutDefinition => ({ ...definition(variant), slideType: "context" });
const comparison = (variant: LayoutVariant): LayoutDefinition => ({ ...twoCol(variant), slideType: "comparison" });
const timeline = (variant: LayoutVariant): LayoutDefinition => ({ ...steps(variant), slideType: "timeline" });

const definitions = (): LayoutDefinition[] => [
  cover("a"), cover("b"), cover("c"), goals("a"), goals("b"), hook("a"), hook("b"),
  context("a"), context("b"), context("c"), definition("a"), definition("b"), definition("c"),
  mediaBody("bullets", "a"), mediaBody("bullets", "b"), mediaBody("bullets", "c"),
  mediaBody("visual_explanation", "a"), mediaBody("visual_explanation", "b"), mediaBody("visual_explanation", "c"),
  mediaBody("examples", "a"), mediaBody("examples", "b"), mediaBody("examples", "c"),
  comparison("a"), comparison("b"), comparison("c"), twoCol("a"), twoCol("b"), twoCol("c"),
  timeline("a"), timeline("b"), timeline("c"), steps("a"), steps("b"), steps("c"),
  quiz("a"), quiz("b"), summary("a"), summary("b"), summary("c"),
];

const writeZip = async (zipPath: string, doc: unknown, hasImage: boolean): Promise<void> => {
  const writer = new yazl.ZipFile();
  const output = fs.createWriteStream(zipPath);
  writer.outputStream.pipe(output);
  writer.addBuffer(Buffer.from(JSON.stringify(doc, null, 2), "utf8"), "doc.json");
  if (hasImage) writer.addBuffer(PLACEHOLDER_PNG, "assets/images/ph_hero.png");
  writer.end();
  await new Promise<void>((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
  });
};

const buildManifest = (id: string, definition: LayoutDefinition): LayoutPackManifest => {
  const textSlots = definition.elements.flatMap((element, index) => {
    const slotId = typeof element.meta?.slotId === "string" ? element.meta.slotId : null;
    if (element.type !== "text" || !slotId) return [];
    return [{
      slotId,
      role: typeof element.meta?.layoutRole === "string" ? element.meta.layoutRole : "body",
      required: element.meta?.required !== false,
      path: `slides[0].elements[${index}].text`,
    }];
  });
  const imageSlots = definition.elements.flatMap((element, index) => {
    if (element.type !== "image" || element.meta?.placeholderKey !== "hero") return [];
    return [{ slotId: "hero", required: false, elementIndex: index, kind: "photo" as const, aspect: element.meta.aspect === "portrait" ? "portrait" as const : "landscape" as const }];
  });

  return {
    id,
    version: 2,
    slideType: definition.slideType,
    tags: ["presentonika", "education", "gamma-like", definition.variant === "a" ? "primary" : definition.variant === "b" ? "alternate" : "editorial"],
    seedWeight: definition.variant === "a" ? 45 : definition.variant === "b" ? 30 : 25,
    textSlots,
    imageSlots,
    constraints: {
      maxTextDensity: definition.maxTextDensity,
      preferredTextDensity: definition.preferredTextDensity,
      supportsLongBullets: definition.supportsLongBullets,
      supportsNoImage: true,
    },
  };
};

export const buildGammaLayoutPacks = async (root = path.resolve(process.env.LAYOUT_ENGINE_DIR || "layouts-local")): Promise<string[]> => {
  const ids: string[] = [];
  for (const definition of definitions()) {
    const id = `edu-${definition.slideType}-${definition.variant}`;
    const packDir = path.join(root, id);
    await fsPromises.mkdir(packDir, { recursive: true });
    const doc = {
      schemaVersion: 1,
      slideSize: { width: WIDTH, height: HEIGHT, unit: "px" },
      slides: [{ id: "layout_slide_1", width: WIDTH, height: HEIGHT, elements: definition.elements }],
    };
    const manifest = buildManifest(id, definition);
    await fsPromises.writeFile(path.join(packDir, "layout.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await writeZip(path.join(packDir, "layout.out.zip"), doc, manifest.imageSlots.length > 0);
    ids.push(id);
  }
  return ids;
};

if (require.main === module) {
  buildGammaLayoutPacks()
    .then((ids) => console.log(`gamma layouts built: ${ids.length}\n${ids.join("\n")}`))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
