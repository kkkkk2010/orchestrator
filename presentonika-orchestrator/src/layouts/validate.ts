import fs from "node:fs/promises";
import path from "node:path";
import yauzl from "yauzl";
import { Readable } from "node:stream";
import { loadLayoutCatalog } from "./catalog";
import type { LayoutPack } from "./types";

const readZipContent = async (zipPath: string): Promise<{ doc: unknown; entries: Set<string> }> => {
  const zipFile = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (error, zf) => (error || !zf ? reject(error ?? new Error("open zip failed")) : resolve(zf)));
  });

  const readStream = (entry: yauzl.Entry): Promise<Readable> => new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => (error || !stream ? reject(error ?? new Error("stream failed")) : resolve(stream)));
  });

  return new Promise((resolve, reject) => {
    const entries = new Set<string>();
    let doc: unknown = null;
    zipFile.on("entry", async (entry) => {
      entries.add(entry.fileName);
      if (entry.fileName !== "doc.json") {
        zipFile.readEntry();
        return;
      }
      try {
        const stream = await readStream(entry);
        const chunks: Buffer[] = [];
        stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        stream.on("error", reject);
        stream.on("end", () => {
          doc = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          zipFile.readEntry();
        });
      } catch (error) {
        reject(error);
      }
    });
    zipFile.on("end", () => {
      if (!doc) reject(new Error("layout zip missing doc.json"));
      else resolve({ doc, entries });
    });
    zipFile.readEntry();
  });
};

const getByPath = (obj: unknown, pathExpr: string): unknown => {
  const tokens = pathExpr.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur: unknown = obj;
  for (const token of tokens) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[token];
  }
  return cur;
};

