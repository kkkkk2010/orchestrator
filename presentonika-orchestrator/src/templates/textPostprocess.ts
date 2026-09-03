import type { PlaceholderLocation } from "./applyFills";
import { measureTextBlock, type TextMetricStyle } from "../layouts/textMetrics";

export type StyleRole = "title" | "subtitle" | "body" | "small" | "muted" | "bullets";
type ThemeMode = "dark" | "light";

type TextKind = "title" | "bullets" | "body";

export type TypographyConfig = {
  fontFamily: string;
  displayFontFamily: string;
  scale: number;
  sizes: Record<StyleRole, number>;
  lineHeights: Record<StyleRole, number>;
  colors: {
    title: string;
    body: string;
    muted: string;
  };
  mode: ThemeMode;
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
  requiredLines: number;
  maxLines: number;
  overflowAfterFit: boolean;
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

const readThemeMode = (theme: unknown): ThemeMode | null => {
  const mode = toRecord(theme)?.mode;
  return mode === "dark" || mode === "light" ? mode : null;
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
  if (/(?:_left_title|_right_title)$/.test(normalized)) return "subtitle";
  if (/(?:_hook_question)$/.test(normalized)) return "subtitle";
  if (/(?:_hook_hint|_hook_fact|_hook_why|_q\d+|_step\d+|_homework)$/.test(normalized)) return "small";
  if (/(^|_)(title|header)$/.test(normalized) || /^s\d+_title$/.test(normalized)) return "title";
  if (normalized.endsWith("_subtitle") || normalized.includes("subtitle")) return "subtitle";
  if (normalized.endsWith("_meta") || normalized.endsWith("_sources") || normalized.includes("sources")) return "muted";
  if (/(?:_bullets|_plan|_goals|_examples|_task|_q\d+|_step\d+)$/i.test(normalized)) return "bullets";
  if (normalized.endsWith("_small")) return "small";
  return "body";
};

export type FormatNormalizationResult = {
  value: string;
  changed: boolean;
  rules: string[];
};

export const isBulletLikeFillKey = (key: string): boolean => {
  const normalized = key.toLowerCase();
  return /(?:_bullets|_plan|_goals|_examples|_questions|_summary|_task|_steps|_step\d+|_q\d+)$/i.test(normalized);
};

export const normalizeBulletLineFormatting = (value: string): FormatNormalizationResult => {
  const original = value;
  const rules: string[] = [];
  let next = value.replace(/\r\n/g, "\n");

  if (/•\s*•/.test(next)) {
    next = next.replace(/•\s*•\s*/g, "• ");
    rules.push("double_bullet_marker");
  }

  if (next.split("\n").some((line) => (line.match(/•/g) || []).length > 1)) {
    next = next.replace(/([^\n])\s+•\s*/g, "$1\n• ");
    rules.push("multiple_bullets_on_one_line");
  }

  const normalizedLines = next
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      if (/^•/.test(trimmed)) return `• ${trimmed.replace(/^•\s*/, "").trim()}`;
      if (/^[-*]\s+/.test(trimmed)) return `• ${trimmed.replace(/^[-*]\s+/, "").trim()}`;
      return trimmed;
    });

  next = normalizedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (next !== original && !rules.includes("bullet_spacing")) {
    rules.push("bullet_spacing");
  }

  return {
    value: next,
    changed: next !== original,
    rules,
  };
};

const defaultTypography = (themeId: string, themeMode: ThemeMode | null): TypographyConfig => {
  const normalized = themeId.toLowerCase();
  const mode = themeMode ?? (normalized.includes("dark") ? "dark" : "light");

  if (mode === "dark") {
    return {
      fontFamily: "Inter",
      displayFontFamily: "Manrope",
      scale: parseTypographyScale(),
      sizes: { title: 56, subtitle: 30, body: 23, small: 18, muted: 16, bullets: 21 },
      lineHeights: { title: 1.04, subtitle: 1.12, body: 1.26, small: 1.24, muted: 1.2, bullets: 1.26 },
      colors: { title: "#F7F8FA", body: "#E4E8ED", muted: "#A8B0BA" },
      mode: "dark",
    };
  }

  return {
    fontFamily: "Inter",
    displayFontFamily: "Manrope",
    scale: parseTypographyScale(),
    sizes: { title: 56, subtitle: 30, body: 23, small: 18, muted: 16, bullets: 21 },
    lineHeights: { title: 1.04, subtitle: 1.12, body: 1.26, small: 1.24, muted: 1.2, bullets: 1.26 },
    colors: themeMode === "light" || normalized.includes("light")
      ? { title: "#18202A", body: "#2C3540", muted: "#66717E" }
      : { title: "#17242B", body: "#293A42", muted: "#5F6E76" },
    mode: "light",
  };
};

