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

export const assertThemeTemplateExists = async (themeId: string): Promise<string> => {
  const templatePath = getThemeTemplateZipPath(themeId);

  try {
    await fs.access(templatePath);
  } catch {
    throw new Error(`ThemePackNotFound: ${templatePath}`);
  }

  return templatePath;
};
