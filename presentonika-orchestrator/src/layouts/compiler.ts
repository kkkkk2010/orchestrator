import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import yazl from "yazl";
import { getDynamicFillKey, getDynamicSlotBindings } from "./binder";
import { loadLayoutCatalog } from "./catalog";
import { buildDynamicSlidePlan, getDefaultSlotsForSlideType, type CompiledSlidePlanRow } from "./dynamicPlan";
import { mergeLayoutSlides } from "./merge";
import { selectLayoutForSlide } from "./selector";
import type { LayoutEngineDiagnostics, LayoutPack, SlideType } from "./types";
import { buildDeterministicDeckPlan, type DeckPlan } from "../deckPlan";
import { readDocJsonFromTemplateZip } from "../themes/templateZip";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5f0tQAAAAASUVORK5CYII=";

const layoutFallbacks = (slideType: SlideType): SlideType[] => {
  switch (slideType) {
    case "timeline": return ["timeline", "steps"];
    case "comparison": return ["comparison", "twoCol"];
    case "visual_explanation": return ["visual_explanation", "bullets"];
    case "context": return ["context", "definition", "bullets"];
    case "hook": return ["hook", "cover"];
    default: return [slideType];
  }
};

const builtinBaseType = (slideType: SlideType): SlideType => {
  switch (slideType) {
    case "timeline": return "steps";
    case "comparison": return "twoCol";
    case "visual_explanation": return "bullets";
    case "context": return "definition";
    default: return slideType;
  }
};

const builtinSlide = (slideType: SlideType): { elements: Array<Record<string, unknown>> } => {
  const mkText = (slotId: string, x: number, y: number, w: number, h: number) => ({ type: "text", x, y, width: w, height: h, text: `{{slot:${slotId}}}` });
  const mkImage = (id: string, x: number, y: number, w: number, h: number) => ({ type: "image", name: id, x, y, width: w, height: h, src: "assets/images/placeholder.png", meta: { placeholder: true } });

  switch (slideType) {
    case "cover": return { elements: [mkText("title", 80, 90, 900, 140), mkText("subtitle", 80, 250, 780, 70), mkText("meta", 80, 330, 780, 60), mkImage("hero_1", 980, 120, 470, 520)] };
    case "goals": return { elements: [mkText("title", 80, 70, 1100, 110), mkText("goals", 80, 220, 650, 480), mkText("plan", 760, 220, 690, 480)] };
    case "hook": return { elements: [mkText("title", 80, 70, 1100, 110), mkText("hook_question", 80, 210, 820, 100), mkText("hook_hint", 80, 320, 820, 110), mkText("hook_fact", 80, 440, 820, 110), mkText("hook_why", 80, 560, 820, 110), mkImage("hero_1", 940, 220, 510, 420)] };
    case "context":
    case "definition": return { elements: [mkText("title", 80, 70, 1100, 110), mkText("definition", 80, 230, 700, 200), mkText("keywords", 80, 450, 700, 240), mkImage("hero_1", 830, 220, 620, 470)] };
    case "visual_explanation":
    case "bullets": return { elements: [mkText("title", 80, 70, 1000, 110), mkText("bullets", 80, 220, 820, 470), mkImage("hero_1", 940, 220, 510, 470)] };
    case "comparison":
    case "twoCol": return { elements: [mkText("title", 80, 70, 1100, 110), mkText("left_title", 80, 220, 640, 70), mkText("left_bullets", 80, 300, 640, 390), mkText("right_title", 770, 220, 640, 70), mkText("right_bullets", 770, 300, 640, 390)] };
    case "timeline":
    case "steps": return { elements: [mkText("title", 80, 70, 1100, 110), mkText("step1", 80, 220, 640, 90), mkText("step2", 80, 320, 640, 90), mkText("step3", 80, 420, 640, 90), mkText("step4", 80, 520, 640, 90), mkImage("hero_1", 780, 220, 670, 420)] };
    case "examples": return { elements: [mkText("title", 80, 70, 1000, 110), mkText("examples", 80, 220, 820, 470), mkImage("hero_1", 940, 220, 510, 470)] };
    case "quiz": return { elements: [mkText("title", 80, 70, 1100, 110), mkText("task", 80, 200, 700, 90), mkText("q1", 80, 300, 700, 90), mkText("q2", 80, 400, 700, 90), mkText("q3", 80, 500, 700, 90), mkImage("hero_1", 900, 220, 550, 360)] };
    case "summary": return { elements: [mkText("title", 80, 70, 1000, 110), mkText("summary", 80, 220, 780, 200), mkText("homework", 80, 440, 780, 150), mkText("sources", 80, 610, 1200, 120), mkImage("hero_1", 900, 220, 550, 360)] };
  }
};

