import type { PlaceholderLocation } from "./applyFills";

export type StyleRole = "title" | "subtitle" | "body" | "small" | "muted" | "bullets";

type TextKind = "title" | "bullets" | "body";

export type TypographyConfig = {
  fontFamily: string;
  scale: number;
  sizes: Record<StyleRole, number>;
  lineHeights: Record<StyleRole, number>;
  colors: {
    title: string;
    body: string;
    muted: string;
  };
  mode: "dark" | "light";
};

export type TextFitItem = {
  key: string;
  role: StyleRole;
  slide: number;
  elementIndex: number;
  baseFontSize: number;
  origFontSize: number;
  finalFontSize: number;
  textLen: number;
  maxCharsEst: number;
  wasShrunk: boolean;
  wasTruncated: boolean;
};

export type TextFitStats = {
  overflowCount: number;
  truncatedCount: number;
  items: TextFitItem[];
};

export type TypographyApplyStats = {
  touched: number;
  colorsApplied: boolean;
  themeColorMode: "dark" | "light";
};

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const readNum = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

const clip = (value: string, max: number): string => {
  if (value.length <= max) return value;
  const safe = Math.max(1, max - 1);
  return `${value.slice(0, safe)}…`;
};

const parseTypographyScale = (): number => {
  const raw = Number.parseFloat(process.env.TYPOGRAPHY_SCALE || "1");
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.min(1.5, Math.max(0.75, raw));
};

const guessKind = (key: string): TextKind => {
  const normalized = key.toLowerCase();
  if (normalized.includes("title") || normalized.includes("header")) return "title";
  if (normalized.includes("bullets") || normalized.includes("list") || normalized.includes("points") || normalized.includes("step")) return "bullets";
  return "body";
};

export const styleRoleByKey = (key: string): StyleRole => {
  const normalized = key.toLowerCase();
  if (/(^|_)(title|header)$/.test(normalized) || /^s\d+_title$/.test(normalized)) return "title";
  if (normalized.endsWith("_subtitle") || normalized.includes("subtitle")) return "subtitle";
  if (normalized.endsWith("_meta") || normalized.endsWith("_sources") || normalized.includes("sources")) return "muted";
  if (/(?:_bullets|_plan|_goals|_examples|_task|_q\d+|_step\d+)$/i.test(normalized)) return "bullets";
  if (normalized.endsWith("_small")) return "small";
  return "body";
};

const defaultTypography = (themeId: string): TypographyConfig => {
  const normalized = themeId.toLowerCase();
  const dark = normalized.includes("dark");

  if (dark) {
    return {
      fontFamily: process.env.FONT_FAMILY_DEFAULT || "Times New Roman",
      scale: parseTypographyScale(),
      sizes: { title: 48, subtitle: 30, body: 24, small: 16, muted: 16, bullets: 22 },
      lineHeights: { title: 1.06, subtitle: 1.12, body: 1.22, small: 1.15, muted: 1.15, bullets: 1.18 },
      colors: { title: "#FFFFFF", body: "#F2F2F2", muted: "#CFCFCF" },
      mode: "dark",
    };
  }

  const isLight = normalized.includes("light");
  return {
    fontFamily: process.env.FONT_FAMILY_DEFAULT || "Times New Roman",
    scale: parseTypographyScale(),
    sizes: { title: 48, subtitle: 30, body: 24, small: 16, muted: 16, bullets: 22 },
    lineHeights: { title: 1.06, subtitle: 1.12, body: 1.22, small: 1.15, muted: 1.15, bullets: 1.18 },
    colors: isLight
      ? { title: "#111111", body: "#222222", muted: "#555555" }
      : { title: "#111111", body: "#111111", muted: "#444444" },
    mode: "light",
  };
};

export const resolveThemeTypography = (themeId: string, theme: unknown): TypographyConfig => {
  const base = defaultTypography(themeId);
  const typography = toRecord(toRecord(theme)?.typography);
  const sizes = toRecord(typography?.sizes);
  const lineHeights = toRecord(typography?.lineHeights);
  const colors = toRecord(typography?.colors);
  const useThemeSizes = process.env.TYPOGRAPHY_USE_THEME_SIZES === "true";
  const forcedFontFamily = (process.env.FONT_FAMILY_DEFAULT || "Times New Roman").trim() || "Times New Roman";

  const readSize = (role: StyleRole): number => useThemeSizes ? (readNum(sizes?.[role]) ?? base.sizes[role]) : base.sizes[role];
  const readLineHeight = (role: StyleRole): number => useThemeSizes ? (readNum(lineHeights?.[role]) ?? base.lineHeights[role]) : base.lineHeights[role];

  const scale = parseTypographyScale();
  const applyScale = (value: number): number => Math.max(10, Math.round(value * scale));

  return {
    ...base,
    scale,
    fontFamily: forcedFontFamily,
    sizes: {
      title: applyScale(readSize("title")),
      subtitle: applyScale(readSize("subtitle")),
      body: applyScale(readSize("body")),
      small: applyScale(readSize("small")),
      muted: applyScale(readSize("small")),
      bullets: applyScale(readSize("body")),
    },
    lineHeights: {
      title: readLineHeight("title"),
      subtitle: readLineHeight("subtitle"),
      body: readLineHeight("body"),
      small: readLineHeight("small"),
      muted: readLineHeight("small"),
      bullets: readLineHeight("body"),
    },
    colors: {
      title: typeof colors?.title === "string" ? colors.title : base.colors.title,
      body: typeof colors?.body === "string" ? colors.body : base.colors.body,
      muted: typeof colors?.muted === "string" ? colors.muted : base.colors.muted,
    },
  };
};

