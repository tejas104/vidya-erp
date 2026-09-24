# Vidya school experience redesign

Started 2026-09-24. This is the product-wide UI direction requested by the
owner after N1, not a claim that every screen has been redesigned. Vidya is an
original product; reference products supply public signals about school jobs,
not layouts, copy, imagery, or assets to reproduce. Every feature below still
needs its own security, data, migration, and browser gates.

## Evidence and interpretation

| Source | Public signal | Vidya interpretation |
|---|---|---|
| [Alma solutions](https://www.getalma.com/solutions/) | [PUBLIC] Student information, enrollment history, attendance, academic records, fees, reporting, family access, and data administration are presented as connected school work. | [VIDYA] Keep the pupil record as the spine. A staff member should get from a class list, fee invoice, or report card to that record in one clear step. |
| [EdPlus](https://www.edpluss.com/) | [PUBLIC] Operational breadth includes student data, exams, homework, timetable, fees, recovery, and attendance; it presents separate admin, teacher, and family app roles. | [VIDYA] Design each role's first screen around its next action. Module coverage is a roadmap input, not evidence that our modules are complete. |
| [Vidyalaya School ERP](https://www.vidyalayaschoolsoftware.com/products-services/school-erp) and [portal](https://www.vidyalayaschoolsoftware.com/products-services/integration/online-portal) | [PUBLIC] School operations and parent or student information are joined in a portal, including attendance, results, and fees. | [VIDYA] Put each child's permitted information together in the family surface, with relationship checks on every category. |
| [Dribbble education sign-in search](https://dribbble.com/search/login-page-education) | [PUBLIC] Examples show varied split layouts, clear identity fields and friendly education cues. | [VIDYA] Use a single original staff-and-family sign-in with a calm story panel, accessible form and responsive one-column layout. No artwork or screen is copied. |

The public sites do not establish usability, implementation quality, or live
integration inside Vidya. Staff and parent validation remains unperformed.

## Current Vidya inventory

- The existing shell, role-gated navigation, semantic light/dark tokens, and
  `PageHeader`, `Table`, `Tabs`, `EmptyState`, `StatusBadge` primitives are real
  assets. N1 made Student 360 the first connected pupil record.
- Daily pages still mix explanatory copy, setup controls, and operational
  actions. Long rosters and ledgers use a table whose header claims sticky
  positioning but whose horizontal overflow wrapper has no vertical scroll
  boundary. At 40 px, its rows are tighter than the 44 px touch target rule.
- A screenshot and automated browser flow exist for Student 360. Comparable
  role-by-role visual evidence across the ERP does not yet exist. No broad
  aesthetic claim is made from a single screen.

## Experience contract

1. **A role begins with work.** Teacher: next class, attendance, marks and
   pupils needing help. Office: admissions, record corrections and documents.
   Accountant: dues, receipt, reconciliation and follow-up. Leadership:
   approvals, exceptions and trends. Family: choose a child, then see only
   published and relationship-authorized records.
2. **A pupil is one record.** Class, history, academic, attendance, finance,
   documents and family panels keep their independent authorization and states.
   A denied panel cannot make the permitted profile disappear.
3. **Data tools remain legible at school scale.** A class of 40–60 and a fee
   ledger of hundreds need stable headers, visible context, keyboard-usable
   scrolling, meaningful filters and safe exports. Empty, missing, loading,
   denied, error and stale data are different states.
4. **The action is visible.** One primary action per task surface, adjacent to
   its scope and current year. Destructive and irreversible actions show their
   consequence before submission. Success appears where work continues.
5. **The UI is calm and distinctive.** Retain Vidya's semantic tokens as the
   working baseline. A palette, type or shell rule may change after paired
   light/dark, desktop/mobile and contrast review; the earlier blanket ban on
   changing them is superseded. Avoid decorative density and vendor imitation.
6. **Mobile is a real workspace.** At 390 px, primary tasks, selected tabs and
   record identity remain visible; no document overflow or hidden-only action.
   Keyboard and screen reader semantics remain first-class on desktop.

## Shared component contract

| Primitive | Contract | Adoption |
|---|---|---|
| `PageHeader` | Record or task identity, concise context, one primary action and help; no daily-use tutorial prose. | Existing, refine with staff and parent journeys. |
| `Table` | Optional named bounded scroll region for long rosters/ledgers; sticky header within that region, keyboard focus, 44 px row minimum, readable column widths with a mobile swipe hint, numeric alignment and visible focus. | First use: student roster, accountant directory and invoice ledger. Filters and bulk actions follow as a separate slice. |
| `Tabs` | Selected panel and URL agree; the selected tab is visible when a narrow screen or deep link opens. | N1 Student 360; extend only when other pages need it. |
| `EmptyState` and `AsyncState` | Distinguish no records, not recorded, denied, error and loading; provide a retry or next step where useful. | Per vertical slice. |

Do not invent a general component until two concrete screens share its
behavior. Do not use color alone to convey a status. Server authorization and
tenant isolation are independent of visibility in the UI.

## Rollout and evidence

| Wave | Screens | Exit evidence |
|---|---|---|
| 1. Shared workbench foundation | Long tables, task headers, mobile navigation and state vocabulary. | Two or more real consumers for each new primitive; UI and browser checks at 390 px and desktop in both themes. |
| 2. Teaching day | Dashboard, Now, attendance, marks, class and pupil record. | A teacher completes attendance and marks from the next-class context with real persistence and scoped reads. |
| 3. Office and finance | Student roster, admissions, fee ledger, defaulters, documents, report-card desk. | High-volume tables, corrections and receipt flows verified with realistic fixtures and role permissions. |
| 4. Family | Child switcher, published report cards, attendance, fees, notices. | Two-child revocation and disclosure tests plus mobile browser journeys. |
| 5. SaaS operations | Owner control plane, provisioning, entitlements, support and restore status. | Phase 3 security and operations gates; no school fee/subscription ledger mix. |

For each screen, capture current and revised screenshots, verify keyboard
navigation, narrow and wide layouts, light and dark themes, and the relevant
real API/database path. A browser-local demonstration is labelled as such.

## 2026-09-24 login and staff revision

- One sign-in now accepts school staff, teachers, students and families. The
  server session selects the landing workspace; the old role-copy tabs are gone.
  The login uses an original editorial layout informed by public education
  login inspiration, without copying vendor layouts or assets.
- The old teacher add-only screen now has a college-scoped, searchable,
  paginated directory. Admins can update status, issue a one-time staff
  credential, link an eligible existing staff account, and assign a class.
  Server checks reject cross-school, guardian, student and duplicate links.
  A unique teacher-account index closes the concurrent duplicate case.
- School Results now leads through terms, marks and report cards, while the
  college credits and SGPA desk stays in college edition. School grade scales
  are retained for consistent term records.
- Attendance entry checks for an existing register for the selected section,
  date and period before allowing another save. The server remains the final
  authority for duplicate and scope checks.

The synthetic localhost fixture and isolated school browser suite verify these
paths. Staff acceptance, more legacy-screen redesign, licensing and hosting
remain separate work.

Before applying `people/0007_unique_teacher_identity` to an existing school,
inspect duplicate non-null `ppl_teachers.identity_user_id` values, resolve each
against staff records and derived grants, and take a database backup. Apply in
a maintenance window: the ordinary unique-index build briefly locks writes;
the migration uses a five-second lock timeout and rolls back on contention or
duplicate data. The paired down migration restores the prior non-unique index.
