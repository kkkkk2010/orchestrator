import { createHash } from "node:crypto";
import type { LayoutTemplate } from "./types";

const scoreBySeed = (seed: string, key: string): number => {
  const digest = createHash("sha1").update(`${seed}:${key}`).digest("hex").slice(0, 8);
  return Number.parseInt(digest, 16);
};

export const selectLayoutTemplate = (params: {
  candidates: LayoutTemplate[];
  seed: string;
}): LayoutTemplate => {
  const { candidates, seed } = params;
  if (candidates.length === 0) {
    throw new Error("LayoutSelectorError: no candidates");
  }

  let best = candidates[0];
  let bestScore = scoreBySeed(seed, best.id);

  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const score = scoreBySeed(seed, candidate.id);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
};
