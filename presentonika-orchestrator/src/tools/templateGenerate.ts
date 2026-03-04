import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import yauzl from "yauzl";
import yazl from "yazl";
import { readDocJsonFromTemplateZip } from "../themes/templateZip";
import { getThemeTemplateZipPath, getThemesRootDir } from "../themes/themeStore";
import { REQUIRED_SKELETON_KEYS } from "./skeletonKeys";
import { buildTemplateQaReport } from "./templateQa";
import { applyTypographyStandards, resolveThemeTypography } from "../templates/textPostprocess";
import { extractPlaceholderLocations } from "../themes/parseDoc";


const resolveSourceTemplatePath = async (themeId: string): Promise<string> => {
  const primary = getThemeTemplateZipPath(themeId);
  try {
    await fsPromises.access(primary);
    return primary;
  } catch {
    const fallback = path.resolve("themes", themeId, "template.out.zip");
    await fsPromises.access(fallback);
    return fallback;
  }
};

const PLACEHOLDER_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5f0tQAAAAASUVORK5CYII=";

type Bbox = { x: number; y: number; width: number; height: number };
type SlideLayout = { text: Array<{ key: string; bbox: Bbox }>; image?: Bbox };

const makeLayout = (): Record<number, SlideLayout> => ({
  1: {
    text: [
      { key: "s1_title", bbox: { x: 80, y: 90, width: 900, height: 140 } },
      { key: "s1_subtitle", bbox: { x: 80, y: 250, width: 780, height: 70 } },
      { key: "s1_meta", bbox: { x: 80, y: 330, width: 780, height: 60 } },
    ],
    image: { x: 980, y: 120, width: 470, height: 520 },
  },
  2: {
    text: [
      { key: "s2_title", bbox: { x: 80, y: 70, width: 1100, height: 110 } },
      { key: "s2_goals", bbox: { x: 80, y: 220, width: 650, height: 480 } },
      { key: "s2_plan", bbox: { x: 760, y: 220, width: 690, height: 480 } },
    ],
    image: { x: 1100, y: 70, width: 350, height: 160 },
  },
  3: { text: [{ key: "s3_title", bbox: { x: 80, y: 70, width: 1100, height: 110 } }], image: { x: 980, y: 220, width: 470, height: 420 } },
  4: {
    text: [
      { key: "s4_title", bbox: { x: 80, y: 70, width: 1100, height: 110 } },
      { key: "s4_definition", bbox: { x: 80, y: 230, width: 700, height: 200 } },
      { key: "s4_keywords", bbox: { x: 80, y: 450, width: 700, height: 240 } },
    ],
    image: { x: 830, y: 220, width: 620, height: 470 },
  },
  5: {
    text: [
      { key: "s5_title", bbox: { x: 80, y: 70, width: 1000, height: 110 } },
      { key: "s5_bullets", bbox: { x: 80, y: 220, width: 820, height: 470 } },
    ],
    image: { x: 940, y: 220, width: 510, height: 470 },
  },
  6: {
    text: [
      { key: "s6_title", bbox: { x: 80, y: 70, width: 1100, height: 110 } },
      { key: "s6_left_title", bbox: { x: 80, y: 220, width: 640, height: 70 } },
      { key: "s6_left_bullets", bbox: { x: 80, y: 300, width: 640, height: 390 } },
      { key: "s6_right_title", bbox: { x: 770, y: 220, width: 640, height: 70 } },
      { key: "s6_right_bullets", bbox: { x: 770, y: 300, width: 640, height: 390 } },
    ],
  },
  7: {
    text: [
      { key: "s7_title", bbox: { x: 80, y: 70, width: 1100, height: 110 } },
      { key: "s7_step1", bbox: { x: 80, y: 220, width: 640, height: 90 } },
      { key: "s7_step2", bbox: { x: 80, y: 320, width: 640, height: 90 } },
      { key: "s7_step3", bbox: { x: 80, y: 420, width: 640, height: 90 } },
      { key: "s7_step4", bbox: { x: 80, y: 520, width: 640, height: 90 } },
    ],
    image: { x: 780, y: 220, width: 670, height: 420 },
  },
  8: {
    text: [
      { key: "s8_title", bbox: { x: 80, y: 70, width: 1000, height: 110 } },
      { key: "s8_examples", bbox: { x: 80, y: 220, width: 820, height: 470 } },
    ],
    image: { x: 940, y: 220, width: 510, height: 470 },
  },
  9: { text: [{ key: "s9_title", bbox: { x: 80, y: 70, width: 1100, height: 110 } }], image: { x: 980, y: 220, width: 470, height: 420 } },
  10: {
    text: [
      { key: "s10_title", bbox: { x: 80, y: 70, width: 1000, height: 110 } },
      { key: "s10_summary", bbox: { x: 80, y: 220, width: 780, height: 200 } },
      { key: "s10_homework", bbox: { x: 80, y: 440, width: 780, height: 150 } },
      { key: "s10_sources", bbox: { x: 80, y: 610, width: 1200, height: 120 } },
    ],
    image: { x: 900, y: 220, width: 550, height: 360 },
  },
});

