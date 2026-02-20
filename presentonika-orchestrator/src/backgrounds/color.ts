export type RGB = { r: number; g: number; b: number };

export const clamp8 = (value: number): number => {
  if (value < 0) {
    return 0;
  }
  if (value > 255) {
    return 255;
  }
  return Math.round(value);
};

export const hexToRgb = (hex: string, fallback: RGB): RGB => {
  const normalized = hex.trim().replace(/^#/, "");

  if (/^[a-fA-F0-9]{6}$/.test(normalized)) {
    return {
      r: Number.parseInt(normalized.slice(0, 2), 16),
      g: Number.parseInt(normalized.slice(2, 4), 16),
      b: Number.parseInt(normalized.slice(4, 6), 16),
    };
  }

  if (/^[a-fA-F0-9]{3}$/.test(normalized)) {
    return {
      r: Number.parseInt(`${normalized[0]}${normalized[0]}`, 16),
      g: Number.parseInt(`${normalized[1]}${normalized[1]}`, 16),
      b: Number.parseInt(`${normalized[2]}${normalized[2]}`, 16),
    };
  }

  return fallback;
};

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const mixRgb = (a: RGB, b: RGB, t: number): RGB => ({
  r: lerp(a.r, b.r, t),
  g: lerp(a.g, b.g, t),
  b: lerp(a.b, b.b, t),
});
