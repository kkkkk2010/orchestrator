import { hexToRgb, RGB } from "./color";

type RawTheme = {
  palette?: {
    bg1?: string;
    bg2?: string;
    accent?: string;
  };
  background?: {
    blobs?: number;
    grain?: number;
    gradientStrength?: number;
    blobAlphaMin?: number;
    blobAlphaMax?: number;
    vignette?: number;
    accentBlobChance?: number;
  };
};

export type BackgroundTheme = {
  palette: {
    bg1: RGB;
    bg2: RGB;
    accent: RGB;
  };
  background: {
    blobs: number;
    grain: number;
    gradientStrength: number;
    blobAlphaMin: number;
    blobAlphaMax: number;
    vignette: number;
    accentBlobChance: number;
  };
};

const DEFAULTS = {
  bg1: "#0B1020",
  bg2: "#2A1B5E",
  accent: "#7C4DFF",
  blobs: 2,
  grain: 0.1,
  gradientStrength: 1.35,
  blobAlphaMin: 0.18,
  blobAlphaMax: 0.32,
  vignette: 0.18,
  accentBlobChance: 0.6,
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

export const normalizeBackgroundTheme = (theme: unknown): BackgroundTheme => {
  const raw = (theme && typeof theme === "object" ? theme : {}) as RawTheme;

  const bg1 = hexToRgb(raw.palette?.bg1 ?? DEFAULTS.bg1, { r: 11, g: 16, b: 32 });
  const bg2 = hexToRgb(raw.palette?.bg2 ?? DEFAULTS.bg2, { r: 42, g: 27, b: 94 });
  const accent = hexToRgb(raw.palette?.accent ?? DEFAULTS.accent, { r: 124, g: 77, b: 255 });

  const blobs = Math.max(1, Math.min(4, Math.round(raw.background?.blobs ?? DEFAULTS.blobs)));
  const grain = clamp(raw.background?.grain ?? DEFAULTS.grain, 0, 0.3);
  const vignette = clamp(raw.background?.vignette ?? DEFAULTS.vignette, 0, 0.35);
  const gradientStrength = clamp(raw.background?.gradientStrength ?? DEFAULTS.gradientStrength, 0.8, 2.5);
  const accentBlobChance = clamp(raw.background?.accentBlobChance ?? DEFAULTS.accentBlobChance, 0, 1);

  const rawBlobAlphaMin = clamp(raw.background?.blobAlphaMin ?? DEFAULTS.blobAlphaMin, 0, 0.6);
  const rawBlobAlphaMax = clamp(raw.background?.blobAlphaMax ?? DEFAULTS.blobAlphaMax, 0, 0.6);
  const blobAlphaMin = Math.min(rawBlobAlphaMin, rawBlobAlphaMax);
  const blobAlphaMax = Math.max(rawBlobAlphaMin, rawBlobAlphaMax);

  return {
    palette: { bg1, bg2, accent },
    background: {
      blobs,
      grain,
      gradientStrength,
      blobAlphaMin,
      blobAlphaMax,
      vignette,
      accentBlobChance,
    },
  };
};