const applyBinding = (slide: Record<string, unknown>, bindings: Record<string, string>, warnings: string[]): void => {
  const elements = (Array.isArray(slide.elements) ? slide.elements : []) as Array<Record<string, unknown>>;
  for (const element of elements) {
    if (typeof element.text !== "string") continue;
    element.text = element.text.replace(/\{\{slot:([a-zA-Z0-9_\-]+)\}\}/g, (_full, slotId: string) => {
      const key = bindings[slotId];
      if (!key) {
        warnings.push(`missing binding for slot:${slotId}`);
        return `{{slot:${slotId}}}`;
      }
      return `{{${key}}}`;
    });
  }
};

const textSlotIds = (pack: LayoutPack | null, fallbackSlideType: SlideType): string[] => {
  if (pack) return pack.manifest.textSlots.map((slot) => slot.slotId);
  return getDefaultSlotsForSlideType(fallbackSlideType);
};

const repeatRequest = (row: CompiledSlidePlanRow): { group: "steps" | "questions"; requested: number; rendered: number } | null => {
  if (row.slideType === "steps" || row.slideType === "timeline") {
    const item = row.requiredItems.find((required) => required.kind === "steps");
    const requested = item?.count ?? 4;
    return { group: "steps", requested, rendered: Math.max(1, Math.min(4, requested)) };
  }
  if (row.slideType === "quiz") {
    const item = row.requiredItems.find((required) => required.kind === "questions");
    const requested = item?.count ?? 3;
    return { group: "questions", requested, rendered: Math.max(1, Math.min(3, requested)) };
  }
  return null;
};

const elementMeta = (element: Record<string, unknown>): Record<string, unknown> | null => (
  element.meta && typeof element.meta === "object" ? element.meta as Record<string, unknown> : null
);

const readGeometry = (element: Record<string, unknown>): { x: number; y: number; width: number; height: number } => ({
  x: typeof element.x === "number" ? element.x : 0,
  y: typeof element.y === "number" ? element.y : 0,
  width: typeof element.width === "number" ? element.width : 0,
  height: typeof element.height === "number" ? element.height : 0,
});

const repeatIndexBounds = (elements: Array<Record<string, unknown>>, group: string): Map<number, { x: number; y: number; width: number; height: number }> => {
  const byIndex = new Map<number, Array<Record<string, unknown>>>();
  for (const element of elements) {
    const meta = elementMeta(element);
    if (meta?.repeatGroup !== group || typeof meta.repeatIndex !== "number") continue;
    const rows = byIndex.get(meta.repeatIndex) || [];
    rows.push(element);
    byIndex.set(meta.repeatIndex, rows);
  }
  return new Map([...byIndex.entries()].map(([index, rows]) => {
    const boxes = rows.map(readGeometry);
    const x = Math.min(...boxes.map((box) => box.x));
    const y = Math.min(...boxes.map((box) => box.y));
    const right = Math.max(...boxes.map((box) => box.x + box.width));
    const bottom = Math.max(...boxes.map((box) => box.y + box.height));
    return [index, { x, y, width: right - x, height: bottom - y }];
  }));
};

const moveRepeatIndex = (
  elements: Array<Record<string, unknown>>,
  group: string,
  index: number,
  deltaX: number,
  deltaY: number,
): void => {
  for (const element of elements) {
    const meta = elementMeta(element);
    if (meta?.repeatGroup !== group || meta.repeatIndex !== index) continue;
    if (typeof element.x === "number") element.x += deltaX;
    if (typeof element.y === "number") element.y += deltaY;
  }
};

const medianPositiveStep = (values: number[]): number => {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const steps = sorted.slice(1).map((value, index) => value - sorted[index]).filter((value) => value > 0);
  if (steps.length === 0) return 0;
  steps.sort((a, b) => a - b);
  return steps[Math.floor(steps.length / 2)];
};

