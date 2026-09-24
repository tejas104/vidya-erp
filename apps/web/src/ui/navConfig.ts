import type { Role } from "./api";
import { vocabularyFor, type Edition, type EditionVocabulary } from "./editionVocabulary";
import type { IconName } from "./Icon";

export interface NavEntry {
  href: string;
  label: string;
  icon: IconName;
  group: string;
  roles: Role[];
  editions?: readonly ("college" | "school")[];
  vocabularyKey?: keyof Pick<EditionVocabulary, "academicTerms">;
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
  // --- TODAY (group "TOP"): the screens a staff member opens every morning.
  // Rendered untitled at the top of the rail, so it is one tap from anywhere.
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", group: "TOP", roles: ALL },
  { href: "/portal", label: "Overview", icon: "dashboard", group: "TOP", roles: ["student"], editions: ["school"] },
  { href: "/portal", label: "My register", icon: "students", group: "TOP", roles: ["student"], editions: ["college"] },
  { href: "/portal/schedule", label: "Timetable", icon: "attendance", group: "DAY", roles: ["student"], editions: ["school"] },
  { href: "/portal/assignments", label: "Assignments", icon: "file", group: "DAY", roles: ["student"], editions: ["school"] },
  { href: "/portal/marks", label: "Marks", icon: "marks", group: "LEARNING", roles: ["student"], editions: ["school"] },
  { href: "/portal/exams", label: "Exams", icon: "check", group: "LEARNING", roles: ["student"], editions: ["school"] },
  { href: "/portal/syllabus", label: "Syllabus", icon: "file", group: "LEARNING", roles: ["student"], editions: ["school"] },
  { href: "/portal/attendance", label: "Attendance", icon: "attendance", group: "MY_RECORDS", roles: ["student"], editions: ["school"] },
  { href: "/portal/fees", label: "Fees", icon: "rupee", group: "MY_RECORDS", roles: ["student"], editions: ["school"] },
  { href: "/portal/notices", label: "Notices", icon: "bell", group: "MY_RECORDS", roles: ["student"], editions: ["school"] },
  // The teacher mobile fast-path (A10 Part 4): current/next period + ONE
  // "Mark attendance" button, nothing else.
  { href: "/manage/now", label: "Now", icon: "attendance", group: "TOP", roles: ["teacher", "class_teacher"] },
  // roles mirror the my/week route's TEACHING auth (teacher/class_teacher only) — a pure-hod would 403 on the page
  { href: "/manage/my-timetable", label: "My Timetable", icon: "attendance", group: "TOP", roles: ["teacher", "class_teacher"] },
  { href: "/manage/attendance", label: "Attendance", icon: "attendance", group: "TOP", roles: ["teacher", "class_teacher"] },
  { href: "/manage/coursework", label: "Coursework", icon: "file", group: "TOP", roles: ["teacher", "class_teacher"] },
  { href: "/manage/classes", label: "My Classes", icon: "students", group: "TOP", roles: ["teacher", "class_teacher"] },
  // --- STUDENTS: the pupil record and everything that populates it.
  { href: "/manage/students", label: "Students", icon: "students", group: "STUDENTS", roles: ["admin"] },
  // accountant reconciles against student records + documents (read-only)
  { href: "/manage/directory", label: "Student directory", icon: "students", group: "STUDENTS", roles: ["accountant"] },
  // --- onboarding import (task A4): split off the old single /manage/import
  // form into dedicated students/staff screens. Students populates the pupil
  // record, so it sits with STUDENTS; staff sits with PEOPLE.
  { href: "/manage/import/students", label: "Import Students", icon: "upload", group: "STUDENTS", roles: ["admin"] },
  // --- ACADEMICS: teaching and assessment.
  { href: "/manage/calendar", label: "Calendar", icon: "attendance", group: "ACADEMICS", roles: ALL },
  { href: "/manage/marks", label: "Marks", icon: "marks", group: "ACADEMICS", roles: ["teacher"] },
  // --- syllabus --- teachers author; principal/admin oversee (read-only)
  { href: "/manage/syllabus", label: "Syllabus", icon: "file", group: "ACADEMICS", roles: ["teacher", "class_teacher", "hod"] },
  { href: "/manage/syllabus", label: "Syllabus", icon: "file", group: "ACADEMICS", roles: ["principal", "admin"] },
  // --- results ---
  { href: "/manage/results", label: "Results", icon: "marks", group: "ACADEMICS", roles: ["admin", "principal"] },
  { href: "/manage/report-cards", label: "Report cards", icon: "file", group: "ACADEMICS", roles: ["admin", "principal", "class_teacher"], editions: ["school"] },
  { href: "/manage/backlogs", label: "Backlogs", icon: "marks", group: "ACADEMICS", roles: ["admin", "principal"] },
  // --- exams ---
  { href: "/manage/exams", label: "Exams", icon: "check", group: "ACADEMICS", roles: ["admin"] },
  // --- money ---
  { href: "/manage/fees", label: "Fees", icon: "rupee", group: "MONEY", roles: ["accountant", "admin", "principal"] },
  // --- PEOPLE: staff and the messages that go out to everyone.
  { href: "/manage/teachers", label: "Teachers", icon: "teachers", group: "PEOPLE", roles: ["admin"] },
  { href: "/manage/import/staff", label: "Import Staff", icon: "upload", group: "PEOPLE", roles: ["admin"] },
  { href: "/manage/leave", label: "Leave", icon: "file", group: "PEOPLE", roles: ["teacher", "class_teacher", "hod", "principal"] },
  { href: "/manage/notices", label: "Notices", icon: "bell", group: "PEOPLE", roles: ["admin", "principal"] },
  // --- REVIEW: look back at what happened, never change it.
  { href: "/manage/reports", label: "Reports", icon: "file", group: "REVIEW", roles: ALL },
  // Real screen at apps/web/app/(app)/manage/analytics/page.tsx: the deeper
  // trend/comparison/distribution views for oversight roles (admin/principal/
  // hod). /dashboard keeps the at-a-glance KPIs, at-risk composition and the
  // actionable "Needs attention" list (see dashboard/page.tsx's `teachingOnly`
  // split) — the two screens share `focusOf` via @/ui/oversightFocus instead
  // of duplicating it.
  { href: "/manage/analytics", label: "Analytics", icon: "dashboard", group: "REVIEW", roles: ["admin", "principal", "hod"] },
  // --- SETUP: touched at the start of a year and rarely after. Rendered
  // last and visually separated, so daily work never has to scroll past it.
  { href: "/manage/org", label: "Organisation", icon: "org", group: "SETUP", roles: ["admin"] },
  { href: "/manage/terms", label: "Academic terms", vocabularyKey: "academicTerms", icon: "attendance", group: "SETUP", roles: ["admin", "principal"], editions: ["school"] },
  { href: "/manage/timetable", label: "Timetable", icon: "attendance", group: "SETUP", roles: ["admin"] },
  { href: "/manage/users", label: "Users", icon: "key", group: "SETUP", roles: ["admin"] },
  // --- system (#9): version/build info for support requests, admin-only ---
  { href: "/manage/system", label: "System", icon: "info", group: "SETUP", roles: ["admin"] },
];

