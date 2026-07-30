/**
 * Gradient palette cycled by row index for student avatar swatches, each paired
 * with the ink its initials must use.
 *
 * The ink is per-palette because no single text colour clears WCAG AA (4.5:1 at
 * the 16px/700 the SlideOver renders) against all six gradients — white fails on
 * amber/green/cyan, and a dark ink fails on blue/purple. It is a literal rather
 * than a token because these gradients are theme-invariant: a token that flips
 * with the colour scheme (e.g. --on-brand) would break one theme to fix the other.
 *
 * `blue` and `purple` have their light stop slightly darkened from the original
 * palette (#6B7BFF -> #5D6BDE, #8B5CF6 -> #8558EC); at the original values no
 * flat ink reached 4.5:1 against both stops. avatar.test.ts enforces the whole
 * invariant, so a new palette cannot be added without a compliant ink.
 */
export const AVATARS = [
  { gradient: "linear-gradient(140deg,#5D6BDE,#4A5BD8)", ink: "#FFFFFF" },
  { gradient: "linear-gradient(140deg,#F59E0B,#D97706)", ink: "#000000" },
  { gradient: "linear-gradient(140deg,#10B981,#059669)", ink: "#000000" },
  { gradient: "linear-gradient(140deg,#8558EC,#7C3AED)", ink: "#FFFFFF" },
  { gradient: "linear-gradient(140deg,#EC4899,#DB2777)", ink: "#000000" },
  { gradient: "linear-gradient(140deg,#06B6D4,#0891B2)", ink: "#000000" },
];

/** First letter of the first word + first letter of the last word (if any), uppercased. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]![0] : "")).toUpperCase() || "·";
}
