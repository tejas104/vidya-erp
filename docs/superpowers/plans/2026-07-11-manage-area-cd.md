# Manage UI — Areas C + D (identity admin, import, reports inbox) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the operable-core spec: `/manage/users` (create users, roles, scope grants, reset tokens), `/manage/import` (CSV bulk import with dry-run + polling), `/manage/reports` (the caller's report history + scoped downloads).

**Architecture:** Same shape as Area B: typed `api.ts` methods over existing identity/people/reporting endpoints, three new icons + nav entries, three client pages composed from the kit. No new backend.

**Tech Stack:** Next.js 16 client components, hand-rolled kit, Vitest + RTL, Playwright driver.

## Global Constraints

- **No new backend, no new dependencies.** Demo-impact bar. Admin-only for users/import; reports for all roles.
- **Identity endpoint facts:** `POST /api/v1/identity/users {username, displayName, collegeId, temporaryPassword, roles[]}` → 201 userView; `GET /users?collegeId&limit=200` → `{users}`; `PATCH /users/{id} {displayName?|status: "active"|"disabled"}`; `PUT /users/{id}/roles {roles[]}` (cascades grant removal, invalidates sessions); `POST /users/{id}/grants {role, collegeId, departmentId?, classId?, sectionId?, subjectId?}` → 201 grantView, **409 when the user doesn't hold the role**; grant rules: teacher→classId+subjectId required (classId requires departmentId), class_teacher→classId, no subject; hod→departmentId only; principal/admin→college-wide only; `DELETE /users/{id}/grants/{grantId}`; `POST /grants/verify` → `{verified, unresolved:[{grantId,reason}]}`; `POST /users/{id}/password-reset` → 201 `{token, expiresAt}` (shown once, never logged).
- `userView = {id, username, displayName, status: active|disabled|must_reset, collegeId, roles, grants: grantView[], createdAt}`; `grantView = {id, role, collegeId, departmentId|null, classId|null, sectionId|null, subjectId|null, verified, source: manual|derived}`.
- **Import facts:** `POST /api/v1/people/imports {kind: students|teachers, collegeId, academicYear?, dryRun (default false), csv (string ≤1MB)}` → 202 `{importId}`; poll `GET /imports/{id}` → `{id, kind, collegeId, status: pending|running|completed|failed, dryRun, totalRows, okRows, errorRows, errors:[{row,message}]}`. CSV columns — students: `admission_no, full_name` (+ optional `department_code, class_code, section_name`, which require `academicYear`); teachers: `staff_no, full_name`. Runs in the worker.
- **Reports facts:** `GET /api/v1/reports?limit=25` → `{reports:[{id, kind, format, academicYear, status, rows, error, createdAt}]}`; download via existing `api.downloadUrl(id)` (server re-scope-checks).
- Kit contracts as Area B. Grant org pickers reuse `api.collegeTree`.

---

## Task 1: Foundation — icons, nav entries, api methods

**Files:** Modify `apps/web/src/ui/Icon.tsx` (icons `key`, `upload`, `file`), `apps/web/src/ui/navConfig.ts` (Users+Import in Administration for admin; Reports group for all), `apps/web/src/ui/api.ts` (extend `ReportView` with `academicYear`/`createdAt`; add `GrantView`, `ImportView` types; methods `createUser, updateUser, setUserRoles, addGrant, removeGrant, verifyGrants, passwordResetInit, createImport, getImport, listReports`). Test: extend `apps/web/src/ui/api-people.test.tsx` (createUser POST body; createImport POST body) + `shell.test.tsx` admin case gains Users/Import/Reports.

Method signatures:
```ts
createUser: (body: { username: string; displayName: string; collegeId: string; temporaryPassword: string; roles: Role[] }) => post<UserView>("/api/v1/identity/users", body)
updateUser: (userId: string, body: { displayName?: string; status?: "active" | "disabled" }) => patch<UserView>(...)
setUserRoles: (userId: string, roles: Role[]) => put<{ roles: Role[] }>(`/api/v1/identity/users/${id}/roles`, { roles })
addGrant: (userId: string, body: GrantInput) => post<GrantView>(`.../grants`, body)   // GrantInput = { role: Role; collegeId: string; departmentId?; classId?; sectionId?; subjectId? }
removeGrant: (userId: string, grantId: string) => del<{ ok: true }>(`.../grants/${grantId}`)
verifyGrants: () => post<{ verified: number; unresolved: { grantId: string; reason: string }[] }>("/api/v1/identity/grants/verify", {})
passwordResetInit: (userId: string) => post<{ token: string; expiresAt: string }>(`.../password-reset`, {})
createImport: (body: { kind: "students" | "teachers"; collegeId: string; academicYear?: string; dryRun: boolean; csv: string }) => post<{ importId: string }>("/api/v1/people/imports", body)
getImport: (importId: string) => get<ImportView>(`/api/v1/people/imports/${id}`)
listReports: (limit = 25) => get<{ reports: ReportView[] }>(`/api/v1/reports?limit=${limit}`)
```
`UserView` gains `grants: GrantView[]`, `collegeId`, `createdAt` (extend the existing minimal one). Commit: `feat(web): Areas C+D foundation — nav, icons, identity/import/report api client`.

