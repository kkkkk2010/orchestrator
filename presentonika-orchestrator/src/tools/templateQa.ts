import fs from "node:fs/promises";
import fsSync from "node:fs";
import yauzl from "yauzl";
import path from "node:path";
import { extractFillKeys, extractPlaceholderLocations, inferSlideCount } from "../themes/parseDoc";
import { readDocJsonFromTemplateZip } from "../themes/templateZip";
import { getThemeTemplateZipPath } from "../themes/themeStore";
import { REQUIRED_SKELETON_KEYS } from "./skeletonKeys";
import { detectPlaceholderImageElements } from "../images/imagePlan";

type TemplateQaInput = {
  themeId: string;
  templateZipPath?: string;
};

const extractZipToDir = async (zipPath: string, outDir: string): Promise<void> => {
  await fs.mkdir(outDir, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (error, zipFile) => {
      if (error || !zipFile) return reject(error ?? new Error("unable to open zip"));

      zipFile.on("entry", (entry) => {
        const outPath = path.resolve(outDir, entry.fileName);
        if (entry.fileName.endsWith("/")) {
          void fs.mkdir(outPath, { recursive: true }).then(() => zipFile.readEntry());
          return;
        }

        void fs.mkdir(path.dirname(outPath), { recursive: true }).then(() => {
          zipFile.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) return reject(streamError ?? new Error("entry read failed"));
            const writer = fsSync.createWriteStream(outPath);
            stream.pipe(writer);
            writer.on("close", () => zipFile.readEntry());
            writer.on("error", reject);
          });
        });
      });

      zipFile.on("end", () => resolve());
      zipFile.on("error", reject);
      zipFile.readEntry();
    });
  });
};

export type QaReport = {
  themeId: string;
  templatePath: string;
  extractDir: string;
  slideCount: number;
  fillKeys: string[];
  fillLocationsCount: number;
  missingKeysInTemplate: string[];
  duplicateKeysLocations: Array<{ key: string; count: number; slides: number[] }>;
  textElementsWithoutPlaceholders: Array<{ slide: number; elementIndex: number; textSample: string }>;
  imageElementsSummary: {
    totalImageElements: number;
    placeholderLikeCount: number;
    decorBackgroundLikeCount: number;
  };
  generatedAt: string;
};

export const findMissingSkeletonKeys = (fillKeys: string[]): string[] => REQUIRED_SKELETON_KEYS.filter((key) => !fillKeys.includes(key));

const collectSlides = (doc: unknown): unknown[] => {
  if (!doc || typeof doc !== "object") return [];
  const record = doc as Record<string, unknown>;
  if (Array.isArray(record.slides)) return record.slides;
  if (Array.isArray(record.pages)) return record.pages;
  return [];
};

const looksContentText = (element: Record<string, unknown>): boolean => {
  const text = typeof element.text === "string" ? element.text : "";
  const width = typeof element.width === "number" ? element.width : 0;
  const height = typeof element.height === "number" ? element.height : 0;
  if (text.trim().length > 25) return true;
  return width > 220 && height > 40;
};