export const resolveThemeTypography = (themeId: string, theme: unknown): TypographyConfig => {
  const base = defaultTypography(themeId, readThemeMode(theme));
  const typography = toRecord(toRecord(theme)?.typography);
  const sizes = toRecord(typography?.sizes);
  const lineHeights = toRecord(typography?.lineHeights);
  const colors = toRecord(typography?.colors);
  const useThemeSizes = process.env.TYPOGRAPHY_USE_THEME_SIZES === "true";
  const envFontFamily = process.env.FONT_FAMILY_DEFAULT?.trim() ?? "";
  const envDisplayFontFamily = process.env.FONT_FAMILY_DISPLAY?.trim() ?? "";
  const themeFontFamily = typeof typography?.fontFamily === "string" ? typography.fontFamily.trim() : "";
  const themeDisplayFontFamily = typeof typography?.displayFontFamily === "string" ? typography.displayFontFamily.trim() : "";
  const fontFamily = envFontFamily || themeFontFamily || "Inter";
  const displayFontFamily = envDisplayFontFamily || themeDisplayFontFamily || "Manrope";

  const readSize = (role: StyleRole, fallbackRole: StyleRole = role): number => {
    if (!useThemeSizes) return base.sizes[role];
    return readNum(sizes?.[role]) ?? (fallbackRole !== role ? readNum(sizes?.[fallbackRole]) : null) ?? base.sizes[fallbackRole];
  };
  const readLineHeight = (role: StyleRole, fallbackRole: StyleRole = role): number => {
    if (!useThemeSizes) return base.lineHeights[role];
    return readNum(lineHeights?.[role]) ?? (fallbackRole !== role ? readNum(lineHeights?.[fallbackRole]) : null) ?? base.lineHeights[fallbackRole];
  };

  const scale = parseTypographyScale();
  const applyScale = (value: number): number => Math.max(10, Math.round(value * scale));

  return {
    ...base,
    scale,
    fontFamily,
    displayFontFamily,
    sizes: {
      title: applyScale(readSize("title")),
      subtitle: applyScale(readSize("subtitle")),
      body: applyScale(readSize("body")),
      small: applyScale(readSize("small")),
      muted: applyScale(readSize("muted", "small")),
      bullets: applyScale(readSize("bullets", "body")),
    },
    lineHeights: {
      title: readLineHeight("title"),
      subtitle: readLineHeight("subtitle"),
      body: readLineHeight("body"),
      small: readLineHeight("small"),
      muted: readLineHeight("muted", "small"),
      bullets: readLineHeight("bullets", "body"),
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

  if (kind === "bullets" || role === "bullets") {
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
      fontFamily: role === "title" || role === "subtitle"
        ? params.themeTypography.displayFontFamily
        : params.themeTypography.fontFamily,
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

type TextBoxCapacity = {
  charsPerLine: number;
  maxLines: number;
  maxChars: number;
};

const textBoxCapacity = (w: number, h: number, fontSize: number, lineHeight: number): TextBoxCapacity => {
  const charsPerLine = Math.max(10, Math.floor(w / (fontSize * 0.54)));
  const maxLines = Math.max(1, Math.floor(h / (fontSize * lineHeight)));
  return { charsPerLine, maxLines, maxChars: charsPerLine * maxLines };
};

const measuredWrappedLines = (text: string, width: number, style: TextMetricStyle): number => (
  measureTextBlock(text, width, style).lineCount
);

const clipAtWordBoundary = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) return value;
  const safeMax = Math.max(4, maxChars - 1);
  const candidate = value.slice(0, safeMax + 1);
  const sentenceEnd = Math.max(candidate.lastIndexOf("."), candidate.lastIndexOf("!"), candidate.lastIndexOf("?"));
  if (sentenceEnd >= Math.floor(safeMax * 0.55)) return candidate.slice(0, sentenceEnd + 1).trimEnd();

  const boundary = Math.max(candidate.lastIndexOf(" "), candidate.lastIndexOf("\u00A0"));
  const clipped = (boundary >= Math.floor(safeMax * 0.62) ? candidate.slice(0, boundary) : candidate.slice(0, safeMax))
    .replace(/[,:;\u2013\u2014-]+$/u, "")
    .trimEnd();
  return /[.!?]$/u.test(clipped) ? clipped : `${clipped}.`;
};

const shortenTextForBox = (text: string, capacity: TextBoxCapacity): string => {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const bulletLike = lines.length > 1 || lines.some((line) => /^[-*•]\s*/.test(line));
  if (!bulletLike) return clipAtWordBoundary(text, capacity.maxChars);

  const keptLines = lines;
  const linesPerItem = Math.max(1, Math.floor(capacity.maxLines / Math.max(1, keptLines.length)));
  const itemBudget = Math.max(12, capacity.charsPerLine * linesPerItem);
  return keptLines.map((line) => {
    const bullet = /^[-*•]\s*/.test(line) ? "• " : "";
    const body = line.replace(/^[-*•]\s*/, "").trim();
    return `${bullet}${clipAtWordBoundary(body, Math.max(4, itemBudget - bullet.length))}`;
  }).join("\n");
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

    const text = typeof element.text === "string" ? element.text.trim() : "";
    if (!text) continue;

    const width = readNum(element.width) ?? readNum(element.w) ?? 600;
    const height = readNum(element.height) ?? readNum(element.h) ?? 220;
    const lineHeight = readNum(toRecord(element.style)?.lineHeight) ?? params.themeTypography.lineHeights[role] ?? 1.15;

    const origFontSize = readNum(toRecord(element.style)?.fontSize) ?? baseFontSize;
    const fontSize = baseFontSize;
    const capacity = textBoxCapacity(width, height, fontSize, lineHeight);
    const sourceStyle = toRecord(element.style);
    const metricStyle: TextMetricStyle = {
      fontFamily: typeof sourceStyle?.fontFamily === "string" ? sourceStyle.fontFamily : params.themeTypography.fontFamily,
      fontSize,
      fontWeight: typeof sourceStyle?.fontWeight === "string" || typeof sourceStyle?.fontWeight === "number" ? sourceStyle.fontWeight : undefined,
      bold: sourceStyle?.bold === true,
      lineHeight,
      letterSpacing: readNum(sourceStyle?.letterSpacing) ?? 0,
    };
    const initialRequiredLines = measuredWrappedLines(text, width, metricStyle);
    const initialOverflow = initialRequiredLines > capacity.maxLines;

    let nextText = text;
    let wasTruncated = false;
    if (initialOverflow && role !== "title" && role !== "subtitle" && process.env.TEXT_FIT_SHORTEN === "true") {
      truncatedCount += 1;
      wasTruncated = true;
      nextText = shortenTextForBox(nextText, capacity);
    }
    const requiredLines = measuredWrappedLines(nextText, width, metricStyle);
    const overflowAfterFit = requiredLines > capacity.maxLines;
    if (overflowAfterFit) {
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
      maxCharsEst: capacity.maxChars,
      requiredLines,
      maxLines: capacity.maxLines,
      overflowAfterFit,
      wasShrunk: false,
      wasTruncated,
    });
  }

  return { overflowCount, truncatedCount, items };
};

