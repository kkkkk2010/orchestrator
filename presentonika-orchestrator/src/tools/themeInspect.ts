import { assertThemeTemplateExists } from "../themes/themeStore";
import { readDocJsonFromTemplateZip } from "../themes/templateZip";

const getSlides = (doc: unknown): unknown[] => {
  if (!doc || typeof doc !== "object") {
    return [];
  }
  const record = doc as Record<string, unknown>;
  if (Array.isArray(record.slides)) {
    return record.slides;
  }
  if (Array.isArray(record.pages)) {
    return record.pages;
  }
  return [];
};

const previewText = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").slice(0, 60);
};

const run = async (): Promise<void> => {
  const themeId = process.argv[2];
  if (!themeId) {
    console.error("Usage: npm run theme:inspect -- <themeId>");
    process.exit(1);
  }

  const templatePath = await assertThemeTemplateExists(themeId);
  const doc = await readDocJsonFromTemplateZip(templatePath);
  const slides = getSlides(doc);

  console.log(`Theme: ${themeId}`);
  console.log(`Slides: ${slides.length}`);

  slides.forEach((slide, idx) => {
    const slideRecord = (slide && typeof slide === "object" ? slide : {}) as Record<string, unknown>;
    const elements = Array.isArray(slideRecord.elements) ? slideRecord.elements : [];

    console.log(`\nSlide ${idx + 1}:`);
    elements.forEach((element, elementIndex) => {
      const el = (element && typeof element === "object" ? element : {}) as Record<string, unknown>;
      const type = typeof el.type === "string" ? el.type : "unknown";
      const id = typeof el.id === "string" ? el.id : "-";
      const src = typeof el.src === "string" ? el.src : "";
      const text = previewText(el.text);
      const srcPart = src ? ` src="${src}"` : "";
      const textPart = text ? ` text="${text}"` : "";
      console.log(`  [${elementIndex}] ${type} id=${id}${srcPart}${textPart}`);
    });
  });
};

void run();
