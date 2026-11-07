export type ColorScoring =
  | { mode: "proportional" }
  | { mode: "threshold"; points: number; threshold: number }
  | { mode: "closest"; points: number; tieTolerance: number };

type ColorQuestionBase = {
  image: string;
  initialColor: string;
  targetColor: string;
};

export type ColorQuestion = ColorQuestionBase & (
  | { mask: string; regionIds?: never }
  | { regionIds: string[]; mask?: never }
);

export const SVG_REGION_ID = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;

export function parseRegionIds(raw: unknown): string[] {
  if (!Array.isArray(raw) || !raw.length || !raw.every((id) => typeof id === "string" && SVG_REGION_ID.test(id)) || new Set(raw).size !== raw.length) {
    throw new Error("regionIds must be a nonempty array of unique SVG element IDs.");
  }
  return [...raw];
}

export function parseColorQuestion(raw: unknown): ColorQuestion {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Color question must be an object.");
  const q = raw as Record<string, unknown>;
  const validPath = (path: unknown, extensions: string) => typeof path === "string" && !/[\\\x00-\x1f]/.test(path) && new RegExp(`^(?!/)(?!media/)(?!.*(?:^|/)\\.\\.(?:/|$)).+\\.(${extensions})$`).test(path);
  if (!validPath(q.image, "png|jpg|jpeg|webp|svg")) throw new Error("Color image must be a relative PNG, JPEG, WebP, or SVG path.");
  if (typeof q.initialColor !== "string" || !HEX_COLOR.test(q.initialColor) || typeof q.targetColor !== "string" || !HEX_COLOR.test(q.targetColor)) throw new Error("Color values must be six-digit HEX colors.");
  const svg = (q.image as string).endsWith(".svg");
  const allowed = ["image", "initialColor", "targetColor", svg ? "regionIds" : "mask"];
  if (Object.keys(q).some((key) => !allowed.includes(key))) throw new Error(svg ? "SVG questions use regionIds and cannot have a mask." : "Raster questions use a mask and cannot have regionIds.");
  const base = { image: q.image as string, initialColor: q.initialColor.toUpperCase(), targetColor: q.targetColor.toUpperCase() };
  if (svg) return { ...base, regionIds: parseRegionIds(q.regionIds) };
  if (!validPath(q.mask, "png|jpg|jpeg|webp")) throw new Error("Color mask must be a relative PNG, JPEG, or WebP path.");
  return { ...base, mask: q.mask as string };
}

export type ColorPackRound = {
  type: "color";
  title: string;
  scoring: ColorScoring;
  questions: ColorQuestion[];
};

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function parseColorScoring(raw: unknown): ColorScoring {
  if (!raw || typeof raw !== "object") throw new Error("Color scoring is required.");
  const data = raw as Record<string, unknown>;
  if (data.mode === "proportional") {
    if (Object.keys(data).some((key) => key !== "mode")) throw new Error("Proportional scoring accepts only mode.");
    return { mode: "proportional" };
  }
  const points = data.points ?? 1;
  if (typeof points !== "number" || !Number.isFinite(points) || points <= 0) {
    throw new Error("Color points must be a positive finite number.");
  }
  if (data.mode === "threshold") {
    const threshold = data.threshold ?? 8.5;
    if (Object.keys(data).some((key) => !["mode", "points", "threshold"].includes(key)) ||
        typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0 || threshold > 10) {
      throw new Error("Color threshold must be between 0 and 10.");
    }
    return { mode: "threshold", points, threshold };
  }
  if (data.mode === "closest") {
    const tieTolerance = data.tieTolerance ?? 0.05;
    if (Object.keys(data).some((key) => !["mode", "points", "tieTolerance"].includes(key)) ||
        typeof tieTolerance !== "number" || !Number.isFinite(tieTolerance) || tieTolerance < 0 || tieTolerance > 10) {
      throw new Error("Color tie tolerance must be between 0 and 10.");
    }
    return { mode: "closest", points, tieTolerance };
  }
  throw new Error("Color scoring mode must be threshold, closest, or proportional.");
}
