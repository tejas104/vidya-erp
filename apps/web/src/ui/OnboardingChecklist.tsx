"use client";
import { useEffect, useState } from "react";
import { api, ApiError, type Tile } from "@/ui/api";
import { Button, Card } from "@vidya/ui-system";
import { AsyncState } from "@/ui/AsyncState";
import styles from "./OnboardingChecklist.module.css";

export type ChecklistRole = "admin" | "teacher" | "student";

interface ChecklistItem {
  id: string;
  label: string;
  href: string;
}

const ITEMS: Record<ChecklistRole, ChecklistItem[]> = {
  admin: [
    { id: "password", label: "Change your password", href: "/manage/users" },
    { id: "structure", label: "Set up your academic structure", href: "/manage/org" },
    { id: "students", label: "Import your students", href: "/manage/import/students" },
    { id: "staff", label: "Import your staff", href: "/manage/import/staff" },
    { id: "fees", label: "Set your fee structure", href: "/manage/fees" },
    { id: "credentials", label: "Print sign-in credentials", href: "/manage/classes" },
  ],
  teacher: [
    { id: "timetable", label: "View your timetable", href: "/manage/my-timetable" },
    { id: "attendance", label: "Mark your first attendance", href: "/manage/attendance" },
    { id: "marks", label: "Enter marks", href: "/manage/marks" },
  ],
  student: [
    { id: "attendance", label: "View your attendance", href: "/portal#portal-attendance" },
    { id: "marks", label: "View your marks", href: "/portal#portal-marks" },
    { id: "fees", label: "View your fees", href: "/portal#portal-fees" },
  ],
};

/**
 * Item ids whose completion is derived from existing data rather than a
 * manual checkbox. Everything else in ITEMS[role] is manually checkable and
 * persisted via the preference store.
 */
const AUTO_IDS: Record<ChecklistRole, ReadonlySet<string>> = {
  admin: new Set(["password", "structure", "students", "staff", "fees"]),
  teacher: new Set(["attendance", "marks"]),
  student: new Set(),
};

function prefKeyFor(role: ChecklistRole): string {
  return `onboarding:${role}`;
}

interface StoredPrefs {
  dismissed?: boolean;
  checked?: Record<string, boolean>;
}

type Load =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; dismissed: boolean; manual: Record<string, boolean> };

export interface OnboardingChecklistProps {
  role: ChecklistRole;
  studentEdition?: "school" | "college";
  /** admin only — used for the cheap "did you change your temp password" check. */
  userId?: string;
  /** teacher only — the tiles the dashboard already fetched (no duplicate call). */
  tiles?: Tile[];
}

/**
 * Per-role first-run checklist. Dismissal and manual check-offs persist via
 * the #11 preference store (system.preference-get/set), always scoped to the
 * caller's own principal. A GET for a key never written yet is a real 404 —
 * that's a normal first-run state, not an error.
 *
 * Auto-checked items are re-derived from existing data on every mount rather
 * than stored — storing a point-in-time snapshot would go stale the moment
 * more students get imported. If a derivation call fails, that single item
 * just stays open (degrades to "not yet confirmed", never crashes the card).
 *
 * A 403 is not modeled as a distinct state: the preference GET/PUT is always
 * scoped to the caller's own principal (never a request-supplied id), so
 * there is no "someone else's data" case for this route to deny.
 */