const cleanText = (value: string): string => value
  .replace(/\*\*(.*?)\*\*/g, "$1")
  .replace(/^#+\s*/gm, "")
  .replace(/\[[^\]]+\]\([^)]*\)/g, "")
  .replace(/\bhttps?:\/\/\S+/g, "")
  .replace(/\r\n/g, "\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

const toBullets = (text: string): string => {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^\d+[.)]\s*/, "").replace(/^[-•]\s*/, ""))
    .slice(0, 6)
    .map((line) => `• ${line}`);

  return lines.join("\n");
};

export const normalizeText = (key: string, value: string): string => {
  const kind = guessKind(key);
  const role = styleRoleByKey(key);
  const base = cleanText(value);

  if (kind === "bullets") {
    return toBullets(base);
  }

  if (role === "title") {
    return base;
  }

  const sentenceLike = base
    .split(/(?<=[.!?])\s+/)
    .filter((part) => part.trim().length > 0)
    .slice(0, role === "subtitle" || role === "muted" || role === "small" ? 2 : 3)
    .join(" ");
  return sentenceLike || base;
};

export const generateLocalFallbackBullets = (topic: string, slideType: string): string[] => {
  const root = topic || "теме";
  if (slideType === "chronology") {
    return [
      `• Ключевой этап развития темы «${root}».`,
      "• Важная дата и ее значение.",
      "• Последствия и влияние на дальнейшие события.",
    ];
  }
  if (slideType === "examples") {
    return [
      `• Практический пример по теме «${root}».`,
      "• Короткое объяснение, почему пример показателен.",
      "• Вывод для применения на практике.",
    ];
  }
  return [
    `• Главная мысль по теме «${root}».`,
    "• Ключевой термин и его значение.",
    "• Короткий вывод для закрепления материала.",
  ];
};

const tokenize = (text: string): Set<string> => new Set(text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2));

const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const item of a) if (b.has(item)) inter += 1;
  return inter / (a.size + b.size - inter);
};

export const dedupeBulletLines = (text: string, topic: string, slideType: string): string => {
  const lines = toBullets(text)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const unique: string[] = [];
  for (const line of lines) {
    const currentSet = tokenize(line);
    const nearDuplicate = unique.some((prev) => jaccard(currentSet, tokenize(prev)) > 0.7);
    if (!nearDuplicate) unique.push(line);
  }

  return unique.slice(0, 6).join("\n");
};

const applyTextProps = (record: Record<string, unknown>, props: { fontFamily: string; fontSize: number; lineHeight: number; color: string }): number => {
  let touched = 0;
  const style = toRecord(record.style) ?? {};
  record.style = style;
  const styleTargets = [record, style, toRecord(record.textStyle), toRecord(record.paragraphStyle)].filter(Boolean) as Record<string, unknown>[];

  for (const target of styleTargets) {
    if (target.fontFamily !== props.fontFamily) {
      target.fontFamily = props.fontFamily;
      touched += 1;
    }
    if (target.fontSize !== props.fontSize) {
      target.fontSize = props.fontSize;
      touched += 1;
    }
    if (target.lineHeight !== props.lineHeight) {
      target.lineHeight = props.lineHeight;
      touched += 1;
    }
    if (target.color !== props.color) {
      target.color = props.color;
      touched += 1;
    }
  }

  const walkRuns = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walkRuns);
      return;
    }
    const current = node as Record<string, unknown>;
    const style = toRecord(current.style);
    if (style && style.color !== props.color) {
      style.color = props.color;
      touched += 1;
    }
    Object.values(current).forEach(walkRuns);
  };

  walkRuns(record.runs);
  return touched;
};

const getElement = (doc: unknown, slide: number, elementIndex: number): Record<string, unknown> | null => {
  const slides = toRecord(doc)?.slides;
  const slideArray = Array.isArray(slides) ? slides : [];
  const slideRecord = toRecord(slideArray[slide - 1]);
  const elements = slideRecord && Array.isArray(slideRecord.elements) ? slideRecord.elements : [];
  return toRecord(elements[elementIndex]);
};

