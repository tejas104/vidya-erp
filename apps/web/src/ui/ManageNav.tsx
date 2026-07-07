"use client";
import type { Role } from "./api";

type Link = { href: string; label: string; roles: Role[] };
const LINKS: Link[] = [
  { href: "/manage/attendance", label: "Attendance", roles: ["class_teacher", "admin"] },
  { href: "/manage/marks", label: "Marks", roles: ["teacher", "admin"] },
  { href: "/manage/org", label: "Organisation", roles: ["admin"] },
  { href: "/manage/students", label: "Students", roles: ["admin"] },
  { href: "/manage/teachers", label: "Teachers", roles: ["admin"] },
  { href: "/manage/users", label: "Users", roles: ["admin"] },
  { href: "/manage/import", label: "Import", roles: ["admin"] },
  { href: "/manage/reports", label: "Reports", roles: ["admin", "principal", "hod", "class_teacher", "teacher"] },
];

export function ManageNav({ roles }: { roles: Role[] }) {
  const visible = LINKS.filter((link) => link.roles.some((r) => roles.includes(r)));
  return (
    <nav aria-label="Manage" style={{ display: "flex", gap: 16, flexWrap: "wrap", padding: "12px 0", borderBottom: "1px solid var(--rule)", marginBottom: 20 }}>
      <a className="linklike" href="/dashboard">← Register</a>
      {visible.map((link) => (
        <a key={link.href} className="linklike" href={link.href}>{link.label}</a>
      ))}
    </nav>
  );
}
