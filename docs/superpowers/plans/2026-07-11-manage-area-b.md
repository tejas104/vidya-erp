# Manage UI — Area B (org & people admin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins the three "build the college" screens — `/manage/org` (tree + create/rename/delete), `/manage/students` (create/enroll/browse-by-section), `/manage/teachers` (create/link-identity/assignments) — inside the app shell, over existing endpoints only.

**Architecture:** Extend `api.ts` with typed people/identity client methods; add three icons + an "Administration" nav group (admin-only) to `navConfig`; build each screen as one client page composed from the Round-3 kit (`PageHeader`, `Card`, `DataTable`, `Modal`, `ConfirmDialog`, `Toast`, `Field`, `Button`, `Badge`, `EmptyState`, `Skeleton`). Browsing honors the API's shape: students are browsed per-section (roster), teachers per-class (assignments) — there is no global list endpoint.

**Tech Stack:** Next.js 16 App Router client components, TypeScript, the hand-rolled kit in `apps/web/src/ui/`, Vitest + RTL (`ui` project), Playwright via the session driver pattern.

## Global Constraints

- **No new backend, no new dependencies.** Existing endpoints only (`packages/modules/people/src/definition.ts`, `identity.user-list`). Demo-impact bar.
- **Admin-only screens**: nav entries carry `roles: ["admin"]`; the server enforces every action regardless (ADMIN_ONLY routes).
- **Endpoint facts (verbatim from definitions):**
  - `GET /api/v1/people/colleges` → `{colleges:[{id,name,code}]}`; `GET /api/v1/people/colleges/{collegeId}/tree` → `{college, departments:[{id,collegeId,name,code, classes:[{id,departmentId,name,code, sections:[{id,classId,name}]}], subjects:[{id,departmentId,name,code}]}]}`.
  - Creates: `POST /departments {collegeId,name,code}`, `POST /classes {departmentId,name,code}`, `POST /sections {classId,name}`, `POST /subjects {departmentId,name,code}` → 201 view; 409 duplicate code/name.
  - `PATCH /org/{unitType}/{unitId} {name}` → `{ok:true}`; `DELETE /org/{unitType}/{unitId}` → `{ok:true}`, **409 when the unit still has children/references** (RESTRICT). `unitType ∈ college|department|class|section|subject`.
  - `POST /students {collegeId,admissionNo,fullName}` → 201 studentView `{id,collegeId,admissionNo,fullName,status,enrollment:{sectionId,academicYear}|null}`; `PATCH /students/{id} {fullName?,status?}`; `POST /students/{id}/enrollment {sectionId,academicYear}` → `{enrollmentId,previousEnrollmentId}`; `GET /sections/{id}/roster` → `{students:[studentView]}`.
  - `POST /teachers {collegeId,staffNo,fullName}` → 201 teacherView `{id,collegeId,staffNo,fullName,status,identityUserId}`; `GET /teachers/{id}`; `POST /teachers/{id}/identity-link {identityUserId|null}` → `{teacher,grants:{upserted,removed}}`; `POST /teachers/{id}/assignments {classId,subjectId?,kind:subject_teacher|class_teacher,academicYear}` (subject_teacher REQUIRES subjectId; class_teacher FORBIDS it) → 201 assignmentView `{id,teacherId,classId,subjectId,kind,academicYear}`; `DELETE /assignments/{id}` → `{ok:true}`; `GET /classes/{id}/assignments` → `{assignments:[assignmentView]}`.
  - `GET /api/v1/identity/users?collegeId=…&limit=200` (admin) → `{users:[{id,username,displayName,status,collegeId,roles,grants,createdAt}]}`.
- **No list endpoints for students/teachers** — browse via section roster / class assignments; never invent a list call.
- Kit contracts (already shipped): `useToast().show(msg, "good"|"danger"|"info")` (no-op without provider — page tests need no wrapper); `Modal{open,onClose,title,children,footer?}`; `ConfirmDialog{open,title,message,confirmLabel?,danger?,onConfirm,onCancel}`; `DataTable{columns:Column<T>[],rows,rowKey,empty?}` with `Column<T> = {key,header,align?,render}`; `Field{label,htmlFor?,hint?,error?,children}`; `Button{variant?:"primary"|"ghost"|"danger",loading?}`; `PageHeader{eyebrow?,title,lede?,actions?}`; `Badge{tone?}`; `EmptyState{title,message?,action?}`; `Skeleton{lines?}`.
- Mutation errors surface via `ApiError.message` (problem+json `title`) in a danger toast; successes via a good toast. `currentAcademicYear()` for enrollment/assignment years.
- Test commands: `pnpm vitest run --project ui <file>`; suite `pnpm test:ui`; typecheck `pnpm --filter @vidya/web typecheck`.

---

## Task 1: Foundation — icons, nav entries, api client methods

**Files:**
- Modify: `apps/web/src/ui/Icon.tsx` (add 3 icons)
- Modify: `apps/web/src/ui/navConfig.ts` (Administration group)
- Modify: `apps/web/src/ui/api.ts` (people/identity types + methods)
- Modify: `apps/web/src/ui/shell.test.tsx` (admin nav case)
- Test: `apps/web/src/ui/api-people.test.tsx` (create)

**Interfaces:**
- Produces icons `"org" | "students" | "teachers"` appended to `ICON_NAMES`; nav entries for `/manage/org|students|teachers` (group "Administration", `roles:["admin"]`); types `CollegeView, DepartmentView, ClassView, SectionView, SubjectView, OrgTree, StudentView, TeacherView, AssignmentView, UserView, OrgUnitType`; api methods `colleges, collegeTree, createDepartment, createClass, createSection, createSubject, renameOrgUnit, deleteOrgUnit, createStudent, updateStudent, enrollStudent, createTeacher, getTeacher, linkTeacherIdentity, createTeacherAssignment, removeAssignment, classTeacherAssignments, listUsers` (exact signatures in Step 4).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/ui/api-people.test.tsx`:

```tsx
import { describe, expect, it, vi, afterEach } from "vitest";
import { api } from "./api";

afterEach(() => vi.restoreAllMocks());

function okJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("people api methods", () => {
  it("createDepartment POSTs the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ id: "dep_1", collegeId: "col_1", name: "Physics", code: "PHY" }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const dep = await api.createDepartment({ collegeId: "col_1", name: "Physics", code: "PHY" });
    expect(dep.id).toBe("dep_1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/people/departments");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ collegeId: "col_1", name: "Physics", code: "PHY" });
  });
  it("deleteOrgUnit DELETEs the typed unit path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await api.deleteOrgUnit("section", "sec_9");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/people/org/section/sec_9");
    expect(init.method).toBe("DELETE");
  });
  it("createTeacherAssignment posts kind+year to the teacher path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ id: "asg_1", teacherId: "tch_1", classId: "cls_1", subjectId: null, kind: "class_teacher", academicYear: "2026-27" }, 201));
    vi.stubGlobal("fetch", fetchMock);
    await api.createTeacherAssignment("tch_1", { classId: "cls_1", kind: "class_teacher", academicYear: "2026-27" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/people/teachers/tch_1/assignments");
    expect(JSON.parse(init.body)).toEqual({ classId: "cls_1", kind: "class_teacher", academicYear: "2026-27" });
  });
});
```

In `apps/web/src/ui/shell.test.tsx`, add inside `describe("Sidebar (role-gated)")`:

```tsx
  it("an admin sees the Administration group", () => {
    render(<Sidebar roles={["admin"]} open={false} onClose={() => {}} />);
    expect(screen.getByText("Administration")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /organisation/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /students/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /teachers/i })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify RED**

Run: `pnpm vitest run --project ui apps/web/src/ui/api-people.test.tsx apps/web/src/ui/shell.test.tsx`
Expected: api-people FAILS (`api.createDepartment is not a function`); the new sidebar test FAILS (no Administration group).

- [ ] **Step 3: Add the three icons**

In `apps/web/src/ui/Icon.tsx`: extend `ICON_NAMES` with `"org", "students", "teachers"` (before the closing `] as const;`) and add to `PATHS`:

```tsx
  org: (
    <>
      <rect x="9" y="3" width="6" height="5" rx="1" />
      <rect x="3" y="16" width="6" height="5" rx="1" />
      <rect x="15" y="16" width="6" height="5" rx="1" />
      <path d="M12 8v3M6 16v-3h12v3" />
    </>
  ),
  students: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="10" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  teachers: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="m17 11 2 2 4-4" />
    </>
  ),
```

- [ ] **Step 4: Add nav entries + api types/methods**

In `apps/web/src/ui/navConfig.ts`, append to `NAV` after the Marks entry:

```ts
  { href: "/manage/org", label: "Organisation", icon: "org", group: "Administration", roles: ["admin"] },
  { href: "/manage/students", label: "Students", icon: "students", group: "Administration", roles: ["admin"] },
  { href: "/manage/teachers", label: "Teachers", icon: "teachers", group: "Administration", roles: ["admin"] },
```

In `apps/web/src/ui/api.ts`, add after the `CreateAssessmentBody` interface:

```ts
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
export interface StudentView {
  id: string; collegeId: string; admissionNo: string; fullName: string;
  status: "active" | "inactive";
  enrollment: { sectionId: string; academicYear: string } | null;
}
export interface TeacherView {
  id: string; collegeId: string; staffNo: string; fullName: string;
  status: "active" | "inactive"; identityUserId: string | null;
}
export interface AssignmentView {
  id: string; teacherId: string; classId: string; subjectId: string | null;
  kind: "subject_teacher" | "class_teacher"; academicYear: string;
}
export interface UserView {
  id: string; username: string; displayName: string; status: string; roles: string[];
}
export type OrgUnitType = "college" | "department" | "class" | "section" | "subject";
```

And inside the `api` object (after `assessmentMarks`):

```ts
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
  createStudent: (body: { collegeId: string; admissionNo: string; fullName: string }) =>
    post<StudentView>("/api/v1/people/students", body),
  updateStudent: (studentId: string, body: { fullName?: string; status?: "active" | "inactive" }) =>
    patch<StudentView>(`/api/v1/people/students/${encodeURIComponent(studentId)}`, body),
  enrollStudent: (studentId: string, body: { sectionId: string; academicYear: string }) =>
    post<{ enrollmentId: string; previousEnrollmentId: string | null }>(
      `/api/v1/people/students/${encodeURIComponent(studentId)}/enrollment`,
      body,
    ),
  // people — teachers
  createTeacher: (body: { collegeId: string; staffNo: string; fullName: string }) =>
    post<TeacherView>("/api/v1/people/teachers", body),
  getTeacher: (teacherId: string) => get<TeacherView>(`/api/v1/people/teachers/${encodeURIComponent(teacherId)}`),
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
```

- [ ] **Step 5: Run to verify GREEN + typecheck**

Run: `pnpm vitest run --project ui apps/web/src/ui/api-people.test.tsx apps/web/src/ui/shell.test.tsx && pnpm --filter @vidya/web typecheck`
Expected: PASS (3 + 6 tests), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui/Icon.tsx apps/web/src/ui/navConfig.ts apps/web/src/ui/api.ts apps/web/src/ui/api-people.test.tsx apps/web/src/ui/shell.test.tsx
git commit -m "feat(web): Area B foundation — admin nav group, icons, people api client"
```

---

## Task 2: `/manage/org` — tree builder

**Files:**
- Create: `apps/web/app/(app)/manage/org/page.tsx`
- Test: `apps/web/src/ui/org-page.test.tsx`

**Interfaces:**
- Consumes: `api.colleges/collegeTree/createDepartment/createClass/createSection/createSubject/renameOrgUnit/deleteOrgUnit`, kit components, `useToast`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/ui/org-page.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import OrgPage from "../../app/(app)/manage/org/page";
import { api } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      colleges: vi.fn(), collegeTree: vi.fn(), createDepartment: vi.fn(),
      createClass: vi.fn(), createSection: vi.fn(), createSubject: vi.fn(),
      renameOrgUnit: vi.fn(), deleteOrgUnit: vi.fn(),
    },
  };
});

const tree = {
  college: { id: "col_1", name: "Sunrise", code: "DEMO" },
  departments: [
    {
      id: "dep_1", collegeId: "col_1", name: "Computer Science", code: "CSE",
      classes: [{ id: "cls_1", departmentId: "dep_1", name: "FY CS", code: "FYCS", sections: [{ id: "sec_1", classId: "cls_1", name: "A" }] }],
      subjects: [{ id: "sub_1", departmentId: "dep_1", name: "Data Structures", code: "DS" }],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  (api.colleges as ReturnType<typeof vi.fn>).mockResolvedValue({ colleges: [tree.college] });
  (api.collegeTree as ReturnType<typeof vi.fn>).mockResolvedValue(tree);
  (api.createDepartment as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "dep_2", collegeId: "col_1", name: "Physics", code: "PHY" });
});

describe("/manage/org", () => {
  it("renders the tree", async () => {
    render(<OrgPage />);
    expect(await screen.findByText("Computer Science · CSE")).toBeInTheDocument();
    expect(screen.getByText("FY CS")).toBeInTheDocument();
    expect(screen.getByText("Sec A")).toBeInTheDocument();
  });
  it("creates a department with the right body", async () => {
    render(<OrgPage />);
    fireEvent.click(await screen.findByRole("button", { name: /new department/i }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Physics" } });
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "PHY" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() =>
      expect(api.createDepartment).toHaveBeenCalledWith({ collegeId: "col_1", name: "Physics", code: "PHY" }),
    );
  });
});
```

- [ ] **Step 2: Run to verify RED**

Run: `pnpm vitest run --project ui apps/web/src/ui/org-page.test.tsx`
Expected: FAIL — cannot resolve the org page module.

- [ ] **Step 3: Implement the page**

Create `apps/web/app/(app)/manage/org/page.tsx`:

```tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type OrgTree, type OrgUnitType } from "@/ui/api";
import { useToast } from "@/ui/Toast";
import { PageHeader } from "@/ui/PageHeader";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Modal } from "@/ui/Modal";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { Badge } from "@/ui/Badge";
import { EmptyState } from "@/ui/EmptyState";
import { Skeleton } from "@/ui/Skeleton";

export const dynamic = "force-dynamic";

type CreatableUnit = "department" | "class" | "section" | "subject";
type Editor =
  | { kind: "create"; unit: CreatableUnit; parentId: string; parentLabel: string }
  | { kind: "rename"; unit: OrgUnitType; unitId: string; currentName: string };
type Doomed = { unit: OrgUnitType; unitId: string; label: string };

const HAS_CODE: Record<CreatableUnit, boolean> = { department: true, class: true, subject: true, section: false };

export default function OrgPage() {
  const toast = useToast();
  const [tree, setTree] = useState<OrgTree | null>(null);
  const [failed, setFailed] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [doomed, setDoomed] = useState<Doomed | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { colleges } = await api.colleges();
      const college = colleges[0];
      if (!college) {
        setFailed(true);
        return;
      }
      setTree(await api.collegeTree(college.id));
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  function openCreate(unit: CreatableUnit, parentId: string, parentLabel: string) {
    setName("");
    setCode("");
    setEditor({ kind: "create", unit, parentId, parentLabel });
  }
  function openRename(unit: OrgUnitType, unitId: string, currentName: string) {
    setName(currentName);
    setEditor({ kind: "rename", unit, unitId, currentName });
  }

  async function submitEditor() {
    if (!editor || name.trim() === "") return;
    setSaving(true);
    try {
      if (editor.kind === "create") {
        if (editor.unit === "department") await api.createDepartment({ collegeId: editor.parentId, name, code });
        else if (editor.unit === "class") await api.createClass({ departmentId: editor.parentId, name, code });
        else if (editor.unit === "subject") await api.createSubject({ departmentId: editor.parentId, name, code });
        else await api.createSection({ classId: editor.parentId, name });
        toast.show(`${editor.unit[0]!.toUpperCase()}${editor.unit.slice(1)} "${name}" created.`, "good");
      } else {
        await api.renameOrgUnit(editor.unit, editor.unitId, name);
        toast.show("Renamed.", "good");
      }
      setEditor(null);
      await load();
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't save.", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!doomed) return;
    try {
      await api.deleteOrgUnit(doomed.unit, doomed.unitId);
      toast.show(`Deleted "${doomed.label}".`, "good");
      setDoomed(null);
      await load();
    } catch (caught) {
      setDoomed(null);
      toast.show(
        caught instanceof ApiError && caught.status === 409
          ? `"${doomed.label}" still has children or records — remove those first.`
          : "Couldn't delete.",
        "danger",
      );
    }
  }

  if (failed) {
    return <EmptyState title="Couldn't load the organisation." message="Try again shortly." />;
  }
  if (tree === null) {
    return <Skeleton lines={5} />;
  }

  return (
    <>
      <PageHeader
        eyebrow="Organisation"
        title={tree.college.name}
        lede="Departments, classes, sections and subjects. Deleting is blocked while a unit still has children or records."
        actions={
          <Button onClick={() => openCreate("department", tree.college.id, tree.college.name)}>New department</Button>
        }
      />

      {tree.departments.length === 0 ? (
        <EmptyState
          title="No departments yet."
          message="Create the first department to start building the college."
        />
      ) : (
        <div style={{ display: "grid", gap: "var(--space-4)" }}>
          {tree.departments.map((dept) => (
            <Card
              key={dept.id}
              title={`${dept.name} · ${dept.code}`}
              actions={
                <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Button variant="ghost" onClick={() => openCreate("class", dept.id, dept.name)}>New class</Button>
                  <Button variant="ghost" onClick={() => openCreate("subject", dept.id, dept.name)}>New subject</Button>
                  <Button variant="ghost" onClick={() => openRename("department", dept.id, dept.name)}>Rename</Button>
                  <Button variant="danger" onClick={() => setDoomed({ unit: "department", unitId: dept.id, label: dept.name })}>
                    Delete
                  </Button>
                </span>
              }
            >
              {dept.classes.length === 0 ? (
                <p className="strip-empty">No classes yet.</p>
              ) : (
                dept.classes.map((klass) => (
                  <div key={klass.id} style={{ padding: "10px 0", borderTop: "1px solid var(--rule)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <span>
                      <strong>{klass.name}</strong> <span className="num" style={{ opacity: 0.6 }}>{klass.code}</span>
                    </span>
                    <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      {klass.sections.map((section) => (
                        <Badge key={section.id}>Sec {section.name}</Badge>
                      ))}
                      <Button variant="ghost" onClick={() => openCreate("section", klass.id, klass.name)}>New section</Button>
                      <Button variant="ghost" onClick={() => openRename("class", klass.id, klass.name)}>Rename</Button>
                      <Button variant="danger" onClick={() => setDoomed({ unit: "class", unitId: klass.id, label: klass.name })}>
                        Delete
                      </Button>
                    </span>
                  </div>
                ))
              )}
              {dept.subjects.length > 0 ? (
                <div style={{ marginTop: "var(--space-3)", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="stat-sub num">subjects</span>
                  {dept.subjects.map((subject) => (
                    <Badge key={subject.id} tone="good">{subject.name}</Badge>
                  ))}
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={editor !== null}
        onClose={() => setEditor(null)}
        title={
          editor?.kind === "rename"
            ? `Rename ${editor.unit}`
            : editor
              ? `New ${editor.unit} — ${editor.parentLabel}`
              : ""
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditor(null)}>Cancel</Button>
            <Button onClick={() => void submitEditor()} loading={saving} disabled={name.trim() === ""}>
              {editor?.kind === "rename" ? "Rename" : "Create"}
            </Button>
          </>
        }
      >
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <Field label="Name" htmlFor="org-name">
            <input id="org-name" value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          {editor?.kind === "create" && HAS_CODE[editor.unit] ? (
            <Field label="Code" htmlFor="org-code" hint="Short unique code, e.g. CSE">
              <input id="org-code" value={code} onChange={(event) => setCode(event.target.value)} />
            </Field>
          ) : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={doomed !== null}
        title={`Delete ${doomed?.unit ?? ""}`}
        message={`Delete "${doomed?.label ?? ""}"? This only works when it has no children or records.`}
        confirmLabel="Confirm"
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDoomed(null)}
      />
    </>
  );
}
```

- [ ] **Step 4: Run to verify GREEN**

Run: `pnpm vitest run --project ui apps/web/src/ui/org-page.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @vidya/web typecheck`

```bash
git add "apps/web/app/(app)/manage/org/page.tsx" apps/web/src/ui/org-page.test.tsx
git commit -m "feat(web): /manage/org — org tree builder (create/rename/delete)"
```

---

## Task 3: `/manage/students` — create, enroll, browse-by-section

**Files:**
- Create: `apps/web/app/(app)/manage/students/page.tsx`
- Test: `apps/web/src/ui/students-page.test.tsx`

**Interfaces:**
- Consumes: `api.colleges/collegeTree/sectionRoster/createStudent/enrollStudent/updateStudent`, `currentAcademicYear`, kit.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/ui/students-page.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import StudentsPage from "../../app/(app)/manage/students/page";
import { api } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      colleges: vi.fn(), collegeTree: vi.fn(), sectionRoster: vi.fn(),
      createStudent: vi.fn(), enrollStudent: vi.fn(), updateStudent: vi.fn(),
    },
  };
});

