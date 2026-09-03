import fs from "node:fs";
import path from "node:path";
import * as fontkit from "fontkit";

type FontFace = fontkit.Font;

export type TextMetricStyle = {
  fontFamily?: string;
  fontSize: number;
  fontWeight?: string | number;
  bold?: boolean;
  lineHeight: number;
  letterSpacing?: number;
};

export type TextBlockMetrics = {
  lines: string[];
  lineCount: number;
  lineHeightPx: number;
  height: number;
  maxLineWidth: number;
  usedFallbackFont: boolean;
};

const fontCache = new Map<string, FontFace | null>();

const normalizedFamily = (value?: string): "Inter" | "Manrope" => (
  value?.toLowerCase().includes("manrope") ? "Manrope" : "Inter"
);

const fontFilename = (family: "Inter" | "Manrope"): string => (
  family === "Manrope" ? "manrope-variable.ttf" : "inter-variable.ttf"
);

const loadFont = (familyValue?: string): FontFace | null => {
  const family = normalizedFamily(familyValue);
  if (fontCache.has(family)) return fontCache.get(family) ?? null;
  const fontDir = process.env.PRESENTONIKA_FONT_DIR?.trim() || path.resolve("assets", "fonts");
  const fontPath = path.join(fontDir, fontFilename(family));
  if (!fs.existsSync(fontPath)) {
    fontCache.set(family, null);
    return null;
  }
  const opened = fontkit.openSync(fontPath);
  const font = "layout" in opened ? opened : null;
  fontCache.set(family, font);
  return font;
};

const numericWeight = (style: TextMetricStyle): number => {
  if (style.bold) return 700;
  if (typeof style.fontWeight === "number") return style.fontWeight;
  if (typeof style.fontWeight === "string") {
    if (style.fontWeight === "bold") return 700;
    const parsed = Number.parseInt(style.fontWeight, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 400;
};

const variationForWeight = (font: FontFace, weight: number): FontFace => {
  const variable = font as FontFace & { getVariation?: (variation: Record<string, number>) => FontFace };
  if (typeof variable.getVariation !== "function") return font;
  try {
    return variable.getVariation({ wght: Math.max(100, Math.min(900, weight)) });
  } catch {
    return font;
  }
};

export const measureTextWidth = (text: string, style: TextMetricStyle): { width: number; usedFallbackFont: boolean } => {
  if (!text) return { width: 0, usedFallbackFont: false };
  const baseFont = loadFont(style.fontFamily);
  const letterSpacing = Number.isFinite(style.letterSpacing) ? style.letterSpacing ?? 0 : 0;
  if (!baseFont || typeof baseFont.layout !== "function") {
    return {
      width: text.length * style.fontSize * 0.56 + Math.max(0, [...text].length - 1) * letterSpacing,
      usedFallbackFont: true,
    };
  }
  const font = variationForWeight(baseFont, numericWeight(style));
  const run = font.layout(text);
  const width = (run.advanceWidth / font.unitsPerEm) * style.fontSize
    + Math.max(0, [...text].length - 1) * letterSpacing;
  return { width, usedFallbackFont: false };
};

const splitLongToken = (token: string, maxWidth: number, style: TextMetricStyle): string[] => {
  const parts: string[] = [];
  let current = "";
  for (const char of [...token]) {
    const next = `${current}${char}`;
    if (current && measureTextWidth(next, style).width > maxWidth) {
      parts.push(current);
      current = char;
    } else {
      current = next;
    }
  }
  if (current) parts.push(current);
  return parts;
};

const wrapParagraph = (paragraph: string, maxWidth: number, style: TextMetricStyle): string[] => {
  if (!paragraph) return [""];
  const words = paragraph.trim().split(/\s+/u).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const rawWord of words) {
    const wordParts = measureTextWidth(rawWord, style).width > maxWidth
      ? splitLongToken(rawWord, maxWidth, style)
      : [rawWord];
    for (const word of wordParts) {
      const candidate = current ? `${current} ${word}` : word;
      if (!current || measureTextWidth(candidate, style).width <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
};

export const measureTextBlock = (text: string, maxWidth: number, style: TextMetricStyle): TextBlockMetrics => {
  const safeWidth = Math.max(1, maxWidth);
  const lines = text.replace(/\r\n/g, "\n").split("\n").flatMap((paragraph) => wrapParagraph(paragraph, safeWidth, style));
  const measured = lines.map((line) => measureTextWidth(line, style));
  const lineHeightPx = style.lineHeight <= 3 ? style.fontSize * style.lineHeight : style.lineHeight;
  return {
    lines,
    lineCount: Math.max(1, lines.length),
    lineHeightPx,
    height: Math.max(1, lines.length) * lineHeightPx,
    maxLineWidth: Math.max(0, ...measured.map((row) => row.width)),
    usedFallbackFont: measured.some((row) => row.usedFallbackFont),
  };
};

export const __resetFontMetricCacheForTests = (): void => {
  fontCache.clear();
};
