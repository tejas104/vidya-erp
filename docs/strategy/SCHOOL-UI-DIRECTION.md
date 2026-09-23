# Vidya school UI direction

Written 2026-09-23, against the running application rather than from
imagination: the current shell, navigation and admin home were inspected in a
browser before any of this was decided.

## The constraint this works within

The owner's standing requirement is to **preserve and polish** the current
layout and design system, evolving it incrementally — not to replace the shell
with a generic dashboard template. That constraint is correct, and inspection
confirms why: `packages/ui-system/src/tokens.css` is already a mature system.

- Semantic tokens throughout (`--ink`, `--rule`, `--good/warn/bad` each with a
  `-soft` pair), so meaning survives theming.
- A real light/dark derivation in the same cool-navy family, with the
  `--on-brand` contrast decision reasoned in a comment (~4.9:1 vs ~3.6:1).
- A fixed type scale and a 4px-based spacing scale, both **CI-enforced**:
  `check-no-adhoc-hex.mjs` and `check-scale.mjs` fail the build on ad-hoc
  values.
- An explicit rule that **gradients are structural only** (hero, active nav,
  avatars, ring arcs) and never a surface fill.

So this document is not a new design system. There is nothing here about
picking a palette or a typeface; those decisions are made, they are good, and
re-making them would be churn. What follows is about **structure, ordering and
density** — the things that are actually wrong.

## What is actually wrong (observed, not assumed)

Signed in as an administrator on the running instance:

1. **The home page leads with reading material.** Order was: a paragraph
   explaining scoping → the noticeboard (5 notices) → *then* "1 leave request
   waiting", the KPIs, and the 7 at-risk pupils. The decisions were below the
   fold, under five notices that do not change.
2. **The lede explains the product to a daily user.** "Every figure here is
   drawn only from records you're allowed to read…" is onboarding copy. A
   clerk who opens this every morning reads it several hundred times a year and
   acts on it zero times. The help article already carries the full
   explanation.
3. **Navigation is module-shaped, not job-shaped.** The rail groups by owning
   module — PEOPLE, ACADEMICS, FEES, COMMUNICATION, REPORTS, ANALYTICS,
   ADMINISTRATION — with three single-item groups. It does not separate
   **setup** (done once a year) from **daily operations** (done every day) from
   **review**.
4. **Inline style objects are scattered through the page components**
   (`style={{ display: "flex", … }}`, hardcoded `padding: "9px 0"`). These slip
   past the scale check because it inspects CSS, not JSX, so the design system
   is enforced everywhere except where it is most often broken.

## Principles

1. **Order is the design.** On any screen opened daily, what needs a decision
   comes before what needs reading. Reference material goes last, not first.
2. **Say the number, not the caveat.** Copy that explains how the system works
   belongs in help. Copy on the screen should carry information that changes
   day to day.
3. **Missing is a value.** Never render an unknown as `0`, `—` or a blank. The
   report-card work established "Not recorded"; that vocabulary is now the
   house style for every figure that can be absent.
4. **Density with air.** School staff work in rosters of 40–60. Tables should
   be dense and scannable, but a dense table still needs a 44×44px touch
   target on the row action — density is about information, not about shrinking
   hit areas.
5. **Evolve the shell.** New structure is expressed with the existing tokens,
   the existing `Card`/`Table`/`PageHeader` primitives and the existing rail.

## Decided: role-based home, action-first

**Shipped.** The admin home now orders:

1. **Waiting on you** — leave approvals and anything else holding someone up.
2. **Today** — the teaching roles' actual periods, each with a one-click
   "mark attendance".
3. **Key figures** — attendance, marks, at-risk count, cohort size.
4. **Needs attention** — the flagged pupils, which is the page's real job.
5. **Noticeboard** — reference reading, deliberately last.

The lede is shortened to one clause that still states the scoping rule without
spending the top of the page on it.

## Planned, in priority order

These are not yet built. Each is a vertical slice under the existing
Definition of Done, and each is listed in
[CLAUDE-DELIVERY-ROADMAP.md](CLAUDE-DELIVERY-ROADMAP.md).

### 1. Workspace navigation — **shipped**

The rail is regrouped by job, not by module. `DOMAIN_ORDER` is now
`TOP → STUDENTS → ACADEMICS → MONEY → PEOPLE → REVIEW → SETUP`:

- **TOP** (untitled, top of the rail) — dashboard, Now, my timetable,
  attendance, coursework, my classes. What a teacher opens every morning,
  one tap from anywhere.
- **Students** — the pupil record, the accountant's read-only directory, and
  the student import that populates it.
- **Academics** — calendar, marks, syllabus, results, report cards, backlogs,
  exams.
- **Money** — fees.
- **People & comms** — teachers, staff import, leave, notices.
- **Review** — reports, analytics. Look back; never change.
- **Setup** — organisation, terms, timetable, users, system. Rendered last
  under a `--setup` divider rule, because it is touched at the start of a year
  and rarely after.

Not a single route, label or role list changed — only `group` values, the
order and one CSS rule. Two deliberate deviations from the sketch above:

- The group is **Students**, not "Pupils": every entry and screen in the app
  already says Students, and a "Pupils" header over a "Students" link is the
  kind of inconsistency this document exists to remove.
- **Terms moved to Setup**, not Academics. It is start-of-year configuration,
  which is exactly the split this regroup is for. Its breadcrumb followed.

One regression was caught and fixed in the same change: the search index
excluded the whole `TOP` group, which was harmless when TOP held only landing
pages but would have made a teacher's attendance, marks and coursework
unsearchable once they moved there. It now excludes `/dashboard` and `/portal`
by href, with a test pinning that.

### 2. Student 360 as the centre of gravity

`/students/[studentId]` exists. It should become the record every other screen
links into, with tabs for summary, academics, attendance, finance, documents,
family and history — and it should be reachable from a global search box that
is already in the top bar.

### 3. Dense operational tables

One table pattern, used everywhere: sticky header, saved filters, multi-select
with a bulk action bar, column-level empty states that distinguish "none" from
"not recorded", and an export that is already formula-injection-escaped in
platform code.

### 4. Teacher fast paths

Attendance and marks are the two highest-frequency staff actions in a school.
Both should be reachable in one tap from Today and completable without leaving
the page.

### 5. Inline-style cleanup

Move the scattered `style={{ … }}` objects into CSS modules so the spacing and
colour checks actually cover them. Mechanical, low risk, and it closes the hole
in an otherwise well-enforced system.

## Explicitly not doing

- No new palette, typeface or visual language.
- No decorative card grids, gratuitous gradients or glass effects.
- No shell replacement.
- No college-edition UI work — paused by owner decision until the school
  edition is sellable. College code is **not** deleted; the edition system
  already gates it.
