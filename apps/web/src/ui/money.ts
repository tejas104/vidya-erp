/**
 * Display-side money formatting. Amounts arrive from the API as integer
 * PAISE (house convention — packages/modules/fees/src/money.ts) and are
 * converted to rupees only here, at the edge, with integer math.
 */

const rupeeGroups = new Intl.NumberFormat("en-IN");

/** 12345050 → "₹1,23,450.50" (Indian digit grouping, always two decimals). */
export function formatPaise(paise: number): string {
  const sign = paise < 0 ? "−" : "";
  const abs = Math.abs(Math.trunc(paise));
  return `${sign}₹${rupeeGroups.format(Math.trunc(abs / 100))}.${String(abs % 100).padStart(2, "0")}`;
}

const ONES = [
  "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function underHundred(n: number): string {
  if (n < 20) return ONES[n];
  return `${TENS[Math.trunc(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
}

function underThousand(n: number): string {
  const hundreds = Math.trunc(n / 100);
  const rest = n % 100;
  if (hundreds === 0) return underHundred(rest);
  return `${ONES[hundreds]} hundred${rest ? ` ${underHundred(rest)}` : ""}`;
}

/** Indian grouping: crore (10^7), lakh (10^5), thousand, hundred. */
export function numberInWords(n: number): string {
  if (n === 0) return "zero";
  const crore = Math.trunc(n / 10_000_000);
  const lakh = Math.trunc(n / 100_000) % 100;
  const thousand = Math.trunc(n / 1000) % 100;
  const rest = n % 1000;
  const parts: string[] = [];
  if (crore > 0) parts.push(`${numberInWords(crore)} crore`);
  if (lakh > 0) parts.push(`${underHundred(lakh)} lakh`);
  if (thousand > 0) parts.push(`${underHundred(thousand)} thousand`);
  if (rest > 0) parts.push(underThousand(rest));
  return parts.join(" ");
}

/** 12345050 → "Rupees one lakh twenty-three... and fifty paise only" (receipt convention). */
export function formatPaiseInWords(paise: number): string {
  const abs = Math.abs(Math.trunc(paise));
  const rupees = Math.trunc(abs / 100);
  const p = abs % 100;
  const head = `Rupees ${numberInWords(rupees)}`;
  return p > 0 ? `${head} and ${underHundred(p)} paise only` : `${head} only`;
}
