import assert from "node:assert/strict";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import yazl from "yazl";
import { mergeLayoutSlides } from "../layouts/merge";

const makeZip = async (zipPath: string): Promise<void> => {
  await fsPromises.mkdir(path.dirname(zipPath), { recursive: true });
  const writer = new yazl.ZipFile();
  const out = fs.createWriteStream(zipPath);
  writer.outputStream.pipe(out);
  writer.addBuffer(Buffer.from(JSON.stringify({ slides: [{ elements: [{ type: "image", src: "assets/images/shared.png" }] }] }), "utf8"), "doc.json");
  writer.addBuffer(Buffer.from("abc"), "assets/images/shared.png");
  writer.end();
  await new Promise<void>((resolve, reject) => { out.on("close", resolve); out.on("error", reject); });
};

export const runLayoutsMergeTests = async (): Promise<void> => {
  const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "layout-merge-"));
  const zip1 = path.join(dir, "a.zip");
  const zip2 = path.join(dir, "b.zip");
  await makeZip(zip1);
  await makeZip(zip2);

  const merged = await mergeLayoutSlides({
    slides: [
      { slide: 1, layoutId: "a", docSlide: { elements: [{ type: "image", src: "assets/images/shared.png" }] }, zipPath: zip1 },
      { slide: 2, layoutId: "b", docSlide: { elements: [{ type: "image", src: "assets/images/shared.png" }] }, zipPath: zip2 },
    ],
  });

  assert.ok(Object.keys(merged.extraEntries).some((name) => name.includes("assets/layouts/a/slide-1/assets/images/shared.png")));
  assert.ok(Object.keys(merged.extraEntries).some((name) => name.includes("assets/layouts/b/slide-2/assets/images/shared.png")));

  const slides = (merged.doc as { slides: Array<{ background?: { src?: string }; elements: Array<{ name?: string; src?: string }> }> }).slides;
  assert.equal(slides[0].background?.src, "backgrounds/slide-1.png");
  assert.equal(slides[1].background?.src, "backgrounds/slide-2.png");
  assert.equal(slides[0].elements.some((element) => element.name === "theme_background" || element.src === "backgrounds/slide-1.png"), false);
  assert.equal(slides[0].elements[0].src?.includes("assets/layouts/a/slide-1/assets/images/shared.png"), true);
};