export const applyTypographyStandards = (params: {
  doc: unknown;
  placeholderLocations: PlaceholderLocation[];
  themeTypography: TypographyConfig;
}): TypographyApplyStats => {
  const byElement = new Map<string, PlaceholderLocation>();
  for (const location of params.placeholderLocations) {
    const key = `${location.slide}-${location.elementIndex}`;
    if (!byElement.has(key)) byElement.set(key, location);
  }

  let touched = 0;
  for (const location of byElement.values()) {
    const element = getElement(params.doc, location.slide, location.elementIndex);
    if (!element) continue;

    const role = styleRoleByKey(location.key);
    const color = role === "muted" || role === "small"
      ? params.themeTypography.colors.muted
      : (role === "title" ? params.themeTypography.colors.title : params.themeTypography.colors.body);

    touched += applyTextProps(element, {
      fontFamily: params.themeTypography.fontFamily,
      fontSize: params.themeTypography.sizes[role],
      lineHeight: params.themeTypography.lineHeights[role],
      color,
    });
  }

  return {
    touched,
    colorsApplied: touched > 0,
    themeColorMode: params.themeTypography.mode,
  };
};

const charsCapacity = (w: number, h: number, fontSize: number, lineHeight: number): number => {
  const charsPerLine = Math.max(12, Math.floor(w / (fontSize * 0.53)));
  const maxLines = Math.max(1, Math.floor(h / (fontSize * lineHeight * 1.05)));
  return charsPerLine * maxLines;
};

export const autoFitText = (params: {
  doc: unknown;
  placeholderLocations: PlaceholderLocation[];
  themeTypography: TypographyConfig;
}): TextFitStats => {
  const uniqueTargets = [...new Map(params.placeholderLocations.map((location) => [`${location.slide}-${location.elementIndex}-${location.key}`, location])).values()];
  const items: TextFitItem[] = [];
  let overflowCount = 0;
  let truncatedCount = 0;

  for (const target of uniqueTargets) {
    const element = getElement(params.doc, target.slide, target.elementIndex);
    if (!element) continue;

    const role = styleRoleByKey(target.key);
    const baseFontSize = params.themeTypography.sizes[role];
    const minFontSize = role === "title" ? 30 : (role === "subtitle" ? 20 : 13);
    const maxFontSize = baseFontSize;

    const text = typeof element.text === "string" ? element.text.trim() : "";
    if (!text) continue;

    const width = readNum(element.width) ?? readNum(element.w) ?? 600;
    const height = readNum(element.height) ?? readNum(element.h) ?? 220;
    const lineHeight = readNum(toRecord(element.style)?.lineHeight) ?? params.themeTypography.lineHeights[role] ?? 1.15;

    const origFontSize = readNum(toRecord(element.style)?.fontSize) ?? baseFontSize;
    let fontSize = Math.min(maxFontSize, Math.max(minFontSize, origFontSize));
    let maxCharsEst = charsCapacity(width, height, fontSize, lineHeight);

    let wasShrunk = false;
    while (text.length > maxCharsEst && fontSize > minFontSize) {
      fontSize -= role === "title" ? 2 : 1;
      wasShrunk = true;
      maxCharsEst = charsCapacity(width, height, fontSize, lineHeight);
    }

    let nextText = text;
    let wasTruncated = false;
    if (nextText.length > maxCharsEst && process.env.TEXT_FIT_TRUNCATE === "true") {
      overflowCount += 1;
      truncatedCount += 1;
      wasTruncated = true;
      nextText = clip(nextText, maxCharsEst);
    } else if (nextText.length > maxCharsEst) {
      overflowCount += 1;
    }

    if (typeof element.text === "string") element.text = nextText;
    const style = toRecord(element.style) ?? ({} as Record<string, unknown>);
    style.fontSize = fontSize;
    style.lineHeight = lineHeight;
    element.style = style;

    items.push({
      key: target.key,
      role,
      slide: target.slide,
      elementIndex: target.elementIndex,
      baseFontSize,
      origFontSize,
      finalFontSize: fontSize,
      textLen: text.length,
      maxCharsEst,
      wasShrunk,
      wasTruncated,
    });
  }

  return { overflowCount, truncatedCount, items };
};

export const generateLocalFallback = (params: { key: string; topic: string; slideNumber: number }): string => {
  const key = params.key.toLowerCase();
  const topic = params.topic || "Тема презентации";

  if (key.includes("sources")) {
    return "Источники: учебные материалы, энциклопедии, официальные справочники.";
  }

  if (key.includes("title") || key.includes("header")) {
    return `${topic} — слайд ${params.slideNumber}`;
  }

  if (key.includes("bullets") || key.includes("list") || key.includes("points") || key.includes("step") || key.includes("plan") || key.includes("goals") || key.includes("examples")) {
    return generateLocalFallbackBullets(topic, "general").join("\n");
  }

  return `Краткое пояснение по теме «${topic}» для слайда ${params.slideNumber}.`;
};
