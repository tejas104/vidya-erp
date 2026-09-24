# School ERP localhost demo

This is a synthetic school demonstration on `http://localhost:3125`. Its Compose
project, network, Postgres volume and MinIO volume are separate from the default
Atlas development stack. All published ports bind to `127.0.0.1`.

## Start from a fresh demo volume

In PowerShell, from the repository root:

```powershell
docker compose -p vidya-school-demo -f docker-compose.yml -f docker-compose.school-demo.yml --env-file scripts/school-demo.env up -d --build
docker compose -p vidya-school-demo -f docker-compose.yml -f docker-compose.school-demo.yml --env-file scripts/school-demo.env run --rm -e VIDYA_ADMIN_PASSWORD=school-demo-admin-pass-2026 worker apps/worker/node_modules/.bin/tsx scripts/create-admin.ts --username school-demo-admin --display-name "Demo School Administrator" --college-name "Vidya Demo School" --college-code VDEMO
$env:SCHOOL_DEMO_SEED='true'; pnpm exec tsx scripts/seed-school-demo.ts
pnpm exec tsx scripts/verify-school-demo.ts
```

The seed refuses to run if the demo school already has a class. Keep the
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
| Family | `school-demo-family` | `school-demo-family-pass-2026` |

All records, names, passwords, payment references, and contact addresses are
fictional. The fixture covers a Standard 8 section with five pupils, two
subjects, a six day timetable, attendance, syllabus coverage, an assignment,
closed Term 1 marks, a published report card PDF, future exams, a class notice,
and generated invoices with a partial payment. Term 2 remains open for a live
marks demonstration.

The role dashboards use scoped attendance rollups rebuilt by the seed. Term
marks and report cards open their school records directly; the older generic
analytics marks rollup is not presented as a school grade figure.

## Review route

1. Sign in as administrator: inspect the teacher directory, Results path,
   Students, Academic terms, Report cards, Fee counter, and organisation setup.
2. Sign in as principal: inspect the leadership dashboard, analytics, leave
   decisions, report cards, and notices.
3. Sign in as class teacher: inspect the class dashboard, roster, whole-class
   attendance, saved-register duplicate guard, and report card desk. The class
   register has pupil search and an enrolment action.
4. Sign in as subject teacher: inspect the teaching dashboard, My timetable,
   subject-scoped class register, Attendance, Syllabus, Coursework, and Marks.
   On a phone width, switch timetable days.
5. Sign in as student: inspect Today, assignments, term marks, exams, syllabus
   coverage, and fees in My register.
6. Sign in as family: inspect the child, published report card PDF, fees,
   attendance, and school notice. The family account must receive 403 from
   staff APIs.

The demo runs in school edition. An amber no-licence notice is expected because
hosted licensing is being developed separately. This localhost fixture does
not establish internet deployment readiness or real school acceptance.

The browser check signs into all six roles from the same login page at desktop and 390 px width,
checks the teacher directory and school Results, blocks a duplicate attendance entry,
switches mobile timetable days, reads the family PDF, confirms the family
cannot call a staff API, checks for horizontal overflow and page exceptions,
and keeps screenshots under `test-results/school-demo/`.

To stop only these demo containers while preserving records:

```powershell
docker compose -p vidya-school-demo -f docker-compose.yml -f docker-compose.school-demo.yml --env-file scripts/school-demo.env down
```

To intentionally discard only this synthetic demo database and files, use
the same command with `down -v` after checking that the project name and
volume labels are `vidya-school-demo`.
