# Teacher Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give teacher records profile depth (phone/email/designation/qualification/dob/date_of_joining/about) and let a linked teacher view + edit their own profile, plus admin edit any teacher's depth.

**Architecture:** Mirror student 2.5 profile depth. New nullable columns on `ppl_teachers`; a `teacherProfilePatchSchema`; two self-scoped `/teachers/me` routes (GET + PATCH) that resolve the caller's own record via the existing `findTeacherByIdentityUser(principal.id)` — self-authorizing by construction, so the human-owned ScopeChecker stays byte-identical (Approach A); and an extension of the existing admin `PATCH /teachers/{id}` to accept the same profile fields. A "My profile" page for staff and an admin Edit-profile modal.

**Tech Stack:** TypeScript strict, Next.js App Router (`apps/web`), `@vidya/module-people`, Drizzle/Postgres, Zod, vitest (unit/ui/integration projects), pnpm.

## Global Constraints

- Ponytail: smallest change that fully works; reuse before build; **no new runtime deps** (ADR-0009).
- Real endpoints only; honest empty/404/error states. Five states per screen.
- Both themes from tokens; `:focus-visible`; respect `prefers-reduced-motion`.
- ScopeChecker (`packages/modules/identity/src/core/scope-checker.ts`) and the grant matrix are **not touched** in this plan (Approach A). If any task finds it must, STOP and flag the owner.
- All new profile columns are **nullable**; `staffNo`/`fullName`/`status`/`identityUserId` are never in the teacher-editable (`/me`) patch.
- After any route change: `pnpm openapi:generate`. Build check: `pnpm --filter @vidya/web build`.
- Test env vars (bash) for integration/seed are in `docs/NEXT-SESSION.md`.
- Fields (exact names): `phone`, `email`, `designation`, `qualification`, `dob`, `dateOfJoining` (`date_of_joining`), `about`.

---

### Task 1: Data layer — migration, drizzle schema, repo + service

**Files:**
- Create: `packages/modules/people/migrations/0005_teacher_profile.sql`
- Create: `packages/modules/people/migrations/0005_teacher_profile.down.sql`
- Modify: `packages/modules/people/src/db/schema.ts:110-124` (the `pplTeachers` table)
- Modify: `packages/modules/people/src/repo/people-repo.ts` (interface ~line 110-113, `updateTeacher` ~line 327-339)
- Modify: `packages/modules/people/src/service/people-service.ts` (`updateTeacher` ~148-153; add `findTeacherByIdentityUser` passthrough near `findStudentByIdentityUser`)

**Interfaces:**
- Produces: `PplTeacherRow` now carries `phone/email/designation/qualification/dob/dateOfJoining/about` (all `string | null`). Repo `updateTeacher(id, patch)` and `PeopleService.updateTeacher(id, patch)` accept those fields. `PeopleService.findTeacherByIdentityUser(identityUserId): Promise<PplTeacherRow | null>`.

- [ ] **Step 1: Write the migration SQL**

`0005_teacher_profile.sql`:
```sql
-- Module: people — teacher profile depth. Contact + academic identity.
-- Nullable; existing rows keep NULL until filled.

ALTER TABLE ppl_teachers ADD COLUMN phone text;
ALTER TABLE ppl_teachers ADD COLUMN email text;
ALTER TABLE ppl_teachers ADD COLUMN designation text;
ALTER TABLE ppl_teachers ADD COLUMN qualification text;
ALTER TABLE ppl_teachers ADD COLUMN dob date;
ALTER TABLE ppl_teachers ADD COLUMN date_of_joining date;
ALTER TABLE ppl_teachers ADD COLUMN about text;
```

`0005_teacher_profile.down.sql`:
```sql
ALTER TABLE ppl_teachers DROP COLUMN about;
ALTER TABLE ppl_teachers DROP COLUMN date_of_joining;
ALTER TABLE ppl_teachers DROP COLUMN dob;
ALTER TABLE ppl_teachers DROP COLUMN qualification;
ALTER TABLE ppl_teachers DROP COLUMN designation;
ALTER TABLE ppl_teachers DROP COLUMN email;
ALTER TABLE ppl_teachers DROP COLUMN phone;
```

- [ ] **Step 2: Add columns to the drizzle `pplTeachers` table**

