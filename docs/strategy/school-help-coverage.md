# School help coverage

Updated for T03 on `codex/school-r01-terra`. This inventory uses the route-to-slug rule in `scripts/helpSlug.ts`: remove `/manage`, omit dynamic path segments, and join the remaining stable segments with hyphens. The compiler scans all route files, then selects the configured edition's map at runtime.

## Authored and verified school articles

| Slug | Active screen or workflow | Evidence used |
| --- | --- | --- |
| `terms` | Academic term register and assessment-type editor | `SchoolTermsPage`, `AssessmentTypesEditor`, and school-academics handlers: administrator-only writes, principal read-only UI, 100% whole-number type distribution, fixed configuration after use, and audited reopen requirement. |
| `marks` | School assessment creation and marks entry | `SchoolMarksPage` and school-academics marks handlers: assigned-subject teacher scope, term-linked assessments, grade-scale snapshot, score validation, retained retry state, and read-only closed terms. |
| `attendance` | Attendance recording for an assigned section or period | Attendance page: section/date roster, present/absent/late/excused controls, **Now** handoff, retry state, and save confirmation. |
| `coursework` | Teacher assignment and study-material workflow | Coursework page and coursework handler ownership: assigned class/subject picker, assignment creation/evaluation, material upload, and guarded deletion. |

These four documents use only the compiler's supported Markdown subset. They contain no screenshot placeholders because no T03 browser capture was made.

`attendance` and `coursework` currently render their matching `HelpButton` slugs. `terms` and the school implementation of `marks` compile to their matching slugs, but their screen components do not currently render a `HelpButton`. Wiring those existing screens is outside this content-only T03 boundary; the required change would be in `apps/web/src/ui/SchoolTermsPage.tsx` and `apps/web/src/ui/SchoolMarksPage.tsx`.

## Active route and slug inventory not yet covered

| Slug | Reason no school article is supplied in T03 |
| --- | --- |
| `analytics` | Screen is active, but its school-facing interpretation and recomputation guidance need a dedicated workflow review. |
| `backlogs` | College-oriented workflow; no verified school equivalent. |
| `calendar` | Shared route has no school-specific operating guidance verified for this task. |
| `classes` | Teacher workspace is active, but combines roster, fees, corrections, and legacy student statuses; it needs a separate school workflow review. |
| `dashboard` | Shared role dashboard needs role-specific school guidance beyond the academic workflows documented here. |
| `directory` | Shared people directory has no school-specific help review in T03. |
| `exams` | Existing screen is not verified as the term-linked school assessment workflow; use `marks` for implemented school assessments. |
| `fees` | Fee collection is active but school-specific policy and payment guidance were not verified; no online-payment claim is made. |
| `home` | Routing landing screen, not a distinct school workflow. |
| `import` | Routing parent for the two import screens; no distinct user workflow. |
| `import-staff` | Import contract and school staff data guidance need separate verification. |
| `import-students` | Import contract and school enrollment guidance need separate verification. |
| `leave` | Shared staff leave workflow needs school approval-policy verification. |
| `my-timetable` | Active teacher view; it has no help binding and needs a school timetable-content review. |
| `notices` | Shared notice workflow needs school audience and publication-policy verification. |
| `now` | Active teacher shortcut; it has no help binding and is covered only as an attendance handoff. |
| `org` | Organisation setup needs school administrative-data verification. |
| `portal` | Student portal exists; no parent login or parent portal is claimed or documented. |
| `reports` | Reporting screen is active, but school report-card creation and publication are not implemented here. |
| `results` | Do not document report publication or weighted school result aggregation until those workflows are implemented. |
| `students` | Shared student records require separate school enrollment and guardian-policy review. |
| `syllabus` | Shared syllabus workflow needs school curriculum-policy verification. |
| `system` | Shared deployment/audit screen needs no school-specific article for this academic-help increment. |
| `teachers` | Shared staff records require school data-policy verification. |
| `timetable` | Administrative timetable setup needs school period and staffing-policy verification. |
| `users` | Shared identity administration is outside the T03 ownership boundary. |

The compiled school map intentionally leaves these slugs absent. HelpPanel therefore shows its honest missing-help state instead of falling back to college content.
