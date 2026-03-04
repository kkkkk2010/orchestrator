import fs from "node:fs/promises";
import path from "node:path";
import { extractFillKeys, inferSlideCount } from "../themes/parseDoc";
import { readDocJsonFromTemplateZip } from "../themes/templateZip";
import { getThemeDir, getThemeMapPath, getThemeTemplateZipPath, getThemeJsonPath } from "../themes/themeStore";
import { detectPlaceholderImageElements } from "../images/imagePlan";
import { REQUIRED_SKELETON_KEYS } from "./skeletonKeys";
import { buildTemplateQaReport } from "./templateQa";

const MAX_TEMPLATE_ZIP_BYTES = Number.parseInt(process.env.MAX_TEMPLATE_ZIP_BYTES || "200000000", 10);


const getSlides = (doc: unknown): unknown[] => {
  if (!doc || typeof doc !== "object") return [];
  const record = doc as Record<string, unknown>;
  if (Array.isArray(record.slides)) return record.slides;
  if (Array.isArray(record.pages)) return record.pages;
  return [];
};

const parseJsonSafe = async (filePath: string): Promise<unknown> => {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as unknown;
};

const run = async (): Promise<void> => {
  const themeId = process.argv[2];
  if (!themeId) {
    console.error("Usage: npm run theme:validate -- <themeId>");
    process.exit(1);
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  const themeDir = getThemeDir(themeId);
  const mapPath = getThemeMapPath(themeId);
  const themeJsonPath = getThemeJsonPath(themeId);
  const templatePath = getThemeTemplateZipPath(themeId);
  const metaPath = path.resolve(themeDir, "meta.json");
  const decorPath = path.resolve(themeDir, "decor");

  for (const reqPath of [themeDir, mapPath, themeJsonPath, templatePath, metaPath, decorPath]) {
    try {
      await fs.access(reqPath);
    } catch {
      errors.push(`missing required path: ${reqPath}`);
    }
  }

  let doc: unknown = {};
  let slides: unknown[] = [];

  try {
    const stat = await fs.stat(templatePath);
    if (stat.size > MAX_TEMPLATE_ZIP_BYTES) {
      errors.push(`template too large: ${stat.size} > ${MAX_TEMPLATE_ZIP_BYTES}`);
    }
  } catch {
    // missing already reported
  }

  try {
    doc = await readDocJsonFromTemplateZip(templatePath);
    slides = getSlides(doc);
    const slideCount = inferSlideCount(doc);
    if (slideCount !== 10) {
      errors.push(`doc.json must have 10 slides, got ${slideCount}`);
    }
  } catch (error) {
    errors.push(`template parse failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  let map: Record<string, unknown> = {};
  try {
    const parsed = await parseJsonSafe(mapPath);
    map = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  } catch (error) {
    errors.push(`map.json parse failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const fillKeys = extractFillKeys(doc);
  for (const key of REQUIRED_SKELETON_KEYS) {
    if (!fillKeys.includes(key)) {
      errors.push(`skeleton key missing in template fillKeys: ${key}`);
    }
  }

  try {
    const qa = await buildTemplateQaReport(themeId);
    if (qa.textElementsWithoutPlaceholders.length > 0) {
      warnings.push(`content text elements without placeholders: ${qa.textElementsWithoutPlaceholders.length}`);
      qa.textElementsWithoutPlaceholders.slice(0, 12).forEach((item) => {
        warnings.push(`slide ${item.slide} element ${item.elementIndex} has content text without {{key}}`);
      });
    }
  } catch (error) {
    warnings.push(`template qa summary failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // background naming warning (do not require file presence in template zip)
  slides.forEach((slide, idx) => {
    const slideIndex1 = idx + 1;
    const slideRecord = (slide && typeof slide === "object" ? slide : {}) as Record<string, unknown>;
    const background = (slideRecord.background && typeof slideRecord.background === "object"
      ? slideRecord.background
      : {}) as Record<string, unknown>;

    if (background.type !== "image") {
      return;
    }

    const src = typeof background.src === "string" ? background.src : "";
    const matched = src.match(/^backgrounds\/slide-(\d+)\.png$/);

    if (matched && Number.parseInt(matched[1], 10) === slideIndex1) {
      return;
    }

    warnings.push(
      `slide ${slideIndex1}: background image src has unexpected naming '${src || "<empty>"}', expected 'backgrounds/slide-${slideIndex1}.png'`
    );
  });


  const detectedPlaceholders = detectPlaceholderImageElements({
    doc,
    fallbackAllNonDecor: process.env.IMAGEPLAN_DETECT_FALLBACK_ALL_NON_DECOR !== "false",
  });
  if (detectedPlaceholders.length === 0) {
    warnings.push("No placeholder images detected -> editor 'Подобрать' won't show unless map forces slots");
  }

  const mapSlides = (map.slides && typeof map.slides === "object" ? map.slides : {}) as Record<string, unknown>;
  const hasAnyImageAt = Object.values(mapSlides).some((slideRuleUnknown) => {
    const slideRule = (slideRuleUnknown && typeof slideRuleUnknown === "object" ? slideRuleUnknown : {}) as Record<string, unknown>;
    const imageAt = (slideRule.imageAt && typeof slideRule.imageAt === "object" ? slideRule.imageAt : {}) as Record<string, unknown>;
    return Object.keys(imageAt).length > 0;
  });
  if (!hasAnyImageAt) {
    warnings.push("map.json has no imageAt bindings; auto-detect will be used for imagePlan slots");
  }

  for (const [slideIndexRaw, slideRuleUnknown] of Object.entries(mapSlides)) {
    const slideIndex = Number.parseInt(slideIndexRaw, 10);
    const slideIdx0 = slideIndex - 1;
    const slideRule = (slideRuleUnknown && typeof slideRuleUnknown === "object" ? slideRuleUnknown : {}) as Record<string, unknown>;

    if (!Number.isInteger(slideIndex) || slideIndex <= 0 || slideIdx0 >= slides.length) {
      errors.push(`map slide key invalid/out of range: ${slideIndexRaw}`);
      continue;
    }

    const elements = Array.isArray((slides[slideIdx0] as { elements?: unknown })?.elements) ? (slides[slideIdx0] as { elements: unknown[] }).elements : [];

    const imageAt = (slideRule.imageAt && typeof slideRule.imageAt === "object" ? slideRule.imageAt : {}) as Record<string, unknown>;
    for (const [elementIndexRaw, slotRaw] of Object.entries(imageAt)) {
      const elementIndex = Number.parseInt(elementIndexRaw, 10);
      if (!Number.isInteger(elementIndex) || elementIndex < 0 || elementIndex >= elements.length) {
        errors.push(`slide ${slideIndex} imageAt index out of range: ${elementIndexRaw}`);
        continue;
      }
      const slot = typeof slotRaw === "string" ? slotRaw : "";
      if (!slot) {
        errors.push(`slide ${slideIndex} imageAt slot must be non-empty string at index ${elementIndex}`);
      }
      const el = (elements[elementIndex] && typeof elements[elementIndex] === "object" ? elements[elementIndex] : {}) as Record<string, unknown>;
      if (el.type !== "image") {
        errors.push(`slide ${slideIndex} imageAt index ${elementIndex} is not image type`);
      }
      if (typeof el.src !== "string" || el.src.length === 0) {
        errors.push(`slide ${slideIndex} imageAt index ${elementIndex} has invalid src`);
      }
    }

    const variants = (slideRule.variants && typeof slideRule.variants === "object" ? slideRule.variants : {}) as Record<string, unknown>;
    for (const [variantName, variantRuleUnknown] of Object.entries(variants)) {
      const variantRule = (variantRuleUnknown && typeof variantRuleUnknown === "object" ? variantRuleUnknown : {}) as Record<string, unknown>;
      const dropAt = Array.isArray(variantRule.dropAt) ? variantRule.dropAt : [];
      for (const idx of dropAt) {
        if (!Number.isInteger(idx) || idx < 0 || idx >= elements.length) {
          errors.push(`slide ${slideIndex} variant ${variantName} dropAt out of range: ${String(idx)}`);
        }
      }
    }

    const choose = (slideRule.choose && typeof slideRule.choose === "object" ? slideRule.choose : {}) as Record<string, unknown>;
    const mode = choose.mode;
    if (mode !== undefined && mode !== "seed" && mode !== "fillLength") {
      errors.push(`slide ${slideIndex} choose.mode invalid: ${String(mode)}`);
    }

    if (mode === "seed") {
      const listed = Array.isArray(choose.variants) ? choose.variants.filter((v) => typeof v === "string") as string[] : [];
      for (const v of listed) {
        if (!Object.prototype.hasOwnProperty.call(variants, v)) {
          errors.push(`slide ${slideIndex} choose.seed variant not found: ${v}`);
        }
      }
    }

    if (mode === "fillLength") {
      const key = typeof choose.key === "string" ? choose.key : "";
      if (!key) {
        errors.push(`slide ${slideIndex} choose.fillLength key must be non-empty`);
      }
      const lt = typeof choose.lt === "string" ? choose.lt : "";
      const gte = typeof choose.gte === "string" ? choose.gte : "";
      for (const v of [lt, gte]) {
        if (v && !Object.prototype.hasOwnProperty.call(variants, v)) {
          errors.push(`slide ${slideIndex} choose.fillLength variant not found: ${v}`);
        }
      }
    }
  }

  console.log(`Theme validate: ${themeId}`);
  if (warnings.length > 0) {
    console.log("Warnings:");
    warnings.forEach((w) => console.log(`  - ${w}`));
  }
  if (errors.length > 0) {
    console.log("Errors:");
    errors.forEach((e) => console.log(`  - ${e}`));
    console.log(`Result: FAILED (${errors.length} errors, ${warnings.length} warnings)`);
    process.exit(1);
  }

  console.log(`Result: OK (0 errors, ${warnings.length} warnings)`);
};

void run();