const tree = {
  college: { id: "col_1", name: "Sunrise", code: "DEMO" },
  departments: [
    {
      id: "dep_1", collegeId: "col_1", name: "CS", code: "CSE",
      classes: [{ id: "cls_1", departmentId: "dep_1", name: "FY CS", code: "FYCS", sections: [{ id: "sec_1", classId: "cls_1", name: "A" }] }],
      subjects: [],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  (api.colleges as ReturnType<typeof vi.fn>).mockResolvedValue({ colleges: [tree.college] });
  (api.collegeTree as ReturnType<typeof vi.fn>).mockResolvedValue(tree);
  (api.sectionRoster as ReturnType<typeof vi.fn>).mockResolvedValue({
    students: [{ id: "stu_1", collegeId: "col_1", admissionNo: "FYCS-001", fullName: "Aarav Sharma", status: "active", enrollment: { sectionId: "sec_1", academicYear: "2026-27" } }],
  });
  (api.createStudent as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "stu_9", collegeId: "col_1", admissionNo: "FYCS-099", fullName: "New Kid", status: "active", enrollment: null });
  (api.enrollStudent as ReturnType<typeof vi.fn>).mockResolvedValue({ enrollmentId: "enr_1", previousEnrollmentId: null });
});

describe("/manage/students", () => {
  it("lists the selected section's roster", async () => {
    render(<StudentsPage />);
    expect(await screen.findByText("Aarav Sharma")).toBeInTheDocument();
    expect(screen.getByText("FYCS-001")).toBeInTheDocument();
  });
  it("creates then enrolls a student into the selected section", async () => {
    render(<StudentsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /add student/i }));
    fireEvent.change(screen.getByLabelText("Admission no."), { target: { value: "FYCS-099" } });
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "New Kid" } });
    fireEvent.click(screen.getByRole("button", { name: /^create & enroll$/i }));
    await waitFor(() =>
      expect(api.createStudent).toHaveBeenCalledWith({ collegeId: "col_1", admissionNo: "FYCS-099", fullName: "New Kid" }),
    );
    await waitFor(() =>
      expect(api.enrollStudent).toHaveBeenCalledWith("stu_9", expect.objectContaining({ sectionId: "sec_1" })),
    );
  });
});
```

- [ ] **Step 2: Run to verify RED**

Run: `pnpm vitest run --project ui apps/web/src/ui/students-page.test.tsx`
Expected: FAIL — cannot resolve the students page module.

- [ ] **Step 3: Implement the page**

Create `apps/web/app/(app)/manage/students/page.tsx`:

```tsx
"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, currentAcademicYear, type OrgTree, type StudentView } from "@/ui/api";
import { useToast } from "@/ui/Toast";
import { PageHeader } from "@/ui/PageHeader";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Modal } from "@/ui/Modal";
import { DataTable, type Column } from "@/ui/DataTable";
import { Badge } from "@/ui/Badge";
import { EmptyState } from "@/ui/EmptyState";
import { Skeleton } from "@/ui/Skeleton";

