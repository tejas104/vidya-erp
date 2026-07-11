# Vidya → SaaS-ready college ERP — program spec

- **Date:** 2026-07-11
- **Status:** Program of record (owner-approved direction: "develop all other
  features close to Zoho-level, with licensing and security such that this
  project can also be developed as a SaaS product").
- **Baseline:** Layer 1 merged to `main` (analytics dashboard, app shell +
  design system, manage Areas A–D). See `2026-07-07-erp-roadmap.md`.

## Workstreams (each its own design→plan→build round)

### W1 — Student portal + real student auth  *(this round)*
Students become first-class sign-ins with **self-scoped** access:
- Platform: add `"student"` to `ROLES` (single source, `platform/src/auth/types.ts`).
- Identity: migration extends the `idn_user_roles_role_check` constraint;
  `grantInputSchema` rejects grants for `student` (self-scope only, never org
  grants — the identity **link** is the authority, mirroring teacher links).
- People: `ppl_students.identity_user_id` (opaque text, UNIQUE partial index)
  + `people.student-link-identity` (admin) mirroring the teacher link;
  `PeopleDirectory.studentByIdentityUser`.
- New **portal module** (`@vidya/module-portal`, no tables): three read-only
  routes gated `rolesAnyOf: ["student"]` that resolve the caller's linked
  student server-side and never accept a studentId param:
  `GET /api/v1/portal/me`, `GET /api/v1/portal/attendance?academicYear`,
  `GET /api/v1/portal/marks?academicYear` — composed from the public
  `PeopleDirectory` + `AcademicsReadModel` (no scope-checker changes; records
  are the student's own by construction).
- UI: `student` role in the web `Role` union; sidebar group **My studies** →
  `/portal` (profile, attendance % + monthly trend, marks by subject);
  `/manage/students` gains a **Link sign-in** action; seeder provisions
  `demo-student` linked to a seeded student.

### W2 — Licensing & entitlements *(next after W1)*
A `licensing` module making the product sellable both on-prem and SaaS:
- `lic_licenses`: signed license blobs (ed25519; verify offline for on-prem),
  fields: plan (`core|plus|enterprise`), seat limits (students/staff),
  feature flags, validUntil, collegeId.
- Enforcement at the composition seam: route specs gain an optional
  `feature` tag; `defineRoute` denies (403 `license-required`) when the
  active license lacks the feature or is expired; seat checks on
  student/teacher/user creation paths.
- Admin screen `/manage/license`: current plan, seats used/limit, expiry,
  paste-a-new-key flow. Grace period + read-only degradation on expiry.
- SaaS mode: the same verification, keys issued by a hosted control plane.

### W3 — SaaS/multi-tenancy hardening
`collegeId` is already pervasive (tenant == college; every table scoped, every
read through the ScopeChecker). To claim SaaS-grade isolation:
- Cross-tenant regression suite: for every route, a caller from college B must
  404/403 on college A's resources (extend the integration harness).
- Tenant provisioning: `bootstrapCollege` + first-admin flow exposed as a
  guarded operator API (stays CLI/control-plane only, never public).
- Ops posture: TLS termination + `SESSION_COOKIE_SECURE=true` in prod config,
  secrets from env/vault (no defaults in prod), per-tenant backup/restore
  runbook, audit-log retention policy.
- Later: per-tenant rate limits, optional 2FA for admin roles.

### W4 — Layer-2 feature modules (Zoho-completeness), in order
1. **Results/GPA**: credits + grading scale on subjects/assessment weights →
   GPA/CGPA computation, rank, grade-card PDF (reuses reporting).
2. **Fees**: fee heads, structures per class, invoices, payments, receipts,
   dues/defaulter views (feeds the at-risk surface).
3. **Timetable**: rooms, periods, weekly class/teacher grids, clash detection.
4. **Exams scheduling**: exam series built on the assessment taxonomy.
5. **Homework/assignments** (student submissions, grading → portal).
6. **QR attendance** (session QR + student scan via portal).
7. **Documents/certificates** (object storage + templated generation).

Every module follows the house rules: schema→endpoints (scope-checked,
audited)→UI in the shell; no new deps without an ADR; both themes; tests at
each layer.

## Sequencing
W1 now → W2 (licensing is cross-cutting; land before feature sprawl) → W4.1
Results → W4.2 Fees → W3 hardening pass → remaining W4 in order. Each round
ends demoable and merged.
