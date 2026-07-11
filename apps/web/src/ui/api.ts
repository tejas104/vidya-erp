/**
 * Browser-side API client. Every call is same-origin to /api/v1/... so the
 * HttpOnly, SameSite=Strict session cookie rides along automatically — the
 * UI holds no privileged path and receives only what the caller's scope
 * permits (the permission mirror).
 */

export type Role = "admin" | "principal" | "hod" | "class_teacher" | "teacher";

export interface Session {
  userId: string;
  displayName: string;
  roles: Role[];
  grants: unknown[];
}

export interface MonthPoint {
  month: string;
  pct: number;
}
export interface AttendanceSummary {
  pct: number;
  sessions: number;
  distinctStudents: number;
  monthly: MonthPoint[];
}
export interface MarksSummary {
  avgPct: number;
  nMarks: number;
  distinctStudents: number;
  monthly: { month: string; avgPct: number }[];
}

export type AggState<T> =
  | { state: "ok"; value: T }
  | { state: "insufficient-cohort"; minCohort: number }
  | { state: "no-data" }
  | { state: "denied"; deniedSubjectId?: string };

export interface StripSection {
  sectionId: string;
  name: string;
  days: { heldOn: string; presentPct: number }[];
}

export type Tile =
  | {
      type: "teacher-class";
      classId: string;
      subjectId: string;
      attendance: AggState<AttendanceSummary>;
      marks: AggState<MarksSummary>;
      atRisk: number;
      strip: StripSection[];
    }
  | {
      type: "class";
      classId: string;
      attendance: AggState<AttendanceSummary>;
      marks: AggState<MarksSummary>;
      atRisk: number;
      strip: StripSection[];
    }
  | {
      type: "department";
      departmentId: string;
      attendance: AggState<AttendanceSummary>;
      marks: AggState<MarksSummary>;
      atRisk: number;
    }
  | {
      type: "college";
      collegeId: string;
      attendance: AggState<AttendanceSummary>;
      marks: AggState<MarksSummary>;
      atRisk: number;
    };

export interface Dashboard {
  academicYear: string;
  names: Record<string, string>;
  tiles: Tile[];
}

export interface AtRiskEntry {
  studentId: string;
  name: string;
  attendancePct: number | null;
  subjectPcts: Record<string, number>;
  overallPct: number | null;
  reasons: ("low-attendance" | "low-marks")[];
}

export type ReportParams =
  | { kind: "student-performance"; studentId: string }
  | { kind: "section-attendance"; sectionId: string }
  | { kind: "marks-summary"; classId: string }
  | { kind: "at-risk"; level: string; nodeId: string };

export interface ReportView {
  id: string;
  kind: string;
  format: "pdf" | "csv";
  status: "pending" | "running" | "completed" | "failed";
  rows: number;
  error: string | null;
}

export interface StudentPerformance {
  studentId: string;
  name: string;
  attendance: { pct: number; total: number; monthly: MonthPoint[] } | null;
  subjects: { subjectId: string; name: string; avgPct: number; series: { label: string; pct: number }[] }[];
  overallPct: number | null;
}

export interface NodeRollup {
  node: { level: string; nodeId: string; name: string };
  attendance: AggState<AttendanceSummary>;
  marks: {
    bySubject: { subjectId: string; name: string; summary: AggState<MarksSummary> }[];
    overall: AggState<MarksSummary>;
  };
}

export interface ComparisonChild {
  nodeId: string;
  name: string;
  attendance: AggState<AttendanceSummary>;
  marks: AggState<MarksSummary>;
  atRisk: number;
}
export interface ComparisonReport {
  parent: { level: string; nodeId: string; name: string };
  childLevel: string;
  children: ComparisonChild[];
}

export interface HistogramBand {
  label: string;
  count: number;
}
export interface DistributionResponse {
  node: { level: string; nodeId: string; name: string };
  marks: AggState<{ total: number; bands: HistogramBand[] }>;
  attendance: AggState<{ total: number; bands: HistogramBand[] }>;
}

export type AttendanceStatus = "present" | "absent" | "late" | "excused";
export interface RecordAttendanceBody {
  sectionId: string; heldOn: string; slot: string; academicYear: string;
  entries: { studentId: string; status: AttendanceStatus }[];
}
export interface SessionView {
  id: string; sectionId: string; heldOn: string; slot: string; academicYear: string; takenBy: string;
  entries: { studentId: string; status: AttendanceStatus }[];
}
export interface SessionSummary {
  id: string; heldOn: string; slot: string; academicYear: string;
  counts: { present: number; absent: number; late: number; excused: number };
}
export type AssessmentKind = "exam" | "quiz" | "assignment";
export interface AssessmentView {
  id: string; classId: string; subjectId: string; kind: AssessmentKind; name: string;
  academicYear: string; maxScore: number; heldOn: string | null;
}
export interface CreateAssessmentBody {
  classId: string; subjectId: string; kind: AssessmentKind; name: string;
  academicYear: string; maxScore: number; heldOn?: string;
}

