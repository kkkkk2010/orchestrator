import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { adaptLayoutToContent } from "../layouts/contentAware";
import type { LayoutPackManifest } from "../layouts/types";
import { applyLayoutThemeStyles } from "../templates/layoutTheme";
import { applyTypographyStandards, autoFitText, resolveThemeTypography } from "../templates/textPostprocess";
import type { PlaceholderLocation } from "../templates/applyFills";
import { readDocJsonFromTemplateZip } from "../themes/templateZip";
import { readThemeSafe } from "../themes/themeStore";
import { buildGammaLayoutPacks } from "../tools/buildGammaLayouts";

type Row = Record<string, unknown>;
type Density = "low" | "medium" | "high";

const THEME_IDS = ["teacher-dark", "teacher-light", "teacher-bright"] as const;
const WIDTH = 1536;
const HEIGHT = 864;

const bullets = (count: number, words: number): string => Array.from({ length: count }, (_, index) => {
  const vocabulary = ["объясняет", "причину", "явления", "через", "точный", "пример", "и", "понятный", "вывод", "для", "ученика", "на", "уроке", "сегодня"];
  return `• ${Array.from({ length: words }, (__, word) => word === 0 ? `Пункт ${index + 1}` : vocabulary[(index + word) % vocabulary.length]).join(" ")}`;
}).join("\n");

const fillForSlot = (slotId: string, density: Density): string => {
  const bulletWords = density === "high" ? 14 : density === "medium" ? 10 : 7;
  if (slotId === "title") return "Как технологии меняют жизнь людей каждый день";
  if (slotId === "subtitle") return "Понятный маршрут от главного вопроса к доказанному выводу";
  if (slotId === "meta") return "Разбираем механизм, сравниваем примеры и связываем вывод с современной жизнью ученика";
  if (slotId === "goals" || slotId === "plan") return bullets(3, bulletWords);
  if (slotId === "hook_question") return "Почему привычное решение однажды полностью изменило жизнь целого города?";
  if (slotId === "hook_hint") return "Ищите связь между материалом, формой и потребностью общества.";
  if (slotId === "hook_fact") return "Новая технология заметно ускорила строительство крупных общественных сооружений.";
  if (slotId === "hook_why") return "Инженерное решение повлияло на повседневность миллионов людей.";
  if (slotId === "definition") return "Технологический перелом возникает, когда новое решение одновременно меняет возможности мастеров, устройство пространства и повседневные привычки общества.";
  if (slotId === "keywords") return "Материал, конструкция, инфраструктура, масштаб, повседневность";
  if (slotId === "bullets") return bullets(density === "high" ? 5 : 4, bulletWords);
  if (slotId === "examples") return bullets(4, bulletWords);
  if (slotId === "left_title") return "До изменения";
  if (slotId === "right_title") return "После изменения";
  if (slotId === "left_bullets" || slotId === "right_bullets") return bullets(3, bulletWords);
  if (/^step\d+$/.test(slotId)) return "Период: ключевое событие меняет практику и подготавливает следующий этап развития.";
  if (slotId === "task") return "Сформулируйте ответ и подтвердите его двумя фактами со слайдов.";
  if (/^q\d+$/.test(slotId)) return "Какой факт лучше всего объясняет главное изменение и его последствия?";
  if (slotId === "summary") return bullets(3, bulletWords);
  if (slotId === "homework") return "Сравните два примера и объясните различие в пяти предложениях.";
  if (slotId === "sources") return "Учебник, энциклопедия и материалы урока";
  return "Короткое содержательное объяснение ключевой мысли с конкретным примером.";
};

const elementRows = (doc: unknown): Row[] => {
  const root = doc && typeof doc === "object" ? doc as Row : {};
  const slide = Array.isArray(root.slides) && root.slides[0] && typeof root.slides[0] === "object" ? root.slides[0] as Row : {};
  return Array.isArray(slide.elements) ? slide.elements.filter((row): row is Row => Boolean(row && typeof row === "object")) : [];
};

const prepareContent = (doc: unknown, manifest: LayoutPackManifest): PlaceholderLocation[] => {
  const density = manifest.constraints?.maxTextDensity || "medium";
  const elements = elementRows(doc);
  const locations: PlaceholderLocation[] = [];
  elements.forEach((element, elementIndex) => {
    const meta = element.meta && typeof element.meta === "object" ? element.meta as Row : {};
    const slotId = typeof meta.slotId === "string" ? meta.slotId : null;
    if (!slotId || element.type !== "text") return;
    element.text = fillForSlot(slotId, density);
    locations.push({
      key: `s1_${slotId}`,
      slide: 1,
      elementIndex,
      path: `slides[0].elements[${elementIndex}].text`,
      rawSnippet: `{{slot:${slotId}}}`,
    });
  });
  return locations;
};

