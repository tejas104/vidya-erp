/** Gradient palette cycled by row index for the SlideOver avatar swatch. */
export const AVATARS = [
  "linear-gradient(140deg,#6B7BFF,#4A5BD8)",
  "linear-gradient(140deg,#F59E0B,#D97706)",
  "linear-gradient(140deg,#10B981,#059669)",
  "linear-gradient(140deg,#8B5CF6,#7C3AED)",
  "linear-gradient(140deg,#EC4899,#DB2777)",
  "linear-gradient(140deg,#06B6D4,#0891B2)",
];

/** First letter of the first word + first letter of the last word (if any), uppercased. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]![0] : "")).toUpperCase() || "·";
}