export function OnboardingChecklist({ role, userId, tiles, studentEdition = "college" }: OnboardingChecklistProps) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [auto, setAuto] = useState<Record<string, boolean>>({});
  const [reloadTick, setReloadTick] = useState(0);

  const items = ITEMS[role];
  const autoIds = AUTO_IDS[role];

  useEffect(() => {
    let alive = true;
    setLoad({ status: "loading" });
    api
      .prefsGet<StoredPrefs>(prefKeyFor(role))
      .then((row) => {
        if (!alive) return;
        setLoad({ status: "ready", dismissed: row.value.dismissed ?? false, manual: row.value.checked ?? {} });
      })
      .catch((caught: unknown) => {
        if (!alive) return;
        // No preference written yet is the ordinary first-run case, not a failure.
        if (caught instanceof ApiError && caught.status === 404) {
          setLoad({ status: "ready", dismissed: false, manual: {} });
          return;
        }
        setLoad({ status: "error" });
      });
    return () => {
      alive = false;
    };
  }, [reloadTick, role]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const next: Record<string, boolean> = {};
      if (role === "admin") {
        try {
          const { colleges } = await api.colleges();
          const college = colleges[0];
          if (college !== undefined) {
            const [tree, heads, user] = await Promise.all([
              api.collegeTree(college.id).catch(() => null),
              api.feesHeads(college.id).catch(() => null),
              userId !== undefined ? api.getUser(userId).catch(() => null) : Promise.resolve(null),
            ]);
            if (user !== null) next.password = user.status !== "must_reset";
            if (heads !== null) next.fees = heads.heads.length > 0;
            if (tree !== null) {
              const classes = tree.departments.flatMap((d) => d.classes);
              next.structure = tree.departments.length > 0 && classes.length > 0;
              const firstSection = classes.flatMap((c) => c.sections)[0];
              if (firstSection !== undefined) {
                const roster = await api.sectionRoster(firstSection.id).catch(() => null);
                if (roster !== null) next.students = roster.students.length > 0;
              }
              const firstClass = classes[0];
              if (firstClass !== undefined) {
                const assignments = await api.classTeacherAssignments(firstClass.id).catch(() => null);
                if (assignments !== null) next.staff = assignments.assignments.length > 0;
              }
            }
          }
        } catch {
          /* best-effort only — undetermined items simply stay open */
        }
      } else if (role === "teacher" && tiles !== undefined) {
        for (const tile of tiles) {
          if (tile.attendance.state === "ok" && tile.attendance.value.sessions > 0) next.attendance = true;
          if (tile.marks.state === "ok" && tile.marks.value.nMarks > 0) next.marks = true;
        }
      }
      if (alive) setAuto(next);
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [role, userId, tiles]);

  function isChecked(id: string, ready: Extract<Load, { status: "ready" }>): boolean {
    return autoIds.has(id) ? auto[id] === true : ready.manual[id] === true;
  }

  function toggleManual(id: string) {
    setLoad((prev) => {
      if (prev.status !== "ready") return prev;
      const nextManual = { ...prev.manual, [id]: !prev.manual[id] };
      void api.prefsSet(prefKeyFor(role), { dismissed: prev.dismissed, checked: nextManual }).catch(() => undefined);
      return { ...prev, manual: nextManual };
    });
  }

  function dismiss() {
    setLoad((prev) => {
      if (prev.status !== "ready") return prev;
      void api.prefsSet(prefKeyFor(role), { dismissed: true, checked: prev.manual }).catch(() => undefined);
      return { ...prev, dismissed: true };
    });
  }

  const ready = load.status === "ready" ? load : null;
  const allDone = ready !== null && items.every((item) => isChecked(item.id, ready));

  return (
    <section aria-label="Onboarding checklist" className={styles.wrap}>
      <AsyncState
        loading={load.status === "loading"}
        error={load.status === "error"}
        errorMessage="Couldn't load your checklist. Try again shortly."
        onRetry={() => setReloadTick((t) => t + 1)}
        isEmpty={ready !== null && (ready.dismissed || allDone)}
        empty={null}
      >
        {ready !== null ? (
          <Card
            title="Get started"
            actions={
              <Button variant="ghost" size="sm" onClick={dismiss}>
                Dismiss
              </Button>
            }
          >
            <ul className={styles.list}>
              {items.map((item) => {
                const checked = isChecked(item.id, ready);
                const isAuto = autoIds.has(item.id);
                return (
                  <li key={item.id} className={styles.row}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={checked}
                      disabled={isAuto}
                      onChange={isAuto ? undefined : () => toggleManual(item.id)}
                      aria-label={isAuto ? `${item.label} (detected automatically)` : item.label}
                    />
                    <a href={role === "student" && studentEdition === "school" ? `/portal/${item.id}` : item.href} className={checked ? styles.done : undefined}>
                      {item.label}
                    </a>
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : null}
      </AsyncState>
    </section>
  );
}
