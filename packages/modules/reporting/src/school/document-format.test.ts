import { describe, expect, it } from "vitest";
import { decodeSample, documentStyleSchema, sampleSchema } from "./document-format";

describe("school document formats", () => {
  it("only accepts controlled presentation fields", () => {
    expect(documentStyleSchema.safeParse({ schoolName: "School", accentColor: "#123ABC", footerText: "", markOverride: 99 }).success).toBe(false);
    expect(documentStyleSchema.safeParse({ schoolName: "School", accentColor: "javascript:alert(1)", footerText: "" }).success).toBe(false);
  });
  it("requires a canonical, size-bounded PDF or DOCX sample", () => {
    const pdf = { filename: "sample.pdf", contentType: "application/pdf" as const, dataBase64: Buffer.from("%PDF-1.4\n").toString("base64") };
    expect(decodeSample(sampleSchema.parse(pdf))?.subarray(0, 5).toString()).toBe("%PDF-");
    expect(decodeSample({ ...pdf, dataBase64: Buffer.from("fake").toString("base64") })).toBeNull();
    expect(sampleSchema.safeParse({ ...pdf, dataBase64: "A".repeat(1_400_001) }).success).toBe(false);
    expect(sampleSchema.safeParse({ ...pdf, filename: "danger.exe" }).success).toBe(false);
    expect(sampleSchema.safeParse({ ...pdf, filename: "folder\\sample.pdf" }).success).toBe(false);
    expect(sampleSchema.safeParse({ ...pdf, filename: "sample.docx" }).success).toBe(false);
  });
});