In `schema.ts`, inside `pplTeachers` after the `status` line (before `identityUserId`):
```ts
  /** Profile depth: contact + academic identity, teacher-editable via /me. */
  phone: text("phone"),
  email: text("email"),
  designation: text("designation"),
  qualification: text("qualification"),
  dob: date("dob", { mode: "string" }),
  dateOfJoining: date("date_of_joining", { mode: "string" }),
  about: text("about"),
```
(`date` is already imported.)

- [ ] **Step 3: Extend the repo `updateTeacher` patch type + set-clause**

In `people-repo.ts`, the `PeopleRepo` interface `updateTeacher` signature (~line 111-114) — widen the patch:
```ts
  updateTeacher(
    id: string,
    patch: {
      fullName?: string;
      status?: PersonStatus;
      identityUserId?: string | null;
      phone?: string | null;
      email?: string | null;
      designation?: string | null;
      qualification?: string | null;
      dob?: string | null;
      dateOfJoining?: string | null;
      about?: string | null;
    },
  ): Promise<PplTeacherRow | null>;
```
And in the implementation `.set({...})` (~line 330-334) append, after the `identityUserId` spread line:
```ts
          ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
          ...(patch.email !== undefined ? { email: patch.email } : {}),
          ...(patch.designation !== undefined ? { designation: patch.designation } : {}),
          ...(patch.qualification !== undefined ? { qualification: patch.qualification } : {}),
          ...(patch.dob !== undefined ? { dob: patch.dob } : {}),
          ...(patch.dateOfJoining !== undefined ? { dateOfJoining: patch.dateOfJoining } : {}),
          ...(patch.about !== undefined ? { about: patch.about } : {}),
```

- [ ] **Step 4: Widen the service `updateTeacher` + add `findTeacherByIdentityUser`**

In `people-service.ts`, change `updateTeacher` (~148-153) patch type to match the repo's (copy the same field list as Step 3). Then add a passthrough near `findStudentByIdentityUser`:
```ts
  findTeacherByIdentityUser(identityUserId: string): Promise<PplTeacherRow | null> {
    return this.deps.repo.findTeacherByIdentityUser(identityUserId);
  }
```
(`PplTeacherRow` is already imported in this file.)

- [ ] **Step 5: Typecheck + run people unit tests**

Run: `npx vitest run --project unit packages/modules/people`
Expected: PASS (existing teacher tests still green; no behavior change yet).

- [ ] **Step 6: Apply the migration against the live dev DB**

Run (bash, env from NEXT-SESSION.md exported): `npx tsx scripts/migrate.ts up`
Expected: `0005_teacher_profile` applied. Confirm: `psql "$DATABASE_URL" -c '\d ppl_teachers'` shows the 7 new columns.

- [ ] **Step 7: Commit**

```bash
git add packages/modules/people/migrations/0005_teacher_profile.sql \
  packages/modules/people/migrations/0005_teacher_profile.down.sql \
  packages/modules/people/src/db/schema.ts \
  packages/modules/people/src/repo/people-repo.ts \
  packages/modules/people/src/service/people-service.ts
git commit -m "feat(people): teacher profile columns + repo/service (data layer)"
```

---

### Task 2: API definition — schemas + routes

**Files:**
- Modify: `packages/modules/people/src/definition.ts` (schemas ~63-71 & ~111-118; teacher-update body ~527-534; add two new route objects near the teacher routes ~504-540)

**Interfaces:**
- Consumes: `phoneSchema`, `dobSchema`, `nameSchema`, `idSchema`, `ANY_AUTHENTICATED`, `ADMIN_ONLY`, `problemSchema` (all already in this file).
- Produces: `teacherProfilePatchSchema`; `emailSchema`; extended `teacherViewSchema` (7 new fields); route ids `people.teacher-me-get`, `people.teacher-me-update`; extended `people.teacher-update` body.

- [ ] **Step 1: Add `emailSchema` + `teacherProfilePatchSchema`**

Near `phoneSchema`/`dobSchema` (~63-71):
```ts
export const emailSchema = z.string().trim().email().max(160);
export const teacherProfilePatchSchema = z.object({
  phone: phoneSchema.nullable().optional(),
  email: emailSchema.nullable().optional(),
  designation: z.string().trim().min(1).max(80).nullable().optional(),
  qualification: z.string().trim().min(1).max(120).nullable().optional(),
  dob: dobSchema.nullable().optional(),
  dateOfJoining: dobSchema.nullable().optional(),
  about: z.string().trim().max(1000).nullable().optional(),
});
```

