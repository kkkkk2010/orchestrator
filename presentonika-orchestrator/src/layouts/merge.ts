import yauzl from "yauzl";
import { Readable } from "node:stream";

type AnyRecord = Record<string, unknown>;

const asRecord = (value: unknown): AnyRecord => (value && typeof value === "object" ? value as AnyRecord : {});

const layoutDebugLabelEnabled = (): boolean => process.env.LAYOUT_DEBUG_LABEL !== "false";

const createLayoutDebugLabel = (layoutId: string): AnyRecord => ({
  type: "text",
  name: "layout_debug_label",
  x: 12,
  y: 12,
  width: 420,
  height: 26,
  text: `layout: ${layoutId}`,
  style: {
    fontFamily: "Times New Roman",
    fontSize: 13,
    lineHeight: 1,
    color: "#6B7280",
  },
  meta: {
    debug: true,
    layoutId,
  },
});

const readZipEntries = async (zipPath: string): Promise<Map<string, Buffer>> => {
  const zipFile = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (error, zf) => (error || !zf ? reject(error ?? new Error("open zip failed")) : resolve(zf)));
  });

  const openStream = (entry: yauzl.Entry): Promise<Readable> => new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => (error || !stream ? reject(error ?? new Error("stream failed")) : resolve(stream)));
  });

  return new Promise((resolve, reject) => {
    const out = new Map<string, Buffer>();
    zipFile.on("entry", async (entry) => {
      if (entry.fileName.endsWith("/")) {
        zipFile.readEntry();
        return;
      }
      try {
        const stream = await openStream(entry);
        const chunks: Buffer[] = [];
        stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        stream.on("error", reject);
        stream.on("end", () => {
          out.set(entry.fileName, Buffer.concat(chunks));
          zipFile.readEntry();
        });
      } catch (error) {
        reject(error);
      }
    });
    zipFile.on("end", () => resolve(out));
    zipFile.readEntry();
  });
};

const rewriteAssetRefs = (node: unknown, oldPath: string, newPath: string): unknown => {
  if (typeof node === "string") return node === oldPath ? newPath : node;
  if (Array.isArray(node)) return node.map((item) => rewriteAssetRefs(item, oldPath, newPath));
  if (!node || typeof node !== "object") return node;
  const out: AnyRecord = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = rewriteAssetRefs(value, oldPath, newPath);
  }
  return out;
};

export const mergeLayoutSlides = async (params: {
  slides: Array<{ slide: number; layoutId: string; docSlide: unknown; zipPath?: string }>;
}): Promise<{ doc: unknown; extraEntries: Record<string, Buffer>; mergedAssetsCount: number }> => {
  const docSlides: unknown[] = [];
  const extraEntries: Record<string, Buffer> = {};

  for (const row of params.slides) {
    let slide = JSON.parse(JSON.stringify(row.docSlide));
    if (row.zipPath) {
      const entries = await readZipEntries(row.zipPath);
      for (const [entryPath, buffer] of entries.entries()) {
        if (entryPath === "doc.json") continue;
        const rewritten = `assets/layouts/${row.layoutId}/slide-${row.slide}/${entryPath}`;
        extraEntries[rewritten] = buffer;
        slide = rewriteAssetRefs(slide, entryPath, rewritten);
      }
    }

    const slideObj = asRecord(slide);
    slideObj.id = `slide_${row.slide}`;
    slideObj.background = {
      type: "image",
      src: `backgrounds/slide-${row.slide}.png`,
    };

    const elements = Array.isArray(slideObj.elements) ? slideObj.elements : [];
    const nextElements = layoutDebugLabelEnabled()
      ? [...elements, createLayoutDebugLabel(row.layoutId)]
      : elements;

    slideObj.elements = nextElements.map((element, index) => {
      const el = asRecord(element);
      el.id = `s${row.slide}_e${index + 1}`;
      return el;
    });

    docSlides.push(slideObj);
  }

  return {
    doc: { slides: docSlides },
    extraEntries,
    mergedAssetsCount: Object.keys(extraEntries).length,
  };
};
