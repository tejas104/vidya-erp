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
  { href: "/manage/attendance", label: "Attendance", icon: "attendance", group: "Teaching", roles: ["class_teacher", "admin"] },
  { href: "/manage/marks", label: "Marks", icon: "marks", group: "Teaching", roles: ["teacher", "admin"] },
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
