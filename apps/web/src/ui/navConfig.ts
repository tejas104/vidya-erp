import type { Role } from "./api";
import type { IconName } from "./Icon";

export interface NavEntry {
  href: string;
  label: string;
  icon: IconName;
  group: string;
  roles: Role[];
}

const ALL: Role[] = ["admin", "principal", "hod", "class_teacher", "teacher"];

/**
 * The single nav source. Entries appear only for callers whose roles
 * intersect — the server still enforces every action; this only avoids
 * dead ends. Future areas (org/students/teachers/users/import/reports)
 * append entries here when their routes land.
 */
export const NAV: NavEntry[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", group: "Overview", roles: ALL },
  { href: "/manage/calendar", label: "Calendar", icon: "attendance", group: "Overview", roles: ALL },
  { href: "/portal", label: "My register", icon: "students", group: "My studies", roles: ["student"] },
  // Teaching tools are teacher-owned. Admin is a non-teaching supervisor:
  // it oversees via Reports & Results but cannot change marks/attendance.
  { href: "/manage/classes", label: "My Classes", icon: "students", group: "Teaching", roles: ["teacher", "class_teacher"] },
  { href: "/manage/attendance", label: "Attendance", icon: "attendance", group: "Teaching", roles: ["teacher", "class_teacher"] },
  { href: "/manage/marks", label: "Marks", icon: "marks", group: "Teaching", roles: ["teacher"] },
  // --- coursework ---
  { href: "/manage/coursework", label: "Coursework", icon: "file", group: "Teaching", roles: ["teacher", "class_teacher"] },
  // --- syllabus ---
  { href: "/manage/syllabus", label: "Syllabus", icon: "file", group: "Teaching", roles: ["teacher", "class_teacher", "hod", "principal", "admin"] },
  // --- fees ---
  { href: "/manage/fees", label: "Fees", icon: "rupee", group: "Fees", roles: ["accountant", "admin", "principal"] },
  // accountant reconciles against student records + documents (read-only)
  { href: "/manage/directory", label: "Student directory", icon: "students", group: "Fees", roles: ["accountant"] },
  // --- notices ---
  { href: "/manage/notices", label: "Notices", icon: "file", group: "Administration", roles: ["admin", "principal"] },
  // --- results ---
  { href: "/manage/results", label: "Results", icon: "marks", group: "Administration", roles: ["admin", "principal"] },
  { href: "/manage/backlogs", label: "Backlogs", icon: "marks", group: "Administration", roles: ["admin", "principal"] },
  // --- exams ---
  { href: "/manage/exams", label: "Exams", icon: "attendance", group: "Administration", roles: ["admin"] },
  // --- leave ---
  { href: "/manage/leave", label: "Leave", icon: "file", group: "Teaching", roles: ["teacher", "class_teacher", "hod"] },
  // --- timetable ---
  { href: "/manage/timetable", label: "Timetable", icon: "attendance", group: "Administration", roles: ["admin"] },
  { href: "/manage/org", label: "Organisation", icon: "org", group: "Administration", roles: ["admin"] },
  { href: "/manage/students", label: "Students", icon: "students", group: "Administration", roles: ["admin"] },
  { href: "/manage/teachers", label: "Teachers", icon: "teachers", group: "Administration", roles: ["admin"] },
  { href: "/manage/users", label: "Users", icon: "key", group: "Administration", roles: ["admin"] },
  { href: "/manage/import", label: "Import", icon: "upload", group: "Administration", roles: ["admin"] },
  { href: "/manage/reports", label: "Reports", icon: "file", group: "Reports", roles: ALL },
];

export function visibleNav(roles: Role[]): { group: string; entries: NavEntry[] }[] {
  const groups: { group: string; entries: NavEntry[] }[] = [];
  for (const entry of NAV) {
    if (!entry.roles.some((role) => roles.includes(role))) continue;
    const bucket = groups.find((g) => g.group === entry.group);
    if (bucket) bucket.entries.push(entry);
    else groups.push({ group: entry.group, entries: [entry] });
  }
  return groups;
}
