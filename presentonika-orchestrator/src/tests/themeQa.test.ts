import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { normalizeBackgroundTheme } from "../backgrounds/theme";
import type { PlaceholderLocation } from "../templates/applyFills";
import { applyTypographyStandards, resolveThemeTypography } from "../templates/textPostprocess";

const THEME_IDS = ["teacher-dark", "teacher-light", "teacher-bright"] as const;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const STYLE_ROLES = ["title", "subtitle", "body", "small", "muted", "bullets"] as const;

const TOP_LEVEL_KEYS = ["id", "name", "version", "mode", "palette", "background", "typography"];
const PALETTE_KEYS = ["bg1", "bg2", "accent"];
const BACKGROUND_KEYS = ["blobs", "grain", "gradientStrength", "blobAlphaMin", "blobAlphaMax", "vignette", "accentBlobChance"];
const TYPOGRAPHY_KEYS = ["fontFamily", "sizes", "lineHeights", "colors"];
const COLOR_KEYS = ["title", "body", "muted"];

const toRecord = (value: unknown, label: string): Record<string, unknown> => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
};

const assertOnlyKeys = (record: Record<string, unknown>, allowed: readonly string[], label: string): void => {
  const extra = Object.keys(record).filter((key) => !allowed.includes(key));
  assert.deepEqual(extra, [], `${label} has unsupported keys`);
};

const assertHex = (value: unknown, label: string): string => {
  assert.equal(typeof value, "string", `${label} must be a string`);
  const hex = value as string;
  assert.match(hex, HEX_RE, `${label} must be a 6-digit hex color`);
  return hex;
};

const assertNumberInRange = (value: unknown, min: number, max: number, label: string): number => {
  assert.equal(typeof value, "number", `${label} must be a number`);
  const numberValue = value as number;
  assert.ok(Number.isFinite(numberValue), `${label} must be finite`);
  assert.ok(numberValue >= min && numberValue <= max, `${label} must be in range ${min}..${max}`);
  return numberValue;
};

const linearize = (channel: number): number => {
  const normalized = channel / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex: string): number => {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
};

const contrastRatio = (a: string, b: string): number => {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
};

const readTheme = (themeId: string): Record<string, unknown> => {
  const themePath = path.resolve("themes", themeId, "theme.json");
  return toRecord(JSON.parse(fs.readFileSync(themePath, "utf8")) as unknown, `${themeId} theme.json`);
};

const validateThemeJson = (themeId: string): void => {
  const theme = readTheme(themeId);
  assertOnlyKeys(theme, TOP_LEVEL_KEYS, `${themeId} top-level`);

  assert.equal(theme.id, themeId);
  assert.equal(typeof theme.name, "string");
  assert.equal(theme.version, 1);
  assert.ok(theme.mode === "dark" || theme.mode === "light", `${themeId} mode must be dark or light`);

  const palette = toRecord(theme.palette, `${themeId} palette`);
  const background = toRecord(theme.background, `${themeId} background`);
  const typography = toRecord(theme.typography, `${themeId} typography`);
  const sizes = toRecord(typography.sizes, `${themeId} typography.sizes`);
  const lineHeights = toRecord(typography.lineHeights, `${themeId} typography.lineHeights`);
  const colors = toRecord(typography.colors, `${themeId} typography.colors`);

  assertOnlyKeys(palette, PALETTE_KEYS, `${themeId} palette`);
  assertOnlyKeys(background, BACKGROUND_KEYS, `${themeId} background`);
  assertOnlyKeys(typography, TYPOGRAPHY_KEYS, `${themeId} typography`);
  assertOnlyKeys(sizes, STYLE_ROLES, `${themeId} typography.sizes`);
  assertOnlyKeys(lineHeights, STYLE_ROLES, `${themeId} typography.lineHeights`);
  assertOnlyKeys(colors, COLOR_KEYS, `${themeId} typography.colors`);

  const bg1 = assertHex(palette.bg1, `${themeId} palette.bg1`);
  const bg2 = assertHex(palette.bg2, `${themeId} palette.bg2`);
  assertHex(palette.accent, `${themeId} palette.accent`);
  const titleColor = assertHex(colors.title, `${themeId} typography.colors.title`);
  const bodyColor = assertHex(colors.body, `${themeId} typography.colors.body`);
  assertHex(colors.muted, `${themeId} typography.colors.muted`);

  assert.equal(typography.fontFamily, "Times New Roman");
  for (const role of STYLE_ROLES) {
    assertNumberInRange(sizes[role], 8, 96, `${themeId} typography.sizes.${role}`);
    assertNumberInRange(lineHeights[role], 0.8, 2, `${themeId} typography.lineHeights.${role}`);
  }

  const blobs = assertNumberInRange(background.blobs, 1, 4, `${themeId} background.blobs`);
  assert.ok(Number.isInteger(blobs), `${themeId} background.blobs must be an integer`);
  assertNumberInRange(background.grain, 0, 0.3, `${themeId} background.grain`);
  assertNumberInRange(background.gradientStrength, 0.8, 2.5, `${themeId} background.gradientStrength`);
  const blobAlphaMin = assertNumberInRange(background.blobAlphaMin, 0, 0.6, `${themeId} background.blobAlphaMin`);
  const blobAlphaMax = assertNumberInRange(background.blobAlphaMax, 0, 0.6, `${themeId} background.blobAlphaMax`);
  assert.ok(blobAlphaMin <= blobAlphaMax, `${themeId} background blob alpha min must be <= max`);
  assertNumberInRange(background.vignette, 0, 0.35, `${themeId} background.vignette`);
  assertNumberInRange(background.accentBlobChance, 0, 1, `${themeId} background.accentBlobChance`);

  for (const bg of [bg1, bg2]) {
    assert.ok(contrastRatio(titleColor, bg) >= 4.5, `${themeId} title contrast is too low against ${bg}`);
    assert.ok(contrastRatio(bodyColor, bg) >= 4.5, `${themeId} body contrast is too low against ${bg}`);
  }

  if (themeId === "teacher-bright") {
    const darkBackground = luminance(bg1) < 0.3 && luminance(bg2) < 0.3;
    const darkText = luminance(titleColor) < 0.3 && luminance(bodyColor) < 0.3;
    assert.ok(!darkBackground || !darkText, "teacher-bright must not combine a dark background with dark text");
  }
};