export const validateLayoutPack = async (pack: LayoutPack): Promise<{ ok: boolean; errors: string[] }> => {
  const errors: string[] = [];
  if (!pack.manifest.id) errors.push("layout.json: id required");
  if (path.basename(pack.rootDir) !== pack.manifest.id) errors.push(`layout.json: id ${pack.manifest.id} does not match directory ${path.basename(pack.rootDir)}`);
  if (!Number.isInteger(pack.manifest.version) || pack.manifest.version < 1) errors.push("layout.json: version must be a positive integer");

  const slotIds = pack.manifest.textSlots.map((slot) => slot.slotId);
  const duplicateSlotIds = slotIds.filter((slotId, index) => slotIds.indexOf(slotId) !== index);
  if (duplicateSlotIds.length > 0) errors.push(`layout.json: duplicate text slot ids: ${[...new Set(duplicateSlotIds)].join(", ")}`);
  const slotPaths = pack.manifest.textSlots.map((slot) => slot.path);
  const duplicateSlotPaths = slotPaths.filter((slotPath, index) => slotPaths.indexOf(slotPath) !== index);
  if (duplicateSlotPaths.length > 0) errors.push(`layout.json: duplicate text slot paths: ${[...new Set(duplicateSlotPaths)].join(", ")}`);

  const zipContent = await readZipContent(pack.zipPath).catch((error) => {
    errors.push(`layout.out.zip: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  });

  const doc = zipContent?.doc;
  if (!doc || typeof doc !== "object") return { ok: false, errors };
  const slides = Array.isArray((doc as Record<string, unknown>).slides) ? (doc as Record<string, unknown>).slides as unknown[] : [];
  if (slides.length !== 1) errors.push(`layout.out.zip: expected 1 slide, got ${slides.length}`);

  for (const slot of pack.manifest.textSlots) {
    const value = getByPath(doc, slot.path);
    if (typeof value !== "string") {
      errors.push(`textSlot ${slot.slotId}: path not string (${slot.path})`);
      continue;
    }
    if (!value.includes(`{{slot:${slot.slotId}}}`)) {
      errors.push(`textSlot ${slot.slotId}: missing placeholder {{slot:${slot.slotId}}} at path ${slot.path}`);
    }
  }

  const elements = slides[0] && typeof slides[0] === "object" && Array.isArray((slides[0] as Record<string, unknown>).elements)
    ? (slides[0] as Record<string, unknown>).elements as unknown[]
    : [];

  const docRecord = doc as Record<string, unknown>;
  const slideRecord = slides[0] && typeof slides[0] === "object" ? slides[0] as Record<string, unknown> : {};
  const slideSize = docRecord.slideSize && typeof docRecord.slideSize === "object" ? docRecord.slideSize as Record<string, unknown> : {};
  const width = typeof slideRecord.width === "number" ? slideRecord.width : (typeof slideSize.width === "number" ? slideSize.width : 1536);
  const height = typeof slideRecord.height === "number" ? slideRecord.height : (typeof slideSize.height === "number" ? slideSize.height : 864);
  const elementIds = new Set<string>();
  const repeatIndexes = new Map<string, Set<number>>();

  elements.forEach((rawElement, index) => {
    if (!rawElement || typeof rawElement !== "object") {
      errors.push(`element ${index}: must be an object`);
      return;
    }
    const element = rawElement as Record<string, unknown>;
    const id = typeof element.id === "string" ? element.id : "";
    if (!id) errors.push(`element ${index}: id required`);
    else if (elementIds.has(id)) errors.push(`element ${index}: duplicate id ${id}`);
    else elementIds.add(id);

    const x = typeof element.x === "number" ? element.x : Number.NaN;
    const y = typeof element.y === "number" ? element.y : Number.NaN;
    const elementWidth = typeof element.width === "number" ? element.width : Number.NaN;
    const elementHeight = typeof element.height === "number" ? element.height : Number.NaN;
    if (![x, y, elementWidth, elementHeight].every(Number.isFinite)) errors.push(`element ${index}: geometry must contain finite x/y/width/height`);
    else if (x < 0 || y < 0 || elementWidth <= 0 || elementHeight <= 0 || x + elementWidth > width || y + elementHeight > height) {
      errors.push(`element ${index}: geometry outside ${width}x${height}`);
    }

    const meta = element.meta && typeof element.meta === "object" ? element.meta as Record<string, unknown> : null;
    if (typeof meta?.repeatGroup === "string") {
      const repeatIndex = meta.repeatIndex;
      if (!Number.isInteger(repeatIndex) || (repeatIndex as number) < 1) errors.push(`element ${index}: repeatIndex must be a positive integer`);
      else {
        const indexes = repeatIndexes.get(meta.repeatGroup) || new Set<number>();
        indexes.add(repeatIndex as number);
        repeatIndexes.set(meta.repeatGroup, indexes);
      }
    }

    if (element.type === "image" && typeof element.src === "string" && !zipContent?.entries.has(element.src)) {
      errors.push(`element ${index}: missing image asset ${element.src}`);
    }
  });

  for (const [group, indexes] of repeatIndexes.entries()) {
    const max = Math.max(...indexes);
    for (let index = 1; index <= max; index += 1) {
      if (!indexes.has(index)) errors.push(`repeat group ${group}: missing index ${index}`);
    }
  }

  for (const imageSlot of pack.manifest.imageSlots) {
    const element = elements[imageSlot.elementIndex];
    if (!element || typeof element !== "object") {
      errors.push(`imageSlot ${imageSlot.slotId}: elementIndex out of range`);
      continue;
    }
    const type = (element as Record<string, unknown>).type;
    if (type !== "image") errors.push(`imageSlot ${imageSlot.slotId}: elementIndex is not image`);
  }

  return { ok: errors.length === 0, errors };
};

export const runLayoutValidateCli = async (): Promise<void> => {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const validateAll = args.includes("--all");
  const layoutId = args.find((arg) => arg !== "--all");
  if (validateAll) {
    const catalog = await loadLayoutCatalog();
    const directoryEntries = await fs.readdir(catalog.sourceDir, { withFileTypes: true }).catch(() => []);
    const packDirectories = directoryEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    const loadedDirectories = new Set(catalog.packs.map((pack) => path.basename(pack.rootDir)));
    const errors: string[] = packDirectories.filter((directory) => !loadedDirectories.has(directory)).map((directory) => `${directory}: pack could not be loaded`);
    for (const pack of catalog.packs) {
      const report = await validateLayoutPack(pack);
      if (report.ok) console.log(`layout valid: ${pack.id}`);
      else report.errors.forEach((error) => errors.push(`${pack.id}: ${error}`));
    }
    if (catalog.packs.length === 0) errors.push("layout catalog is empty");
    if (errors.length > 0) {
      errors.forEach((error) => console.error(error));
      process.exit(1);
    }
    console.log(`layout catalog valid: ${catalog.packs.length} packs`);
    return;
  }
  if (!layoutId) throw new Error("Usage: npm run layout:validate -- <layoutId>");
  const catalog = await loadLayoutCatalog();
  const pack = catalog.packs.find((item) => item.id === layoutId);
  if (!pack) throw new Error(`LayoutNotFound: ${layoutId}`);
  const report = await validateLayoutPack(pack);
  if (!report.ok) {
    report.errors.forEach((error) => console.error(error));
    process.exit(1);
  }
  console.log(`layout valid: ${layoutId}`);
};

if (require.main === module) {
  void runLayoutValidateCli();
}
