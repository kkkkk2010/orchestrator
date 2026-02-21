import path from "node:path";
import fs from "node:fs/promises";
import { PNG } from "pngjs";
import { BackgroundTheme } from "./theme";
import { clamp8, lerp, mixRgb } from "./color";
import { fnv1a32, mulberry32 } from "./prng";

const WIDTH = 1536;
const HEIGHT = 864;
const MISSING_LIMIT = 50;

export type BackgroundMissing = {
  slide: number;
  path: string;
  reason: string;
};

export type BackgroundGenerationResult = {
  replacements: Record<string, string>;
  plannedCount: number;
  replacedCount: number;
  missing: BackgroundMissing[];
};

const clamp01 = (value: number): number => {
  return Math.max(0, Math.min(1, value));
};

const blobContribution = (
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  sigma: number,
  alpha: number
): number => {
  const dx = x - centerX;
  const dy = y - centerY;
  const exponent = -((dx * dx + dy * dy) / (2 * sigma * sigma));
  return Math.min(1, Math.exp(exponent) * alpha * 1.15);
};

const generateBackgroundPng = async (filePath: string, seedKey: string, theme: BackgroundTheme): Promise<void> => {
  const seed = fnv1a32(seedKey);
  const random = mulberry32(seed);
  const png = new PNG({ width: WIDTH, height: HEIGHT });

  const angle = (Math.PI / 4) + (random() - 0.5) * 0.5;
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);

  const blobs = Array.from({ length: theme.background.blobs }, () => {
    const centerX = random() * WIDTH;
    const centerY = random() * HEIGHT;
    const sigma = 260 + random() * 260;
    const alpha = lerp(theme.background.blobAlphaMin, theme.background.blobAlphaMax, random());
    const useAccent = random() < theme.background.accentBlobChance;

    return {
      centerX,
      centerY,
      sigma,
      alpha,
      color: useAccent ? theme.palette.accent : theme.palette.bg2,
    };
  });

  const grainAmount = theme.background.grain * 20;
  const centerX = WIDTH / 2;
  const centerY = HEIGHT / 2;
  const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);

  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const tRaw = ((x * dirX) + (y * dirY)) / ((WIDTH * Math.abs(dirX)) + (HEIGHT * Math.abs(dirY)));
      const tLinear = clamp01(tRaw);
      const t = Math.pow(tLinear, 1 / theme.background.gradientStrength);
      const base = mixRgb(theme.palette.bg1, theme.palette.bg2, t);

      let r = base.r;
      let g = base.g;
      let b = base.b;

      for (const blob of blobs) {
        const influence = blobContribution(x, y, blob.centerX, blob.centerY, blob.sigma, blob.alpha);
        r += (blob.color.r - r) * influence;
        g += (blob.color.g - g) * influence;
        b += (blob.color.b - b) * influence;
      }

      const dx = x - centerX;
      const dy = y - centerY;
      const distNorm = clamp01(Math.sqrt(dx * dx + dy * dy) / maxDist);
      const vignette = 1 - theme.background.vignette * Math.pow(distNorm, 1.6);
      r *= vignette;
      g *= vignette;
      b *= vignette;

      if (grainAmount > 0) {
        const grain = (random() * 2 - 1) * grainAmount;
        r += grain;
        g += grain;
        b += grain;
      }

      const idx = (WIDTH * y + x) * 4;
      png.data[idx] = clamp8(r);
      png.data[idx + 1] = clamp8(g);
      png.data[idx + 2] = clamp8(b);
      png.data[idx + 3] = 255;
    }
  }

  const buffer = PNG.sync.write(png);
  await fs.writeFile(filePath, buffer);
};

export const generateBackgrounds = async ({
  jobId,
  presentationId,
  slideCount,
  theme,
}: {
  jobId: string;
  presentationId: number;
  slideCount: number;
  theme: BackgroundTheme;
}): Promise<BackgroundGenerationResult> => {
  const replacements: Record<string, string> = {};
  const missing: BackgroundMissing[] = [];

  const tmpDir = path.resolve(".tmp", jobId, "backgrounds");
  await fs.mkdir(tmpDir, { recursive: true });

  for (let slide = 1; slide <= slideCount; slide += 1) {
    const zipPath = `backgrounds/slide-${slide}.png`;
    const localPath = path.resolve(tmpDir, `slide-${slide}.png`);

    try {
      await generateBackgroundPng(localPath, `${presentationId}:${slide}`, theme);
      replacements[zipPath] = localPath;
    } catch (error) {
      if (missing.length < MISSING_LIMIT) {
        missing.push({
          slide,
          path: zipPath,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    replacements,
    plannedCount: slideCount,
    replacedCount: Object.keys(replacements).length,
    missing,
  };
};