type LocalFallbackSlideContext = {
  titleIntent?: string;
  claim?: string;
  mustInclude?: string[];
  expectedEvidence?: string[];
};

export const normalizeDocumentBulletMarkers = (root: unknown): number => {
  const visited = new Set<object>();
  let changed = 0;

  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object" || visited.has(node as object)) return;
    visited.add(node as object);

    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }

    const record = node as Record<string, unknown>;
    if (typeof record.text === "string" && /•[\s\u200B\uFEFF]*•/u.test(record.text)) {
      const next = record.text.replace(/•(?:[\s\u200B\uFEFF]*•)+[\s\u200B\uFEFF]*/gu, "• ");
      if (next !== record.text) {
        record.text = next;
        changed += 1;
      }
    }

    Object.values(record).forEach(walk);
  };

  walk(root);
  return changed;
};

const uniqueFallbackCandidates = (values: Array<string | undefined>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = (value || "").replace(/^[-•]\s*/, "").trim();
    const identity = cleaned.toLocaleLowerCase("ru-RU");
    if (!cleaned || seen.has(identity)) continue;
    seen.add(identity);
    result.push(cleaned);
  }
  return result;
};

export const generateLocalFallback = (params: {
  key: string;
  topic: string;
  slideNumber: number;
  slideContext?: LocalFallbackSlideContext;
}): string => {
  const key = params.key.toLowerCase();
  const topic = params.topic || "Тема презентации";

  if (key.includes("sources")) {
    return "Источники: учебные материалы, энциклопедии, официальные справочники.";
  }

  if (key.includes("title") || key.includes("header")) {
    return params.slideContext?.titleIntent || `${topic} — слайд ${params.slideNumber}`;
  }

  if (key.includes("bullets") || key.includes("list") || key.includes("points") || key.includes("step") || key.includes("plan") || key.includes("goals") || key.includes("examples")) {
    const candidates = uniqueFallbackCandidates([
      ...(params.slideContext?.mustInclude || []),
      params.slideContext?.claim,
      ...(params.slideContext?.expectedEvidence || []),
      ...generateLocalFallbackBullets(topic, "general"),
      `Практический пример по теме «${topic}».`,
      `Связь этого пункта с основной темой слайда ${params.slideNumber}.`,
    ]);
    const numberedSlot = key.match(/(?:step|point|item|example|bullet|goal)[_-]?(\d+)(?:_|$)/i);
    if (numberedSlot?.[1]) {
      const index = Math.max(0, Number.parseInt(numberedSlot[1], 10) - 1);
      return candidates[index % candidates.length];
    }
    return candidates.slice(0, 4).join("\n");
  }

  return params.slideContext?.claim || `Краткое пояснение по теме «${topic}» для слайда ${params.slideNumber}.`;
};