## Task 2: `/manage/users`

Create `apps/web/app/(app)/manage/users/page.tsx` + test `users-page.test.tsx`. Structure: `DataTable<UserView>` (username, displayName, roles chips, status Badge, grants count) loaded from `listUsers(collegeId)` (college from `api.colleges()[0]`); header actions: **New user** (Modal: username/displayName/temporaryPassword/roles checkboxes → `createUser`, toast "created in must_reset status") and **Verify grants** (→ `verifyGrants`, toast counts). Row actions: **Roles** (Modal, checkboxes → `setUserRoles`, warns it invalidates sessions), **Grants** (Modal listing user's grants — role + scope path names via tree lookup + verified/source badges — each with Remove; plus an add-grant form: role select, conditional selects department/class/subject driven by the grant rules, submit → `addGrant`, 409 surfaces via toast), **Reset password** (→ `passwordResetInit`, then a Modal showing the one-time token + expiry with "copy it now" copy), **Disable/Enable** (`updateUser`). Tests: renders user list; createUser posts the right body. Commit: `feat(web): /manage/users — users, roles, grants, reset tokens`.

## Task 3: `/manage/import`

Create `apps/web/app/(app)/manage/import/page.tsx` + test `import-page.test.tsx`. Structure: kind select (students/teachers), academicYear input (prefilled `currentAcademicYear()`, only relevant for students-with-enrollment), dryRun checkbox (default ON), CSV textarea + a file `<input type="file" accept=".csv">` that reads into the textarea via `FileReader`, column-format hint text per kind, submit → `createImport` → poll `getImport` every 1s (cap 30s) until `completed|failed` → result Card (status Badge, total/ok/error counts) + errors `DataTable` (`row`, `message`) when `errorRows > 0`. Tests: submit posts `{kind, collegeId, dryRun, csv}`; poll reaching `completed` renders counts. Commit: `feat(web): /manage/import — CSV bulk import with dry-run + polling`.

## Task 4: `/manage/reports`

Create `apps/web/app/(app)/manage/reports/page.tsx` + test `reports-page.test.tsx`. Structure: `listReports(50)` → `DataTable<ReportView>` (kind, format badge, academicYear, status badge — `failed` shows `error` title attr, rows, createdAt via `toLocaleString`, Download link `api.downloadUrl(id)` only when completed) + empty state ("Reports you request appear here — try Download report on a student page."). Refresh button. Tests: lists rows; completed row has a download href. Commit: `feat(web): /manage/reports — report history inbox`.

## Task 5: Live verification

Restart the worker first (it predates the pgErrorCode fix). Playwright as `demo-admin`: (1) `/manage/users` — list renders; create user `pw.user.<stamp>` with role `hod`; open Grants → add an hod grant on a department; Reset password → token modal appears (screenshot, don't log the token elsewhere); (2) `/manage/import` — dry-run a 2-row students CSV (`admission_no,full_name` plus enroll columns for CSE/FYCS/A), poll to completed, expect `okRows: 2, errorRows: 0`; then a wet run and confirm the roster grew (API check); include one bad row in a second dry-run to see the errors table; (3) as `demo-ct-fycs`: generate a student PDF (existing ReportButton), then `/manage/reports` shows it completed with a working download. Screenshot each; console clean; DB spot-checks.

## Self-Review
Spec Phase 3 (users/roles/grants/reset) → Task 2; Phase 4 (import wizard, reports inbox) → Tasks 3-4; nav → Task 1; verification → Task 5. Grant-rule conditionality mirrored client-side but server remains authority (409/422 toasts). No placeholders; types named consistently (`GrantView`, `ImportView`, extended `ReportView`/`UserView`).
