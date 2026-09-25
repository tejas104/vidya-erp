/**
 * Browser-side API client. Every call is same-origin to /api/v1/... so the
 * HttpOnly, SameSite=Strict session cookie rides along automatically — the
 * UI holds no privileged path and receives only what the caller's scope
 * permits (the permission mirror).
 */

export type Role = "admin" | "principal" | "hod" | "class_teacher" | "teacher" | "student" | "accountant";

export interface Session {
  userId: string;
  /** ADR-0027: "guardian" sessions hold no roles and live in /family.
   *  Absent (an older server) means staff. */
  kind?: "staff" | "guardian";
  displayName: string;
  roles: Role[];
  grants: unknown[];
}

// --- license (#11.75 item 1): admin-only, surface only, never enforced ---
export interface LicenseClaims {
  id: string;
  customer: string;
  edition: "college" | "school";
  issuedAt: string;
  expiresAt: string;
  seats: number;
  notBefore?: string;
}
export type LicenseInvalidReason =
  | "malformed"
  | "bad-signature"
  | "unsupported-version"
  | "not-yet-valid"
  | "edition-mismatch";
export type LicenseInfo =
  | { kind: "valid"; claims: LicenseClaims; daysRemaining: number; studentCount: number }
  | { kind: "grace"; claims: LicenseClaims; daysOverdue: number; studentCount: number }
  | { kind: "expired"; claims: LicenseClaims; daysOverdue: number; studentCount: number }
  | { kind: "invalid"; reason: LicenseInvalidReason; studentCount: number }
  | { kind: "absent"; studentCount: number };

export interface AuditEventView {
  id: number;
  occurredAt: string;
  module: string;
  action: string;
  actorType: string;
  actorId: string | null;
  resourceType: string;
  resourceId: string | null;
  requestId: string | null;
  details: Record<string, unknown>;
}

export interface AuditEventsView {
  events: AuditEventView[];
  limit: number;
  truncated: boolean;
}

export interface SchoolTermView {
  id: string;
  collegeId: string;
  name: string;
  academicYear: string;
  startsOn: string;
  endsOn: string;
  status: "open" | "closed";
  closedAt: string | null;
  closedBy: string | null;
  closedReason: string | null;
  marksReleasedAt: string | null;
}

export interface SchoolAssessmentType {
  id: string;
  termId: string;
  name: string;
  weight: number;
}

export interface SchoolAssessmentView {
  id: string; termId: string; typeId: string; classId: string; subjectId: string;
  name: string; academicYear: string; maxScore: number; heldOn: string;
}
export interface SchoolMarkView {
  id: string; assessmentId: string; studentId: string; score: number;
  percentage: number; grade: string; points: number; recordedBy: string; updatedAt: string;
}
export interface SchoolClassSetup {
  terms: { id: string; name: string; academicYear: string; startsOn: string; endsOn: string; status: "open" | "closed"; scaleId: string | null; scaleName: string | null; types: { id: string; name: string; weight: number }[] }[];
  scales: { id: string; name: string }[];
}

export interface SchoolReportCardRosterStudent {
  studentId: string;
  fullName: string;
  admissionNo: string;
  snapshotId: string | null;
  generatedAt: string | null;
  publishedSnapshotId: string | null;
}
export interface SchoolTermCalendar { termId: string; instructionalDays: string[] | null; shortfallThreshold: number | null; version: number; locked: boolean }
export interface SchoolAttendanceShortfall {
  termId: string; sectionId: string; through: string; calendarVersion: number; threshold: number;
  scheduledDates: string[]; unsubmittedDates: string[];
  students: { studentId: string; fullName: string; admissionNo: string; enrollmentDates: { from: string | null; to: string | null }[]; dateIssue: string | null; expectedDays: number | null; recordedDays: number | null; absentDays: number | null; missingEntryDates: string[]; percentageDenominator: number | null; percentage: number | null; shortfall: boolean | null }[];
}

export interface ChildReportCard {
  snapshotId: string;
  termId: string;
  termName: string;
  academicYear: string;
  generatedAt: string;
  overall: { percentage: number | null; grade: string | null; complete: boolean };
  attendance: { percentage: number | null; complete: boolean };
}

