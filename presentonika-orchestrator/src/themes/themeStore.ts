import path from "node:path";
import fs from "node:fs/promises";

const THEMES_DIR = process.env.THEMES_DIR || "themes";

export const getThemesRootDir = (): string => path.resolve(THEMES_DIR);

export const getThemeDir = (themeId: string): string => {
  return path.resolve(getThemesRootDir(), themeId);
};

export const getThemeTemplateZipPath = (themeId: string): string => {
  return path.resolve(getThemeDir(themeId), "template.out.zip");
};

export const getThemeMapPath = (themeId: string): string => {
  return path.resolve(getThemeDir(themeId), "map.json");
};


export const getThemeJsonPath = (themeId: string): string => {
  return path.resolve(getThemeDir(themeId), "theme.json");
};

export const assertThemeTemplateExists = async (themeId: string): Promise<string> => {
  const templatePath = getThemeTemplateZipPath(themeId);

  try {
    await fs.access(templatePath);
  } catch {
    throw new Error(`ThemePackNotFound: ${templatePath}`);
  }

  return templatePath;
};

export const readThemeMap = async (themeId: string): Promise<unknown> => {
  const mapPath = getThemeMapPath(themeId);

  try {
    const rawMap = await fs.readFile(mapPath, "utf8");
    return JSON.parse(rawMap) as unknown;
  } catch {
    return {};
  }
};

export const readThemeSafe = async (themeId: string): Promise<unknown> => {
  const themePath = getThemeJsonPath(themeId);

  try {
    const rawTheme = await fs.readFile(themePath, "utf8");
    return JSON.parse(rawTheme) as unknown;
  } catch {
    return {};
  }
};