export const dynamic = "force-dynamic";

type SectionOpt = { sectionId: string; label: string };

/** Flattens the org tree into "Class · Section" options (no student-list endpoint — browse per section). */
function sectionOptions(tree: OrgTree): SectionOpt[] {
  const options: SectionOpt[] = [];
  for (const dept of tree.departments) {
    for (const klass of dept.classes) {
      for (const section of klass.sections) {
        options.push({ sectionId: section.id, label: `${klass.name} · Sec ${section.name}` });
      }
    }
  }
  return options;
}

export default function StudentsPage() {
  const toast = useToast();
  const year = useMemo(() => currentAcademicYear(), []);
  const [tree, setTree] = useState<OrgTree | null>(null);
  const [failed, setFailed] = useState(false);
  const [sectionId, setSectionId] = useState("");
  const [roster, setRoster] = useState<StudentView[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [transfer, setTransfer] = useState<StudentView | null>(null);
  const [transferTo, setTransferTo] = useState("");
  const [admissionNo, setAdmissionNo] = useState("");
  const [fullName, setFullName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { colleges } = await api.colleges();
        const college = colleges[0];
        if (!college) {
          setFailed(true);
          return;
        }
        const loaded = await api.collegeTree(college.id);
        setTree(loaded);
        const first = sectionOptions(loaded)[0];
        if (first) setSectionId(first.sectionId);
      } catch {
        setFailed(true);
      }
    })();
  }, []);

  const loadRoster = useCallback(async () => {
    if (!sectionId) return;
    try {
      setRoster((await api.sectionRoster(sectionId)).students as StudentView[]);
    } catch {
      setRoster([]);
    }
  }, [sectionId]);
  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  async function createAndEnroll() {
    if (!tree || admissionNo.trim() === "" || fullName.trim() === "") return;
    setSaving(true);
    try {
      const student = await api.createStudent({ collegeId: tree.college.id, admissionNo, fullName });
      await api.enrollStudent(student.id, { sectionId, academicYear: year });
      toast.show(`${fullName} enrolled.`, "good");
      setAdding(false);
      setAdmissionNo("");
      setFullName("");
      await loadRoster();
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't add the student.", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function submitTransfer() {
    if (!transfer || !transferTo) return;
    setSaving(true);
    try {
      await api.enrollStudent(transfer.id, { sectionId: transferTo, academicYear: year });
      toast.show(`${transfer.fullName} transferred.`, "good");
      setTransfer(null);
      await loadRoster();
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't transfer.", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(student: StudentView) {
    const next = student.status === "active" ? "inactive" : "active";
    try {
      await api.updateStudent(student.id, { status: next });
      toast.show(`${student.fullName} is now ${next}.`, "good");
      await loadRoster();
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't update.", "danger");
    }
  }

  if (failed) return <EmptyState title="Couldn't load the college." message="Try again shortly." />;
  if (tree === null) return <Skeleton lines={5} />;

  const options = sectionOptions(tree);
  const columns: Column<StudentView>[] = [
    { key: "admissionNo", header: "Admission no.", render: (row) => <span className="num">{row.admissionNo}</span> },
    {
      key: "name",
      header: "Student",
      render: (row) => (
        <a className="risk-name" href={`/students/${encodeURIComponent(row.id)}`}>
          {row.fullName}
        </a>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <Badge tone={row.status === "active" ? "good" : "warn"}>{row.status}</Badge>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <span style={{ display: "inline-flex", gap: 8 }}>
          <Button variant="ghost" onClick={() => { setTransferTo(""); setTransfer(row); }}>Transfer</Button>
          <Button variant="ghost" onClick={() => void toggleStatus(row)}>
            {row.status === "active" ? "Deactivate" : "Reactivate"}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Students"
        title="Student records"
        lede="Browse a section's roster; add, transfer or deactivate students. There is no global list — students live in sections."
        actions={<Button onClick={() => setAdding(true)} disabled={options.length === 0}>Add student</Button>}
      />

      {options.length === 0 ? (
        <EmptyState title="No sections yet." message="Create departments, classes and sections in Organisation first." />
      ) : (
        <>
          <Field label="Section" htmlFor="sec-pick">
            <select id="sec-pick" value={sectionId} onChange={(event) => setSectionId(event.target.value)} style={{ maxWidth: 340 }}>
              {options.map((option) => (
                <option key={option.sectionId} value={option.sectionId}>{option.label}</option>
              ))}
            </select>
          </Field>
          <div style={{ marginTop: "var(--space-4)" }}>
            {roster === null ? (
              <Skeleton lines={4} />
            ) : (
              <DataTable
                columns={columns}
                rows={roster}
                rowKey={(row) => row.id}
                empty={{ title: "No students enrolled here.", message: "Add one with the button above." }}
              />
            )}
          </div>
        </>
      )}

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title={`Add student — ${options.find((option) => option.sectionId === sectionId)?.label ?? ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            <Button onClick={() => void createAndEnroll()} loading={saving} disabled={admissionNo.trim() === "" || fullName.trim() === ""}>
              Create & enroll
            </Button>
          </>
        }
      >
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <Field label="Admission no." htmlFor="stu-adm" hint="Unique, e.g. FYCS-015">
            <input id="stu-adm" value={admissionNo} onChange={(event) => setAdmissionNo(event.target.value)} />
          </Field>
          <Field label="Full name" htmlFor="stu-name">
            <input id="stu-name" value={fullName} onChange={(event) => setFullName(event.target.value)} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={transfer !== null}
        onClose={() => setTransfer(null)}
        title={`Transfer ${transfer?.fullName ?? ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTransfer(null)}>Cancel</Button>
            <Button onClick={() => void submitTransfer()} loading={saving} disabled={transferTo === ""}>
              Transfer
            </Button>
          </>
        }
      >
        <Field label="To section" htmlFor="stu-transfer">
          <select id="stu-transfer" value={transferTo} onChange={(event) => setTransferTo(event.target.value)}>
            <option value="">Choose…</option>
            {options
              .filter((option) => option.sectionId !== sectionId)
              .map((option) => (
                <option key={option.sectionId} value={option.sectionId}>{option.label}</option>
              ))}
          </select>
        </Field>
      </Modal>
    </>
  );
}
```

> Note: `api.sectionRoster` was typed in Round 2 as `{ students: { id; fullName; admissionNo }[] }`. The real endpoint returns full `studentView` rows (see Global Constraints). Widen the Round-2 return type to `{ students: StudentView[] }` in `api.ts` (Task 1 may do this) so the cast in `loadRoster` is unnecessary — if you widen it, drop the `as StudentView[]`.

- [ ] **Step 4: Run to verify GREEN**

Run: `pnpm vitest run --project ui apps/web/src/ui/students-page.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @vidya/web typecheck`

```bash
git add "apps/web/app/(app)/manage/students/page.tsx" apps/web/src/ui/students-page.test.tsx apps/web/src/ui/api.ts
git commit -m "feat(web): /manage/students — create, enroll, browse-by-section"
```

---

## Task 4: `/manage/teachers` — create, link identity, assignments

**Files:**
- Create: `apps/web/app/(app)/manage/teachers/page.tsx`
- Test: `apps/web/src/ui/teachers-page.test.tsx`

**Interfaces:**
- Consumes: `api.colleges/collegeTree/createTeacher/getTeacher/linkTeacherIdentity/createTeacherAssignment/removeAssignment/classTeacherAssignments/listUsers`, `currentAcademicYear`, kit.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/ui/teachers-page.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TeachersPage from "../../app/(app)/manage/teachers/page";
import { api } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      colleges: vi.fn(), collegeTree: vi.fn(), createTeacher: vi.fn(), getTeacher: vi.fn(),
      linkTeacherIdentity: vi.fn(), createTeacherAssignment: vi.fn(), removeAssignment: vi.fn(),
      classTeacherAssignments: vi.fn(), listUsers: vi.fn(),
    },
  };
});

const tree = {
  college: { id: "col_1", name: "Sunrise", code: "DEMO" },
  departments: [
    {
      id: "dep_1", collegeId: "col_1", name: "CS", code: "CSE",
      classes: [{ id: "cls_1", departmentId: "dep_1", name: "FY CS", code: "FYCS", sections: [] }],
      subjects: [{ id: "sub_1", departmentId: "dep_1", name: "Data Structures", code: "DS" }],
    },
  ],
};
const teacher = { id: "tch_1", collegeId: "col_1", staffNo: "S-9", fullName: "New Teacher", status: "active", identityUserId: null };

beforeEach(() => {
  vi.clearAllMocks();
  (api.colleges as ReturnType<typeof vi.fn>).mockResolvedValue({ colleges: [tree.college] });
  (api.collegeTree as ReturnType<typeof vi.fn>).mockResolvedValue(tree);
  (api.classTeacherAssignments as ReturnType<typeof vi.fn>).mockResolvedValue({ assignments: [] });
  (api.listUsers as ReturnType<typeof vi.fn>).mockResolvedValue({ users: [{ id: "u_1", username: "t.new", displayName: "T New", status: "active", roles: [] }] });
  (api.createTeacher as ReturnType<typeof vi.fn>).mockResolvedValue(teacher);
  (api.linkTeacherIdentity as ReturnType<typeof vi.fn>).mockResolvedValue({ teacher: { ...teacher, identityUserId: "u_1" }, grants: { upserted: 0, removed: 0 } });
  (api.createTeacherAssignment as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "asg_1", teacherId: "tch_1", classId: "cls_1", subjectId: "sub_1", kind: "subject_teacher", academicYear: "2026-27" });
});

describe("/manage/teachers", () => {
  it("creates a teacher with the college id", async () => {
    render(<TeachersPage />);
    fireEvent.change(await screen.findByLabelText("Staff no."), { target: { value: "S-9" } });
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "New Teacher" } });
    fireEvent.click(screen.getByRole("button", { name: /add teacher/i }));
    await waitFor(() =>
      expect(api.createTeacher).toHaveBeenCalledWith({ collegeId: "col_1", staffNo: "S-9", fullName: "New Teacher" }),
    );
    expect(await screen.findByText("New Teacher")).toBeInTheDocument();
  });
  it("assigns the created teacher as subject_teacher with a subject", async () => {
    render(<TeachersPage />);
    fireEvent.change(await screen.findByLabelText("Staff no."), { target: { value: "S-9" } });
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "New Teacher" } });
    fireEvent.click(screen.getByRole("button", { name: /add teacher/i }));
    fireEvent.click(await screen.findByRole("button", { name: /assign/i }));
    // modal defaults: first class, subject_teacher + first subject
    fireEvent.click(screen.getByRole("button", { name: /create assignment/i }));
    await waitFor(() =>
      expect(api.createTeacherAssignment).toHaveBeenCalledWith("tch_1", {
        classId: "cls_1",
        subjectId: "sub_1",
        kind: "subject_teacher",
        academicYear: expect.any(String),
      }),
    );
  });
});
```

- [ ] **Step 2: Run to verify RED**

Run: `pnpm vitest run --project ui apps/web/src/ui/teachers-page.test.tsx`
Expected: FAIL — cannot resolve the teachers page module.

- [ ] **Step 3: Implement the page**

Create `apps/web/app/(app)/manage/teachers/page.tsx`:

```tsx
"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  currentAcademicYear,
  type AssignmentView,
  type OrgTree,
  type TeacherView,
  type UserView,
} from "@/ui/api";
import { useToast } from "@/ui/Toast";
import { PageHeader } from "@/ui/PageHeader";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Modal } from "@/ui/Modal";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { DataTable, type Column } from "@/ui/DataTable";
import { Badge } from "@/ui/Badge";
import { EmptyState } from "@/ui/EmptyState";
import { Skeleton } from "@/ui/Skeleton";

export const dynamic = "force-dynamic";

type ClassOpt = { classId: string; label: string; subjects: { id: string; name: string }[] };

function classOptions(tree: OrgTree): ClassOpt[] {
  const options: ClassOpt[] = [];
  for (const dept of tree.departments) {
    for (const klass of dept.classes) {
      options.push({
        classId: klass.id,
        label: `${dept.code} · ${klass.name}`,
        subjects: dept.subjects.map((subject) => ({ id: subject.id, name: subject.name })),
      });
    }
  }
  return options;
}

export default function TeachersPage() {
  const toast = useToast();
  const year = useMemo(() => currentAcademicYear(), []);
  const [tree, setTree] = useState<OrgTree | null>(null);
  const [failed, setFailed] = useState(false);
  const [users, setUsers] = useState<UserView[]>([]);
  const [recent, setRecent] = useState<TeacherView[]>([]);
  const [staffNo, setStaffNo] = useState("");
  const [fullName, setFullName] = useState("");
  const [saving, setSaving] = useState(false);
  // assignments browser
  const [classId, setClassId] = useState("");
  const [assignments, setAssignments] = useState<AssignmentView[] | null>(null);
  const [teacherNames, setTeacherNames] = useState<Record<string, string>>({});
  const [removal, setRemoval] = useState<AssignmentView | null>(null);
  // link + assign modals
  const [linking, setLinking] = useState<TeacherView | null>(null);
  const [linkUserId, setLinkUserId] = useState("");
  const [assigning, setAssigning] = useState<TeacherView | null>(null);
  const [assignClassId, setAssignClassId] = useState("");
  const [assignKind, setAssignKind] = useState<"subject_teacher" | "class_teacher">("subject_teacher");
  const [assignSubjectId, setAssignSubjectId] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const { colleges } = await api.colleges();
        const college = colleges[0];
        if (!college) {
          setFailed(true);
          return;
        }
        const loaded = await api.collegeTree(college.id);
        setTree(loaded);
        const first = classOptions(loaded)[0];
        if (first) {
          setClassId(first.classId);
          setAssignClassId(first.classId);
          setAssignSubjectId(first.subjects[0]?.id ?? "");
        }
        try {
          setUsers((await api.listUsers(college.id)).users);
        } catch {
          setUsers([]);
        }
      } catch {
        setFailed(true);
      }
    })();
  }, []);

  const loadAssignments = useCallback(async () => {
    if (!classId) return;
    try {
      const { assignments: rows } = await api.classTeacherAssignments(classId);
      setAssignments(rows);
      const missing = [...new Set(rows.map((row) => row.teacherId))].filter((id) => teacherNames[id] === undefined);
      if (missing.length > 0) {
        const fetched = await Promise.all(
          missing.map(async (id) => {
            try {
              const t = await api.getTeacher(id);
              return [id, t.fullName] as const;
            } catch {
              return [id, id] as const;
            }
          }),
        );
        setTeacherNames((current) => ({ ...current, ...Object.fromEntries(fetched) }));
      }
    } catch {
      setAssignments([]);
    }
  }, [classId, teacherNames]);
  useEffect(() => {
    void loadAssignments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  async function addTeacher() {
    if (!tree || staffNo.trim() === "" || fullName.trim() === "") return;
    setSaving(true);
    try {
      const teacher = await api.createTeacher({ collegeId: tree.college.id, staffNo, fullName });
      setRecent((current) => [teacher, ...current]);
      toast.show(`${teacher.fullName} added.`, "good");
      setStaffNo("");
      setFullName("");
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't add the teacher.", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function submitLink() {
    if (!linking || linkUserId === "") return;
    setSaving(true);
    try {
      const { teacher, grants } = await api.linkTeacherIdentity(linking.id, linkUserId);
      setRecent((current) => current.map((t) => (t.id === teacher.id ? teacher : t)));
      toast.show(`Linked — ${grants.upserted} grant(s) derived.`, "good");
      setLinking(null);
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't link.", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function submitAssignment() {
    if (!assigning || assignClassId === "") return;
    if (assignKind === "subject_teacher" && assignSubjectId === "") return;
    setSaving(true);
    try {
      await api.createTeacherAssignment(assigning.id, {
        classId: assignClassId,
        ...(assignKind === "subject_teacher" ? { subjectId: assignSubjectId } : {}),
        kind: assignKind,
        academicYear: year,
      });
      toast.show("Assignment created — the identity grant derives when the teacher is linked.", "good");
      setAssigning(null);
      if (assignClassId === classId) await loadAssignments();
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't create the assignment.", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function confirmRemoval() {
    if (!removal) return;
    try {
      await api.removeAssignment(removal.id);
      toast.show("Assignment removed (derived grant revoked).", "good");
      setRemoval(null);
      await loadAssignments();
    } catch (caught) {
      setRemoval(null);
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't remove.", "danger");
    }
  }

  if (failed) return <EmptyState title="Couldn't load the college." message="Try again shortly." />;
  if (tree === null) return <Skeleton lines={5} />;

  const classes = classOptions(tree);
  const assignSubjects = classes.find((option) => option.classId === assignClassId)?.subjects ?? [];
  const subjectNames = new Map(tree.departments.flatMap((d) => d.subjects.map((s) => [s.id, s.name] as const)));
  const assignmentColumns: Column<AssignmentView>[] = [
    { key: "teacher", header: "Teacher", render: (row) => teacherNames[row.teacherId] ?? row.teacherId },
    {
      key: "kind",
      header: "Role",
      render: (row) =>
        row.kind === "class_teacher" ? <Badge tone="good">class teacher</Badge> : <Badge>{subjectNames.get(row.subjectId ?? "") ?? "subject"}</Badge>,
    },
    { key: "year", header: "Year", render: (row) => <span className="num">{row.academicYear}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => <Button variant="danger" onClick={() => setRemoval(row)}>Remove</Button>,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Teachers"
        title="Teacher records & assignments"
        lede="Assignments derive scope grants once the teacher is linked to a sign-in (ADR-0015). Browse by class — teachers appear where they teach."
      />

      <Card title="Add a teacher">
        <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="Staff no." htmlFor="tch-staff" hint="Unique, e.g. S-1042">
            <input id="tch-staff" value={staffNo} onChange={(event) => setStaffNo(event.target.value)} />
          </Field>
          <Field label="Full name" htmlFor="tch-name">
            <input id="tch-name" value={fullName} onChange={(event) => setFullName(event.target.value)} />
          </Field>
          <Button onClick={() => void addTeacher()} loading={saving} disabled={staffNo.trim() === "" || fullName.trim() === ""}>
            Add teacher
          </Button>
        </div>
        {recent.length > 0 ? (
          <div style={{ marginTop: "var(--space-4)", display: "grid", gap: "var(--space-2)" }}>
            {recent.map((teacher) => (
              <div key={teacher.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "8px 0", borderTop: "1px solid var(--rule)" }}>
                <span>
                  <strong>{teacher.fullName}</strong> <span className="num" style={{ opacity: 0.6 }}>{teacher.staffNo}</span>{" "}
                  {teacher.identityUserId !== null ? <Badge tone="good">linked</Badge> : <Badge tone="warn">no sign-in</Badge>}
                </span>
                <span style={{ display: "flex", gap: 8 }}>
                  <Button variant="ghost" onClick={() => { setLinkUserId(""); setLinking(teacher); }}>Link identity</Button>
                  <Button variant="ghost" onClick={() => setAssigning(teacher)}>Assign</Button>
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      <section className="section" aria-label="Assignments by class">
        <div className="section-head"><h2>Assignments by class</h2></div>
        <Field label="Class" htmlFor="tch-class">
          <select id="tch-class" value={classId} onChange={(event) => setClassId(event.target.value)} style={{ maxWidth: 340 }}>
            {classes.map((option) => (
              <option key={option.classId} value={option.classId}>{option.label}</option>
            ))}
          </select>
        </Field>
        <div style={{ marginTop: "var(--space-4)" }}>
          {assignments === null ? (
            <Skeleton lines={3} />
          ) : (
            <DataTable
              columns={assignmentColumns}
              rows={assignments}
              rowKey={(row) => row.id}
              empty={{ title: "No assignments for this class.", message: "Add a teacher above, then Assign." }}
            />
          )}
        </div>
      </section>

      <Modal
        open={linking !== null}
        onClose={() => setLinking(null)}
        title={`Link ${linking?.fullName ?? ""} to a sign-in`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setLinking(null)}>Cancel</Button>
            <Button onClick={() => void submitLink()} loading={saving} disabled={linkUserId === ""}>Link</Button>
          </>
        }
      >
        <Field label="Identity user" htmlFor="tch-user" hint="Grants for existing assignments derive on link.">
          <select id="tch-user" value={linkUserId} onChange={(event) => setLinkUserId(event.target.value)}>
            <option value="">Choose…</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>{user.displayName} ({user.username})</option>
            ))}
          </select>
        </Field>
      </Modal>

      <Modal
        open={assigning !== null}
        onClose={() => setAssigning(null)}
        title={`Assign ${assigning?.fullName ?? ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAssigning(null)}>Cancel</Button>
            <Button
              onClick={() => void submitAssignment()}
              loading={saving}
              disabled={assignClassId === "" || (assignKind === "subject_teacher" && assignSubjectId === "")}
            >
              Create assignment
            </Button>
          </>
        }
      >
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <Field label="Class" htmlFor="asg-class">
            <select
              id="asg-class"
              value={assignClassId}
              onChange={(event) => {
                setAssignClassId(event.target.value);
                const subjects = classes.find((option) => option.classId === event.target.value)?.subjects ?? [];
                setAssignSubjectId(subjects[0]?.id ?? "");
              }}
            >
              {classes.map((option) => (
                <option key={option.classId} value={option.classId}>{option.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Role" htmlFor="asg-kind" hint="class_teacher records attendance; subject_teacher enters marks for one subject.">
            <select id="asg-kind" value={assignKind} onChange={(event) => setAssignKind(event.target.value as typeof assignKind)}>
              <option value="subject_teacher">subject_teacher</option>
              <option value="class_teacher">class_teacher</option>
            </select>
          </Field>
          {assignKind === "subject_teacher" ? (
            <Field label="Subject" htmlFor="asg-subject">
              <select id="asg-subject" value={assignSubjectId} onChange={(event) => setAssignSubjectId(event.target.value)}>
                {assignSubjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>{subject.name}</option>
                ))}
              </select>
            </Field>
          ) : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={removal !== null}
        title="Remove assignment"
        message={`Remove this assignment${removal ? ` (${teacherNames[removal.teacherId] ?? removal.teacherId})` : ""}? The derived grant is revoked first.`}
        confirmLabel="Confirm"
        danger
        onConfirm={() => void confirmRemoval()}
        onCancel={() => setRemoval(null)}
      />
    </>
  );
}
```

- [ ] **Step 4: Run to verify GREEN**

Run: `pnpm vitest run --project ui apps/web/src/ui/teachers-page.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Full suite + typecheck + commit**

Run: `pnpm --filter @vidya/web typecheck && pnpm test:ui`
Expected: all green.

```bash
git add "apps/web/app/(app)/manage/teachers/page.tsx" apps/web/src/ui/teachers-page.test.tsx
git commit -m "feat(web): /manage/teachers — create, link identity, class assignments"
```

---

## Task 5: Live verification (Playwright as demo-admin)

- [ ] **Step 1: Stack up.** Web + worker + infra running; demo data seeded (login `demo-admin` / `demo-admin-pass-2026!`).
- [ ] **Step 2: Drive as admin** (session driver pattern with storageState + hydration wait): sign in as demo-admin, confirm the sidebar shows the **Administration** group (Organisation, Students, Teachers) alongside Teaching entries. Screenshot.
- [ ] **Step 3: Org flow:** `/manage/org` → New department ("Mathematics" / "MTH") → toast → tree refreshes with the new card. Then New class under it ("FY Maths" / "FYM"), New section ("A"). Try deleting the CSE department → expect the 409 "still has children" danger toast. Screenshot each state.
- [ ] **Step 4: Students flow:** `/manage/students` → pick "FY Maths · Sec A" → Add student ("FYM-001" / "Test Student") → toast → roster shows the row. Transfer them to another section and back. Screenshot.
- [ ] **Step 5: Teachers flow:** `/manage/teachers` → Add teacher ("S-900" / "Playwright Teacher") → Assign (class_teacher of FY Maths) → browse "Assignments by class" for FY Maths shows the row → Remove it (ConfirmDialog) → toast. Screenshot.
- [ ] **Step 6: Look at every screenshot** — shell chrome present, modals centred and focus-trapped, toasts legible, tables read well; no console errors. Fix anything broken before declaring done.
- [ ] **Step 7: Verify the loop:** the objects created via UI exist via API (curl the tree; roster of the new section). Then clean up is unnecessary — demo data tolerates additions.

---

## Self-Review

- **Spec coverage (manage-ui spec, Phase 2 / Area B):** org tree + create + rename + delete-with-409 → Task 2; students list/create/enroll (browse-per-section per the API's real shape) → Task 3; teachers create/link-identity/assignments (+ ADR-0015 grant notes in UI copy) → Task 4; nav entries → Task 1; verification → Task 5. Import (`/manage/import`) and users admin (`/manage/users`) are Areas C/D — separate plans.
- **Placeholder scan:** clean; one explicit widening note (sectionRoster → StudentView[]) with exact location.
- **Type consistency:** `OrgTree/StudentView/TeacherView/AssignmentView/UserView/OrgUnitType` defined in Task 1 and consumed verbatim in Tasks 2-4; api method names match across tasks (`classTeacherAssignments` ≠ academics' `classAssessments`).
- **Known tradeoffs (demo bar):** teachers "recent" list is session-state only (no list endpoint); teacher names in the assignments table resolve via per-id `getTeacher` (fine at demo scale); `listUsers` failure degrades to an empty link-picker rather than an error.