- [ ] **Step 2: Extend `teacherViewSchema`**

Replace the `teacherViewSchema` object (~111-118) with:
```ts
export const teacherViewSchema = z.object({
  id: z.string(),
  collegeId: z.string(),
  staffNo: z.string(),
  fullName: z.string(),
  status: z.enum(["active", "inactive"]),
  identityUserId: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  designation: z.string().nullable(),
  qualification: z.string().nullable(),
  dob: z.string().nullable(),
  dateOfJoining: z.string().nullable(),
  about: z.string().nullable(),
});
```

- [ ] **Step 3: Extend the admin `teacher-update` body**

In the `people.teacher-update` route (~529-533), change the body to merge the profile patch:
```ts
      body: z
        .object({ fullName: nameSchema.optional(), status: z.enum(["active", "inactive"]).optional() })
        .merge(teacherProfilePatchSchema)
        .refine((patch) => Object.values(patch).some((v) => v !== undefined), {
          message: "at least one field required",
        }),
```

- [ ] **Step 4: Add the two `/me` route objects**

Insert immediately AFTER the `people.teacher-get` route object (before `people.teacher-update`):
```ts
  {
    id: "people.teacher-me-get",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/people/teachers/me",
    summary: "Read my own teacher profile (self, via identity link)",
    description:
      "Resolves the caller's own teacher record from their identity link. 404 when no staff record is linked to the signed-in account. Self by construction — no scope grant is consulted.",
    tags: ["people-teachers"],
    auth: ANY_AUTHENTICATED,
    request: {},
    responses: {
      200: { description: "My teacher record", schema: teacherViewSchema },
      404: { description: "No teacher record linked to this account", schema: problemSchema },
    },
  },
  {
    id: "people.teacher-me-update",
    module: MODULE_NAME,
    method: "PATCH",
    path: "/api/v1/people/teachers/me",
    summary: "Edit my own teacher profile (self, via identity link)",
    description:
      "A linked teacher edits their own contact/academic profile fields. Cannot change name, status or staff number. Self by construction — no scope grant is consulted.",
    tags: ["people-teachers"],
    auth: ANY_AUTHENTICATED,
    request: {
      body: teacherProfilePatchSchema.refine(
        (patch) => Object.values(patch).some((v) => v !== undefined),
        { message: "at least one field required" },
      ),
    },
    audit: { action: "people.teacher-updated", resourceType: "teacher" },
    responses: {
      200: { description: "Updated", schema: teacherViewSchema },
      404: { description: "No teacher record linked to this account", schema: problemSchema },
    },
  },
```

> **Route ordering note:** the literal `/teachers/me` paths are registered as their own
> Next.js route folder (`teachers/me/route.ts` in Task 3), which Next matches before the
> dynamic `[teacherId]` segment — so `me` never falls through to `teacher-get`. No change
> needed to existing routes.

- [ ] **Step 5: Typecheck**

Run: `npx vitest run --project unit packages/modules/people/src/definition.test.ts`
Expected: PASS (or update `definition.test.ts` if it snapshots the route count — bump the expected count by 2 and assert the two new ids exist).

- [ ] **Step 6: Commit**

```bash
git add packages/modules/people/src/definition.ts packages/modules/people/src/definition.test.ts
git commit -m "feat(people): teacher-profile schemas + /teachers/me routes (definition)"
```

---

### Task 3: Handlers — teacherView, self routes, admin extend, wiring

**Files:**
- Modify: `packages/modules/people/src/api/handlers.ts` (`teacherView` ~86-93; `teacherUpdate` ~652-689; add `teacherMeGet` + `teacherMeUpdate`; register in the handler map ~1053-1055)
- Modify: `packages/modules/people/src/api/handlers.test.ts` (add cases)
- Create: `apps/web/app/api/v1/people/teachers/me/route.ts`

**Interfaces:**
- Consumes: `deps.people.findTeacherByIdentityUser`, `deps.people.updateTeacher` (Task 1); `teacherProfilePatchSchema` shape (Task 2); `ctx.principal.id`.
- Produces: handlers registered under ids `people.teacher-me-get`, `people.teacher-me-update`; `teacherView()` returns the 7 new fields.

