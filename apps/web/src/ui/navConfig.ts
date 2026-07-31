import type { Role } from "./api";
import type { IconName } from "./Icon";

export interface NavEntry {
  href: string;
  label: string;
  icon: IconName;
  group: string;
  roles: Role[];
}

// All staff-side roles. Entries tagged ALL map to ANY_AUTHENTICATED routes
// (dashboard, calendar, reports); accountant was wrongly omitted, so an
// accountant had no nav path to /manage/reports at all. Student is
// deliberately excluded — students live in the walled-garden /portal and
// reach reports via its ReportButtons, not the staff nav (see shell.test).
const ALL: Role[] = ["admin", "principal", "hod", "class_teacher", "teacher", "accountant"];

/**
 * The single nav source. Entries appear only for callers whose roles
 * intersect — the server still enforces every action; this only avoids
 * dead ends. Future areas (org/students/teachers/users/import/reports)
 * append entries here when their routes land.
 */
export const NAV: NavEntry[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", group: "TOP", roles: ALL },
  { href: "/manage/calendar", label: "Calendar", icon: "attendance", group: "ACADEMICS", roles: ALL },
  { href: "/portal", label: "My register", icon: "students", group: "TOP", roles: ["student"] },
  // The teacher mobile fast-path (A10 Part 4): current/next period + ONE
  // "Mark attendance" button, nothing else. Deliberately ungrouped/TOP so
  // it's one tap away from anywhere, same tier as Dashboard — this is the
  // screen a teacher opens between classes, not a destination they dig for.
  { href: "/manage/now", label: "Now", icon: "attendance", group: "TOP", roles: ["teacher", "class_teacher"] },
  // Teaching tools are teacher-owned. Admin is a non-teaching supervisor:
  // it oversees via Reports & Results but cannot change marks/attendance.
  { href: "/manage/classes", label: "My Classes", icon: "students", group: "ACADEMICS", roles: ["teacher", "class_teacher"] },
  // roles mirror the my/week route's TEACHING auth (teacher/class_teacher only) — a pure-hod would 403 on the page
  { href: "/manage/my-timetable", label: "My Timetable", icon: "attendance", group: "ACADEMICS", roles: ["teacher", "class_teacher"] },
  { href: "/manage/attendance", label: "Attendance", icon: "attendance", group: "ACADEMICS", roles: ["teacher", "class_teacher"] },
  { href: "/manage/marks", label: "Marks", icon: "marks", group: "ACADEMICS", roles: ["teacher"] },
  // --- coursework ---
  { href: "/manage/coursework", label: "Coursework", icon: "file", group: "ACADEMICS", roles: ["teacher", "class_teacher"] },
  // --- syllabus --- teachers author; principal/admin oversee (read-only) — both now ACADEMICS
  { href: "/manage/syllabus", label: "Syllabus", icon: "file", group: "ACADEMICS", roles: ["teacher", "class_teacher", "hod"] },
  { href: "/manage/syllabus", label: "Syllabus", icon: "file", group: "ACADEMICS", roles: ["principal", "admin"] },
  // --- fees ---
  { href: "/manage/fees", label: "Fees", icon: "rupee", group: "FEES", roles: ["accountant", "admin", "principal"] },
  // accountant reconciles against student records + documents (read-only)
  { href: "/manage/directory", label: "Student directory", icon: "students", group: "PEOPLE", roles: ["accountant"] },
  // --- notices ---
  { href: "/manage/notices", label: "Notices", icon: "bell", group: "COMMUNICATION", roles: ["admin", "principal"] },
  // --- results ---
  { href: "/manage/results", label: "Results", icon: "marks", group: "ACADEMICS", roles: ["admin", "principal"] },
  { href: "/manage/backlogs", label: "Backlogs", icon: "marks", group: "ACADEMICS", roles: ["admin", "principal"] },
  // --- exams ---
  { href: "/manage/exams", label: "Exams", icon: "check", group: "ACADEMICS", roles: ["admin"] },
  // --- leave ---
  { href: "/manage/leave", label: "Leave", icon: "file", group: "ADMINISTRATION", roles: ["teacher", "class_teacher", "hod"] },
  // --- timetable ---
  { href: "/manage/timetable", label: "Timetable", icon: "attendance", group: "ACADEMICS", roles: ["admin"] },
  { href: "/manage/org", label: "Organisation", icon: "org", group: "PEOPLE", roles: ["admin"] },
  { href: "/manage/students", label: "Students", icon: "students", group: "PEOPLE", roles: ["admin"] },
  { href: "/manage/teachers", label: "Teachers", icon: "teachers", group: "PEOPLE", roles: ["admin"] },
  { href: "/manage/users", label: "Users", icon: "key", group: "ADMINISTRATION", roles: ["admin"] },
  { href: "/manage/import", label: "Import", icon: "upload", group: "ADMINISTRATION", roles: ["admin"] },
  { href: "/manage/reports", label: "Reports", icon: "file", group: "REPORTS", roles: ALL },
  // --- analytics ---
  // Real screen at apps/web/app/(app)/manage/analytics/page.tsx: the deeper
  // trend/comparison/distribution views for oversight roles (admin/principal/
  // hod). /dashboard keeps the at-a-glance KPIs, at-risk composition and the
  // actionable "Needs attention" list (see dashboard/page.tsx's `teachingOnly`
  // split) — the two screens share `focusOf` via @/ui/oversightFocus instead
  // of duplicating it.
  { href: "/manage/analytics", label: "Analytics", icon: "dashboard", group: "ANALYTICS", roles: ["admin", "principal", "hod"] },
];

export const DOMAIN_ORDER = ["TOP", "PEOPLE", "ACADEMICS", "FEES", "COMMUNICATION", "REPORTS", "ANALYTICS", "ADMINISTRATION"] as const;
const LABEL: Record<string, string> = {
  PEOPLE: "People",
  ACADEMICS: "Academics",
  FEES: "Fees",
  COMMUNICATION: "Communication",
  REPORTS: "Reports",
  ANALYTICS: "Analytics",
  ADMINISTRATION: "Administration",
};

export function domainLabel(group: string): string {
  return LABEL[group] ?? group;
}

export function visibleNav(roles: Role[]): { group: string; entries: NavEntry[] }[] {
  const groups: { group: string; entries: NavEntry[] }[] = [];
  for (const entry of NAV) {
    if (!entry.roles.some((role) => roles.includes(role))) continue;
    const bucket = groups.find((g) => g.group === entry.group);
    if (bucket) bucket.entries.push(entry);
    else groups.push({ group: entry.group, entries: [entry] });
  }
  return groups.sort((a, b) => DOMAIN_ORDER.indexOf(a.group as (typeof DOMAIN_ORDER)[number]) - DOMAIN_ORDER.indexOf(b.group as (typeof DOMAIN_ORDER)[number]));
}

// Derives breadcrumbs from the same NAV source — no second hand-maintained
// route map. [] for /dashboard (TOP, ungrouped) and unknown paths.
export function crumbsFor(pathname: string): { label: string; href?: string }[] {
  const entry = NAV.find((e) => e.group !== "TOP" && (pathname === e.href || pathname.startsWith(`${e.href}/`)));
  if (!entry) return [];
  return [{ label: LABEL[entry.group] ?? entry.group }, { label: entry.label }];
}
