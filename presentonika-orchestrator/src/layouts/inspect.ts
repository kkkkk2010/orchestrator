import fs from "node:fs/promises";
import path from "node:path";
import { loadLayoutCatalog } from "./catalog";
import { validateLayoutPack } from "./validate";

export const runLayoutInspectCli = async (): Promise<void> => {
  const layoutId = process.argv.slice(2).find((arg) => arg !== "--");
  if (!layoutId) throw new Error("Usage: npm run layout:inspect -- <layoutId>");
  const catalog = await loadLayoutCatalog();
  const pack = catalog.packs.find((item) => item.id === layoutId);
  if (!pack) throw new Error(`LayoutNotFound: ${layoutId}`);

  const validation = await validateLayoutPack(pack);
  const report = {
    id: pack.id,
    slideType: pack.manifest.slideType,
    source: pack.source,
    textSlots: pack.manifest.textSlots,
    imageSlots: pack.manifest.imageSlots,
    placeholderSummary: pack.manifest.textSlots.map((slot) => `{{slot:${slot.slotId}}}`),
    validation,
  };

  const outPath = path.resolve(".tmp", "layout-inspect", `${layoutId}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(report, null, 2));

  console.log(`layoutId=${pack.id}`);
  console.log(`slideType=${pack.manifest.slideType}`);
  console.log(`textSlots=${pack.manifest.textSlots.length}`);
  console.log(`imageSlots=${pack.manifest.imageSlots.length}`);
  console.log(`report=${outPath}`);
};

if (require.main === module) {
  void runLayoutInspectCli();
}