- [ ] **Step 1: Write failing handler tests**

In `handlers.test.ts`, add (mirror existing teacher handler test setup in that file):
```ts
it("teacher-me-get returns the caller's own record, 404 when unlinked", async () => {
  // caller principal.id === a teacher's identityUserId → 200 with that teacher
  // caller principal.id with no teacher link → 404
});
it("teacher-me-update patches only profile fields on the caller's own record", async () => {
  // PATCH { phone, designation } → 200, row updated; fullName/status untouched
  // unlinked caller → 404
});
it("admin teacher-update accepts profile fields", async () => {
  // PATCH /teachers/{id} { qualification } as admin → 200, row updated
});
```
Fill these with the concrete harness the file already uses (fake repo + principal builder). Assert `updated.phone` / `updated.designation` etc.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project unit packages/modules/people/src/api/handlers.test.ts`
Expected: FAIL (handlers not defined / fields missing).

- [ ] **Step 3: Extend `teacherView()`**

Replace the `teacherView` return object (~87-93) to include the new fields:
```ts
  return {
    id: teacher.id,
    collegeId: teacher.collegeId,
    staffNo: teacher.staffNo,
    fullName: teacher.fullName,
    status: teacher.status,
    identityUserId: teacher.identityUserId,
    phone: teacher.phone,
    email: teacher.email,
    designation: teacher.designation,
    qualification: teacher.qualification,
    dob: teacher.dob,
    dateOfJoining: teacher.dateOfJoining,
    about: teacher.about,
  };
```

- [ ] **Step 4: Extend `teacherUpdate` to pass profile fields**

The admin `teacherUpdate` handler (~652) types the body narrowly and passes it straight to `updateTeacher`. Widen the body type and pass-through:
```ts
    const body = ctx.request.body as {
      fullName?: string;
      status?: "active" | "inactive";
      phone?: string | null;
      email?: string | null;
      designation?: string | null;
      qualification?: string | null;
      dob?: string | null;
      dateOfJoining?: string | null;
      about?: string | null;
    };
```
The existing `await deps.people.updateTeacher(params.teacherId, body)` now carries the profile fields unchanged. Leave the grant-resync block as-is (keyed on `body.status`).

- [ ] **Step 5: Add the two self handlers**

After `teacherUpdate` (before `teacherLinkIdentity`):
```ts
  const teacherMeGet: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const teacher = await deps.people.findTeacherByIdentityUser(principal.id);
    if (teacher === null) {
      return notFound();
    }
    return { status: 200, body: teacherView(teacher) };
  };

  const teacherMeUpdate: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const body = ctx.request.body as {
      phone?: string | null;
      email?: string | null;
      designation?: string | null;
      qualification?: string | null;
      dob?: string | null;
      dateOfJoining?: string | null;
      about?: string | null;
    };
    const teacher = await deps.people.findTeacherByIdentityUser(principal.id);
    if (teacher === null) {
      return notFound();
    }
    const updated = await deps.people.updateTeacher(teacher.id, body);
    if (updated === null) {
      return notFound();
    }
    return {
      status: 200,
      body: teacherView(updated),
      audit: {
        resourceId: updated.id,
        details: { self: true, fields: Object.keys(body) },
      },
    };
  };
```

- [ ] **Step 6: Register the handlers**

In the handler map (near `"people.teacher-update": teacherUpdate,`):
```ts
    "people.teacher-me-get": teacherMeGet,
    "people.teacher-me-update": teacherMeUpdate,
```

- [ ] **Step 7: Add the web route file**

`apps/web/app/api/v1/people/teachers/me/route.ts`:
```ts
import { routeHandler } from "@/composition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = routeHandler("people.teacher-me-get");
export const PATCH = routeHandler("people.teacher-me-update");
```

- [ ] **Step 8: Run handler tests to verify pass**

Run: `npx vitest run --project unit packages/modules/people/src/api/handlers.test.ts`
Expected: PASS.

- [ ] **Step 9: Regenerate the OpenAPI client**

Run: `pnpm openapi:generate`
Expected: the generated spec now lists `/api/v1/people/teachers/me` GET + PATCH. Commit the regenerated artifact with this task.

- [ ] **Step 10: Commit**

```bash
git add packages/modules/people/src/api/handlers.ts \
  packages/modules/people/src/api/handlers.test.ts \
  apps/web/app/api/v1/people/teachers/me/route.ts \
  <regenerated openapi files>
