import fs from "node:fs/promises";
import yauzl from "yauzl";
import { Readable } from "node:stream";
import { loadLayoutCatalog } from "./catalog";
import type { LayoutPack } from "./types";

const readZipDocJson = async (zipPath: string): Promise<unknown> => {
  const zipFile = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (error, zf) => (error || !zf ? reject(error ?? new Error("open zip failed")) : resolve(zf)));
  });

  const readStream = (entry: yauzl.Entry): Promise<Readable> => new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => (error || !stream ? reject(error ?? new Error("stream failed")) : resolve(stream)));
  });

  return new Promise((resolve, reject) => {
    zipFile.on("entry", async (entry) => {
      if (entry.fileName !== "doc.json") {
        zipFile.readEntry();
        return;
      }
      try {
        const stream = await readStream(entry);
        const chunks: Buffer[] = [];
        stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        stream.on("error", reject);
        stream.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
      } catch (error) {
        reject(error);
      }
    });
    zipFile.on("end", () => reject(new Error("layout zip missing doc.json")));
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
  const doc = await readZipDocJson(pack.zipPath).catch((error) => {
    errors.push(`layout.out.zip: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  });

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
  const layoutId = process.argv.slice(2).find((arg) => arg !== "--");
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
