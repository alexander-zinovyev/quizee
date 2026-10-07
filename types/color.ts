export type ColorScoring =
  | { mode: "threshold"; points: number; threshold: number }
  | { mode: "closest"; points: number; tieTolerance: number };

export type ColorQuestion = {
  image: string;
  mask: string;
  initialColor: string;
  targetColor: string;
};

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
  throw new Error("Color scoring mode must be threshold or closest.");
}