const openZip = (zipPath: string): Promise<yauzl.ZipFile> => new Promise((resolve, reject) => {
  yauzl.open(zipPath, { lazyEntries: true }, (error, zipFile) => {
    if (error || !zipFile) return reject(error ?? new Error("zip open failed"));
    resolve(zipFile);
  });
});

const getSlides = (doc: unknown): unknown[] => {
  if (!doc || typeof doc !== "object") return [];
  const record = doc as Record<string, unknown>;
  if (Array.isArray(record.slides)) return record.slides;
  return [];
};

const makeTextElement = (proto: Record<string, unknown>, id: string, key: string, bbox: Bbox): Record<string, unknown> => ({
  ...proto,
  id,
  type: "text",
  x: bbox.x,
  y: bbox.y,
  width: bbox.width,
  height: bbox.height,
  text: `{{${key}}}`,
});

const makeImageElement = (proto: Record<string, unknown>, id: string, slide: number, bbox: Bbox): Record<string, unknown> => ({
  ...proto,
  id,
  type: "image",
  x: bbox.x,
  y: bbox.y,
  width: bbox.width,
  height: bbox.height,
  src: "assets/images/placeholder.png",
  name: `image_placeholder_s${slide}`,
  meta: { ...(proto.meta && typeof proto.meta === "object" ? proto.meta as Record<string, unknown> : {}), placeholder: true, placeholderKey: `img_s${slide}` },
});

const collectPrototype = (slides: unknown[]): { text: Record<string, unknown>; image: Record<string, unknown>; slide: Record<string, unknown> } => {
  let textProto: Record<string, unknown> | null = null;
  let imageProto: Record<string, unknown> | null = null;
  const slideProto = (slides[0] && typeof slides[0] === "object" ? slides[0] : { elements: [] }) as Record<string, unknown>;

  for (const slideUnknown of slides) {
    const slide = (slideUnknown && typeof slideUnknown === "object" ? slideUnknown : {}) as Record<string, unknown>;
    const elements = Array.isArray(slide.elements) ? slide.elements : [];
    for (const elementUnknown of elements) {
      const element = (elementUnknown && typeof elementUnknown === "object" ? elementUnknown : {}) as Record<string, unknown>;
      if (!textProto && (element.type === "text" || typeof element.text === "string")) textProto = { ...element };
      if (!imageProto && (element.type === "image" || typeof element.src === "string")) imageProto = { ...element };
    }
  }

  return {
    text: textProto || { type: "text", style: {} },
    image: imageProto || { type: "image", style: {} },
    slide: slideProto,
  };
};

export const buildGeneratedDoc = (doc: unknown): unknown => {
  const record = (doc && typeof doc === "object" ? doc : {}) as Record<string, unknown>;
  const slides = getSlides(doc);
  const prototype = collectPrototype(slides);
  const layout = makeLayout();

  const nextSlides: unknown[] = [];
  for (let slideNum = 1; slideNum <= 10; slideNum += 1) {
    const baseSlide = (slides[slideNum - 1] && typeof slides[slideNum - 1] === "object"
      ? slides[slideNum - 1]
      : JSON.parse(JSON.stringify(prototype.slide))) as Record<string, unknown>;

    const slideLayout = layout[slideNum] || { text: [] };
    const elements: unknown[] = [];

    for (const textSpec of slideLayout.text) {
      elements.push(makeTextElement(prototype.text, `s${slideNum}_${textSpec.key}`, textSpec.key, textSpec.bbox));
    }

    if (slideLayout.image) {
      elements.push(makeImageElement(prototype.image, `s${slideNum}_image`, slideNum, slideLayout.image));
    }

    baseSlide.elements = elements;
    nextSlides.push(baseSlide);
  }

  record.slides = nextSlides;
  return record;
};