git commit -m "feat(people): /teachers/me self view+edit handlers + admin profile fields"
```

---

### Task 4: Web API client

**Files:**
- Modify: `apps/web/src/ui/api.ts` (`TeacherView` ~223-226; teacher client fns ~666-673)

**Interfaces:**
- Produces: `TeacherView` with 7 new nullable fields; `api.getMyTeacher()`, `api.updateMyTeacher(patch)`, `api.updateTeacher(teacherId, patch)`.

- [ ] **Step 1: Extend `TeacherView`**

```ts
export interface TeacherView {
  id: string; collegeId: string; staffNo: string; fullName: string;
  status: "active" | "inactive"; identityUserId: string | null;
  phone: string | null; email: string | null; designation: string | null;
  qualification: string | null; dob: string | null; dateOfJoining: string | null;
  about: string | null;
}
export type TeacherProfilePatch = Partial<
  Pick<TeacherView, "phone" | "email" | "designation" | "qualification" | "dob" | "dateOfJoining" | "about">
>;
```

- [ ] **Step 2: Add client functions** (near the other teacher fns ~666-673)

```ts
  getMyTeacher: () => get<TeacherView>("/api/v1/people/teachers/me"),
  updateMyTeacher: (patch: TeacherProfilePatch) =>
    patch<TeacherView>("/api/v1/people/teachers/me", patch),
  updateTeacher: (teacherId: string, body: TeacherProfilePatch & { fullName?: string; status?: "active" | "inactive" }) =>
    patch<TeacherView>(`/api/v1/people/teachers/${encodeURIComponent(teacherId)}`, body),
```
(Confirm the local PATCH helper name — the file already imports one; the students code uses it for `patch<...>`. If it is named differently, match the existing usage in this file.)

- [ ] **Step 3: Typecheck the web package**

Run: `pnpm --filter @vidya/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/ui/api.ts
git commit -m "feat(web): teacher-profile api client (getMyTeacher/updateMyTeacher/updateTeacher)"
```

---

### Task 5: "My profile" page + nav

**Files:**
- Create: `apps/web/app/(app)/manage/profile/page.tsx`
- Modify: `apps/web/src/ui/navConfig.ts` (add an entry near line 43)

**Interfaces:**
- Consumes: `api.getMyTeacher`, `api.updateMyTeacher`, `TeacherView`, `TeacherProfilePatch`, existing UI kit (`PageHeader`, `Card`, `Field`, `Button`, `EmptyState`, `Skeleton`, `useToast`).

- [ ] **Step 1: Add the nav entry**

In `navConfig.ts`, add (mirroring the existing shape/icon set — reuse an existing icon such as `"students"` or `"file"`):
```ts
  { href: "/manage/profile", label: "My profile", icon: "students", group: "Teaching", roles: ["teacher", "class_teacher", "hod"] },
```

- [ ] **Step 2: Build the page (client component, five states)**

`apps/web/app/(app)/manage/profile/page.tsx` — `"use client"`, `export const dynamic = "force-dynamic";`. On mount call `api.getMyTeacher()`:
- **loading** → `<Skeleton lines={6} />`
- **404 (ApiError status 404)** → `<EmptyState title="No staff profile is linked to your account." message="Ask an administrator to link your sign-in to a teacher record." />`
- **other error** → `<EmptyState title="Couldn't load your profile." message="Try again shortly." />`
- **loaded** → header (name + staffNo read-only) + a `<Card>` form with `Field`s: phone (`type="tel"`), email (`type="email"`), designation, qualification, dob (`type="date"`), dateOfJoining (`type="date"`), about (`<textarea>`). A Save button calls `api.updateMyTeacher(patch)` sending only changed fields (empty string → send `null` to clear), toast on success, disabled while saving.
- **empty** (all fields null) is just the form pre-filled blank — the same view, no special branch.

Keep styling to existing tokens/kit; both themes, `:focus-visible`, reduced-motion inherited from globals.

- [ ] **Step 3: Manual/dev smoke**

Run `pnpm dev` (+ worker not needed here). Log in as a linked teacher (see SETUP.md demo logins), open `/manage/profile`, save a phone/designation, reload → persisted. Log in as a user with no teacher record → 404 empty state. (Owner is the eyes for visual sign-off.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/(app)/manage/profile/page.tsx apps/web/src/ui/navConfig.ts
git commit -m "feat(web): teacher My-profile page (self view + edit) + nav entry"
```

