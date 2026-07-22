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

let cache: IndexEntry[] | null = null;

export function clearIndexCache(): void {
  cache = null;
}

export async function buildIndex(
  apiLike: ApiLike,
  roles: Role[],
  onProgress?: (done: number, total: number) => void,
): Promise<IndexEntry[]> {
  if (cache) return cache;

  const pages: IndexEntry[] = NAV.filter(
    (e) => e.group !== "TOP" && e.roles.some((r) => roles.includes(r)),
  ).map((e) => ({ kind: "page", label: e.label, href: e.href }));

  const { colleges } = await apiLike.colleges();
  const sections = (
    await Promise.all(colleges.map((c) => apiLike.collegeTree(c.id)))
  ).flatMap((tree) => tree.departments.flatMap((d) => d.classes.flatMap((c) => c.sections)));

  // ponytail: O(sections) roster requests on first open, pooled at 6; holds
  // to ~1-2k students. Real fix = scoped students?q= endpoint scheduled on #11.
  const rosters = await mapPool(
    sections,
    6,
    (s) => apiLike.sectionRoster(s.id),
    (done, total) => onProgress?.(done, total),
  );

  const students: IndexEntry[] = rosters.flatMap((roster) =>
    roster.students.map((s) => {
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

  cache = [...students, ...pages];
  return cache;
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
