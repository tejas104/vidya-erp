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

export interface StudentPerformance {
  studentId: string;
  name: string;
  attendance: { pct: number; total: number; monthly: MonthPoint[] } | null;
  subjects: { subjectId: string; name: string; avgPct: number; series: { label: string; pct: number }[] }[];
  overallPct: number | null;
}

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