const rewriteTemplateZip = async (params: {
  sourceZipPath: string;
  outputZipPath: string;
  docJsonString: string;
  ensurePlaceholderAsset: boolean;
}): Promise<void> => {
  const zipFile = await openZip(params.sourceZipPath);
  const writer = new yazl.ZipFile();
  const output = fs.createWriteStream(params.outputZipPath);
  writer.outputStream.pipe(output);

  await new Promise<void>((resolve, reject) => {
    let foundDoc = false;
    let foundPlaceholderAsset = false;

    const fail = (error: unknown): void => reject(error instanceof Error ? error : new Error(String(error)));

    zipFile.on("entry", (entry) => {
      if (entry.fileName.endsWith("/")) {
        writer.addEmptyDirectory(entry.fileName);
        zipFile.readEntry();
        return;
      }

      if (entry.fileName === "doc.json") {
        foundDoc = true;
        writer.addBuffer(Buffer.from(params.docJsonString, "utf8"), entry.fileName);
        zipFile.readEntry();
        return;
      }

      if (entry.fileName === "assets/images/placeholder.png") {
        foundPlaceholderAsset = true;
      }

      zipFile.openReadStream(entry, (error, stream) => {
        if (error || !stream) return fail(error ?? new Error("entry stream failed"));
        writer.addReadStream(stream, entry.fileName);
        zipFile.readEntry();
      });
    });

    zipFile.on("end", () => {
      if (!foundDoc) return fail(new Error("template missing doc.json"));
      if (params.ensurePlaceholderAsset && !foundPlaceholderAsset) {
        writer.addBuffer(Buffer.from(PLACEHOLDER_PNG_BASE64, "base64"), "assets/images/placeholder.png");
      }
      writer.end();
    });

    output.on("close", resolve);
    output.on("error", fail);
    zipFile.on("error", fail);
    zipFile.readEntry();
  });
};

const run = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const themeId = args[0];
  const writeFlag = args.includes("--write");

  if (!themeId) {
    console.error("Usage: npm run template:generate -- <themeId> [--write]");
    process.exit(1);
  }

  const sourceZipPath = await resolveSourceTemplatePath(themeId);
  const sourceDoc = await readDocJsonFromTemplateZip(sourceZipPath);
  const generatedDoc = buildGeneratedDoc(sourceDoc);

  const themeRoot = path.resolve("themes-local", themeId);
  await fsPromises.mkdir(themeRoot, { recursive: true });

  const generatedZipPath = path.resolve(themeRoot, "template.generated.out.zip");
  await rewriteTemplateZip({
    sourceZipPath,
    outputZipPath: generatedZipPath,
    docJsonString: JSON.stringify(generatedDoc, null, 2),
    ensurePlaceholderAsset: true,
  });

  const placeholderLocations = extractPlaceholderLocations(generatedDoc).locations;
  const typography = resolveThemeTypography(themeId, {});
  applyTypographyStandards({ doc: generatedDoc, placeholderLocations, themeTypography: typography });

  await rewriteTemplateZip({
    sourceZipPath,
    outputZipPath: generatedZipPath,
    docJsonString: JSON.stringify(generatedDoc, null, 2),
    ensurePlaceholderAsset: true,
  });

  if (writeFlag) {
    await fsPromises.copyFile(generatedZipPath, path.resolve(themeRoot, "template.out.zip"));
  }

  const report = await buildTemplateQaReport({ themeId, templateZipPath: generatedZipPath });
  const reportPath = path.resolve(".tmp", "template-qa", `${themeId}.generated.report.json`);
  await fsPromises.mkdir(path.dirname(reportPath), { recursive: true });
  await fsPromises.writeFile(reportPath, JSON.stringify(report, null, 2));

  console.log(`Generated template: ${generatedZipPath}`);
  console.log(`QA report: ${reportPath}`);
  console.log(`missingKeysInTemplate=${report.missingKeysInTemplate.length}`);

  if (report.missingKeysInTemplate.length > 0) {
    console.error(`Missing keys: ${report.missingKeysInTemplate.join(", ")}`);
    process.exit(1);
  }

  console.log(`themesRootUsed=${getThemesRootDir()}`);
};

if (require.main === module) {
  void run();
}
