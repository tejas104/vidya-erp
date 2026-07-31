import { mapPool } from "./pool";
import { NAV } from "../navConfig";
import type { Role } from "../api";

export type IndexEntry = {
  kind: "student" | "page";
  label: string;
  sub?: string;
  href: string;
  roll?: string;
};

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
export function getCachedIndex(): IndexEntry[] | null {
  return cache?.entries ?? null;
}

export async function buildIndex(
  apiLike: ApiLike,
  roles: Role[],
  onProgress?: (done: number, total: number) => void,
): Promise<IndexEntry[]> {
  const key = keyOf(roles);
  if (cache && cache.key === key) return cache.entries;

  const pages: IndexEntry[] = NAV.filter(
    (e) => e.group !== "TOP" && e.roles.some((r) => roles.includes(r)),
  ).map((e) => ({ kind: "page", label: e.label, href: e.href }));

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

  cache = { key, entries: [...students, ...pages] };
  return cache.entries;
}

export function filterIndex(entries: IndexEntry[], q: string): { students: IndexEntry[]; pages: IndexEntry[] } {
  const query = q.trim().toLowerCase();
  if (!query) return { students: [], pages: entries.filter((e) => e.kind === "page") };
  return {
    students: entries.filter(
      (e) => e.kind === "student" && (e.label.toLowerCase().includes(query) || e.roll?.toLowerCase().includes(query)),
    ),
    pages: entries.filter((e) => e.kind === "page" && e.label.toLowerCase().includes(query)),
  };
}
