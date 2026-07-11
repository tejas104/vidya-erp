import type { AnalyticsReadModel } from "@vidya/module-analytics";
import type { Principal } from "@vidya/platform";

/**
 * Report content is assembled ONLY through the analytics read model, which
 * enforces constituent-closure, the minimum-cohort rule and at-risk
 * field-gating (ADR-0018). A report therefore contains exactly what the
 * requester's live view would — no exemption because it is "a document"
 * (ADR-0020). Access is decided by `canProduce`; content by `collectReport`.
 */

export type ReportKind =
  | "student-performance"
  | "section-attendance"
  | "marks-summary"
  | "at-risk";

export type ScopeLevel = "section" | "class" | "department" | "college";

export type ReportParams =
  | { readonly kind: "student-performance"; readonly studentId: string }
  | { readonly kind: "section-attendance"; readonly sectionId: string }
  | { readonly kind: "marks-summary"; readonly classId: string }
  | { readonly kind: "at-risk"; readonly level: ScopeLevel; readonly nodeId: string };

export interface ReportTable {
  readonly caption: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly (string | number)[])[];
}

export interface ReportData {
  readonly kind: ReportKind;
  readonly title: string;
  readonly subtitle: string;
  readonly academicYear: string;
  readonly generatedFor: string;
  readonly generatedAt: string;
  readonly stats: readonly { label: string; value: string }[];
  readonly tables: readonly ReportTable[];
  /** Withheld-cohort / out-of-scope notes shown IN the document, honestly. */
  readonly notes: readonly string[];
  readonly rowCount: number;
}

export type Access = "ok" | "not-found" | "forbidden";

function marksState(
  summary: { state: string; value?: { avgPct: number; nMarks: number; distinctStudents: number } },
): { text: string; note?: string } {
  if (summary.state === "ok" && summary.value !== undefined) {
    return { text: `${summary.value.avgPct}%` };
  }
  if (summary.state === "insufficient-cohort") {
    return { text: "withheld", note: "cohort under 5" };
  }
  if (summary.state === "denied") {
    return { text: "—", note: "outside scope" };
  }
  return { text: "—", note: "no data" };
}

/** Cheap access decision used at request time AND on download (no rendering). */
export async function canProduce(
  readModel: AnalyticsReadModel,
  principal: Principal,
  params: ReportParams,
  academicYear: string,
): Promise<Access> {
  switch (params.kind) {
    case "student-performance": {
      const perf = await readModel.studentPerformance(principal, params.studentId, academicYear);
      if (perf.state === "not-found") return "not-found";
      if (perf.state === "denied") return "forbidden";
      return "ok";
    }
    case "section-attendance": {
      const node = await readModel.nodeRollups(principal, "section", params.sectionId, academicYear);
      if (node === null) return "not-found";
      return node.attendance.state === "denied" ? "forbidden" : "ok";
    }
    case "marks-summary": {
      const node = await readModel.nodeRollups(principal, "class", params.classId, academicYear);
      if (node === null) return "not-found";
      const anyVisible = node.marks.bySubject.length > 0 || node.marks.overall.state === "ok";
      return anyVisible ? "ok" : "forbidden";
    }
    case "at-risk": {
      const node = await readModel.nodeRollups(principal, params.level, params.nodeId, academicYear);
      if (node === null) return "not-found";
      const covers =
        node.attendance.state !== "denied" || node.marks.bySubject.length > 0;
      return covers ? "ok" : "forbidden";
    }
  }
}