const reflowRepeatGroup = (
  elements: Array<Record<string, unknown>>,
  group: "steps" | "questions",
  rendered: number,
  originalBounds: Map<number, { x: number; y: number; width: number; height: number }>,
): void => {
  const active = [...originalBounds.entries()].filter(([index]) => index <= rendered).sort(([a], [b]) => a - b);
  if (active.length === 0 || active.length === originalBounds.size) return;
  const distinctX = [...new Set([...originalBounds.values()].map((bounds) => bounds.x))].sort((a, b) => a - b);
  const distinctY = [...new Set([...originalBounds.values()].map((bounds) => bounds.y))].sort((a, b) => a - b);

  if (group === "steps" && distinctX.length > 1 && distinctY.length === 1) {
    const step = medianPositiveStep([...originalBounds.values()].map((bounds) => bounds.x));
    if (step <= 0) return;
    const centerX = (distinctX[0] + distinctX[distinctX.length - 1]) / 2;
    const startX = centerX - ((rendered - 1) * step) / 2;
    active.forEach(([index, bounds], position) => {
      moveRepeatIndex(elements, group, index, startX + position * step - bounds.x, 0);
    });
    return;
  }

  if (group === "steps" && distinctX.length > 1 && distinctY.length > 1) {
    const leftX = distinctX[0];
    const rightX = distinctX[distinctX.length - 1];
    const centerX = (leftX + rightX) / 2;
    const topY = distinctY[0];
    const bottomY = distinctY[distinctY.length - 1];
    const centerY = (topY + bottomY) / 2;
    const targets = rendered === 1
      ? [[centerX, centerY]]
      : rendered === 2
        ? [[leftX, centerY], [rightX, centerY]]
        : [[leftX, topY], [rightX, topY], [centerX, bottomY]];
    active.forEach(([index, bounds], position) => {
      moveRepeatIndex(elements, group, index, targets[position][0] - bounds.x, targets[position][1] - bounds.y);
    });
    return;
  }

  const step = medianPositiveStep([...originalBounds.values()].map((bounds) => bounds.y));
  if (step <= 0) return;
  const minY = Math.min(...[...originalBounds.values()].map((bounds) => bounds.y));
  const startY = minY + ((originalBounds.size - rendered) * step) / 2;
  active.forEach(([index, bounds], position) => {
    moveRepeatIndex(elements, group, index, 0, startY + position * step - bounds.y);
  });
};

const adaptRepeatGroup = (slide: Record<string, unknown>, row: CompiledSlidePlanRow): { group: "steps" | "questions"; requested: number; rendered: number } | null => {
  const request = repeatRequest(row);
  if (!request || !Array.isArray(slide.elements)) return null;
  const elements = slide.elements as Array<Record<string, unknown>>;
  const originalBounds = repeatIndexBounds(elements, request.group);
  let tagged = 0;
  slide.elements = slide.elements.filter((rawElement) => {
    if (!rawElement || typeof rawElement !== "object") return true;
    const element = rawElement as Record<string, unknown>;
    const elementMeta = element.meta && typeof element.meta === "object" ? element.meta as Record<string, unknown> : null;
    if (elementMeta?.repeatGroup !== request.group) return true;
    tagged += 1;
    const index = typeof elementMeta.repeatIndex === "number" ? elementMeta.repeatIndex : 0;
    return index <= request.rendered;
  });
  if (tagged === 0) return null;
  reflowRepeatGroup(slide.elements as Array<Record<string, unknown>>, request.group, request.rendered, originalBounds);
  return { group: request.group, requested: request.requested, rendered: request.rendered };
};

const presentTextSlotIds = (slide: Record<string, unknown>, pack: LayoutPack, fallbackSlideType: SlideType): string[] => {
  const all = textSlotIds(pack, fallbackSlideType);
  const serialized = JSON.stringify(slide);
  const present = all.filter((slotId) => serialized.includes(`{{slot:${slotId}}}`));
  return present.length > 0 ? present : all;
};

const resolveImageElementIndex = (slide: Record<string, unknown>, preferredIndex: number, slotId: string): number | null => {
  const elements = Array.isArray(slide.elements) ? slide.elements : [];
  const preferred = elements[preferredIndex];
  if (preferred && typeof preferred === "object" && (preferred as Record<string, unknown>).type === "image") return preferredIndex;
  const found = elements.findIndex((rawElement) => {
    if (!rawElement || typeof rawElement !== "object") return false;
    const element = rawElement as Record<string, unknown>;
    const elementMeta = element.meta && typeof element.meta === "object" ? element.meta as Record<string, unknown> : null;
    return element.type === "image" && (elementMeta?.placeholderKey === slotId || element.name === slotId);
  });
  return found >= 0 ? found : null;
};

