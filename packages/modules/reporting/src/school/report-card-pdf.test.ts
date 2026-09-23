import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { SNAPSHOT_VERSION, type ReportCardSnapshot } from "./report-card-contract";
import { renderReportCardPdf } from "./report-card-pdf";

/**
 * Proves the report-card PDF actually SAYS what the snapshot holds — not just
 * that bytes came out. Same stdlib approach as credential-sheet.test.ts: no
 * PDF-parsing dependency (ADR-0009); pdfkit's content streams are
 * FlateDecode, so `node:zlib` plus the hex show-text operators reconstruct
 * the page text.
 */
function pdfText(buf: Buffer): string {
  const raw = buf.toString("latin1");
  const streamsByObjNum = new Map<number, string>();
  const pageContentRefs: number[] = [];

  for (const match of raw.matchAll(/(\d+) 0 obj\r?\n((?:(?!endobj)[\s\S])*?)endobj/g)) {
    const objNum = Number(match[1]);
    const body = match[2]!;
    const streamMatch = body.match(/stream\r?\n([\s\S]*?)\r?\nendstream/);
    if (streamMatch !== null) {
      try {
        streamsByObjNum.set(
          objNum,
          inflateSync(Buffer.from(streamMatch[1]!, "latin1")).toString("latin1"),
        );
      } catch {
        // Non-Flate stream (embedded font) — not page text.
      }
    }
    if (/\/Type \/Page\b/.test(body) && !/\/Type \/Pages\b/.test(body)) {
      const contents = body.match(/\/Contents (\d+) 0 R/);
      if (contents !== null) pageContentRefs.push(Number(contents[1]));
    }
  }

  return pageContentRefs
    .map((ref) => {
      const stream = streamsByObjNum.get(ref) ?? "";
      let out = "";
      for (const token of stream.match(/<([0-9A-Fa-f]+)>/g) ?? []) {
        const hex = token.slice(1, -1);
        for (let i = 0; i + 1 < hex.length; i += 2) {
          out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
        }
      }
      return out;
    })
    .join("\n");
}

const ISSUED = new Date("2026-09-23T06:30:00.000Z");

function snapshot(overrides: Partial<ReportCardSnapshot> = {}): ReportCardSnapshot {
  return {
    snapshotVersion: SNAPSHOT_VERSION,
    student: { id: "stu-1", fullName: "Asha Kulkarni", admissionNo: "A-001" },
    term: {
      id: "term-1",
      name: "Term 1",
      academicYear: "2026-27",
      startsOn: "2026-06-01",
      endsOn: "2026-10-31",
    },
    subjects: [
      { subjectId: "m", subjectName: "Mathematics", percentage: 90.5, grade: "A", complete: true },
      { subjectId: "s", subjectName: "Science", percentage: 72, grade: "B", complete: true },
    ],
    overall: { percentage: 81.25, grade: "A", complete: true },
    attendance: {
      eligibleDays: 80,
      presentEquivalentDays: 74,
      percentage: 92.5,
      complete: true,
      missingDates: [],
    },
    warnings: [],
    provenance: {
      resultPolicyVersion: "school-weighted-result.policy.v1",
      resultEngineVersion: "school-weighted-result.engine.v1",
      attendancePolicyVersion: "school-attendance-summary.policy.v1",
      attendanceEngineVersion: "school-attendance-summary.engine.v1",
      withinTypeAggregation: "earned-points",
      lateTreatment: "counts-as-present",
      excusedTreatment: "excluded-from-denominator",
      halfDayTreatment: "half-credit",
    },
    ...overrides,
  };
}

describe("renderReportCardPdf", () => {
  it("prints the pupil, term, every subject and the summary figures", async () => {
    const text = pdfText(await renderReportCardPdf(snapshot(), ISSUED));

    expect(text).toContain("Asha Kulkarni");
    expect(text).toContain("A-001");
    expect(text).toContain("Term 1");
    expect(text).toContain("Mathematics");
    expect(text).toContain("90.50%");
    expect(text).toContain("Science");
    expect(text).toContain("72.00%");
    expect(text).toContain("81.25%");
    expect(text).toContain("92.50%");
    expect(text).toContain("74 of 80 eligible days");
  });

  it("prints missing values as 'Not recorded', never as a zero", async () => {
    const text = pdfText(
      await renderReportCardPdf(
        snapshot({
          subjects: [
            { subjectId: "m", subjectName: "Mathematics", percentage: null, grade: null, complete: false },
          ],
          overall: { percentage: null, grade: null, complete: false },
          attendance: {
            eligibleDays: 80,
            presentEquivalentDays: null,
            percentage: null,
            complete: false,
            missingDates: ["2026-06-04"],
          },
          warnings: ["Mathematics has no final percentage because some assessments have no recorded mark."],
        }),
        ISSUED,
      ),
    );

    expect(text).toContain("Not recorded");
    // The failure that would matter: a blank or a zero read as a real mark.
    expect(text).not.toContain("0.00%");
    expect(text).toContain("no recorded mark");
    expect(text).toContain("2026-06-04");
  });

  it("carries the provenance of the figures it printed", async () => {
    const text = pdfText(await renderReportCardPdf(snapshot(), ISSUED));

    expect(text).toContain("school-weighted-result.engine.v1");
    expect(text).toContain("school-attendance-summary.engine.v1");
    expect(text).toContain("earned-points");
    expect(text).toContain(ISSUED.toISOString());
  });

  it("renders from the snapshot alone, so the same snapshot always renders the same document", async () => {
    const frozen = snapshot();
    const [first, second] = await Promise.all([
      renderReportCardPdf(frozen, ISSUED),
      renderReportCardPdf(frozen, ISSUED),
    ]);
    // Byte-identical: nothing in the renderer reads a clock, a database or
    // any ambient state. This is what makes a reprint reproduce the original.
    expect(first.equals(second)).toBe(true);
  });

  it("still produces a valid document when a term has no subjects at all", async () => {
    const bytes = await renderReportCardPdf(
      snapshot({
        subjects: [],
        overall: { percentage: null, grade: null, complete: false },
        warnings: ["This term has no assessments for this class, so there are no subject results."],
      }),
      ISSUED,
    );
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdfText(bytes)).toContain("No subjects were assessed this term.");
  });
});
