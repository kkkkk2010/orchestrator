type ThemeMode = "dark" | "light";

type LayoutVisualRole =
  | "surface"
  | "surfaceAlt"
  | "accent"
  | "accentSoft"
  | "highlight"
  | "highlightSoft"
  | "border"
  | "inverse"
  | "shadow";

export type LayoutThemeTokens = Record<LayoutVisualRole, string> & {
  onAccent: string;
  onHighlight: string;
  accentText: string;
  onInverse: string;
  mutedText: string;
  fontFamily: string;
  mode: ThemeMode;
};

export type LayoutThemeApplyStats = {
  shapesStyled: number;
  fixedTextStyled: number;
  imagesStyled: number;
};

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const readString = (record: Record<string, unknown> | null, key: string, fallback: string): string => {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
};

const defaultsForMode = (mode: ThemeMode): Omit<LayoutThemeTokens, "fontFamily" | "mode"> => mode === "dark"
  ? {
      surface: "#1F2328",
      surfaceAlt: "#282D34",
      accent: "#A8D85D",
      accentSoft: "#2D3926",
      highlight: "#6E91E8",
      highlightSoft: "#26324A",
      border: "#343A43",
      inverse: "#F4F6F8",
      shadow: "#000000",
      onAccent: "#17200D",
      onHighlight: "#17200D",
      accentText: "#C2EA80",
      onInverse: "#16191D",
      mutedText: "#A8B0BA",
    }
  : {
      surface: "#FFFFFF",
      surfaceAlt: "#EEF1F5",
      accent: "#4D5BD1",
      accentSoft: "#E7E9FB",
      highlight: "#D7634F",
      highlightSoft: "#F8E7E2",
      border: "#DDE2E8",
      inverse: "#18202A",
      shadow: "#233044",
      onAccent: "#FFFFFF",
      onHighlight: "#24110D",
      accentText: "#3F4AB6",
      onInverse: "#FFFFFF",
      mutedText: "#66717E",
    };

export const resolveLayoutThemeTokens = (theme: unknown): LayoutThemeTokens => {
  const root = toRecord(theme);
  const mode: ThemeMode = root?.mode === "dark" ? "dark" : "light";
  const defaults = defaultsForMode(mode);
  const palette = toRecord(root?.palette);
  const visual = toRecord(root?.visual);
  const typography = toRecord(root?.typography);

  return {
    surface: readString(visual, "surface", defaults.surface),
    surfaceAlt: readString(visual, "surfaceAlt", defaults.surfaceAlt),
    accent: readString(palette, "accent", defaults.accent),
    accentSoft: readString(visual, "accentSoft", defaults.accentSoft),
    highlight: readString(visual, "highlight", defaults.highlight),
    highlightSoft: readString(visual, "highlightSoft", defaults.highlightSoft),
    border: readString(visual, "border", defaults.border),
    inverse: readString(visual, "inverse", defaults.inverse),
    shadow: readString(visual, "shadow", defaults.shadow),
    onAccent: readString(visual, "onAccent", defaults.onAccent),
    onHighlight: readString(visual, "onHighlight", defaults.onHighlight),
    accentText: readString(visual, "accentText", defaults.accentText),
    onInverse: readString(visual, "onInverse", defaults.onInverse),
    mutedText: readString(visual, "mutedText", defaults.mutedText),
    fontFamily: readString(typography, "fontFamily", "Inter"),
    mode,
  };
};

const visualRole = (meta: Record<string, unknown> | null): LayoutVisualRole | null => {
  const role = meta?.layoutThemeRole;
  if (
    role === "surface" || role === "surfaceAlt" || role === "accent" || role === "accentSoft"
    || role === "highlight" || role === "highlightSoft" || role === "border" || role === "inverse"
    || role === "shadow"
  ) return role;
  return null;
};

const fixedTextColor = (role: unknown, tokens: LayoutThemeTokens): string | null => {
  if (role === "onAccent") return tokens.onAccent;
  if (role === "onHighlight") return tokens.onHighlight;
  if (role === "accent") return tokens.accentText;
  if (role === "onInverse") return tokens.onInverse;
  if (role === "muted") return tokens.mutedText;
  return null;
};

export const applyLayoutThemeStyles = (params: { doc: unknown; theme: unknown }): LayoutThemeApplyStats => {
  const tokens = resolveLayoutThemeTokens(params.theme);
  const root = toRecord(params.doc);
  const slides = Array.isArray(root?.slides) ? root.slides : [];
  let shapesStyled = 0;
  let fixedTextStyled = 0;
  let imagesStyled = 0;

  for (const rawSlide of slides) {
    const slide = toRecord(rawSlide);
    const elements = Array.isArray(slide?.elements) ? slide.elements : [];
    for (const rawElement of elements) {
      const element = toRecord(rawElement);
      if (!element) continue;
      const meta = toRecord(element.meta);
      const style = toRecord(element.style) ?? {};
      element.style = style;

      if (element.type === "shape") {
        const role = visualRole(meta);
        if (!role) continue;
        style.fill = tokens[role];
        if (role === "surface" || role === "surfaceAlt") {
          style.stroke = tokens.border;
          style.strokeWidth = 1;
        } else {
          style.stroke = tokens[role];
          style.strokeWidth = 0;
        }
        if (role === "shadow") {
          const authoredOpacity = typeof style.opacity === "number" ? style.opacity : 0.2;
          style.opacity = tokens.mode === "dark"
            ? Math.min(0.34, authoredOpacity * 1.25)
            : Math.min(0.15, authoredOpacity * 0.5);
        }
        shapesStyled += 1;
        continue;
      }

      if (element.type === "text") {
        const color = fixedTextColor(meta?.layoutTextRole, tokens);
        if (!color) continue;
        style.color = color;
        style.fontFamily = tokens.fontFamily;
        fixedTextStyled += 1;
        continue;
      }

      if (element.type === "image" && meta?.layoutRole === "media") {
        style.borderRadius = typeof style.borderRadius === "number" ? style.borderRadius : 28;
        style.objectFit = typeof style.objectFit === "string" ? style.objectFit : "cover";
        imagesStyled += 1;
      }
    }
  }

  return { shapesStyled, fixedTextStyled, imagesStyled };
};