const withEnv = (updates: Record<string, string | undefined>, fn: () => void): void => {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(updates)) {
    previous[key] = process.env[key];
    const next = updates[key];
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  }

  try {
    fn();
  } finally {
    for (const key of Object.keys(updates)) {
      const old = previous[key];
      if (old === undefined) delete process.env[key];
      else process.env[key] = old;
    }
  }
};

const runTypographyResolverTests = (): void => {
  withEnv({ FONT_FAMILY_DEFAULT: "Times New Roman" }, () => {
    const typography = resolveThemeTypography("teacher-light", { mode: "light", typography: { fontFamily: "Aptos" } });
    assert.equal(typography.fontFamily, "Times New Roman");
  });

  withEnv({ FONT_FAMILY_DEFAULT: "" }, () => {
    const typography = resolveThemeTypography("teacher-light", { mode: "light", typography: { fontFamily: "Aptos" } });
    assert.equal(typography.fontFamily, "Aptos");
  });

  withEnv({ FONT_FAMILY_DEFAULT: undefined }, () => {
    const typography = resolveThemeTypography("teacher-light", { mode: "light", typography: {} });
    assert.equal(typography.fontFamily, "Times New Roman");
  });

  const doc = { slides: [{ elements: [{ text: "Title", style: {} }] }] };
  const locations: PlaceholderLocation[] = [
    { key: "s1_title", slide: 1, elementIndex: 0, path: "slides[0].elements[0].text", rawSnippet: "{{s1_title}}" },
  ];
  const darkTypography = resolveThemeTypography("teacher-light", { mode: "dark", typography: { colors: { title: "#FFFFFF" } } });
  const lightTypography = resolveThemeTypography("teacher-dark", { mode: "light", typography: { colors: { title: "#111827" } } });
  assert.equal(applyTypographyStandards({ doc, placeholderLocations: locations, themeTypography: darkTypography }).themeColorMode, "dark");
  assert.equal(applyTypographyStandards({ doc, placeholderLocations: locations, themeTypography: lightTypography }).themeColorMode, "light");

  withEnv({ TYPOGRAPHY_USE_THEME_SIZES: "true", TYPOGRAPHY_SCALE: "1" }, () => {
    const typography = resolveThemeTypography("teacher-light", {
      mode: "light",
      typography: {
        sizes: { body: 23, small: 17 },
        lineHeights: { body: 1.3, small: 1.2 },
      },
    });
    assert.equal(typography.sizes.muted, 17);
    assert.equal(typography.sizes.bullets, 23);
    assert.equal(typography.lineHeights.muted, 1.2);
    assert.equal(typography.lineHeights.bullets, 1.3);
  });
};

const runBackgroundNormalizationTests = (): void => {
  const normalized = normalizeBackgroundTheme({
    mode: "light",
    palette: { bg1: "#010203", bg2: "#040506", accent: "#070809" },
    background: {
      blobs: 3,
      grain: 0.2,
      gradientStrength: 1.4,
      blobAlphaMin: 0.11,
      blobAlphaMax: 0.22,
      vignette: 0.09,
      accentBlobChance: 0.7,
    },
  });

  assert.deepEqual(normalized.palette.bg1, { r: 1, g: 2, b: 3 });
  assert.deepEqual(normalized.palette.bg2, { r: 4, g: 5, b: 6 });
  assert.deepEqual(normalized.palette.accent, { r: 7, g: 8, b: 9 });
  assert.equal(normalized.background.blobs, 3);
  assert.equal(normalized.background.grain, 0.2);
  assert.equal(normalized.background.gradientStrength, 1.4);
  assert.equal(normalized.background.blobAlphaMin, 0.11);
  assert.equal(normalized.background.blobAlphaMax, 0.22);
  assert.equal(normalized.background.vignette, 0.09);
  assert.equal(normalized.background.accentBlobChance, 0.7);
};

export const runThemeQaTests = (): void => {
  THEME_IDS.forEach(validateThemeJson);
  runTypographyResolverTests();
  runBackgroundNormalizationTests();
};