const selectDynamicLayout = (params: {
  row: CompiledSlidePlanRow;
  catalog: Awaited<ReturnType<typeof loadLayoutCatalog>>;
  presentationId: number;
  themeId: string;
  variation: boolean;
}): { pack: LayoutPack | null; resolvedSlideType: SlideType; fallback?: { requested: SlideType; resolved: SlideType; reason: string } } => {
  for (const candidateType of layoutFallbacks(params.row.slideType)) {
    const candidates = params.catalog.bySlideType.get(candidateType) || [];
    const selected = selectLayoutForSlide({
      presentationId: params.presentationId,
      themeId: params.themeId,
      row: { ...params.row, slideType: candidateType },
      candidates,
      variation: params.variation,
    });
    if (selected) {
      return {
        pack: selected,
        resolvedSlideType: candidateType,
        fallback: candidateType === params.row.slideType ? undefined : {
          requested: params.row.slideType,
          resolved: candidateType,
          reason: "no compatible exact layout",
        },
      };
    }
  }

  const resolvedSlideType = builtinBaseType(params.row.slideType);
  return {
    pack: null,
    resolvedSlideType,
    fallback: resolvedSlideType === params.row.slideType ? undefined : {
      requested: params.row.slideType,
      resolved: resolvedSlideType,
      reason: "builtin fallback uses compatible base layout",
    },
  };
};

const writeTemplateZip = async (params: { path: string; doc: unknown; extraEntries: Record<string, Buffer> }): Promise<void> => {
  await fsPromises.mkdir(path.dirname(params.path), { recursive: true });
  const zipWriter = new yazl.ZipFile();
  const stream = fs.createWriteStream(params.path);
  zipWriter.outputStream.pipe(stream);
  zipWriter.addBuffer(Buffer.from(JSON.stringify(params.doc, null, 2), "utf8"), "doc.json");
  zipWriter.addBuffer(Buffer.from(PNG_BASE64, "base64"), "assets/images/placeholder.png");
  for (const [name, buffer] of Object.entries(params.extraEntries)) {
    zipWriter.addBuffer(buffer, name);
  }
  zipWriter.end();
  await new Promise<void>((resolve, reject) => {
    stream.on("close", () => resolve());
    stream.on("error", reject);
  });
};

