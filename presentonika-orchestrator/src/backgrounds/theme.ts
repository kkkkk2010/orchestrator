import { hexToRgb, RGB } from "./color";

type RawTheme = {
  mode?: "dark" | "light";
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

const LIGHT_DEFAULTS = {
  ...DEFAULTS,
  bg1: "#F7F8FC",
  bg2: "#E8EEFF",
  accent: "#3157D5",
  blobs: 2,
  grain: 0.035,
  gradientStrength: 1.08,
  blobAlphaMin: 0.05,
  blobAlphaMax: 0.14,
  vignette: 0.035,
  accentBlobChance: 0.3,
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

export const normalizeBackgroundTheme = (theme: unknown): BackgroundTheme => {
  const raw = (theme && typeof theme === "object" ? theme : {}) as RawTheme;
  const defaults = raw.mode === "light" ? LIGHT_DEFAULTS : DEFAULTS;

  const bg1 = hexToRgb(raw.palette?.bg1 ?? defaults.bg1, { r: 11, g: 16, b: 32 });
  const bg2 = hexToRgb(raw.palette?.bg2 ?? defaults.bg2, { r: 42, g: 27, b: 94 });
  const accent = hexToRgb(raw.palette?.accent ?? defaults.accent, { r: 124, g: 77, b: 255 });

  const blobs = Math.max(1, Math.min(4, Math.round(raw.background?.blobs ?? defaults.blobs)));
  const grain = clamp(raw.background?.grain ?? defaults.grain, 0, 0.3);
  const vignette = clamp(raw.background?.vignette ?? defaults.vignette, 0, 0.35);
  const gradientStrength = clamp(raw.background?.gradientStrength ?? defaults.gradientStrength, 0.8, 2.5);
  const accentBlobChance = clamp(raw.background?.accentBlobChance ?? defaults.accentBlobChance, 0, 1);

  const rawBlobAlphaMin = clamp(raw.background?.blobAlphaMin ?? defaults.blobAlphaMin, 0, 0.6);
  const rawBlobAlphaMax = clamp(raw.background?.blobAlphaMax ?? defaults.blobAlphaMax, 0, 0.6);
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
