# School ERP localhost demo

This is a synthetic school demonstration on `http://localhost:3125`. Its Compose
project, network, Postgres volume and MinIO volume are separate from the default
Atlas development stack. All published ports bind to `127.0.0.1`.

## Start from a fresh demo volume

In PowerShell, from the repository root after Docker Desktop is running. The
first image build needs internet access and may take several minutes. Node.js
and pnpm are not required on the reviewer's computer:

```powershell
docker compose -p vidya-school-demo -f docker-compose.yml -f docker-compose.school-demo.yml --env-file scripts/school-demo.env up -d --build
docker compose -p vidya-school-demo -f docker-compose.yml -f docker-compose.school-demo.yml --env-file scripts/school-demo.env run --rm -e VIDYA_ADMIN_PASSWORD=school-demo-admin-pass-2026 worker apps/worker/node_modules/.bin/tsx scripts/create-admin.ts --username school-demo-admin --display-name "Demo School Administrator" --college-name "Vidya Demo School" --college-code VDEMO
docker compose -p vidya-school-demo -f docker-compose.yml -f docker-compose.school-demo.yml --env-file scripts/school-demo.env run --rm -e SCHOOL_DEMO_SEED=true -e SCHOOL_DEMO_BASE_URL=http://web:3000 worker apps/worker/node_modules/.bin/tsx scripts/seed-school-demo.ts
docker compose -p vidya-school-demo -f docker-compose.yml -f docker-compose.school-demo.yml --env-file scripts/school-demo.env run --rm -e SCHOOL_DEMO_SEED=true -e SCHOOL_DEMO_BASE_URL=http://web:3000 worker apps/worker/node_modules/.bin/tsx scripts/enrich-school-demo.ts
```

Wait for `http://localhost:3125/login` to respond before the seed command.
If the web service is still starting, retry after it becomes ready. Run the
seed only once on a fresh demo volume; repeat the enrichment safely after
later updates. `scripts/verify-school-demo.ts` is an optional browser check
for a host with Node.js, pnpm, and Playwright Chromium installed.

The initial seed refuses to run if the demo school already has a class. The
enrichment command is repeatable and adds only missing synthetic records to
the isolated VDEMO school. Keep the
containers and volumes running for review; `docker compose ... up -d --no-build`
restarts them without reseeding. The browser verification writes screenshots to
`test-results/school-demo/`.

## Sign-ins

| Role | Username | Password |
| --- | --- | --- |
| Administrator | `school-demo-admin` | `school-demo-admin-pass-2026` |
| Subject teacher | `school-demo-teacher` | `school-demo-teacher-pass-2026` |
| Class teacher | `school-demo-class-teacher` | `school-demo-class-pass-2026` |
| Principal | `school-demo-principal` | `school-demo-principal-pass-2026` |
| Student | `school-demo-student` | `school-demo-student-pass-2026` |
| Standard 9 student | `school-demo-student-9a` | `school-demo-student-9a-pass-2026` |
| Family | `school-demo-family` | `school-demo-family-pass-2026` |

All records, names, passwords, payment references, and contact addresses are
fictional. The fixture covers Standard 8 A and B and Standard 9 A with 40 pupils,
four subjects, section timetables, dated registers with present, absent, late
and excused entries, syllabus coverage, assignments and a study file. It has
closed Term 1 marks and a published report card for Asha, plus open Term 2
assessments with recorded marks across both standards for teacher review.
Term 2 also has explicit instructional weekdays and a 75% shortfall threshold.
Open **Attendance review** as an administrator or class teacher to see missing
daily registers separately from pupil absence. Standard 8 A has registers for
21–23 September and shows unsubmitted days. Standard 8 B has daily registers
through 25 September, with one pupil below 75%, one missing pupil entry, and
classmates on track. The configured calendar covers the full term. School
holidays should be removed from the calendar before a real pilot.
After loading a review, use **Prepare PDF**, **Prepare Excel**, or **Prepare CSV**
to create a scoped copy through the selected date. The background worker must
be running; the download link appears when generation finishes.
The open term deliberately withholds those newer marks from pupils until the
school closes it. There are future exams for both standards, event notices,
a pending staff leave request, and 40 generated invoices spanning unpaid,
partially paid, fully paid, and scholarship adjusted examples.

The role dashboards use scoped attendance rollups rebuilt by the seed. Term
marks and report cards open their school records directly; the older generic
analytics marks rollup is not presented as a school grade figure.

## Review route

1. Sign in as administrator: inspect the teacher directory, Results path,
   Students, Academic terms, Report cards, Fee counter, and organisation setup.
   **Promotion and exits** can preview one pupil's transfer or graduation for
   today, or a section's year-end promotion, detention, transfer and graduation.
   Preview is safe; **Apply** really moves the demo
   pupils. A mistaken outcome for one pupil can be corrected from that pupil's
   History tab only while the next-year placement has no dependent records.
   The administrator can set the guardian history window on this page for
   future exits; it defaults to 90 days and does not rewrite earlier exits.
   Apply only to a section you create for the purpose.
2. Sign in as principal: inspect the leadership dashboard, analytics, leave
   decisions, report cards, and notices.
3. Sign in as class teacher: inspect the class dashboard, roster, whole-class
   attendance, saved-register duplicate guard, and report card desk. The class
   register has pupil search and an enrolment action.
4. Sign in as subject teacher: inspect the teaching dashboard, My timetable,
   subject-scoped class register, Attendance, Syllabus, Coursework, and Marks.
   On a phone width, switch timetable days.
5. Sign in as either Standard 8 or Standard 9 student: use the My day, Learning, and My records navigation
   sections to open the timetable, assignments, marks, exams, syllabus,
   attendance, fees, and notices as separate pages. The Standard 9 marks page
   shows the intentional unpublished-term state.
6. Sign in as family: switch between Asha Sharma (Standard 8 A) and Vedant
   Sharma (Standard 9 A). Use the Overview, Learning, Fees, and Notices sections
   to inspect each child's attendance, report-card state, balances, and notices.
   Asha's published PDF is available; Vedant's open-term marks remain private.
   The family account must receive 403 from
   staff APIs.

The demo runs in school edition. An amber no-licence notice is expected because
hosted licensing is being developed separately. This localhost fixture does
not establish internet deployment readiness or real school acceptance.

The browser check signs into the staff, family, and two pupil accounts from the same login page at desktop and 390 px width,
checks the teacher directory and school Results, reads a saved attendance register,
changes an unsaved pupil status, opens every student navigation page and the mobile menu,
downloads the sample study PDF, switches mobile timetable days, reads the family PDF, confirms the family
cannot call a staff API, checks for horizontal overflow and page exceptions,
and keeps screenshots under `test-results/school-demo/`.

To stop only these demo containers while preserving records:

```powershell
docker compose -p vidya-school-demo -f docker-compose.yml -f docker-compose.school-demo.yml --env-file scripts/school-demo.env down
```

To intentionally discard only this synthetic demo database and files, use
the same command with `down -v` after checking that the project name and
volume labels are `vidya-school-demo`.
