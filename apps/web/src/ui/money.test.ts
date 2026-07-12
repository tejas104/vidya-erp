import { describe, expect, it } from "vitest";
import { formatPaise, formatPaiseInWords, numberInWords } from "./money";

describe("formatPaise", () => {
  it("groups Indian-style with two decimals", () => {
    expect(formatPaise(12_345_050)).toBe("₹1,23,450.50");
    expect(formatPaise(100)).toBe("₹1.00");
    expect(formatPaise(0)).toBe("₹0.00");
    expect(formatPaise(999)).toBe("₹9.99");
    expect(formatPaise(1_00_00_00_000)).toBe("₹1,00,00,000.00");
  });
  it("marks negatives (refund ledger lines)", () => {
    expect(formatPaise(-4500)).toBe("−₹45.00");
  });
});

describe("numberInWords (Indian grouping)", () => {
  it("handles zero through hundreds", () => {
    expect(numberInWords(0)).toBe("zero");
    expect(numberInWords(19)).toBe("nineteen");
    expect(numberInWords(45)).toBe("forty five");
    expect(numberInWords(705)).toBe("seven hundred five");
  });
  it("uses lakh and crore", () => {
    expect(numberInWords(123_450)).toBe("one lakh twenty three thousand four hundred fifty");
    expect(numberInWords(10_00_000)).toBe("ten lakh");
    expect(numberInWords(12_34_56_789)).toBe(
      "twelve crore thirty four lakh fifty six thousand seven hundred eighty nine",
    );
  });
});

describe("formatPaiseInWords (receipt line)", () => {
  it("writes rupees and paise", () => {
    expect(formatPaiseInWords(12_345_050)).toBe(
      "Rupees one lakh twenty three thousand four hundred fifty and fifty paise only",
    );
    expect(formatPaiseInWords(1234)).toBe("Rupees twelve and thirty four paise only");
  });
  it("omits zero paise", () => {
    expect(formatPaiseInWords(500_000)).toBe("Rupees five thousand only");
  });
});
