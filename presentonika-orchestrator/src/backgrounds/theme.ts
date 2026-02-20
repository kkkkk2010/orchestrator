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
  };
};

const DEFAULTS = {
  bg1: "#0B1020",
  bg2: "#2A1B5E",
  accent: "#7C4DFF",
  blobs: 2,
  grain: 0.1,
};

export const normalizeBackgroundTheme = (theme: unknown): BackgroundTheme => {
  const raw = (theme && typeof theme === "object" ? theme : {}) as RawTheme;

  const bg1 = hexToRgb(raw.palette?.bg1 ?? DEFAULTS.bg1, { r: 11, g: 16, b: 32 });
  const bg2 = hexToRgb(raw.palette?.bg2 ?? DEFAULTS.bg2, { r: 42, g: 27, b: 94 });
  const accent = hexToRgb(raw.palette?.accent ?? DEFAULTS.accent, { r: 124, g: 77, b: 255 });

  const blobs = Math.max(1, Math.min(4, Math.round(raw.background?.blobs ?? DEFAULTS.blobs)));
  const grain = Math.max(0, Math.min(0.3, raw.background?.grain ?? DEFAULTS.grain));

  return {
    palette: { bg1, bg2, accent },
    background: { blobs, grain },
  };
};