const geometrySignature = (doc: unknown): string => elementRows(doc)
  .filter((element) => element.type === "text" || element.type === "image")
  .map((element) => [element.type, element.x, element.y, element.width, element.height].join(":"))
  .join("|");

export const runLayoutVisualRegressionTests = async (): Promise<void> => {
  const root = path.resolve(".tmp", "layout-visual-regression");
  const ids = await buildGammaLayoutPacks(root);
  assert.equal(ids.length, 39);

  const signaturesByType = new Map<string, Set<string>>();
  let checkedCases = 0;
  for (const id of ids) {
    const packDir = path.join(root, id);
    const manifest = JSON.parse(await fs.readFile(path.join(packDir, "layout.json"), "utf8")) as LayoutPackManifest;
    const sourceDoc = await readDocJsonFromTemplateZip(path.join(packDir, "layout.out.zip"));
    const signatures = signaturesByType.get(manifest.slideType) || new Set<string>();
    signatures.add(geometrySignature(sourceDoc));
    signaturesByType.set(manifest.slideType, signatures);

    for (const themeId of THEME_IDS) {
      const doc = JSON.parse(JSON.stringify(sourceDoc)) as unknown;
      const locations = prepareContent(doc, manifest);
      const theme = await readThemeSafe(themeId);
      applyLayoutThemeStyles({ doc, theme });
      const typography = resolveThemeTypography(themeId, theme);
      applyTypographyStandards({ doc, placeholderLocations: locations, themeTypography: typography });
      const contentStats = adaptLayoutToContent(doc);
      const fitStats = autoFitText({ doc, placeholderLocations: locations, themeTypography: typography });

      assert.equal(contentStats.fontFallbackCount, 0, `${id}/${themeId} used fallback font metrics`);
      assert.equal(contentStats.overflowRiskCount, 0, `${id}/${themeId} has adaptive overflow risk`);
      assert.equal(fitStats.overflowCount, 0, `${id}/${themeId} has overflowing text: ${fitStats.items.filter((item) => item.overflowAfterFit).map((item) => item.key).join(", ")}`);
      assert.equal(fitStats.truncatedCount, 0, `${id}/${themeId} truncated text`);

      const rows = elementRows(doc);
      const adaptiveGroups = new Map<string, Row[]>();
      for (const element of rows) {
        const meta = element.meta && typeof element.meta === "object" ? element.meta as Row : {};
        if (typeof meta.adaptiveGroup !== "string") continue;
        const groupRows = adaptiveGroups.get(meta.adaptiveGroup) || [];
        groupRows.push(element);
        adaptiveGroups.set(meta.adaptiveGroup, groupRows);
      }
      for (const [groupId, groupRows] of adaptiveGroups) {
        const container = groupRows.find((element) => (element.meta as Row | undefined)?.adaptiveRole === "container");
        const contents = groupRows.filter((element) => (element.meta as Row | undefined)?.adaptiveRole === "content");
        if (!container || contents.length === 0) continue;
        const containerBottom = Number(container.y) + Number(container.height);
        const contentBottom = Math.max(...contents.map((element) => Number(element.y) + Number(element.height)));
        assert.ok(containerBottom - contentBottom <= 96, `${id}/${themeId}/${groupId} leaves excessive empty card space`);
      }

      for (const element of rows) {
        const x = typeof element.x === "number" ? element.x : 0;
        const y = typeof element.y === "number" ? element.y : 0;
        const width = typeof element.width === "number" ? element.width : 0;
        const height = typeof element.height === "number" ? element.height : 0;
        assert.ok(x >= -0.5 && y >= -0.5, `${id}/${themeId} starts outside slide`);
        assert.ok(x + width <= WIDTH + 0.5, `${id}/${themeId} exceeds slide width`);
        assert.ok(y + height <= HEIGHT + 0.5, `${id}/${themeId} exceeds slide height`);
      }
      checkedCases += 1;
    }
  }

  for (const [slideType, signatures] of signaturesByType) {
    const variants = ids.filter((id) => id.startsWith(`edu-${slideType}-`)).length;
    assert.equal(signatures.size, variants, `${slideType} contains duplicate composition geometry`);
  }
  assert.equal(checkedCases, 117);
};
