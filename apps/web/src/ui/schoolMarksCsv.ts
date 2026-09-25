import type { ScoreEntryStudent } from "./ScoreEntryCard";
import type { SchoolMarkView } from "./api";

export interface CsvIssue { row: number; studentId: string; message: string }
export interface CsvChange { studentId: string; fullName: string; admissionNo: string; before: number | null; after: number }
export interface CsvPreview { changes: CsvChange[]; blankCount: number; issues: CsvIssue[] }

const HEADER = ["student_id", "admission_no", "student_name", "score"];

function csvCell(raw: string): string {
  const value = /^[\s=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${value.replaceAll('"', '""')}"`;
}

/** The opaque ID binds each row; names only help teachers identify pupils. */
export function marksCsvTemplate(roster: readonly ScoreEntryStudent[], marks: readonly SchoolMarkView[]): string {
  const existing = new Map(marks.map((mark) => [mark.studentId, mark.score]));
  return [HEADER.join(","), ...roster.map((student) => [
    csvCell(student.id), csvCell(student.admissionNo ?? ""), csvCell(student.fullName),
    existing.has(student.id) ? String(existing.get(student.id)) : "",
  ].join(","))].join("\r\n") + "\r\n";
}

/** Small RFC 4180 reader for browser CSV, including Excel quotes and CRLF. */
function readRecords(csv: string): string[][] {
  const text = csv.replace(/^\uFEFF/, "");
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') { quoted = false; closedQuote = true; }
      else field += char;
    } else if (char === '"' && field === "" && !closedQuote) {
      quoted = true;
    } else if (char === "," || char === "\n" || char === "\r") {
      row.push(field);
      field = "";
      closedQuote = false;
      if (char !== ",") {
        if (row.some((cell) => cell !== "")) records.push(row);
        row = [];
        if (char === "\r" && text[index + 1] === "\n") index += 1;
        if (records.length > 501) throw new Error("The CSV exceeds 500 student rows.");
      }
    } else if (closedQuote || char === '"') {
      throw new Error("The CSV has an invalid quoted field.");
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error("The CSV has an unfinished quoted field.");
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell !== "")) records.push(row);
  }
  if (records.length > 501) throw new Error("The CSV exceeds 500 student rows.");
  return records;
}

export function previewMarksCsv(csv: string, roster: readonly ScoreEntryStudent[], marks: readonly SchoolMarkView[], maxScore: number): CsvPreview {
  const records = readRecords(csv);
  if (records.length === 0 || records[0]?.length !== HEADER.length ||
      records[0]?.some((value, index) => value.trim().toLowerCase() !== HEADER[index])) {
    throw new Error(`Use the downloaded template with columns: ${HEADER.join(", ")}.`);
  }
  if (roster.length > 500) throw new Error("This class exceeds the 500-row batch limit. Contact your administrator.");
  const byId = new Map(roster.map((student) => [student.id, student]));
  const saved = new Map(marks.map((mark) => [mark.studentId, mark.score]));
  const seen = new Set<string>();
  const issues: CsvIssue[] = [];
  const changes: CsvChange[] = [];
  let blankCount = 0;
  for (const [index, values] of records.slice(1).entries()) {
    const row = index + 2;
    const [rawId = "", rawAdmission = "", , rawScore = ""] = values;
    const studentId = rawId.trim();
    const student = byId.get(studentId);
    if (values.length !== HEADER.length) { issues.push({ row, studentId, message: "Use exactly four columns." }); continue; }
    if (!student) { issues.push({ row, studentId, message: "Student ID is not in this section's current roster." }); continue; }
    if (seen.has(studentId)) { issues.push({ row, studentId, message: "This student appears more than once." }); continue; }
    seen.add(studentId);
    const admission = rawAdmission.startsWith("'") && /^[\s=+\-@]/.test(student.admissionNo ?? "") ? rawAdmission.slice(1) : rawAdmission;
    if (admission.trim() !== (student.admissionNo ?? "")) {
      issues.push({ row, studentId, message: "Admission number does not match this student." });
      continue;
    }
    const scoreText = rawScore.trim();
    if (scoreText === "") { blankCount += 1; continue; }
    if (!/^\d+(?:\.\d{1,2})?$/.test(scoreText) || Number(scoreText) > maxScore) {
      issues.push({ row, studentId, message: `Score must be 0–${maxScore}, with at most two decimal places.` });
      continue;
    }
    const after = Number(scoreText);
    const before = saved.get(studentId) ?? null;
    if (before !== after) changes.push({ studentId, fullName: student.fullName, admissionNo: student.admissionNo ?? "", before, after });
  }
  for (const student of roster) {
    if (!seen.has(student.id)) issues.push({ row: 0, studentId: student.id, message: `${student.fullName} is missing from the file.` });
  }
  return { changes, blankCount, issues };
}

export function marksCsvErrorReport(issues: readonly CsvIssue[]): string {
  return ["csv_row,student_id,error", ...issues.map((issue) => [String(issue.row || ""), csvCell(issue.studentId), csvCell(issue.message)].join(","))].join("\r\n") + "\r\n";
}
