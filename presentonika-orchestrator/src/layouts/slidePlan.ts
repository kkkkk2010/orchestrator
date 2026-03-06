import type { SlidePlanRow } from "./types";

export const buildTeacherSlidePlan = (): SlidePlanRow[] => ([
  { slide: 1, slideType: "cover" },
  { slide: 2, slideType: "goals" },
  { slide: 3, slideType: "hook" },
  { slide: 4, slideType: "definition" },
  { slide: 5, slideType: "bullets" },
  { slide: 6, slideType: "twoCol" },
  { slide: 7, slideType: "steps" },
  { slide: 8, slideType: "examples" },
  { slide: 9, slideType: "quiz" },
  { slide: 10, slideType: "summary" },
]);