---

### Task 6: Admin Edit-profile modal on /manage/teachers

**Files:**
- Modify: `apps/web/app/(app)/manage/teachers/page.tsx` (the recent-teachers list ~229-244; add a modal + state)

**Interfaces:**
- Consumes: `api.updateTeacher(id, patch)`, `TeacherView`, existing `Modal`/`Field`/`Button`.

- [ ] **Step 1: Add an "Edit profile" action + modal**

Add state `const [editing, setEditing] = useState<TeacherView | null>(null);` and per-row form fields. On each recent-teacher row (~237-240) add a `<Button variant="ghost" onClick={() => setEditing(teacher)}>Edit profile</Button>`. Add a `<Modal open={editing !== null} …>` with the 7 profile `Field`s (+ optional fullName/status), calling `api.updateTeacher(editing.id, patch)`, updating `recent` on success, toast, close.

> Note: the current page only holds newly-added teachers in `recent` (no full teacher list endpoint). Edit-profile therefore applies to teachers added/edited in this session — consistent with the page's existing behavior. A full teacher roster is out of scope (not requested).

- [ ] **Step 2: Typecheck + UI test**

Add/extend a UI test under the teachers page test (if one exists) asserting the modal opens and calls `updateTeacher`. Run: `npx vitest run --project ui apps/web` (scope to the teachers page test file).
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/(app)/manage/teachers/page.tsx <ui test>
git commit -m "feat(web): admin edit-profile modal on the teachers page"
```

---

### Task 7: Seed backfill + integration verify

**Files:**
- Modify: `scripts/seed-demo.ts` (where teachers are created)

**Interfaces:**
- Consumes: the widened `createTeacher`/`updateTeacher` (or a direct insert with the new columns).

- [ ] **Step 1: Backfill seeded teachers with realistic profile data**

After each seeded teacher is created, set profile fields (phone, email, designation e.g. "Assistant Professor"/"Associate Professor", qualification e.g. "M.Sc, Ph.D", dob, dateOfJoining, a one-line about). Use `updateTeacher(id, {...})` or extend the insert. Keep it India-realistic (matches existing seed tone).

- [ ] **Step 2: Reseed + integration test**

Run (bash, env exported):
```
# drop public schema, then:
npx tsx scripts/migrate.ts up
VIDYA_ALLOW_DEMO_SEED=true npx tsx scripts/seed-demo.ts
```
Then a people integration test asserting: a linked teacher GET `/teachers/me` returns their seeded profile; PATCH updates a field; an unlinked identity gets 404.
Run: `INTEGRATION_RESET_DB=true npx vitest run --project integration --no-file-parallelism people`
Expected: PASS.

- [ ] **Step 3: Full test sweep + build**

Run:
```
npx vitest run --project unit --project ui
pnpm --filter @vidya/web build
```
Expected: all green (unit/ui count ≥ prior 685 + new tests; build clean).

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-demo.ts <integration test>
git commit -m "feat(people): seed teacher profiles + integration coverage"
```

---

## Self-review notes
- **Spec coverage:** fields (T1–T2), migration (T1), `teacherProfilePatchSchema`/`emailSchema`/view (T2), 3 endpoints incl. admin extend (T2–T3), Approach A no-ScopeChecker-change (T3 `/me` handlers, explicit constraint), `/manage/profile` + five states + nav (T5), admin modal (T6), api.ts (T4), testing unit/ui/integration (T1–T3,T6,T7), seed (T7). Photo/other-staff-view explicitly out of scope.
- **Auth:** no task edits `scope-checker.ts` or the grant matrix; the `/me` handlers resolve own-record from `principal.id`. The policy flag for the owner is recorded in the design spec; add a one-line note to the conformance matrix doc if the owner requests during review.
- **Type consistency:** `dateOfJoining` (camel) ↔ `date_of_joining` (snake) used consistently; `TeacherProfilePatch` fields match `teacherProfilePatchSchema` keys and repo/service patch fields.
