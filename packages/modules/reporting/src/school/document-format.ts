import { z } from "zod";

/** Only presentation may be edited. Figures and identity always come from records. */
export const documentFamilySchema = z.enum(["report_card", "attendance_review", "certificate"]);
export const documentStyleSchema = z.object({
  schoolName: z.string().trim().min(1).max(100),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  footerText: z.string().trim().max(180),
}).strict();
export type DocumentFamily = z.infer<typeof documentFamilySchema>;
export type DocumentStyle = z.infer<typeof documentStyleSchema>;

export const DEFAULT_DOCUMENT_STYLE: DocumentStyle = {
  schoolName: "VIDYA",
  accentColor: "#b23a2e",
  footerText: "",
};

export const sampleSchema = z.object({
  filename: z.string().trim().min(1).max(180).regex(/^[^\\/\r\n]+\.(pdf|docx)$/i),
  contentType: z.enum(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]),
  dataBase64: z.string().max(1_400_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
}).strict().refine((sample) => sample.filename.toLowerCase().endsWith(sample.contentType === "application/pdf" ? ".pdf" : ".docx"), {
  path: ["filename"], message: "file extension must match its media type",
});

export function decodeSample(sample: z.infer<typeof sampleSchema>): Buffer | null {
  const bytes = Buffer.from(sample.dataBase64, "base64");
  if (bytes.length === 0 || bytes.length > 1_048_576 || bytes.toString("base64") !== sample.dataBase64) return null;
  if (sample.contentType === "application/pdf") return bytes.subarray(0, 5).toString() === "%PDF-" ? bytes : null;
  return bytes[0] === 0x50 && bytes[1] === 0x4b ? bytes : null;
}
