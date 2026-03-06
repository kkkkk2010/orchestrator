import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import yazl from "yazl";
import { getSlotBindings } from "./binder";
import { loadLayoutCatalog } from "./catalog";
import { mergeLayoutSlides } from "./merge";
import { selectLayoutForSlide } from "./selector";
import { buildTeacherSlidePlan } from "./slidePlan";
import type { LayoutEngineDiagnostics, LayoutPack, SlideType } from "./types";
import { readDocJsonFromTemplateZip } from "../themes/templateZip";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5f0tQAAAAASUVORK5CYII=";

const builtinSlide = (slideType: SlideType): { elements: Array<Record<string, unknown>> } => {
  const mkText = (slotId: string, x: number, y: number, w: number, h: number) => ({ type: "text", x, y, width: w, height: h, text: `{{slot:${slotId}}}` });
  const mkImage = (id: string, x: number, y: number, w: number, h: number) => ({ type: "image", name: id, x, y, width: w, height: h, src: "assets/images/placeholder.png", meta: { placeholder: true } });

  switch (slideType) {
    case "cover": return { elements: [mkText("title", 80, 90, 900, 140), mkText("subtitle", 80, 250, 780, 70), mkText("meta", 80, 330, 780, 60), mkImage("hero_1", 980, 120, 470, 520)] };
    case "goals": return { elements: [mkText("title", 80, 70, 1100, 110), mkText("goals", 80, 220, 650, 480), mkText("plan", 760, 220, 690, 480)] };
    case "hook": return { elements: [mkText("title", 80, 70, 1100, 110), mkText("hook_question", 80, 210, 820, 100), mkText("hook_hint", 80, 320, 820, 110), mkText("hook_fact", 80, 440, 820, 110), mkText("hook_why", 80, 560, 820, 110), mkImage("hero_1", 940, 220, 510, 420)] };
    case "definition": return { elements: [mkText("title", 80, 70, 1100, 110), mkText("definition", 80, 230, 700, 200), mkText("keywords", 80, 450, 700, 240), mkImage("hero_1", 830, 220, 620, 470)] };
    case "bullets": return { elements: [mkText("title", 80, 70, 1000, 110), mkText("bullets", 80, 220, 820, 470), mkImage("hero_1", 940, 220, 510, 470)] };
    case "twoCol": return { elements: [mkText("title", 80, 70, 1100, 110), mkText("left_title", 80, 220, 640, 70), mkText("left_bullets", 80, 300, 640, 390), mkText("right_title", 770, 220, 640, 70), mkText("right_bullets", 770, 300, 640, 390)] };
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
}): Promise<{
  doc: unknown;
  templateZipPath: string;
  diagnostics: LayoutEngineDiagnostics;
  layoutIds: string[];
  imageAtBySlide: Record<string, Record<string, unknown>>;
}> => {
  const plan = buildTeacherSlidePlan();
  const catalog = await loadLayoutCatalog();
  const selectedLayouts: LayoutEngineDiagnostics["selectedLayouts"] = [];
  const missingLayoutTypes: string[] = [];
  const slotBindingWarnings: string[] = [];
  const mergedRows: Array<{ slide: number; layoutId: string; docSlide: unknown; zipPath?: string }> = [];
  const imageAtBySlide: Record<string, Record<string, unknown>> = {};

  for (const row of plan) {
    const candidates = catalog.bySlideType.get(row.slideType) || [];
    const selected = selectLayoutForSlide({ presentationId: params.presentationId, themeId: params.themeId, row, candidates, variation: params.variation });

    if (!selected) {
      missingLayoutTypes.push(row.slideType);
      const built = builtinSlide(row.slideType);
      applyBinding(built, getSlotBindings(row.slideType), slotBindingWarnings);
      mergedRows.push({ slide: row.slide, layoutId: `builtin-${row.slideType}`, docSlide: built });
      selectedLayouts.push({ slide: row.slide, slideType: row.slideType, layoutId: `builtin-${row.slideType}`, source: "builtin", hadFallback: true });
      continue;
    }

    const doc = await readDocJsonFromTemplateZip(selected.zipPath);
    const slides = (doc && typeof doc === "object" && Array.isArray((doc as Record<string, unknown>).slides)
      ? (doc as Record<string, unknown>).slides
      : []) as unknown[];
    const slide = (slides[0] && typeof slides[0] === "object" ? slides[0] : { elements: [] }) as Record<string, unknown>;

    applyBinding(slide, getSlotBindings(row.slideType), slotBindingWarnings);
    mergedRows.push({ slide: row.slide, layoutId: selected.id, docSlide: slide, zipPath: selected.zipPath });
    selectedLayouts.push({ slide: row.slide, slideType: row.slideType, layoutId: selected.id, source: selected.source, hadFallback: false });

    const imageAt: Record<string, unknown> = {};
    selected.manifest.imageSlots.forEach((slot) => {
      imageAt[String(slot.elementIndex)] = { slotId: `img_s${row.slide}`, kind: slot.kind || "photo", aspect: slot.aspect || "any" };
    });
    if (Object.keys(imageAt).length > 0) imageAtBySlide[String(row.slide)] = imageAt;
  }

  const merged = await mergeLayoutSlides({ slides: mergedRows });

  const templateZipPath = path.resolve(".tmp", params.jobId, "layout-template.out.zip");
  await writeTemplateZip({ path: templateZipPath, doc: merged.doc, extraEntries: merged.extraEntries });

  const diagnostics: LayoutEngineDiagnostics = {
    enabled: true,
    mode: selectedLayouts.every((row) => row.source === "builtin") ? "builtins" : "catalog",
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