export async function collectReport(
  readModel: AnalyticsReadModel,
  principal: Principal,
  params: ReportParams,
  academicYear: string,
  generatedFor: string,
): Promise<ReportData | null> {
  const generatedAt = new Date().toISOString();
  const base = { academicYear, generatedFor, generatedAt } as const;

  switch (params.kind) {
    case "student-performance": {
      const perf = await readModel.studentPerformance(principal, params.studentId, academicYear);
      if (perf.state !== "ok") return null;
      const notes: string[] = [];
      if (perf.overallPct === null) {
        notes.push("Overall average is hidden: you cannot see every subject for this student.");
      }
      if (perf.attendance === null) {
        notes.push("Attendance is outside your scope for this student.");
      }
      const subjectRows = perf.subjects.map((subject) => [
        subject.name,
        `${subject.avgPct}%`,
        subject.series.length,
      ]);
      return {
        ...base,
        kind: params.kind,
        title: "Student performance report",
        subtitle: perf.name,
        stats: [
          { label: "Attendance (YTD)", value: perf.attendance ? `${perf.attendance.pct}%` : "—" },
          { label: "Overall marks (YTD)", value: perf.overallPct === null ? "—" : `${perf.overallPct}%` },
          { label: "Subjects visible", value: String(perf.subjects.length) },
        ],
        tables: [
          {
            caption: "Marks by subject",
            columns: ["Subject", "Average", "Assessments"],
            rows: subjectRows,
          },
        ],
        notes,
        rowCount: subjectRows.length,
      };
    }

    case "section-attendance": {
      const roster = await readModel.rosterAttendance(principal, params.sectionId, academicYear);
      const node = await readModel.nodeRollups(principal, "section", params.sectionId, academicYear);
      if (roster === null || node === null) return null;
      if (node.attendance.state === "denied") return null;
      const notes: string[] = [];
      if (node.attendance.state === "insufficient-cohort") {
        notes.push("Section attendance summary is withheld: cohort under 5.");
      }
      const rows = roster.rows.map((row) => [row.name, `${row.pct}%`, row.total]);
      const summary =
        node.attendance.state === "ok"
          ? `${node.attendance.value.pct}% over ${node.attendance.value.sessions} sessions`
          : "withheld";
      return {
        ...base,
        kind: params.kind,
        title: "Section attendance report",
        subtitle: roster.sectionName,
        stats: [{ label: "Section attendance (YTD)", value: summary }],
        tables: [
          {
            caption: "Attendance by student",
            columns: ["Student", "Attendance", "Sessions"],
            rows,
          },
        ],
        notes: rows.length === 0 ? [...notes, "No student attendance in your scope for this section."] : notes,
        rowCount: rows.length,
      };
    }

    case "marks-summary": {
      const node = await readModel.nodeRollups(principal, "class", params.classId, academicYear);
      if (node === null) return null;
      if (node.marks.bySubject.length === 0 && node.marks.overall.state !== "ok") return null;
      const notes: string[] = [];
      const overall = marksState(node.marks.overall);
      if (overall.note !== undefined) {
        notes.push(`Overall class average ${overall.text} (${overall.note}).`);
      }
      const rows = node.marks.bySubject.map((subject) => {
        const state = marksState(subject.summary);
        const students =
          subject.summary.state === "ok" ? subject.summary.value.distinctStudents : 0;
        const marksCount = subject.summary.state === "ok" ? subject.summary.value.nMarks : 0;
        return [subject.name, state.text + (state.note ? ` (${state.note})` : ""), students, marksCount];
      });
      return {
        ...base,
        kind: params.kind,
        title: "Marks summary report",
        subtitle: node.nodeName,
        stats: [{ label: "Overall average", value: overall.text }],
        tables: [
          {
            caption: "Average by subject",
            columns: ["Subject", "Average", "Students", "Marks"],
            rows,
          },
        ],
        notes,
        rowCount: rows.length,
      };
    }

    case "at-risk": {
      const entries = await readModel.atRisk(principal, params.level, params.nodeId, academicYear);
      const node = await readModel.nodeRollups(principal, params.level, params.nodeId, academicYear);
      if (entries === null || node === null) return null;
      const rows = entries.map((entry) => [
        entry.name,
        entry.attendancePct === null ? "—" : `${entry.attendancePct}%`,
        entry.overallPct === null ? "—" : `${entry.overallPct}%`,
        entry.reasons.join(", "),
      ]);
      return {
        ...base,
        kind: params.kind,
        title: "At-risk report",
        subtitle: `${node.nodeName} · ${params.level}`,
        stats: [{ label: "Flagged", value: String(rows.length) }],
        tables: [
          {
            caption: "Students needing attention",
            columns: ["Student", "Attendance", "Overall", "Reasons"],
            rows,
          },
        ],
        notes:
          rows.length === 0
            ? ["No students are flagged within your scope for this area."]
            : ["Figures shown reflect only what your scope permits; blanks are outside your scope."],
        rowCount: rows.length,
      };
    }
  }
}