export const buildTemplateQaReport = async (params: string | TemplateQaInput): Promise<QaReport> => {
  const input = typeof params === "string" ? { themeId: params } : params;
  const templatePath = input.templateZipPath || getThemeTemplateZipPath(input.themeId);
  const extractDir = path.resolve(".tmp", "template-qa", `${input.themeId}.unzipped`);

  await extractZipToDir(templatePath, extractDir);
  const doc = await readDocJsonFromTemplateZip(templatePath);
  const placeholderScan = extractPlaceholderLocations(doc);
  const fillKeys = extractFillKeys(doc);
  const keyToSlides = new Map<string, number[]>();

  for (const location of placeholderScan.locations) {
    if (!keyToSlides.has(location.key)) keyToSlides.set(location.key, []);
    keyToSlides.get(location.key)?.push(location.slide);
  }

  const duplicateKeysLocations = [...keyToSlides.entries()]
    .filter(([, slides]) => slides.length > 1)
    .map(([key, slides]) => ({ key, count: slides.length, slides }));

  const slides = collectSlides(doc);
  const withPlaceholder = new Set(placeholderScan.locations.map((location) => `${location.slide}-${location.elementIndex}`));
  const textElementsWithoutPlaceholders: Array<{ slide: number; elementIndex: number; textSample: string }> = [];

  slides.forEach((slideUnknown, slideIdx0) => {
    const slide = slideIdx0 + 1;
    const slideRecord = (slideUnknown && typeof slideUnknown === "object" ? slideUnknown : {}) as Record<string, unknown>;
    const elements = Array.isArray(slideRecord.elements) ? slideRecord.elements : [];

    elements.forEach((elementUnknown, elementIndex) => {
      const element = (elementUnknown && typeof elementUnknown === "object" ? elementUnknown : {}) as Record<string, unknown>;
      const marker = `${slide}-${elementIndex}`;
      if (withPlaceholder.has(marker)) return;
      if (!looksContentText(element)) return;

      const text = typeof element.text === "string" ? element.text : "";
      if (text.trim().length === 0) return;
      textElementsWithoutPlaceholders.push({ slide, elementIndex, textSample: text.slice(0, 140) });
    });
  });

  let totalImageElements = 0;
  let decorBackgroundLikeCount = 0;
  slides.forEach((slideUnknown) => {
    const slideRecord = (slideUnknown && typeof slideUnknown === "object" ? slideUnknown : {}) as Record<string, unknown>;
    const elements = Array.isArray(slideRecord.elements) ? slideRecord.elements : [];
    elements.forEach((elementUnknown) => {
      const element = (elementUnknown && typeof elementUnknown === "object" ? elementUnknown : {}) as Record<string, unknown>;
      const type = typeof element.type === "string" ? element.type.toLowerCase() : "";
      if (type === "image") {
        totalImageElements += 1;
        const src = typeof element.src === "string" ? element.src.toLowerCase() : "";
        if (src.startsWith("backgrounds/") || src.includes("decor/")) decorBackgroundLikeCount += 1;
      }
    });
  });

  const placeholderLikeCount = detectPlaceholderImageElements({
    doc,
    fallbackAllNonDecor: process.env.IMAGEPLAN_DETECT_FALLBACK_ALL_NON_DECOR !== "false",
  }).length;

  return {
    themeId: input.themeId,
    templatePath,
    extractDir,
    slideCount: inferSlideCount(doc),
    fillKeys,
    fillLocationsCount: placeholderScan.locations.length,
    missingKeysInTemplate: findMissingSkeletonKeys(fillKeys),
    duplicateKeysLocations,
    textElementsWithoutPlaceholders,
    imageElementsSummary: { totalImageElements, placeholderLikeCount, decorBackgroundLikeCount },
    generatedAt: new Date().toISOString(),
  };
};

const run = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const themeId = args[0];
  const zipIndex = args.indexOf("--zip");
  const zipPath = zipIndex >= 0 ? args[zipIndex + 1] : undefined;

  if (!themeId) {
    console.error("Usage: npm run template:qa -- <themeId> [--zip <path>]");
    process.exit(1);
  }

  const report = await buildTemplateQaReport({ themeId, templateZipPath: zipPath });
  const outDir = path.resolve(".tmp", "template-qa");
  await fs.mkdir(outDir, { recursive: true });
  const reportPath = path.resolve(outDir, `${themeId}.report.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

  console.log(`Template QA for ${themeId}`);
  console.log(`- slides: ${report.slideCount}`);
  console.log(`- extracted to: ${report.extractDir}`);
  console.log(`- fill keys: ${report.fillKeys.length}`);
  console.log(`- missing skeleton keys: ${report.missingKeysInTemplate.length}`);
  console.log(`- duplicate key locations: ${report.duplicateKeysLocations.length}`);
  console.log(`- content text elements without placeholders: ${report.textElementsWithoutPlaceholders.length}`);
  console.log(`- image placeholders: ${report.imageElementsSummary.placeholderLikeCount}/${report.imageElementsSummary.totalImageElements}`);
  console.log(`report: ${reportPath}`);
};

if (require.main === module) {
  void run();
}