export interface SchoolReportCardPreview {
  student: { id: string; fullName: string; admissionNo: string };
  term: { id: string; name: string; academicYear: string; startsOn: string; endsOn: string };
  subjects: { subjectId: string; subjectName: string; percentage: number | null; grade: string | null; complete: boolean }[];
  overall: { percentage: number | null; grade: string | null; complete: boolean };
  attendance: { eligibleDays: number; presentEquivalentDays: number | null; percentage: number | null; complete: boolean; missingDates: string[] };
  warnings: string[];
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
  | { kind: "teacher-attendance"; collegeId: string; date: string }
  | { kind: "school-attendance-review"; sectionId: string; termId: string; through: string }
  | { kind: "marks-summary"; classId: string }
  | { kind: "at-risk"; level: string; nodeId: string }
  | { kind: "grade-card"; studentId: string }
  | { kind: "hall-ticket"; studentId: string };

export interface ReportView {
  id: string;
  kind: string;
  format: "pdf" | "csv" | "xlsx";
  academicYear: string;
  status: "pending" | "running" | "completed" | "failed";
  rows: number;
  error: string | null;
  createdAt: string;
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
  sectionId: string; subjectId?: string; heldOn: string; slot: string; academicYear: string;
  entries: { studentId: string; status: AttendanceStatus }[];
}
export interface SessionView {
  id: string; sectionId: string; subjectId: string; heldOn: string; slot: string; academicYear: string; takenBy: string;
  entries: { studentId: string; status: AttendanceStatus }[];
}
export interface SessionSummary {
  id: string; subjectId: string; heldOn: string; slot: string; academicYear: string;
  counts: { present: number; absent: number; late: number; excused: number };
}
export interface SectionCorrection {
  sessionId: string;
  studentId: string;
  studentName: string;
  before: AttendanceStatus;
  after: AttendanceStatus;
  at: string;
  byName?: string;
}
export interface RosterCard {
  studentId: string;
  counts: { present: number; absent: number; late: number; excused: number };
  attended: number; total: number; pct: number | null;
  recent: { heldOn: string; status: AttendanceStatus }[];
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
export interface StudentMarksRow {
  mark: { id: string; assessmentId: string; studentId: string; score: number; recordedBy: string; updatedAt: string };
  assessment: AssessmentView;
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
export type DocumentKind = "photo" | "id_proof" | "marksheet" | "tc" | "other";
export interface StudentDocument {
  id: string;
  studentId: string;
  kind: DocumentKind;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
}
export type StudentStatus =
  | "active" | "inactive" | "backlog" | "year_back" | "transferred" | "dropped" | "alumni";
export interface StudentProfile {
  phone: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  dob: string | null;
}
export interface StudentView extends StudentProfile {
  id: string; collegeId: string; admissionNo: string; fullName: string;
  status: StudentStatus;
  identityUserId: string | null;
  enrollment: { id?: string; sectionId: string; academicYear: string; startsOn?: string | null; endsOn?: string | null } | null;
}
export interface SchoolReportCardDeskScope {
    classes: { id: string; collegeId: string; name: string; canPublish: boolean }[];
    terms: { id: string; collegeId: string; name: string; academicYear: string; startsOn: string; endsOn: string }[];
}
export interface StudentDetailView extends Omit<StudentView, "enrollment"> {
  enrollment: {
    sectionId: string; sectionName: string; classId: string | null;
    className: string; academicYear: string;
  } | null;
}
export interface StudentHistory {
  enrollments: {
    id: string; sectionId: string; sectionName: string; classId: string | null;
    className: string; academicYear: string; status: string; createdAt: string; updatedAt: string;
    startsOn?: string | null; endsOn?: string | null;
  }[];
  statusChanges: { from: StudentStatus; to: StudentStatus; occurredAt: string; actorId: string | null }[];
  events: { action: string; actorId: string | null; occurredAt: string }[];
}
export interface StudentAttendance {
  sessions: { sessionId: string; sectionId: string; heldOn: string; slot: string; status: AttendanceStatus }[];
  counts: { present: number; absent: number; late: number; excused: number };
}
export interface TeacherView {
  id: string; collegeId: string; staffNo: string; fullName: string;
  status: "active" | "inactive"; identityUserId: string | null;
}
export type StaffPresence = "present" | "absent" | "late" | "leave";
export interface StaffAttendanceView {
  id: string;
  teacherId: string;
  attendedOn: string;
  status: StaffPresence;
  note: string | null;
  markedBy: string;
  updatedAt: string;
}
export interface StaffAttendancePage {
  teachers: { teacher: TeacherView; attendance: StaffAttendanceView | null }[];
  nextOffset: number | null;
}
export interface AssignmentView {
  id: string; teacherId: string; classId: string; subjectId: string | null;
  kind: "subject_teacher" | "class_teacher"; academicYear: string;
  teacherName: string | null; subjectName: string | null;
}
export interface GrantView {
  id: string; role: Role; collegeId: string;
  departmentId: string | null; classId: string | null; sectionId: string | null; subjectId: string | null;
  verified: boolean; source: "manual" | "derived";
}
export interface GrantInput {
  role: Role; collegeId: string;
  departmentId?: string; classId?: string; sectionId?: string; subjectId?: string;
}
export interface UserView {
  id: string; username: string; displayName: string;
  accountKind: "staff" | "guardian";
  status: "active" | "disabled" | "must_reset";
  collegeId: string; roles: Role[]; grants: GrantView[]; createdAt: string;
}
export interface ImportView {
  id: string; kind: "students" | "teachers"; collegeId: string;
  status: "pending" | "running" | "completed" | "failed";
  dryRun: boolean; totalRows: number; okRows: number; errorRows: number;
  warningRows: number; processedRows: number;
  errors: { row: number; message: string }[];
  warnings: { row: number; message: string }[];
}
export type OrgUnitType = "college" | "department" | "class" | "section" | "subject";

export interface PortalMe {
  student: { id: string; admissionNo: string; fullName: string; status: string };
  enrollment: { sectionId: string; sectionName: string; className: string; academicYear: string } | null;
}
export interface PortalAttendance {
  counts: { present: number; absent: number; late: number; excused: number };
  pct: number | null;
  monthly: { month: string; pct: number }[];
  sessions: { heldOn: string; status: AttendanceStatus }[];
}
// --- timetable ---
export interface TtPeriod {
  periodNo: number;
  starts: string;
  ends: string;
}
export interface TtEntry {
  id: string;
  sectionId: string;
  subjectId: string;
  subjectName: string;
  teacherId: string;
  teacherName: string;
  room: string;
  dayOfWeek: number;
  periodNo: number;
}
export interface TtToday {
  dayOfWeek: number;
  periods: TtPeriod[];
  entries: (TtEntry & { sectionName: string; className: string })[];
}
export interface TtWeek {
  periods: TtPeriod[];
  entries: (TtEntry & { sectionName: string; className: string })[];
}

// --- coursework ---
export interface CwkAssignment {
  id: string;
  classId: string;
  subjectId: string;
  subjectName: string;
  title: string;
  instructions: string;
  dueOn: string;
  maxScore: number | null;
  academicYear: string;
  submissions?: number;
  mySubmission?: { submittedAt: string; score: number | null; feedback: string | null } | null;
}
export interface CwkSubmission {
  id: string;
  studentId: string;
  studentName: string;
  body: string;
  hasFile: boolean;
  submittedAt: string;
  score: number | null;
  feedback: string | null;
}
export interface CwkMaterial {
  id: string;
  classId: string;
  subjectId: string;
  subjectName: string;
  title: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

// --- notices ---
export type NoticeKind = "notice" | "holiday" | "exam" | "event";
export interface NoticeView {
  id: string;
  collegeId: string;
  audience: string;
  audienceLabel: string;
  kind: NoticeKind;
  eventDate: string | null;
  title: string;
  body: string;
  publishAt: string;
  expiresAt: string | null;
  createdBy: string;
  createdAt: string;
}

export type ChildNotice = Pick<NoticeView, "id" | "kind" | "eventDate" | "title" | "body" | "publishAt" | "expiresAt">;

// --- fees ---
export type PaymentMode = "cash" | "upi" | "card" | "bank" | "gateway";
export type InvoiceStatus = "pending" | "part" | "paid" | "waived";
export type AdjustmentKind = "scholarship" | "fine" | "refund" | "waiver";
export interface FeeHeadView {
  id: string;
  collegeId: string;
  name: string;
}
export interface FeeStructureView {
  id: string;
  collegeId: string;
  departmentId: string;
  classId: string;
  headId: string;
  headName: string;
  academicYear: string;
  amountPaise: number;
  dueOn: string;
  installmentNo: number;
}
export interface FeeInvoiceView {
  id: string;
  collegeId: string;
  departmentId: string;
  classId: string;
  sectionId: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  structureId: string;
  headId: string;
  headName: string;
  academicYear: string;
  amountPaise: number;
  dueOn: string;
  status: InvoiceStatus;
  paidPaise: number;
  duesPaise: number;
}
export interface FeePaymentView {
  id: string;
  invoiceId: string;
  receiptNo: number;
  amountPaise: number;
  mode: PaymentMode;
  ref: string;
  receivedBy: string;
  receivedAt: string;
}
export interface FeeAdjustmentView {
  id: string;
  invoiceId: string;
  kind: AdjustmentKind;
  amountPaise: number;
  reason: string;
  actor: string;
  createdAt: string;
}
export interface FeeGenerationRunView {
  id: string;
  collegeId: string;
  classId: string;
  academicYear: string;
  status: "pending" | "running" | "completed" | "failed";
  invoicesCreated: number;
  invoicesSkipped: number;
  error: string | null;
}
export interface FeeCollectionSummary {
  from: string;
  to: string;
  totalPaise: number;
  byMode: { mode: PaymentMode; totalPaise: number; count: number }[];
}
export type FeeMyInvoice = FeeInvoiceView & {
  payments: FeePaymentView[];
  adjustments: FeeAdjustmentView[];
};
export type ChildFeeInvoice = Pick<FeeInvoiceView, "id" | "headName" | "academicYear" | "amountPaise" | "dueOn" | "status" | "paidPaise" | "duesPaise"> & {
  payments: Pick<FeePaymentView, "receiptNo" | "amountPaise" | "mode" | "receivedAt">[];
};

// --- results ---
export interface GradeBand {
  minPct: number;
  grade: string;
  points: number;
}
export interface GradeScaleView {
  id: string;
  collegeId: string;
  name: string;
  bands: GradeBand[];
  /** Referenced by a publication — frozen against edits. */
  locked: boolean;
}
export interface SubjectCreditView {
  subjectId: string;
  subjectName: string;
  credits: number;
}
export interface SubjectResult {
  subjectId: string;
  subjectName: string;
  credits: number;
  pct: number;
  grade: string;
  points: number;
}
export interface StudentResult {
  studentId: string;
  studentName: string;
  admissionNo: string;
  subjects: SubjectResult[];
  sgpa: number;
  rank: number;
}
export interface PublicationView {
  id: string;
  collegeId: string;
  classId: string;
  academicYear: string;
  term: string;
  scaleId: string;
  publishedAt: string;
  publishedBy: string;
}
export interface MyResultsTerm {
  term: string;
  academicYear: string;
  publishedAt: string;
  sgpa: number;
  subjects: SubjectResult[];
}
export interface MyResults {
  terms: MyResultsTerm[];
  cgpa: number | null;
}

// --- exams ---
export interface ExamSeriesView {
  id: string;
  collegeId: string;
  name: string;
  academicYear: string;
  term: string;
  slotCount: number;
}
export interface ExamSlotView {
  id: string;
  seriesId: string;
  seriesName: string;
  classId: string;
  subjectId: string;
  subjectName: string;
  onDate: string;
  starts: string;
  ends: string;
  room: string;
}

// --- leave ---
export interface LeaveRequestView {
  id: string;
  collegeId: string;
  departmentId: string | null;
  teacherId: string;
  teacherName: string;
  fromOn: string;
  toOn: string;
  kind: "casual" | "sick" | "duty";
  reason: string;
  status: "pending" | "approved" | "rejected";
  decisionNote: string | null;
  decidedAt: string | null;
}

export interface PortalMarks {
  subjects: {
    subjectId: string;
    name: string;
    avgPct: number;
    marks: { assessmentName: string; kind: string; pct: number; heldOn: string | null }[];
  }[];
  overallPct: number | null;
}

export interface SchoolPortalMarks {
  terms: {
    termId: string;
    termName: string;
    academicYear: string;
    endsOn: string;
    overallPct: number | null;
    complete: boolean;
    subjects: {
      subjectId: string;
      name: string;
      percentage: number | null;
      status: "complete" | "incomplete" | "unavailable";
      recordedCount: number;
      assessmentCount: number;
      assessments: {
        assessmentId: string;
        name: string;
        typeName: string;
        heldOn: string;
        maxScore: number;
        score: number | null;
        status: "scored" | "absent" | "exempt" | "missing";
      }[];
    }[];
  }[];
}

// --- syllabus ---
export interface TopicView {
  id: string;
  title: string;
  position: number;
  taughtOn: string | null;
}
export interface UnitView {
  id: string;
  classId: string;
  subjectId: string;
  subjectName: string;
  title: string;
  position: number;
  academicYear: string;
  topics: TopicView[];
  coveragePct: number;
}
export interface SyllabusView {
  units: UnitView[];
}
export interface SubjectSyllabus {
  subjectId: string;
  subjectName: string;
  coveragePct: number;
  units: UnitView[];
}
export interface MySyllabus {
  subjects: SubjectSyllabus[];
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

// --- guardians (ADR-0027) ---
export type GuardianRelationshipType = "parent" | "legal-guardian" | "other-authorized-contact";
export type GuardianRelationshipStatus = "pending" | "active" | "restricted" | "revoked" | "expired";
export interface GuardianChild {
  studentId: string;
  fullName: string;
  admissionNo: string;
  relationshipType: GuardianRelationshipType;
  status: GuardianRelationshipStatus;
  categories: string[];
}
export interface GuardianRelationshipView {
  id: string;
  guardianName: string;
  relationshipType: GuardianRelationshipType;
  isPrimaryContact: boolean;
  verificationState: "unverified" | "self-attested" | "staff-verified";
  status: GuardianRelationshipStatus;
  categories: string[];
  statusReason: string | null;
  since: string;
}
export interface GuardianInvitationView {
  id: string;
  guardianName: string;
  relationshipType: GuardianRelationshipType;
  contactMethod: "sms" | "email";
  contactValue: string;
  staffVerified: boolean;
  expiresAt: string;
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
  rollup: (level: string, nodeId: string, year: string) =>
    get<NodeRollup>(`/api/v1/analytics/rollups/${level}/${encodeURIComponent(nodeId)}?academicYear=${year}`),
  compare: (level: string, nodeId: string, year: string) =>
    get<ComparisonReport>(`/api/v1/analytics/compare/${level}/${encodeURIComponent(nodeId)}?academicYear=${year}`),
  distribution: (level: string, nodeId: string, year: string) =>
    get<DistributionResponse>(`/api/v1/analytics/distribution/${level}/${encodeURIComponent(nodeId)}?academicYear=${year}`),
  recomputeAnalytics: (year: string) =>
    post<{ enqueued: true }>("/api/v1/analytics/recompute", { academicYear: year }),
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
  rosterAttendance: (sectionId: string, opts: { academicYear?: string; subjectId?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.academicYear) q.set("academicYear", opts.academicYear);
    if (opts.subjectId) q.set("subjectId", opts.subjectId);
    return get<{ cards: RosterCard[] }>(
      `/api/v1/academics/sections/${encodeURIComponent(sectionId)}/roster-attendance?${q}`,
    );
  },
  getSession: (sessionId: string) =>
    get<SessionView>(`/api/v1/academics/attendance/sessions/${encodeURIComponent(sessionId)}`),
  correctAttendance: (sessionId: string, studentId: string, status: AttendanceStatus) =>
    patch<{ studentId: string; status: AttendanceStatus }>(
      `/api/v1/academics/attendance/sessions/${encodeURIComponent(sessionId)}/entries/${encodeURIComponent(studentId)}`,
      { status },
    ),
  sectionCorrections: (sectionId: string, opts: { limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.limit) q.set("limit", String(opts.limit));
    return get<{ corrections: SectionCorrection[] }>(
      `/api/v1/academics/sections/${encodeURIComponent(sectionId)}/corrections?${q}`,
    );
  },
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
  studentMarks: (studentId: string, year: string) =>
    get<{ marks: StudentMarksRow[] }>(
      `/api/v1/academics/students/${encodeURIComponent(studentId)}/marks?academicYear=${year}`,
    ),
  studentAttendance: (studentId: string, year: string) =>
    get<StudentAttendance>(`/api/v1/academics/students/${encodeURIComponent(studentId)}/attendance?academicYear=${year}`),
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
  studentGet: (studentId: string) =>
    get<StudentDetailView>(`/api/v1/people/students/${encodeURIComponent(studentId)}`),
  studentHistory: (studentId: string) =>
    get<StudentHistory>(`/api/v1/people/students/${encodeURIComponent(studentId)}/history`),
  // student documents (2.5)
  docList: (studentId: string) =>
    get<{ documents: StudentDocument[] }>(`/api/v1/people/students/${encodeURIComponent(studentId)}/documents`),
  docUpload: (studentId: string, body: { kind: DocumentKind; filename: string; contentType: string; dataBase64: string }) =>
    post<StudentDocument>(`/api/v1/people/students/${encodeURIComponent(studentId)}/documents`, body),
  docDownloadUrl: (documentId: string) => `/api/v1/people/documents/${encodeURIComponent(documentId)}/download`,
  docDelete: (documentId: string) => del<{ ok: true }>(`/api/v1/people/documents/${encodeURIComponent(documentId)}`),
  createStudent: (body: { collegeId: string; admissionNo: string; fullName: string; sectionId?: string; academicYear?: string; startsOn?: string }) =>
    post<StudentView>("/api/v1/people/students", body),
  updateStudent: (
    studentId: string,
    body: { fullName?: string; status?: StudentStatus; phone?: string | null; guardianName?: string | null; guardianPhone?: string | null; dob?: string | null },
  ) =>
    patch<StudentView>(`/api/v1/people/students/${encodeURIComponent(studentId)}`, body),
  enrollStudent: (studentId: string, body: { sectionId: string; academicYear: string; startsOn?: string }) =>
    post<{ enrollmentId: string; previousEnrollmentId: string | null }>(
      `/api/v1/people/students/${encodeURIComponent(studentId)}/enrollment`,
      body,
    ),
  correctEnrollmentDates: (studentId: string, enrollmentId: string, body: { startsOn: string; endsOn: string | null; expectedStartsOn: string | null; expectedEndsOn: string | null }) =>
    patch<{ enrollmentId: string; startsOn: string; endsOn: string | null }>(`/api/v1/people/students/${encodeURIComponent(studentId)}/enrollments/${encodeURIComponent(enrollmentId)}/dates`, body),
  // people — teachers
  createTeacher: (body: { collegeId: string; staffNo: string; fullName: string }) =>
    post<TeacherView>("/api/v1/people/teachers", body),
  listTeachers: (collegeId: string, options: { q?: string; offset?: number; limit?: number } = {}) => {
    const query = new URLSearchParams({ collegeId, offset: String(options.offset ?? 0), limit: String(options.limit ?? 50) });
    if (options.q) query.set("q", options.q);
    return get<{ teachers: TeacherView[]; nextOffset: number | null }>(`/api/v1/people/teachers?${query}`);
  },
  listStaffAttendance: (collegeId: string, date: string, options: { q?: string; offset?: number; limit?: number } = {}) => {
    const query = new URLSearchParams({ collegeId, date, offset: String(options.offset ?? 0), limit: String(options.limit ?? 50) });
    if (options.q) query.set("q", options.q);
    return get<StaffAttendancePage>(`/api/v1/people/teachers/attendance?${query}`);
  },
  saveStaffAttendance: (body: { collegeId: string; date: string; entries: { teacherId: string; status: StaffPresence; note?: string | null }[] }) =>
    put<{ attendance: StaffAttendanceView[] }>("/api/v1/people/teachers/attendance", body),
  getTeacher: (teacherId: string) => get<TeacherView>(`/api/v1/people/teachers/${encodeURIComponent(teacherId)}`),
  updateTeacher: (teacherId: string, body: { fullName?: string; status?: "active" | "inactive" }) =>
    patch<TeacherView>(`/api/v1/people/teachers/${encodeURIComponent(teacherId)}`, body),
  issueTeacherCredential: (teacherId: string) =>
    post<{ teacher: TeacherView; username: string; temporaryPassword: string; grants: { upserted: number; removed: number } }>(
      `/api/v1/people/teachers/${encodeURIComponent(teacherId)}/credential`, {},
    ),
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
  createUser: (body: { username: string; displayName: string; collegeId: string; temporaryPassword: string; roles: Role[] }) =>
    post<UserView>("/api/v1/identity/users", body),
  updateUser: (userId: string, body: { displayName?: string; status?: "active" | "disabled" }) =>
    patch<UserView>(`/api/v1/identity/users/${encodeURIComponent(userId)}`, body),
  setUserRoles: (userId: string, roles: Role[]) =>
    put<{ roles: Role[] }>(`/api/v1/identity/users/${encodeURIComponent(userId)}/roles`, { roles }),
  addGrant: (userId: string, body: GrantInput) =>
    post<GrantView>(`/api/v1/identity/users/${encodeURIComponent(userId)}/grants`, body),
  removeGrant: (userId: string, grantId: string) =>
    del<{ ok: true }>(`/api/v1/identity/users/${encodeURIComponent(userId)}/grants/${encodeURIComponent(grantId)}`),
  verifyGrants: () =>
    post<{ verified: number; unresolved: { grantId: string; reason: string }[] }>("/api/v1/identity/grants/verify", {}),
  passwordResetInit: (userId: string) =>
    post<{ token: string; expiresAt: string }>(`/api/v1/identity/users/${encodeURIComponent(userId)}/password-reset`, {}),
  setUserPassword: (userId: string, newPassword: string) =>
    post<{ ok: true }>(`/api/v1/identity/users/${encodeURIComponent(userId)}/password`, { newPassword }),
  // people — imports
  createImport: (body: { kind: "students" | "teachers"; collegeId: string; academicYear?: string; dryRun: boolean; csv: string }) =>
    post<{ importId: string }>("/api/v1/people/imports", body),
  getImport: (importId: string) => get<ImportView>(`/api/v1/people/imports/${encodeURIComponent(importId)}`),
  /** Header-only CSV template; downloaded via a plain <a href download>, same pattern as docDownloadUrl/downloadUrl. */
  importTemplateUrl: (kind: "students" | "teachers") => `/api/v1/people/imports/template?kind=${kind}`,
  /** Rejected-row CSV — re-scope-checked server-side on click. */
  importErrorsUrl: (importId: string) => `/api/v1/people/imports/${encodeURIComponent(importId)}/errors`,
  // reporting
  listReports: (limit = 25) => get<{ reports: ReportView[] }>(`/api/v1/reports?limit=${limit}`),
  // people — student identity link (W1)
  linkStudentIdentity: (studentId: string, identityUserId: string | null) =>
    post<{ student: StudentView }>(
      `/api/v1/people/students/${encodeURIComponent(studentId)}/identity-link`,
      { identityUserId },
    ),
  // portal (student self-scope)
  portalMe: () => get<PortalMe>("/api/v1/portal/me"),
  portalAttendance: (year: string) => get<PortalAttendance>(`/api/v1/portal/attendance?academicYear=${year}`),
  portalMarks: (year: string) => get<PortalMarks>(`/api/v1/portal/marks?academicYear=${year}`),
  portalSchoolMarks: (year: string) => get<SchoolPortalMarks>(`/api/v1/portal/school-marks?academicYear=${encodeURIComponent(year)}`),
  portalTimetable: (year: string) =>
    get<{ periods: TtPeriod[]; entries: TtEntry[] }>(`/api/v1/portal/timetable?academicYear=${year}`),
  portalToday: (year: string) =>
    get<{ dayOfWeek: number; periods: TtPeriod[]; entries: TtEntry[] }>(`/api/v1/portal/today?academicYear=${year}`),
  // --- guardians (ADR-0027) ---
  guardianChildren: () => get<{ children: GuardianChild[] }>("/api/v1/people/guardian/children"),
  childAttendance: (studentId: string, year: string) =>
    get<PortalAttendance>(`/api/v1/portal/children/${encodeURIComponent(studentId)}/attendance?academicYear=${year}`),
  childMarks: (studentId: string, year: string) =>
    get<PortalMarks>(`/api/v1/portal/children/${encodeURIComponent(studentId)}/marks?academicYear=${year}`),
  childSchoolMarks: (studentId: string, year: string) =>
    get<SchoolPortalMarks>(`/api/v1/portal/children/${encodeURIComponent(studentId)}/school-marks?academicYear=${encodeURIComponent(year)}`),
  childToday: (studentId: string, year: string) =>
    get<{ dayOfWeek: number; periods: TtPeriod[]; entries: TtEntry[] }>(
      `/api/v1/portal/children/${encodeURIComponent(studentId)}/today?academicYear=${year}`,
    ),
  childFees: (studentId: string) =>
    get<{ invoices: ChildFeeInvoice[] }>(`/api/v1/fees/children/${encodeURIComponent(studentId)}/invoices`),
  childNotices: (studentId: string) =>
    get<{ notices: ChildNotice[] }>(`/api/v1/notices/children/${encodeURIComponent(studentId)}/visible`),
  childReportCards: (studentId: string) =>
    get<{ reportCards: ChildReportCard[] }>(`/api/v1/school/report-cards/children/${encodeURIComponent(studentId)}`),
  childReportCardDownloadUrl: (studentId: string, snapshotId: string) =>
    `/api/v1/school/report-cards/children/${encodeURIComponent(studentId)}/${encodeURIComponent(snapshotId)}/download`,
  guardianActivate: (body: { code: string; fullName: string; username: string; password: string }) =>
    post<{ username: string; child: { fullName: string }; status: "active" | "pending" }>("/api/v1/people/guardian-invitations/activate", body),
  guardianRedeem: (code: string) =>
    post<{ child: { fullName: string }; status: "active" | "pending" }>("/api/v1/people/guardian-invitations/redeem", { code }),
  studentGuardians: (studentId: string) =>
    get<{ relationships: GuardianRelationshipView[]; invitations: GuardianInvitationView[] }>(
      `/api/v1/people/students/${encodeURIComponent(studentId)}/guardians`,
    ),
  inviteGuardian: (
    studentId: string,
    body: { guardianName: string; relationshipType: GuardianRelationshipType; contactMethod: "sms" | "email"; contactValue: string; staffVerified: boolean },
  ) =>
    post<{ invitation: GuardianInvitationView; code: string }>(
      `/api/v1/people/students/${encodeURIComponent(studentId)}/guardian-invitations`,
      body,
    ),
  verifyGuardian: (relationshipId: string) =>
    post<{ relationship: GuardianRelationshipView }>(`/api/v1/people/guardian-relationships/${encodeURIComponent(relationshipId)}/verify`, {}),
  revokeGuardian: (relationshipId: string, reason: string) =>
    post<{ relationship: GuardianRelationshipView }>(`/api/v1/people/guardian-relationships/${encodeURIComponent(relationshipId)}/revoke`, { reason }),
  // --- timetable ---
  ttPeriodsGet: (collegeId: string) =>
    get<{ periods: TtPeriod[] }>(`/api/v1/timetable/colleges/${encodeURIComponent(collegeId)}/periods`),
  ttPeriodsSet: (collegeId: string, periods: TtPeriod[]) =>
    put<{ ok: true }>(`/api/v1/timetable/colleges/${encodeURIComponent(collegeId)}/periods`, { periods }),
  ttEntryCreate: (body: {
    sectionId: string; subjectId: string; teacherId: string; room?: string;
    dayOfWeek: number; periodNo: number; academicYear: string;
  }) => post<TtEntry>("/api/v1/timetable/entries", body),
  ttEntryDelete: (entryId: string) => del<{ ok: true }>(`/api/v1/timetable/entries/${encodeURIComponent(entryId)}`),
  ttSectionGrid: (sectionId: string, year: string) =>
    get<{ periods: TtPeriod[]; entries: TtEntry[] }>(
      `/api/v1/timetable/sections/${encodeURIComponent(sectionId)}/grid?academicYear=${year}`,
    ),
  ttMyToday: (year: string) => get<TtToday>(`/api/v1/timetable/my/today?academicYear=${year}`),
  ttMyWeek: (year: string) => get<TtWeek>(`/api/v1/timetable/my/week?academicYear=${year}`),
  // --- coursework ---
  cwkCreateAssignment: (body: {
    classId: string; subjectId: string; title: string; instructions?: string;
    dueOn: string; maxScore?: number; academicYear: string;
  }) => post<CwkAssignment>("/api/v1/coursework/assignments", body),
  cwkClassAssignments: (classId: string, year: string) =>
    get<{ assignments: CwkAssignment[] }>(`/api/v1/coursework/classes/${encodeURIComponent(classId)}/assignments?academicYear=${year}`),
  cwkDeleteAssignment: (assignmentId: string) =>
    del<{ ok: true }>(`/api/v1/coursework/assignments/${encodeURIComponent(assignmentId)}`),
  cwkSubmissions: (assignmentId: string) =>
    get<{ submissions: CwkSubmission[] }>(`/api/v1/coursework/assignments/${encodeURIComponent(assignmentId)}/submissions`),
  cwkEvaluate: (submissionId: string, body: { score: number; feedback?: string }) =>
    post<CwkSubmission>(`/api/v1/coursework/submissions/${encodeURIComponent(submissionId)}/evaluate`, body),
  cwkUploadMaterial: (body: {
    classId: string; subjectId: string; title: string; contentType: string; dataBase64: string; academicYear: string;
  }) => post<CwkMaterial>("/api/v1/coursework/materials", body),
  cwkClassMaterials: (classId: string, year: string) =>
    get<{ materials: CwkMaterial[] }>(`/api/v1/coursework/classes/${encodeURIComponent(classId)}/materials?academicYear=${year}`),
  cwkMaterialUrl: (materialId: string) => `/api/v1/coursework/materials/${encodeURIComponent(materialId)}/download`,
  cwkMyAssignments: (year: string) =>
    get<{ assignments: CwkAssignment[] }>(`/api/v1/coursework/my/assignments?academicYear=${year}`),
  cwkSubmit: (assignmentId: string, body: { body: string; contentType?: string; dataBase64?: string }) =>
    post<{ ok: true; submittedAt: string }>(`/api/v1/coursework/my/assignments/${encodeURIComponent(assignmentId)}/submission`, body),
  cwkMyMaterials: (year: string) =>
    get<{ materials: CwkMaterial[] }>(`/api/v1/coursework/my/materials?academicYear=${year}`),
  // --- notices ---
  ntcCreate: (body: {
    collegeId: string; audience: string; title: string; body: string;
    kind?: NoticeKind; eventDate?: string;
    publishAt?: string; expiresAt?: string;
  }) => post<NoticeView>("/api/v1/notices", body),
  ntcList: (collegeId: string) =>
    get<{ notices: NoticeView[] }>(`/api/v1/notices?collegeId=${encodeURIComponent(collegeId)}`),
  ntcVisible: () => get<{ notices: NoticeView[] }>("/api/v1/notices/visible"),
  ntcDelete: (noticeId: string) => del<{ ok: true }>(`/api/v1/notices/${encodeURIComponent(noticeId)}`),
  // --- fees ---
  feesCreateHead: (body: { collegeId: string; name: string }) =>
    post<FeeHeadView>("/api/v1/fees/heads", body),
  feesHeads: (collegeId: string) =>
    get<{ heads: FeeHeadView[] }>(`/api/v1/fees/heads?collegeId=${encodeURIComponent(collegeId)}`),
  feesDeleteHead: (headId: string) => del<{ ok: true }>(`/api/v1/fees/heads/${encodeURIComponent(headId)}`),
  feesCreateStructure: (body: {
    classId: string; headId: string; academicYear: string;
    amountPaise: number; dueOn: string; installmentNo?: number;
  }) => post<FeeStructureView>("/api/v1/fees/structures", body),
  feesStructures: (classId: string, year: string) =>
    get<{ structures: FeeStructureView[] }>(
      `/api/v1/fees/classes/${encodeURIComponent(classId)}/structures?academicYear=${year}`,
    ),
  feesGenerate: (body: { classId: string; academicYear: string }) =>
    post<{ runId: string }>("/api/v1/fees/generate", body),
  feesGenerateStatus: (runId: string) =>
    get<FeeGenerationRunView>(`/api/v1/fees/generate/${encodeURIComponent(runId)}`),
  feesStudentInvoices: (studentId: string) =>
    get<{ invoices: FeeInvoiceView[] }>(`/api/v1/fees/students/${encodeURIComponent(studentId)}/invoices`),
  feesSectionInvoices: (sectionId: string, year: string) =>
    get<{ invoices: FeeInvoiceView[] }>(
      `/api/v1/fees/sections/${encodeURIComponent(sectionId)}/invoices?academicYear=${year}`,
    ),
  feesRecordPayment: (body: {
    invoiceId: string;
    amountPaise: number;
    mode: PaymentMode;
    ref?: string;
    idempotencyKey: string;
  }) =>
    post<{ payment: FeePaymentView; invoice: FeeInvoiceView }>("/api/v1/fees/payments", body),
  feesAddAdjustment: (body: { invoiceId: string; kind: AdjustmentKind; amountPaise: number; reason?: string }) =>
    post<{ adjustment: FeeAdjustmentView; invoice: FeeInvoiceView }>("/api/v1/fees/adjustments", body),
  feesMyFees: () => get<{ invoices: FeeMyInvoice[] }>("/api/v1/fees/my-fees"),
  feesCollectionSummary: (collegeId: string, from: string, to: string) =>
    get<FeeCollectionSummary>(
      `/api/v1/fees/collections/summary?collegeId=${encodeURIComponent(collegeId)}&from=${from}&to=${to}`,
    ),
  feesDefaulters: (collegeId: string, year: string) =>
    get<{ defaulters: FeeInvoiceView[] }>(
      `/api/v1/fees/defaulters?collegeId=${encodeURIComponent(collegeId)}&academicYear=${year}`,
    ),
  // --- results ---
  resCreateScale: (body: { collegeId: string; name: string; bands: GradeBand[] }) =>
    post<GradeScaleView>("/api/v1/results/scales", body),
  resScales: (collegeId: string) =>
    get<{ scales: GradeScaleView[] }>(`/api/v1/results/scales?collegeId=${encodeURIComponent(collegeId)}`),
  resUpdateScale: (scaleId: string, body: { name?: string; bands?: GradeBand[] }) =>
    put<GradeScaleView>(`/api/v1/results/scales/${encodeURIComponent(scaleId)}`, body),
  resDeleteScale: (scaleId: string) => del<{ ok: true }>(`/api/v1/results/scales/${encodeURIComponent(scaleId)}`),
  resCredits: (classId: string, year: string) =>
    get<{ credits: SubjectCreditView[] }>(
      `/api/v1/results/classes/${encodeURIComponent(classId)}/credits?academicYear=${year}`,
    ),
  resSetCredits: (body: { classId: string; academicYear: string; entries: { subjectId: string; credits: number }[] }) =>
    put<{ credits: SubjectCreditView[] }>("/api/v1/results/credits", body),
  resClassResults: (classId: string, year: string, scaleId: string) =>
    get<{ rows: StudentResult[]; publications: PublicationView[] }>(
      `/api/v1/results/classes/${encodeURIComponent(classId)}/preview?academicYear=${year}&scaleId=${encodeURIComponent(scaleId)}`,
    ),
  resPublish: (body: { classId: string; academicYear: string; term: string; scaleId: string }) =>
    post<PublicationView>("/api/v1/results/publish", body),
  resMyResults: () => get<MyResults>("/api/v1/results/my-results"),
  // --- exams ---
  exmCreateSeries: (body: { collegeId: string; name: string; academicYear: string; term: string }) =>
    post<ExamSeriesView>("/api/v1/exams/series", body),
  exmSeries: (collegeId: string, year: string) =>
    get<{ series: ExamSeriesView[] }>(
      `/api/v1/exams/series?collegeId=${encodeURIComponent(collegeId)}&academicYear=${year}`,
    ),
  exmDeleteSeries: (seriesId: string) => del<{ ok: true }>(`/api/v1/exams/series/${encodeURIComponent(seriesId)}`),
  exmCreateSlot: (body: {
    seriesId: string; classId: string; subjectId: string;
    onDate: string; starts: string; ends: string; room?: string;
  }) => post<ExamSlotView & { clash?: string }>("/api/v1/exams/slots", body),
  exmDeleteSlot: (slotId: string) => del<{ ok: true }>(`/api/v1/exams/slots/${encodeURIComponent(slotId)}`),
  exmClassSchedule: (classId: string, year: string) =>
    get<{ slots: ExamSlotView[] }>(
      `/api/v1/exams/classes/${encodeURIComponent(classId)}/schedule?academicYear=${year}`,
    ),
  exmMySchedule: () => get<{ slots: ExamSlotView[] }>("/api/v1/exams/my-schedule"),
  // --- leave ---
  lvsApply: (body: { fromOn: string; toOn: string; kind: "casual" | "sick" | "duty"; reason: string; departmentId?: string }) =>
    post<LeaveRequestView>("/api/v1/leave/requests", body),
  lvsMine: () => get<{ requests: LeaveRequestView[] }>("/api/v1/leave/mine"),
  lvsPending: () => get<{ requests: LeaveRequestView[] }>("/api/v1/leave/pending"),
  lvsDecide: (requestId: string, body: { status: "approved" | "rejected"; note?: string }) =>
    post<LeaveRequestView>(`/api/v1/leave/requests/${encodeURIComponent(requestId)}/decide`, body),
  // --- syllabus ---
  syllabusForClass: (classId: string, academicYear: string) =>
    get<SyllabusView>(`/api/v1/syllabus/classes/${encodeURIComponent(classId)}/syllabus?academicYear=${encodeURIComponent(academicYear)}`),
  createUnit: (body: { classId: string; subjectId: string; academicYear: string; title: string; position?: number }) =>
    post<UnitView>("/api/v1/syllabus/units", body),
  updateUnit: (unitId: string, body: { title?: string; position?: number }) =>
    patch<UnitView>(`/api/v1/syllabus/units/${encodeURIComponent(unitId)}`, body),
  deleteUnit: (unitId: string) => del<{ ok: true }>(`/api/v1/syllabus/units/${encodeURIComponent(unitId)}`),
  addTopic: (unitId: string, body: { title: string; position?: number }) =>
    post<TopicView>(`/api/v1/syllabus/units/${encodeURIComponent(unitId)}/topics`, body),
  updateTopic: (topicId: string, body: { title?: string; position?: number }) =>
    patch<TopicView>(`/api/v1/syllabus/topics/${encodeURIComponent(topicId)}`, body),
  deleteTopic: (topicId: string) => del<{ ok: true }>(`/api/v1/syllabus/topics/${encodeURIComponent(topicId)}`),
  setTopicCoverage: (topicId: string, taughtOn: string | null) =>
    put<TopicView>(`/api/v1/syllabus/topics/${encodeURIComponent(topicId)}/coverage`, { taughtOn }),
  mySyllabus: (academicYear: string) =>
    get<MySyllabus>(`/api/v1/syllabus/my?academicYear=${encodeURIComponent(academicYear)}`),
  // --- identity: single-user read (self, or admin within scope) ---
  getUser: (userId: string) => get<UserView>(`/api/v1/identity/users/${encodeURIComponent(userId)}`),
  // --- system: per-caller keyed preferences (#11 task 11). Always scoped to
  // the caller's own principal server-side — no user id is ever passed. ---
  prefsGet: <T>(key: string) =>
    get<{ key: string; value: T; updatedAt: string }>(`/api/v1/system/preferences/${encodeURIComponent(key)}`),
  prefsSet: <T>(key: string, value: T) =>
    put<{ key: string; value: T; updatedAt: string }>(`/api/v1/system/preferences/${encodeURIComponent(key)}`, {
      value,
    }),
  // --- system: license status (admin-only; #11.75 item 1) ---
  systemLicense: () => get<LicenseInfo>("/api/v1/system/license"),
  systemAudit: (action = "", limit = 50) => {
    const query = new URLSearchParams({ limit: String(limit) });
    if (action.trim()) query.set("action", action.trim());
    return get<AuditEventsView>(`/api/v1/system/audit?${query}`);
  },
  schoolTerms: (academicYear?: string) =>
    get<{ terms: SchoolTermView[] }>(`/api/v1/school/terms${academicYear ? `?academicYear=${encodeURIComponent(academicYear)}` : ""}`),
  schoolTermCalendar: (termId: string) => get<SchoolTermCalendar>(`/api/v1/school/terms/${encodeURIComponent(termId)}/calendar`),
  schoolSetTermCalendar: (termId: string, body: { instructionalDays: string[]; shortfallThreshold: number; expectedVersion: number }) => put<SchoolTermCalendar>(`/api/v1/school/terms/${encodeURIComponent(termId)}/calendar`, body),
  schoolAttendanceShortfall: (sectionId: string, termId: string, through?: string) => get<SchoolAttendanceShortfall>(`/api/v1/school/sections/${encodeURIComponent(sectionId)}/attendance-shortfall?${new URLSearchParams({ termId, ...(through ? { through } : {}) })}`),
  schoolCreateTerm: (body: { collegeId: string; name: string; academicYear: string; startsOn: string; endsOn: string }) =>
    post<SchoolTermView>("/api/v1/school/terms", body),
  schoolAssessmentTypes: (termId: string) =>
    get<{ types: SchoolAssessmentType[]; locked?: boolean }>(`/api/v1/school/terms/${encodeURIComponent(termId)}/assessment-types`),
  schoolClassSetup: (classId: string, academicYear: string) =>
    get<SchoolClassSetup>(`/api/v1/school/classes/${encodeURIComponent(classId)}/setup?academicYear=${encodeURIComponent(academicYear)}`),
  schoolAssessments: (classId: string, academicYear: string) =>
    get<{ assessments: SchoolAssessmentView[] }>(`/api/v1/school/classes/${encodeURIComponent(classId)}/assessments?academicYear=${encodeURIComponent(academicYear)}`),
  schoolCreateAssessment: (body: { classId: string; subjectId: string; termId: string; typeId: string; scaleId: string; name: string; maxScore: number; heldOn: string }) =>
    post<SchoolAssessmentView>("/api/v1/school/assessments", body),
  schoolMarks: (assessmentId: string) =>
    get<{ marks: SchoolMarkView[]; termStatus: "open" | "closed" }>(`/api/v1/school/assessments/${encodeURIComponent(assessmentId)}/marks`),
  schoolEnterMarks: (assessmentId: string, entries: { studentId: string; score: number; expectedScore?: number | null }[]) =>
    put<{ marks: SchoolMarkView[] }>(`/api/v1/school/assessments/${encodeURIComponent(assessmentId)}/marks`, { entries }),
  schoolSetAssessmentTypes: (termId: string, types: { id?: string; name: string; weight: number }[]) =>
    put<{ types: SchoolAssessmentType[] }>(`/api/v1/school/terms/${encodeURIComponent(termId)}/assessment-types`, { types }),
  schoolTransitionTerm: (termId: string, action: "close" | "reopen", reason: string) =>
    post<SchoolTermView>(`/api/v1/school/terms/${encodeURIComponent(termId)}/${action}`, reason.trim() ? { reason: reason.trim() } : {}),
  schoolReleaseTermMarks: (termId: string) =>
    post<SchoolTermView>(`/api/v1/school/terms/${encodeURIComponent(termId)}/release-marks`, {}),
  schoolReportCardDeskScope: () => get<SchoolReportCardDeskScope>("/api/v1/school/report-cards/desk-scope"),
  schoolReportCardRoster: (classId: string, termId: string) =>
    get<{ students: SchoolReportCardRosterStudent[] }>(`/api/v1/school/report-cards/classes/${encodeURIComponent(classId)}?termId=${encodeURIComponent(termId)}`),
  schoolReportCardPreview: (body: { studentId: string; termId: string }) =>
    post<SchoolReportCardPreview>("/api/v1/school/report-cards/preview", body),
  schoolGenerateReportCard: (body: { studentId: string; termId: string }) =>
    post<{ snapshotId: string; generatedAt: string }>("/api/v1/school/report-cards", body),
  schoolReportCardPublication: (snapshotId: string, action: "publish" | "withdraw") =>
    post<{ snapshotId: string; publicationState: "published" | "withdrawn" }>(`/api/v1/school/report-cards/${encodeURIComponent(snapshotId)}/${action}`, {}),
  schoolReportCardDownloadUrl: (snapshotId: string) =>
    `/api/v1/school/report-cards/${encodeURIComponent(snapshotId)}/download`,
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
  async requestReport(report: ReportParams, format: "pdf" | "csv" | "xlsx", year: string): Promise<string> {
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
