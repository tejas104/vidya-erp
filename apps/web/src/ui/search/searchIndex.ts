import { mapPool } from "./pool";
import { visibleNav } from "../navConfig";
import type { Role } from "../api";

export type IndexEntry = {
  kind: "student" | "staff" | "page";
  label: string;
  sub?: string;
  href: string;
  roll?: string;
};

/**
 * KNOWN GAP (Assignment #10 Part 2, owner-ruled 2026-07-31).
 *
 * The spec asks global search to jump to staff. Only the ADMIN slice is
 * implementable today, and two things are missing to finish it:
 *
 *   1. No SCOPED staff-list endpoint. `identity.listUsers` is ADMIN_ONLY, so a
 *      principal/hod/teacher gets no staff results at all — not a client-side
 *      filter, just an endpoint they may not call. (This does mean the scoping
 *      is automatic and correct as far as it goes: the authorization boundary
 *      does the filtering, not us.)
 *   2. No per-teacher route. There is no /staff/[id] page, so a result cannot
 *      deep-link to an individual; every staff hit lands on /manage/teachers.
 *
 * Closing it needs a scoped staff-list endpoint plus a per-teacher screen —
 * both backend/route work, which Assignment #10 forbids (presentation-only).
 */
const STAFF_HREF = "/manage/teachers";

// Structural subset of `api` — kept loose so this unit test doesn't pull in
// the fetch layer. Matches api.colleges/collegeTree/sectionRoster shapes.
type ApiLike = {
  colleges: () => Promise<{ colleges: { id: string }[] }>;
  collegeTree: (collegeId: string) => Promise<{
    departments: { classes: { sections: { id: string }[] }[] }[];
  }>;
  sectionRoster: (sectionId: string) => Promise<{
    students: {
      id: string;
      admissionNo: string;
      fullName: string;
      enrollment: { sectionId: string } | null;
    }[];
  }>;
  /** ADMIN_ONLY — only called when the caller holds `admin` (see STAFF_HREF note). */
  listUsers: (collegeId: string) => Promise<{ users: { id: string; displayName: string; roles: string[] }[] }>;
};

// Session cache keyed on the caller's roles — a role change (defensive; a
// session is single-role today) must not serve another role's scoped results.
let cache: { key: string; entries: IndexEntry[] } | null = null;
const keyOf = (roles: Role[]): string => [...roles].sort().join(",");

export function clearIndexCache(): void {
  cache = null;
}

/** The currently-cached index (any role), or null if not built yet. Lets the
 *  palette render instantly on re-open without re-fetching. */
export function getCachedIndex(roles?: Role[], edition: "college" | "school" = "college"): IndexEntry[] | null {
  if (roles && cache?.key !== `${edition}:${keyOf(roles)}`) return null;
  return cache?.entries ?? null;
}

export async function buildIndex(
  apiLike: ApiLike,
  roles: Role[],
  onProgress?: (done: number, total: number) => void,
  edition: "college" | "school" = "college",
): Promise<IndexEntry[]> {
  const key = `${edition}:${keyOf(roles)}`;
  if (cache && cache.key === key) return cache.entries;

  const pages: IndexEntry[] = visibleNav(roles, edition).filter((group) => group.group !== "TOP")
    .flatMap((group) => group.entries).map((e) => ({ kind: "page", label: e.label, href: e.href }));

  const { colleges } = await apiLike.colleges();
  const sections = (
    await Promise.all(colleges.map((c) => apiLike.collegeTree(c.id)))
  ).flatMap((tree) => tree.departments.flatMap((d) => d.classes.flatMap((c) => c.sections)));

  // ponytail: O(sections) roster requests on first open, pooled at 6; holds
  // to ~1-2k students. Real fix = scoped students?q= endpoint scheduled on #11.
  // Per-section .catch: one failing/transient roster must not sink the whole
  // index (and take the always-available page shortcuts down with it) — that
  // section just contributes zero students; the rest + pages still resolve.
  const rosters = await mapPool(
    sections,
    6,
    (s) => apiLike.sectionRoster(s.id).then((r) => r.students).catch(() => []),
    (done, total) => onProgress?.(done, total),
  );

  const students: IndexEntry[] = rosters.flatMap((roster) =>
    roster.map((s) => {
      // index entries carry name/roll/section/href only — sectionRoster returns
      // PII (phone/guardian/dob); never copy those in. Adding PII fields
      // requires a deliberate privacy review (session-cached client-memory copy).
      return {
        kind: "student" as const,
        label: s.fullName,
        roll: s.admissionNo,
        sub: s.enrollment?.sectionId ?? "",
        href: `/students/${s.id}`,
      };
    }),
  );

  // Staff: admin-only, because listUsers is ADMIN_ONLY (see the STAFF_HREF note).
  // Same per-request .catch discipline as the rosters — a failing user-list must
  // not sink the students and pages that already resolved.
  const staff: IndexEntry[] = roles.includes("admin")
    ? (
        await Promise.all(
          colleges.map((c) =>
            apiLike
              .listUsers(c.id)
              .then((r) => r.users)
              .catch(() => []),
          ),
        )
      ).flatMap((users) =>
        // Project to label + roles only. UserView also carries `username` (a
        // login identifier), `status`, `grants` and `createdAt` — none of that
        // belongs in a session-cached client-memory index, same rule as the
        // student projection above.
        users.map((u) => ({
          kind: "staff" as const,
          label: u.displayName,
          sub: u.roles.join(" · "),
          href: STAFF_HREF,
        })),
      )
    : [];

  cache = { key, entries: [...students, ...staff, ...pages] };
  return cache.entries;
}

export function filterIndex(
  entries: IndexEntry[],
  q: string,
): { students: IndexEntry[]; staff: IndexEntry[]; pages: IndexEntry[] } {
  const query = q.trim().toLowerCase();
  if (!query) return { students: [], staff: [], pages: entries.filter((e) => e.kind === "page") };
  return {
    students: entries.filter(
      (e) => e.kind === "student" && (e.label.toLowerCase().includes(query) || e.roll?.toLowerCase().includes(query)),
    ),
    staff: entries.filter((e) => e.kind === "staff" && e.label.toLowerCase().includes(query)),
    pages: entries.filter((e) => e.kind === "page" && e.label.toLowerCase().includes(query)),
  };
}
