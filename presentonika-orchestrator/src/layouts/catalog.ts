import fs from "node:fs/promises";
import path from "node:path";
import type { LayoutPack, LayoutPackManifest, SlideType } from "./types";

const parseManifest = (value: unknown): LayoutPackManifest | null => {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.slideType !== "string") return null;
  if (!Array.isArray(row.textSlots) || !Array.isArray(row.imageSlots)) return null;
  return row as LayoutPackManifest;
};

const exists = async (p: string): Promise<boolean> => fs.access(p).then(() => true).catch(() => false);

export const resolveLayoutsDir = async (): Promise<{ dir: string; source: "layouts-local" | "layouts" }> => {
  const localDir = path.resolve(process.env.LAYOUT_ENGINE_DIR || process.env.LAYOUTS_DIR || "layouts-local");
  if (await exists(localDir)) return { dir: localDir, source: "layouts-local" };
  return { dir: path.resolve("layouts"), source: "layouts" };
};

export const loadLayoutCatalog = async (): Promise<{ packs: LayoutPack[]; bySlideType: Map<SlideType, LayoutPack[]>; sourceDir: string }> => {
  const { dir, source } = await resolveLayoutsDir();
  const bySlideType = new Map<SlideType, LayoutPack[]>();
  const packs: LayoutPack[] = [];

  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return { packs, bySlideType, sourceDir: dir };
  }

  for (const layoutId of entries) {
    const rootDir = path.join(dir, layoutId);
    const manifestPath = path.join(rootDir, "layout.json");
    const zipPath = path.join(rootDir, "layout.out.zip");
    if (!(await exists(manifestPath)) || !(await exists(zipPath))) continue;

    try {
      const raw = await fs.readFile(manifestPath, "utf8");
      const manifest = parseManifest(JSON.parse(raw));
      if (!manifest) continue;
      const pack: LayoutPack = { id: manifest.id, source, rootDir, zipPath, manifestPath, manifest };
      packs.push(pack);
      const key = manifest.slideType as SlideType;
      const list = bySlideType.get(key) || [];
      list.push(pack);
      bySlideType.set(key, list);
    } catch {
      // ignore broken pack
    }
  }

  return { packs, bySlideType, sourceDir: dir };
};
