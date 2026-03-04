export const mergeFills = (
  fillKeys: string[],
  llmFills: Record<string, string>,
  fallbackPrefix = "TEST_"
): Record<string, string> => {
  const merged: Record<string, string> = {};

  for (const key of fillKeys) {
    const value = llmFills[key];
    if (typeof value === "string" && value.trim().length > 0) {
      merged[key] = value;
    } else {
      merged[key] = `${fallbackPrefix}${key}`;
    }
  }

  return merged;
};
