import type { PlaceholderLocation } from "./applyFills";

export type TextKind = "title" | "bullets" | "body";

export type TextFitItem = {
  key: string;
  slide: number;
  elementIndex: number;
  origFontSize: number;
  finalFontSize: number;
  textLen: number;
  maxCharsEst: number;
  wasShrunk: boolean;
  wasGrown: boolean;
  wasTruncated: boolean;
};

export type TextFitStats = {
  overflowCount: number;
  truncatedCount: number;
  items: TextFitItem[];
};

const TEXT_KEYS = new Set(["text", "content", "value"]);

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const readNum = (value: unknown): number | null => {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const guessKind = (key: string): TextKind => {
  const normalized = key.toLowerCase();
  if (normalized.includes("title") || normalized.includes("header")) return "title";
  if (normalized.includes("bullets") || normalized.includes("list") || normalized.includes("points") || normalized.includes("step")) return "bullets";
  return "body";
};

export const normalizeText = (key: string, value: string): string => {
  let text = value
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (guessKind(key) === "bullets") {
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line.replace(/^[-•]\s*/, ""));

    text = lines.map((line) => `• ${line}`).join("\n");
  }

  return text;
};

const applyFontFamilyOnRecord = (record: Record<string, unknown>, fontFamily: string): number => {
  let updated = 0;

  if (typeof record.fontFamily === "string" && record.fontFamily !== fontFamily) {
    record.fontFamily = fontFamily;
    updated += 1;
  }

  for (const styleKey of ["style", "textStyle", "paragraphStyle"]) {
    const style = toRecord(record[styleKey]);
    if (!style) continue;
    if (style.fontFamily !== fontFamily) {
      style.fontFamily = fontFamily;
      updated += 1;
    }
  }

  return updated;
};

export const enforceFontFamily = (doc: unknown, fontFamily: string): { touched: number } => {
  const visited = new Set<object>();
  let touched = 0;

  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (visited.has(node as object)) return;
    visited.add(node as object);

    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }

    const record = node as Record<string, unknown>;
    touched += applyFontFamilyOnRecord(record, fontFamily);

    for (const value of Object.values(record)) {
      walk(value);
    }
  };

  walk(doc);
  return { touched };
};

const readElementFontSize = (element: Record<string, unknown>): number => {
  const direct = readNum(element.fontSize);
  if (direct && direct > 0) return direct;

  const style = toRecord(element.style);
  const styleSize = style ? readNum(style.fontSize) : null;
  if (styleSize && styleSize > 0) return styleSize;

  const textStyle = toRecord(element.textStyle);
  const textStyleSize = textStyle ? readNum(textStyle.fontSize) : null;
  if (textStyleSize && textStyleSize > 0) return textStyleSize;

  return 24;
};

const writeElementFontSize = (element: Record<string, unknown>, size: number): void => {
  const style = toRecord(element.style);
  if (style) {
    style.fontSize = size;
  } else {
    element.style = { fontSize: size };
  }

  const textStyle = toRecord(element.textStyle);
  if (textStyle) {
    textStyle.fontSize = size;
  }
};

const charsCapacity = (w: number, h: number, fontSize: number, lineHeight: number): number => {
  const charsPerLine = Math.max(12, Math.floor(w / (fontSize * 0.55)));
  const maxLines = Math.max(1, Math.floor(h / (fontSize * lineHeight * 1.1)));
  return charsPerLine * maxLines;
};

const truncateByKind = (text: string, key: string, maxCharsEst: number, charsPerLine: number, maxLines: number): string => {
  const kind = guessKind(key);

  if (kind === "bullets") {
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, maxLines)
      .map((line) => {
        const raw = line.replace(/^[-•]\s*/, "");
        const clipped = raw.length > charsPerLine ? `${raw.slice(0, Math.max(0, charsPerLine - 1))}…` : raw;
        return `• ${clipped}`;
      });
    return lines.join("\n");
  }

  if (text.length <= maxCharsEst) return text;
  const limit = Math.max(1, maxCharsEst - 1);
  return `${text.slice(0, limit)}…`;
};

