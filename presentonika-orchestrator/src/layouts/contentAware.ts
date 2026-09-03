import { measureTextBlock } from "./textMetrics";

type AnyRecord = Record<string, unknown>;

type AdaptiveRole = "container" | "shadow" | "content" | "fixed" | "stretch";

type AdaptiveGroup = {
  id: string;
  elements: AnyRecord[];
  container: AnyRecord;
  contents: AnyRecord[];
  baseY: number;
  baseHeight: number;
  minHeight: number;
  maxHeight: number;
  bottomPadding: number;
  desiredHeight: number;
  flow?: string;
  order: number;
  balance?: string;
};

export type ContentAwareLayoutStats = {
  groupsFound: number;
  groupsAdjusted: number;
  groupsCompacted: number;
  groupsExpanded: number;
  elementsMoved: number;
  overflowRiskCount: number;
  titlesAdjusted: number;
  fontFallbackCount: number;
};

const asRecord = (value: unknown): AnyRecord | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as AnyRecord;
};

const readNumber = (record: AnyRecord | null, key: string, fallback: number): number => {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const readString = (record: AnyRecord | null, key: string): string | undefined => {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const requiredTextMetrics = (element: AnyRecord) => {
  const text = typeof element.text === "string" ? element.text.trim() : "";
  if (!text) return { height: 0, usedFallbackFont: false };
  const style = asRecord(element.style);
  const width = readNumber(element, "width", readNumber(element, "w", 600));
  const fontSize = readNumber(style, "fontSize", 21);
  const rawLineHeight = readNumber(style, "lineHeight", 1.25);
  const metrics = measureTextBlock(text, width, {
    fontFamily: readString(style, "fontFamily"),
    fontSize,
    fontWeight: style?.fontWeight as string | number | undefined,
    bold: style?.bold === true,
    lineHeight: rawLineHeight,
    letterSpacing: readNumber(style, "letterSpacing", 0),
  });
  return { height: Math.ceil(metrics.height), usedFallbackFont: metrics.usedFallbackFont };
};

const requiredTextHeight = (element: AnyRecord): number => requiredTextMetrics(element).height;

const adaptTitleArea = (elements: AnyRecord[], slideHeight: number, stats: ContentAwareLayoutStats): void => {
  const titles = elements.filter((element) => {
    if (element.type !== "text") return false;
    const meta = asRecord(element.meta);
    return readString(meta, "slotId") === "title";
  });
  for (const title of titles) {
    const baseY = readNumber(title, "y", 0);
    const baseHeight = readNumber(title, "height", readNumber(title, "h", 0));
    const measured = requiredTextMetrics(title);
    if (measured.usedFallbackFont) stats.fontFallbackCount += 1;
    if (measured.height <= baseHeight - 2) continue;
    const maxHeight = Math.max(baseHeight, 142);
    const desiredHeight = Math.min(maxHeight, measured.height + 4);
    if (measured.height > maxHeight) stats.overflowRiskCount += 1;
    const delta = desiredHeight - baseHeight;
    if (delta <= 0) continue;
    setHeight(title, desiredHeight);
    stats.titlesAdjusted += 1;
    stats.groupsAdjusted += 1;

    const shiftThreshold = baseY + baseHeight + 18;
    const shiftTargets = elements.filter((element) => (
      element !== title && typeof element.y === "number" && element.y >= shiftThreshold
    ));
    const safeShift = shiftTargets.reduce((available, element) => {
      const height = readNumber(element, "height", readNumber(element, "h", 0));
      return Math.min(available, Math.max(0, slideHeight - (element.y as number + height)));
    }, delta);
    if (safeShift < delta - 1) stats.overflowRiskCount += 1;
    for (const element of shiftTargets) {
      if (safeShift < 1) continue;
      setY(element, element.y as number + safeShift);
      stats.elementsMoved += 1;
    }
  }
};

const buildGroups = (elements: AnyRecord[]): AdaptiveGroup[] => {
  const grouped = new Map<string, AnyRecord[]>();
  for (const element of elements) {
    const meta = asRecord(element.meta);
    const groupId = readString(meta, "adaptiveGroup");
    if (!groupId) continue;
    const rows = grouped.get(groupId) || [];
    rows.push(element);
    grouped.set(groupId, rows);
  }

  return [...grouped.entries()].flatMap(([id, rows]) => {
    const container = rows.find((element) => readString(asRecord(element.meta), "adaptiveRole") === "container");
    if (!container) return [];
    const meta = asRecord(container.meta);
    const baseHeight = readNumber(container, "height", readNumber(container, "h", 0));
    const minHeight = readNumber(meta, "adaptiveMinHeight", Math.min(baseHeight, 120));
    const maxHeight = Math.max(minHeight, readNumber(meta, "adaptiveMaxHeight", baseHeight));
    const bottomPadding = readNumber(meta, "adaptiveBottomPadding", 36);
    const contents = rows.filter((element) => readString(asRecord(element.meta), "adaptiveRole") === "content");
    const baseY = readNumber(container, "y", 0);
    const requiredBottom = contents.reduce((bottom, element) => {
      const contentY = readNumber(element, "y", baseY);
      return Math.max(bottom, contentY - baseY + requiredTextHeight(element) + bottomPadding);
    }, minHeight);
    return [{
      id,
      elements: rows,
      container,
      contents,
      baseY,
      baseHeight,
      minHeight,
      maxHeight,
      bottomPadding,
      desiredHeight: clamp(Math.ceil(requiredBottom), minHeight, maxHeight),
      flow: readString(meta, "adaptiveFlow"),
      order: readNumber(meta, "adaptiveOrder", 0),
      balance: readString(meta, "adaptiveBalance"),
    }];
  });
};

const setHeight = (element: AnyRecord, height: number): void => {
  if (typeof element.height === "number" || typeof element.h !== "number") element.height = height;
  else element.h = height;
};

const setY = (element: AnyRecord, y: number): void => {
  if (typeof element.y === "number" || !("y" in element)) element.y = y;
};

export const adaptLayoutToContent = (doc: unknown): ContentAwareLayoutStats => {
  const root = asRecord(doc);
  const slides = Array.isArray(root?.slides) ? root.slides : [];
  const stats: ContentAwareLayoutStats = {
    groupsFound: 0,
    groupsAdjusted: 0,
    groupsCompacted: 0,
    groupsExpanded: 0,
    elementsMoved: 0,
    overflowRiskCount: 0,
    titlesAdjusted: 0,
    fontFallbackCount: 0,
  };

  for (const rawSlide of slides) {
    const slide = asRecord(rawSlide);
    const elements = Array.isArray(slide?.elements)
      ? slide.elements.map(asRecord).filter((element): element is AnyRecord => Boolean(element))
      : [];
    const slideSize = asRecord(root?.slideSize);
    const slideHeight = readNumber(slide, "height", readNumber(slideSize, "height", readNumber(root, "height", 864)));
    adaptTitleArea(elements, slideHeight, stats);
    const groups = buildGroups(elements);
    stats.groupsFound += groups.length;

    const balanceRows = new Map<string, AdaptiveGroup[]>();
    for (const group of groups) {
      if (!group.balance) continue;
      const rows = balanceRows.get(group.balance) || [];
      rows.push(group);
      balanceRows.set(group.balance, rows);
    }
    for (const rows of balanceRows.values()) {
      const balancedHeight = Math.max(...rows.map((group) => group.desiredHeight));
      rows.forEach((group) => { group.desiredHeight = clamp(balancedHeight, group.minHeight, group.maxHeight); });
    }

    const flowRows = new Map<string, AdaptiveGroup[]>();
    for (const group of groups) {
      if (!group.flow) continue;
      const rows = flowRows.get(group.flow) || [];
      rows.push(group);
      flowRows.set(group.flow, rows);
    }

    const targetY = new Map<string, number>();
    for (const rows of flowRows.values()) {
      rows.sort((a, b) => a.order - b.order || a.baseY - b.baseY);
      rows.forEach((group, index) => {
        if (index === 0) {
          targetY.set(group.id, group.baseY);
          return;
        }
        const previous = rows[index - 1];
        const previousTargetY = targetY.get(previous.id) ?? previous.baseY;
        const originalGap = Math.max(18, group.baseY - (previous.baseY + previous.baseHeight));
        targetY.set(group.id, previousTargetY + previous.desiredHeight + originalGap);
      });
    }

    for (const group of groups) {
      const nextY = targetY.get(group.id) ?? group.baseY;
      const deltaY = nextY - group.baseY;
      const changedHeight = Math.abs(group.desiredHeight - group.baseHeight) >= 1;
      if (changedHeight || Math.abs(deltaY) >= 1) stats.groupsAdjusted += 1;
      if (group.desiredHeight < group.baseHeight - 1) stats.groupsCompacted += 1;
      if (group.desiredHeight > group.baseHeight + 1) stats.groupsExpanded += 1;

      for (const element of group.elements) {
        const meta = asRecord(element.meta);
        const role = readString(meta, "adaptiveRole") as AdaptiveRole | undefined;
        if (Math.abs(deltaY) >= 1 && typeof element.y === "number") {
          setY(element, element.y + deltaY);
          stats.elementsMoved += 1;
        }
        if (role === "container" || role === "shadow" || role === "stretch") {
          setHeight(element, group.desiredHeight);
        }
      }

      for (const content of group.contents) {
        const contentY = readNumber(content, "y", nextY);
        const available = Math.max(24, nextY + group.desiredHeight - contentY - group.bottomPadding);
        const metrics = requiredTextMetrics(content);
        const required = metrics.height;
        if (metrics.usedFallbackFont) stats.fontFallbackCount += 1;
        setHeight(content, Math.min(available, Math.max(24, required + 4)));
        if (required > available + 1) stats.overflowRiskCount += 1;
      }
    }
  }

  return stats;
};
