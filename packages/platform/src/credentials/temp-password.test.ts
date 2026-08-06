import { expect, it } from "vitest";
import { generateTemporaryPassword, TEMP_PASSWORD_ALPHABET } from "./temp-password";

it("uses only the unambiguous alphabet", () => {
  for (let i = 0; i < 500; i += 1) {
    for (const ch of generateTemporaryPassword()) {
      expect(TEMP_PASSWORD_ALPHABET).toContain(ch);
    }
  }
});

it("excludes visually ambiguous characters", () => {
  for (const ch of "0O1lI") expect(TEMP_PASSWORD_ALPHABET).not.toContain(ch);
});

it("honours the requested length and defaults to 10", () => {
  expect(generateTemporaryPassword()).toHaveLength(10);
  expect(generateTemporaryPassword(16)).toHaveLength(16);
});

it("does not repeat across draws", () => {
  const seen = new Set(Array.from({ length: 200 }, () => generateTemporaryPassword()));
  expect(seen.size).toBe(200);
});
