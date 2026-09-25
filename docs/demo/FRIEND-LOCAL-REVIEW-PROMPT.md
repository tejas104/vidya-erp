# Prompt for a local school ERP reviewer

Copy the text below into Claude on the reviewer's computer. This is a
**synthetic localhost demo**. It does not require the hosted licence server.

> Help me run and review the Vidya school ERP from
> https://github.com/tejas104/vidya-erp on my own Windows computer. I have
> Docker Desktop. Use the latest `main` commit and read
> `docs/demo/SCHOOL-LOCAL-DEMO.md` before running commands. Work in PowerShell.
> Check that Docker Desktop's engine and Docker Compose are running. If Git is
> unavailable, obtain the repository ZIP from GitHub and extract it. Check
> whether localhost ports 3125, 55436, 6386, 9020, 9021, and 9474 are free;
> if one is occupied, explain the conflict and use a safe local port override.
>
> Start the isolated `vidya-school-demo` Compose project exactly as the demo
> guide describes, using `docker-compose.yml`,
> `docker-compose.school-demo.yml`, and `scripts/school-demo.env`. Wait for
> `http://localhost:3125/login` to respond. Create the VDEMO administrator,
> then run `seed-school-demo.ts` once and `enrich-school-demo.ts` through the
> worker container using `SCHOOL_DEMO_BASE_URL=http://web:3000`. These scripts
> create fictional data. Docker Desktop is enough; do not require Node.js or
> pnpm on my computer. If an existing demo volume is present, preserve it,
> inspect the state, and do not run the one-time seed again. Never run
> `docker compose down -v` without asking me.
>
> Open `http://localhost:3125/login` and review the school experience at
> desktop and phone widths. Use the fictional accounts in the demo guide:
> administrator, principal, class teacher, subject teacher, student, Standard
> 9 student, and family. Check the role navigation, class register, attendance
> review, academic terms, report cards and PDF, results, assignments, syllabus,
> timetable, notices, fees, and student/family pages. In Attendance review,
> distinguish missing daily registers, missing pupil entries, absence, and
> enrollment dates that still need verification. Record screenshots and
> concrete issues with page URL, role, expected result, and actual result.
>
> Keep the demo containers and their data running for my review. Report the
> exact Git commit, Docker commands and container status, login URL, checks
> completed, and any blockers. The amber missing-licence notice is expected
> for this demo. Do not expose this local demo to the internet, replace its
> synthetic credentials with real school data, or call it production-ready.

The credentials and exact Compose commands are in
`docs/demo/SCHOOL-LOCAL-DEMO.md` so the prompt stays aligned with the build.
