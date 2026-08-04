import { describe, expect, it } from "vitest";
import { helpSlugFor } from "./helpSlug";

describe("helpSlugFor", () => {
  it("derives a slug from the route", () => {
    expect(helpSlugFor("/manage/attendance")).toBe("attendance");
    expect(helpSlugFor("/manage/import/students")).toBe("import-students");
    expect(helpSlugFor("/dashboard")).toBe("dashboard");
  });

  it("drops dynamic segments", () => {
    expect(helpSlugFor("/students/abc-123")).toBe("students");
  });

  it("handles the root", () => {
    expect(helpSlugFor("/")).toBe("home");
  });
});
