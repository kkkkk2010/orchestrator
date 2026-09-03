const stripListMarker = (value: string): string => value
  .replace(/^\s*(?:[•*\-–—]|\d+[.)])\s*/u, "")
  .trim();

export const splitContentItems = (value: string): string[] => value
  .split(/\r?\n|(?=\s*•\s*)/u)
  .map(stripListMarker)
  .filter(Boolean);

export const buildItemizedRepairKeys = (key: string, count: number): string[] => (
  Array.from({ length: count }, (_, index) => `${key}__item${index + 1}`)
);

export const composeExactBulletBlock = (fills: Record<string, string>, keys: string[]): string => {
  const items = keys.map((key) => splitContentItems(fills[key] || "").join(" ").trim());
  if (items.some((item) => item.length === 0)) throw new Error("ExactCountRepairReturnedEmptyItem");
  return items.map((item) => `• ${item}`).join("\n");
};