export const compileLayoutPresentation = async (params: {
  presentationId: number;
  themeId: string;
  jobId: string;
  variation: boolean;
  legacyTemplateZipPath: string;
  deckPlan?: DeckPlan;
  topic?: string;
  language?: string;
  contentDensityBySlide?: Record<number, "low" | "medium" | "high">;
}): Promise<{
  doc: unknown;
  templateZipPath: string;
  diagnostics: LayoutEngineDiagnostics;
  layoutIds: string[];
  imageAtBySlide: Record<string, Record<string, unknown>>;
}> => {
  const deckPlan = params.deckPlan ?? buildDeterministicDeckPlan({
    topic: params.topic || "Presentation",
    language: params.language || "ru",
    slideCount: 10,
    presentationType: "auto",
  });
  const dynamicPlan = buildDynamicSlidePlan(deckPlan, params.contentDensityBySlide);
  const plan = dynamicPlan.rows;
  const catalog = await loadLayoutCatalog();
  const selectedLayouts: LayoutEngineDiagnostics["selectedLayouts"] = [];
  const missingLayoutTypes: string[] = [];
  const slotBindingWarnings: string[] = [];
  const dynamicBindings: NonNullable<LayoutEngineDiagnostics["dynamicBindings"]> = [];
  const duplicateFillKeys: string[] = [];
  const seenFillKeys = new Set<string>();
  const fallbackSlideTypeMappings: NonNullable<LayoutEngineDiagnostics["fallbackSlideTypeMappings"]> = [];
  const repeatGroupAdaptations: NonNullable<LayoutEngineDiagnostics["repeatGroupAdaptations"]> = [];
  const mergedRows: Array<{ slide: number; layoutId: string; docSlide: unknown; zipPath?: string }> = [];
  const imageAtBySlide: Record<string, Record<string, unknown>> = {};

  for (const row of plan) {
    const selected = selectDynamicLayout({
      row,
      catalog,
      presentationId: params.presentationId,
      themeId: params.themeId,
      variation: params.variation,
    });
    if (selected.fallback) fallbackSlideTypeMappings.push({ slide: row.slide, ...selected.fallback });

    if (!selected.pack) {
      missingLayoutTypes.push(row.slideType);
      const built = builtinSlide(selected.resolvedSlideType);
      const bindings = getDynamicSlotBindings(row.slide, getDefaultSlotsForSlideType(selected.resolvedSlideType));
      for (const [slotName, fillKey] of Object.entries(bindings)) {
        dynamicBindings.push({ slide: row.slide, slotName, fillKey });
        if (seenFillKeys.has(fillKey)) duplicateFillKeys.push(fillKey);
        seenFillKeys.add(fillKey);
      }
      applyBinding(built, bindings, slotBindingWarnings);
      mergedRows.push({ slide: row.slide, layoutId: `builtin-${selected.resolvedSlideType}`, docSlide: built });
      selectedLayouts.push({ slide: row.slide, slideType: row.slideType, resolvedSlideType: selected.resolvedSlideType, layoutId: `builtin-${selected.resolvedSlideType}`, source: "builtin", hadFallback: true, fallbackSlideType: selected.fallback?.resolved });
      continue;
    }

    const doc = await readDocJsonFromTemplateZip(selected.pack.zipPath);
    const slides = (doc && typeof doc === "object" && Array.isArray((doc as Record<string, unknown>).slides)
      ? (doc as Record<string, unknown>).slides
      : []) as unknown[];
    const slide = (slides[0] && typeof slides[0] === "object" ? slides[0] : { elements: [] }) as Record<string, unknown>;
    const repeatAdaptation = adaptRepeatGroup(slide, row);
    if (repeatAdaptation) repeatGroupAdaptations.push({ slide: row.slide, ...repeatAdaptation });

    const bindings = getDynamicSlotBindings(row.slide, presentTextSlotIds(slide, selected.pack, selected.resolvedSlideType));
    for (const [slotName, fillKey] of Object.entries(bindings)) {
      dynamicBindings.push({ slide: row.slide, slotName, fillKey });
      if (seenFillKeys.has(fillKey)) duplicateFillKeys.push(fillKey);
      seenFillKeys.add(fillKey);
    }
    applyBinding(slide, bindings, slotBindingWarnings);
    mergedRows.push({ slide: row.slide, layoutId: selected.pack.id, docSlide: slide, zipPath: selected.pack.zipPath });
    selectedLayouts.push({ slide: row.slide, slideType: row.slideType, resolvedSlideType: selected.resolvedSlideType, layoutId: selected.pack.id, source: selected.pack.source, hadFallback: Boolean(selected.fallback), fallbackSlideType: selected.fallback?.resolved });

    const imageAt: Record<string, unknown> = {};
    selected.pack.manifest.imageSlots.forEach((slot) => {
      const elementIndex = resolveImageElementIndex(slide, slot.elementIndex, slot.slotId);
      if (elementIndex === null) return;
      imageAt[String(elementIndex)] = { slotId: `img_s${row.slide}_${slot.slotId || elementIndex}`, kind: slot.kind || "photo", aspect: slot.aspect || "any" };
    });
    if (Object.keys(imageAt).length > 0) imageAtBySlide[String(row.slide)] = imageAt;
  }

  const merged = await mergeLayoutSlides({ slides: mergedRows });

  const templateZipPath = path.resolve(".tmp", params.jobId, "layout-template.out.zip");
  await writeTemplateZip({ path: templateZipPath, doc: merged.doc, extraEntries: merged.extraEntries });

  const diagnostics: LayoutEngineDiagnostics = {
    enabled: true,
    mode: selectedLayouts.every((row) => row.source === "builtin") ? "builtins" : "catalog",
    dynamicPlanUsed: true,
    deckPlanSlideCount: deckPlan.slideCount,
    compiledSlideTypes: dynamicPlan.diagnostics.compiledSlideTypes.map((row) => ({
      ...row,
      layoutSlideType: selectedLayouts.find((selected) => selected.slide === row.slide)?.resolvedSlideType,
    })),
    fallbackSlideTypeMappings,
    fallbackSlotInferences: dynamicPlan.diagnostics.fallbackSlotInferences,
    repeatGroupAdaptations,
    unsupportedSlideTypes: dynamicPlan.diagnostics.unsupportedSlideTypes,
    dynamicBindings,
    missingSlotBindings: slotBindingWarnings,
    duplicateFillKeys: [...new Set(duplicateFillKeys)],
    legacyEmergencyFallbackUsed: false,
    selectedLayouts,
    missingLayoutTypes,
    slotBindingWarnings,
    mergedAssetsCount: merged.mergedAssetsCount,
  };

  return {
    doc: merged.doc,
    templateZipPath,
    diagnostics,
    layoutIds: selectedLayouts.map((row) => row.layoutId),
    imageAtBySlide,
  };
};
