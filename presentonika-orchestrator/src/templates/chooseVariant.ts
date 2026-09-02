type SlideChooseRule =
  | {
      mode: "seed";
      variants?: string[];
    }
  | {
      mode: "fillLength";
      key?: string;
      threshold?: number;
      lt?: string;
      gte?: string;
    };

type VariantRule = {
  dropAt?: number[];
  drop?: string[];
};

type SlideMap = {
  choose?: SlideChooseRule;
  variants?: Record<string, VariantRule>;
};

const hash32 = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const pickSeedAB = (presentationId: number, slideIndex1: number): "A" | "B" => {
  const hash = hash32(`${presentationId}:${slideIndex1}`);
  return hash % 2 === 0 ? "A" : "B";
};

export const chooseVariant = (params: {
  slideIndex1: number;
  mapSlide: unknown;
  presentationId: number;
  fills: Record<string, string>;
}): { chosen: string | null; reason: string } => {
  const mapSlide = (params.mapSlide && typeof params.mapSlide === "object" ? params.mapSlide : {}) as SlideMap;
  const choose = mapSlide.choose;

  if (choose && choose.mode === "seed") {
    const variants = Array.isArray(choose.variants) ? choose.variants.filter((item) => typeof item === "string" && item.length > 0) : [];
    if (variants.length === 0) {
      return { chosen: null, reason: "seed:no_variants" };
    }

    const index = hash32(`${params.presentationId}:${params.slideIndex1}`) % variants.length;
    return { chosen: variants[index], reason: "seed" };
  }

  if (choose && choose.mode === "fillLength") {
    const key = typeof choose.key === "string" ? choose.key : "";
    const threshold = typeof choose.threshold === "number" && Number.isFinite(choose.threshold) ? choose.threshold : 0;
    const lt = typeof choose.lt === "string" ? choose.lt : null;
    const gte = typeof choose.gte === "string" ? choose.gte : null;

    if (!key) {
      return { chosen: null, reason: "fillLength:missing_key" };
    }

    const len = (params.fills[key] || "").length;

    if (!lt || !gte) {
      return { chosen: null, reason: `fillLength:${key}:${len}:invalid_rule` };
    }

    return {
      chosen: len >= threshold ? gte : lt,
      reason: `fillLength:${key}:${len}`,
    };
  }

  const variants = mapSlide.variants ? Object.keys(mapSlide.variants) : [];
  if (variants.length === 0) {
    return { chosen: null, reason: "no_variants" };
  }

  if (variants.includes("A") && variants.includes("B")) {
    return { chosen: pickSeedAB(params.presentationId, params.slideIndex1), reason: "legacy_seed_ab" };
  }

  const stable = [...variants].sort()[0];
  return { chosen: stable, reason: "legacy_first" };
};
