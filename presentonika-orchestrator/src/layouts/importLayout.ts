import fs from "node:fs/promises";
import path from "node:path";
import yauzl from "yauzl";
import type { LayoutPackManifest, SlideType } from "./types";

const parseArgs = (): { zipPath: string; id: string; slideType: SlideType } => {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const get = (flag: string): string => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] || "" : "";
  };
  const zipPath = get("--zip");
  const id = get("--id");
  const slideType = get("--slideType") as SlideType;
  if (!zipPath || !id || !slideType) throw new Error("Usage: npm run layout:import -- --zip <path> --id <layoutId> --slideType <slideType>");
  return { zipPath: path.resolve(zipPath), id, slideType };
};

const readDoc = async (zipPath: string): Promise<unknown> => {
  const zipFile = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (error, zf) => (error || !zf ? reject(error ?? new Error("open zip failed")) : resolve(zf)));
  });

  return new Promise((resolve, reject) => {
    zipFile.on("entry", (entry) => {
      if (entry.fileName !== "doc.json") {
        zipFile.readEntry();
        return;
      }
      zipFile.openReadStream(entry, (error, stream) => {
        if (error || !stream) return reject(error ?? new Error("doc stream failed"));
        const chunks: Buffer[] = [];
        stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        stream.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
        stream.on("error", reject);
      });
    });
    zipFile.on("end", () => reject(new Error("missing doc.json")));
    zipFile.readEntry();
  });
};

export const scaffoldManifestFromDoc = (params: { doc: unknown; id: string; slideType: SlideType }): LayoutPackManifest => {
  const slides = (params.doc && typeof params.doc === "object" && Array.isArray((params.doc as Record<string, unknown>).slides)
    ? (params.doc as Record<string, unknown>).slides
    : []) as unknown[];
  const slide = (slides[0] && typeof slides[0] === "object" ? slides[0] : { elements: [] }) as Record<string, unknown>;
  const elements = (Array.isArray(slide.elements) ? slide.elements : []) as Array<Record<string, unknown>>;

  const textSlots: LayoutPackManifest["textSlots"] = [];
  const imageSlots: LayoutPackManifest["imageSlots"] = [];

  const slotRegex = /\{\{slot:([a-zA-Z0-9_\-]+)\}\}/g;

  elements.forEach((element, index) => {
    if (element.type === "text" && typeof element.text === "string") {
      const text = element.text;
      for (const match of text.matchAll(slotRegex)) {
        const slotId = match[1];
        if (!slotId) continue;
        textSlots.push({ slotId, role: slotId, required: slotId === "title", path: `slides[0].elements[${index}].text` });
      }
    }
    if (element.type === "image") {
      const src = typeof element.src === "string" ? element.src : "";
      const isDecor = src.includes("background") || src.includes("decor");
      if (!isDecor) {
        imageSlots.push({ slotId: `image_${index}`, required: false, elementIndex: index, kind: "photo", aspect: "any" });
      }
    }
  });

  return {
    id: params.id,
    version: 1,
    slideType: params.slideType,
    tags: [],
    seedWeight: 1,
    textSlots,
    imageSlots,
    constraints: {
      maxTextDensity: "medium",
      supportsLongBullets: false,
      supportsNoImage: imageSlots.length === 0,
    },
  };
};

export const runLayoutImportCli = async (): Promise<void> => {
  const args = parseArgs();
  const doc = await readDoc(args.zipPath);
  const manifest = scaffoldManifestFromDoc({ doc, id: args.id, slideType: args.slideType });

  const root = path.resolve(process.env.LAYOUT_ENGINE_DIR || "layouts-local", args.id);
  await fs.mkdir(root, { recursive: true });
  await fs.copyFile(args.zipPath, path.join(root, "layout.out.zip"));
  await fs.writeFile(path.join(root, "layout.json"), JSON.stringify(manifest, null, 2));

  const previewCandidate = path.join(path.dirname(args.zipPath), "preview.jpg");
  await fs.copyFile(previewCandidate, path.join(root, "preview.jpg")).catch(() => undefined);

  console.log(`imported layout: ${args.id}`);
  console.log(`path: ${root}`);
};

if (require.main === module) {
  void runLayoutImportCli();
}