export interface CollegeView { id: string; name: string; code: string }
export interface DepartmentView { id: string; collegeId: string; name: string; code: string }
export interface ClassView { id: string; departmentId: string; name: string; code: string }
export interface SectionView { id: string; classId: string; name: string }
export interface SubjectView { id: string; departmentId: string; name: string; code: string }
export interface OrgTree {
  college: CollegeView;
  departments: (DepartmentView & {
    classes: (ClassView & { sections: SectionView[] })[];
    subjects: SubjectView[];
  })[];
}
export interface StudentView {
  id: string; collegeId: string; admissionNo: string; fullName: string;
  status: "active" | "inactive";
  enrollment: { sectionId: string; academicYear: string } | null;
}
export interface TeacherView {
  id: string; collegeId: string; staffNo: string; fullName: string;
  status: "active" | "inactive"; identityUserId: string | null;
}
export interface AssignmentView {
  id: string; teacherId: string; classId: string; subjectId: string | null;
  kind: "subject_teacher" | "class_teacher"; academicYear: string;
}
export interface UserView {
  id: string; username: string; displayName: string; status: string; roles: string[];
}
export type OrgUnitType = "college" | "department" | "class" | "section" | "subject";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new ApiError(response.status, `request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

type Json = unknown;

async function send<T>(method: string, path: string, body?: Json): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as { title?: string; message?: string };
    throw new ApiError(response.status, problem.title ?? problem.message ?? `request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
const post = <T>(path: string, body: Json) => send<T>("POST", path, body);
const patch = <T>(path: string, body: Json) => send<T>("PATCH", path, body);
const put = <T>(path: string, body: Json) => send<T>("PUT", path, body);
const del = <T>(path: string) => send<T>("DELETE", path);

/** Academic year rolls over in June (matches the server's academicYearForDate). */
export function currentAcademicYear(now: Date = new Date()): string {
  const year = now.getFullYear();
  const startYear = now.getMonth() + 1 >= 6 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export const api = {
  session: () => get<Session>("/api/v1/identity/auth/session"),
  dashboard: (year: string) => get<Dashboard>(`/api/v1/analytics/dashboard?academicYear=${year}`),
  atRisk: (level: string, nodeId: string, year: string) =>
    get<{ students: AtRiskEntry[] }>(
      `/api/v1/analytics/at-risk/${level}/${encodeURIComponent(nodeId)}?academicYear=${year}`,
    ),
  studentPerformance: (studentId: string, year: string) =>
    get<StudentPerformance>(
      `/api/v1/analytics/students/${encodeURIComponent(studentId)}/performance?academicYear=${year}`,
    ),
  rollup: (level: string, nodeId: string, year: string) =>
    get<NodeRollup>(`/api/v1/analytics/rollups/${level}/${encodeURIComponent(nodeId)}?academicYear=${year}`),
  compare: (level: string, nodeId: string, year: string) =>
    get<ComparisonReport>(`/api/v1/analytics/compare/${level}/${encodeURIComponent(nodeId)}?academicYear=${year}`),
  distribution: (level: string, nodeId: string, year: string) =>
    get<DistributionResponse>(`/api/v1/analytics/distribution/${level}/${encodeURIComponent(nodeId)}?academicYear=${year}`),
  // people
  sectionRoster: (sectionId: string) =>
    get<{ students: StudentView[] }>(`/api/v1/people/sections/${encodeURIComponent(sectionId)}/roster`),
  // academics — attendance
  recordAttendance: (body: RecordAttendanceBody) =>
    post<SessionView>("/api/v1/academics/attendance/sessions", body),
  sessionAttendance: (sectionId: string, opts: { from?: string; to?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.from) q.set("from", opts.from);
    if (opts.to) q.set("to", opts.to);
    if (opts.limit) q.set("limit", String(opts.limit));
    return get<{ sessions: SessionSummary[] }>(`/api/v1/academics/sections/${encodeURIComponent(sectionId)}/attendance?${q}`);
  },
  getSession: (sessionId: string) =>
    get<SessionView>(`/api/v1/academics/attendance/sessions/${encodeURIComponent(sessionId)}`),
  correctAttendance: (sessionId: string, studentId: string, status: AttendanceStatus) =>
    patch<{ studentId: string; status: AttendanceStatus }>(
      `/api/v1/academics/attendance/sessions/${encodeURIComponent(sessionId)}/entries/${encodeURIComponent(studentId)}`,
      { status },
    ),
  // academics — marks
  classAssessments: (classId: string, year: string) =>
    get<{ assessments: AssessmentView[] }>(`/api/v1/academics/classes/${encodeURIComponent(classId)}/assessments?academicYear=${year}`),
  createAssessment: (body: CreateAssessmentBody) => post<AssessmentView>("/api/v1/academics/assessments", body),
  enterMarks: (assessmentId: string, entries: { studentId: string; score: number }[]) =>
    put<{ created: number; updated: number; unchanged: number }>(
      `/api/v1/academics/assessments/${encodeURIComponent(assessmentId)}/marks`,
      { entries },
    ),
  assessmentMarks: (assessmentId: string) =>
    get<{ marks: { id: string; assessmentId: string; studentId: string; score: number }[] }>(
      `/api/v1/academics/assessments/${encodeURIComponent(assessmentId)}/marks`,
    ),
  // people — org
  colleges: () => get<{ colleges: CollegeView[] }>("/api/v1/people/colleges"),
  collegeTree: (collegeId: string) => get<OrgTree>(`/api/v1/people/colleges/${encodeURIComponent(collegeId)}/tree`),
  createDepartment: (body: { collegeId: string; name: string; code: string }) =>
    post<DepartmentView>("/api/v1/people/departments", body),
  createClass: (body: { departmentId: string; name: string; code: string }) =>
    post<ClassView>("/api/v1/people/classes", body),
  createSection: (body: { classId: string; name: string }) => post<SectionView>("/api/v1/people/sections", body),
  createSubject: (body: { departmentId: string; name: string; code: string }) =>
    post<SubjectView>("/api/v1/people/subjects", body),
  renameOrgUnit: (unitType: OrgUnitType, unitId: string, name: string) =>
    patch<{ ok: true }>(`/api/v1/people/org/${unitType}/${encodeURIComponent(unitId)}`, { name }),
  deleteOrgUnit: (unitType: OrgUnitType, unitId: string) =>
    del<{ ok: true }>(`/api/v1/people/org/${unitType}/${encodeURIComponent(unitId)}`),
  // people — students
  createStudent: (body: { collegeId: string; admissionNo: string; fullName: string }) =>
    post<StudentView>("/api/v1/people/students", body),
  updateStudent: (studentId: string, body: { fullName?: string; status?: "active" | "inactive" }) =>
    patch<StudentView>(`/api/v1/people/students/${encodeURIComponent(studentId)}`, body),
  enrollStudent: (studentId: string, body: { sectionId: string; academicYear: string }) =>
    post<{ enrollmentId: string; previousEnrollmentId: string | null }>(
      `/api/v1/people/students/${encodeURIComponent(studentId)}/enrollment`,
      body,
    ),
  // people — teachers
  createTeacher: (body: { collegeId: string; staffNo: string; fullName: string }) =>
    post<TeacherView>("/api/v1/people/teachers", body),
  getTeacher: (teacherId: string) => get<TeacherView>(`/api/v1/people/teachers/${encodeURIComponent(teacherId)}`),
  linkTeacherIdentity: (teacherId: string, identityUserId: string | null) =>
    post<{ teacher: TeacherView; grants: { upserted: number; removed: number } }>(
      `/api/v1/people/teachers/${encodeURIComponent(teacherId)}/identity-link`,
      { identityUserId },
    ),
  createTeacherAssignment: (
    teacherId: string,
    body: { classId: string; subjectId?: string; kind: "subject_teacher" | "class_teacher"; academicYear: string },
  ) => post<AssignmentView>(`/api/v1/people/teachers/${encodeURIComponent(teacherId)}/assignments`, body),
  removeAssignment: (assignmentId: string) =>
    del<{ ok: true }>(`/api/v1/people/assignments/${encodeURIComponent(assignmentId)}`),
  classTeacherAssignments: (classId: string) =>
    get<{ assignments: AssignmentView[] }>(`/api/v1/people/classes/${encodeURIComponent(classId)}/assignments`),
  // identity (admin)
  listUsers: (collegeId: string) =>
    get<{ users: UserView[] }>(`/api/v1/identity/users?collegeId=${encodeURIComponent(collegeId)}&limit=200`),
  async login(username: string, password: string): Promise<void> {
    const response = await fetch("/api/v1/identity/auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!response.ok) {
      const problem = (await response.json().catch(() => ({}))) as { message?: string };
      throw new ApiError(response.status, problem.message ?? "login failed");
    }
  },
  async logout(): Promise<void> {
    await fetch("/api/v1/identity/auth/logout", { method: "POST", credentials: "same-origin" }).catch(
      () => undefined,
    );
  },
  async requestReport(report: ReportParams, format: "pdf" | "csv", year: string): Promise<string> {
    const response = await fetch("/api/v1/reports", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ format, academicYear: year, report }),
    });
    if (!response.ok) {
      throw new ApiError(response.status, "could not request report");
    }
    return (await response.json() as { reportId: string }).reportId;
  },
  reportStatus: (reportId: string) => get<ReportView>(`/api/v1/reports/${encodeURIComponent(reportId)}`),
  /** The scoped-download URL — the browser navigates to it; the server re-checks scope. */
  downloadUrl: (reportId: string) => `/api/v1/reports/${encodeURIComponent(reportId)}/download`,
};

/** Categorical subject hue, fixed order (matches globals.css --series-*). */
export function subjectColor(index: number): string {
  return `var(--series-${(index % 6) + 1})`;
}

/** Present% → the register-strip density bucket 0–4. */
export function densityBucket(pct: number): number {
  if (pct >= 90) return 4;
  if (pct >= 75) return 3;
  if (pct >= 50) return 2;
  if (pct >= 1) return 1;
  return 0;
}