// Job-shaped, not module-shaped: daily work first, once-a-year setup last.
export const DOMAIN_ORDER = ["TOP", "DAY", "LEARNING", "MY_RECORDS", "STUDENTS", "ACADEMICS", "MONEY", "PEOPLE", "REVIEW", "SETUP"] as const;
// The group rendered below the setup divider. Everything above it is work a
// staff member does during a term; SETUP is what a new school does once.
export const SETUP_GROUP = "SETUP";
const LABEL: Record<string, string> = {
  DAY: "My day",
  LEARNING: "Learning",
  MY_RECORDS: "My records",
  STUDENTS: "Students",
  ACADEMICS: "Academics",
  MONEY: "Money",
  PEOPLE: "People & comms",
  REVIEW: "Review",
  SETUP: "Setup",
};

export function domainLabel(group: string): string {
  return LABEL[group] ?? group;
}

function labelFor(entry: NavEntry, edition: Edition): string {
  return entry.vocabularyKey ? vocabularyFor(edition)[entry.vocabularyKey] : entry.label;
}

export function visibleNav(roles: Role[], edition: Edition = "college"): { group: string; entries: NavEntry[] }[] {
  const groups: { group: string; entries: NavEntry[] }[] = [];
  for (const entry of NAV) {
    if (entry.editions && !entry.editions.includes(edition)) continue;
    if (!entry.roles.some((role) => roles.includes(role))) continue;
    const bucket = groups.find((g) => g.group === entry.group);
    const visibleEntry = { ...entry, label: labelFor(entry, edition) };
    if (bucket) bucket.entries.push(visibleEntry);
    else groups.push({ group: entry.group, entries: [visibleEntry] });
  }
  return groups.sort((a, b) => DOMAIN_ORDER.indexOf(a.group as (typeof DOMAIN_ORDER)[number]) - DOMAIN_ORDER.indexOf(b.group as (typeof DOMAIN_ORDER)[number]));
}

// Derives breadcrumbs from the same NAV source — no second hand-maintained
// route map. [] for /dashboard (TOP, ungrouped) and unknown paths.
export function crumbsFor(pathname: string, edition: Edition = "college"): { label: string; href?: string }[] {
  const entry = NAV.find((e) => e.group !== "TOP" && (!e.editions || e.editions.includes(edition)) && (pathname === e.href || pathname.startsWith(`${e.href}/`)));
  if (!entry) return [];
  return [{ label: LABEL[entry.group] ?? entry.group }, { label: labelFor(entry, edition) }];
}