export const autoFitText = (params: {
  doc: unknown;
  placeholderLocations: PlaceholderLocation[];
  scope: "placeholders" | "all";
  limits: {
    title: { min: number; max: number };
    body: { min: number; max: number };
    bullets: { min: number; max: number };
  };
}): TextFitStats => {
  const slides = toRecord(params.doc)?.slides;
  const slideArray = Array.isArray(slides) ? slides : [];

  const targets = params.scope === "all"
    ? slideArray.flatMap((slide, slideIndex) => {
        const slideRecord = toRecord(slide);
        const elements = slideRecord && Array.isArray(slideRecord.elements) ? slideRecord.elements : [];
        return elements.map((_element, elementIndex) => ({ key: "body", slide: slideIndex + 1, elementIndex }));
      })
    : [...new Map(params.placeholderLocations.map((location) => [`${location.slide}-${location.elementIndex}-${location.key}`, location])).values()];

  const items: TextFitItem[] = [];
  let overflowCount = 0;
  let truncatedCount = 0;

  for (const target of targets) {
    const slideRecord = toRecord(slideArray[target.slide - 1]);
    const elements = slideRecord && Array.isArray(slideRecord.elements) ? slideRecord.elements : [];
    const element = toRecord(elements[target.elementIndex]);
    if (!element) continue;

    const textParts: string[] = [];
    const collectText = (node: unknown): void => {
      if (typeof node === "string") {
        textParts.push(node);
        return;
      }
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        node.forEach(collectText);
        return;
      }
      const record = node as Record<string, unknown>;
      for (const [key, value] of Object.entries(record)) {
        if (TEXT_KEYS.has(key) && typeof value === "string") {
          textParts.push(value);
        } else {
          collectText(value);
        }
      }
    };

    collectText(element);
    const text = textParts.join("\n").trim();
    if (!text) continue;

    const width = readNum(element.width) ?? readNum(element.w) ?? 600;
    const height = readNum(element.height) ?? readNum(element.h) ?? 200;
    const lineHeight = readNum(element.lineHeight) ?? 1.15;
    const kind = guessKind(target.key);
    const limits = params.limits[kind];

    const origFontSize = readElementFontSize(element);
    let fontSize = origFontSize;

    let maxCharsEst = charsCapacity(width, height, fontSize, lineHeight);

    let wasShrunk = false;
    let wasGrown = false;

    const shrinkStep = kind === "title" ? 3 : 2;
    while (text.length > maxCharsEst && fontSize > limits.min) {
      fontSize -= shrinkStep;
      wasShrunk = true;
      maxCharsEst = charsCapacity(width, height, fontSize, lineHeight);
    }

    while (text.length < maxCharsEst * 0.55 && fontSize < limits.max) {
      fontSize += 1;
      const nextCap = charsCapacity(width, height, fontSize, lineHeight);
      if (text.length > nextCap) {
        fontSize -= 1;
        break;
      }
      wasGrown = true;
      maxCharsEst = nextCap;
    }

    const charsPerLine = Math.max(12, Math.floor(width / (fontSize * 0.55)));
    const maxLines = Math.max(1, Math.floor(height / (fontSize * lineHeight * 1.1)));

    let wasTruncated = false;
    if (text.length > maxCharsEst) {
      overflowCount += 1;
      wasTruncated = true;
      truncatedCount += 1;
      const truncated = truncateByKind(text, target.key, maxCharsEst, charsPerLine, maxLines);
      if (typeof element.text === "string") {
        element.text = truncated;
      }
    }

    writeElementFontSize(element, fontSize);

    items.push({
      key: target.key,
      slide: target.slide,
      elementIndex: target.elementIndex,
      origFontSize,
      finalFontSize: fontSize,
      textLen: text.length,
      maxCharsEst,
      wasShrunk,
      wasGrown,
      wasTruncated,
    });
  }

  return {
    overflowCount,
    truncatedCount,
    items,
  };
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

  if (key.includes("bullets") || key.includes("list") || key.includes("points") || key.includes("step")) {
    return [
      `• Ключевая идея по теме «${topic}».`,
      "• Важный термин и его краткое пояснение.",
      "• Практический пример применения.",
      "• Короткий вывод для закрепления.",
    ].join("\n");
  }

  return `Краткое пояснение по теме «${topic}» для слайда ${params.slideNumber}.`;
};
