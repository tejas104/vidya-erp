/// <reference lib="dom" />
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";

const baseURL = "http://localhost:3125";
const output = join(process.cwd(), "test-results", "school-demo");
const accounts = [
  { role: "admin", username: "school-demo-admin", password: "school-demo-admin-pass-2026", landing: "/dashboard", heading: "Your school, in motion." },
  { role: "principal", username: "school-demo-principal", password: "school-demo-principal-pass-2026", landing: "/dashboard", heading: "Decisions for today." },
  { role: "class-teacher", username: "school-demo-class-teacher", password: "school-demo-class-pass-2026", landing: "/dashboard", heading: "Your class, together." },
  { role: "teacher", username: "school-demo-teacher", password: "school-demo-teacher-pass-2026", landing: "/dashboard", heading: "Your teaching day." },
  { role: "family", username: "school-demo-family", password: "school-demo-family-pass-2026", landing: "/family", heading: "Asha Sharma" },
  { role: "student", username: "school-demo-student", password: "school-demo-student-pass-2026", landing: "/portal", heading: "Hello, Asha." },
  { role: "student-9a", username: "school-demo-student-9a", password: "school-demo-student-9a-pass-2026", landing: "/portal", heading: "Hello, Aditi." },
] as const;

async function login(page: Page, username: string, password: string): Promise<void> {
  await page.goto(`${baseURL}/login`);
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.locator(".login-submit").click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 20_000 });
}

async function main(): Promise<void> {
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const findings: string[] = [];
  try {
    const signInContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL });
    const signInPage = await signInContext.newPage();
    await signInPage.goto("/login");
    await signInPage.getByRole("heading", { name: "Sign in to your school." }).waitFor();
    if (await signInPage.getByRole("tab").count() !== 0) throw new Error("Sign-in still asks the visitor to select a role");
    await signInPage.screenshot({ path: join(output, "login-desktop.png"), fullPage: true });
    await signInPage.getByRole("button", { name: "Use dark theme" }).click();
    await signInPage.screenshot({ path: join(output, "login-dark.png"), fullPage: true });
    await signInPage.setViewportSize({ width: 390, height: 844 });
    if (await signInPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error("Sign-in overflows a 390px viewport");
    await signInPage.screenshot({ path: join(output, "login-mobile.png"), fullPage: true });
    await signInContext.close();
    for (const account of accounts) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await login(page, account.username, account.password);
        if (new URL(page.url()).pathname !== account.landing) throw new Error(`${account.role} landed on ${new URL(page.url()).pathname}, expected ${account.landing}`);
        await page.goto(account.landing);
        await page.getByRole("heading", { name: account.heading, level: 1 }).waitFor({ timeout: 20_000 });
        if (account.role === "admin" || account.role === "principal" || account.role === "class-teacher") {
          const figures = page.getByRole("region", { name: "School figures" });
          await figures.getByText("Attendance (YTD)").waitFor();
          await figures.getByText(/\d+%/).first().waitFor();
          await figures.getByRole("link", { name: /View.*Term records/ }).waitFor();
          await page.getByRole("region", { name: "Pupils needing attention" }).getByRole("link").first().click();
          await page.getByRole("heading", { level: 1 }).waitFor();
          await page.goto(account.landing);
          await page.getByRole("heading", { name: account.heading, level: 1 }).waitFor();
        }
        await page.screenshot({ path: join(output, `${account.role}-home.png`), fullPage: true });
        if (account.role === "admin") {
          await page.getByRole("button", { name: "Help" }).click();
          await page.getByRole("dialog", { name: "Help" }).getByRole("heading", { name: "Your school workspace" }).waitFor();
          await page.getByRole("dialog", { name: "Help" }).getByRole("button", { name: "Close" }).click();
          await page.getByRole("region", { name: "Your workspaces" }).getByRole("link", { name: /Fee counter/ }).waitFor();
          await page.goto("/manage/students");
          await page.getByText("Asha Sharma").first().waitFor();
          await page.screenshot({ path: join(output, "admin-students.png"), fullPage: true });
          await page.goto("/manage/teachers");
          await page.getByRole("heading", { name: "Teachers & class roles", level: 1 }).waitFor();
          await page.getByText("Farah Khan").first().waitFor();
          await page.screenshot({ path: join(output, "admin-teachers.png"), fullPage: true });
          await page.getByRole("region", { name: "Teacher directory" }).getByRole("button", { name: "Assign" }).first().waitFor();
          await page.getByLabel("Find a teacher").fill("Farah");
          await page.getByRole("region", { name: "Teacher directory" }).getByRole("button", { name: "Search", exact: true }).click();
          await page.getByRole("region", { name: "Teacher directory" }).getByText("Farah Khan").waitFor();
          await page.getByRole("region", { name: "Teacher directory" }).getByText("Ananya Iyer").waitFor({ state: "detached" });
          await page.goto("/manage/results");
          await page.getByRole("heading", { name: "From marks to report cards", level: 1 }).waitFor();
          await page.getByRole("button", { name: "New grade scale" }).waitFor();
          await page.getByText("School A-E").waitFor();
          if (await page.getByText("SGPA").count()) throw new Error("College SGPA appears in school Results");
          await page.screenshot({ path: join(output, "admin-results.png"), fullPage: true });
          const colleges = await (await page.request.get("/api/v1/people/colleges")).json() as { colleges: { id: string }[] };
          const scaleResponse = await page.request.get(`/api/v1/results/scales?collegeId=${encodeURIComponent(colleges.colleges[0]!.id)}`);
          const scaleList = await scaleResponse.json() as { scales: { id: string; name: string }[] };
          const schoolScale = scaleList.scales.find((scale) => scale.name === "School A-E");
          if (!schoolScale) throw new Error("Demo school grading scale is missing");
          const retained = await page.request.delete(`/api/v1/results/scales/${encodeURIComponent(schoolScale.id)}`, { headers: { origin: baseURL } });
          if (retained.status() !== 409) throw new Error(`School grade-scale retention returned ${retained.status()}, expected 409`);
          await page.goto("/manage/report-cards");
          await page.getByRole("heading", { name: "Report card desk", level: 1 }).waitFor();
          await page.screenshot({ path: join(output, "admin-report-cards.png"), fullPage: true });
          await page.goto("/manage/progression");
          await page.getByRole("heading", { name: "Promotion and exits", level: 1 }).waitFor();
          await page.getByLabel("Section").locator("option").first().waitFor({ state: "attached" });
          await page.getByText("Loading the roll…").waitFor({ state: "hidden" });
          await page.screenshot({ path: join(output, "admin-progression.png"), fullPage: true });
          await page.goto("/manage/fees");
          await page.getByRole("heading", { name: "Fee counter", level: 1 }).waitFor();
          await page.getByText("Asha Sharma").first().waitFor();
          await page.screenshot({ path: join(output, "admin-fees.png"), fullPage: true });
        } else if (account.role === "principal") {
          await page.getByRole("region", { name: "Your workspaces" }).getByRole("link", { name: /School analytics/ }).waitFor();
          await page.getByRole("link", { name: "Leave", exact: true }).waitFor();
          await page.goto("/manage/leave");
          await page.getByRole("heading", { level: 1 }).waitFor();
          await page.screenshot({ path: join(output, "principal-leave.png"), fullPage: true });
          await page.goto("/manage/results");
          await page.getByRole("heading", { name: "From marks to report cards", level: 1 }).waitFor();
          if (await page.getByRole("button", { name: "New grade scale" }).count()) throw new Error("Principal sees an admin-only grading action");
        } else if (account.role === "class-teacher") {
          await page.getByRole("region", { name: "Your workspaces" }).getByRole("link", { name: /Report cards/ }).waitFor();
          await page.goto("/manage/classes");
          await page.getByRole("heading", { name: "My class register", level: 1 }).waitFor();
          await page.getByRole("heading", { name: "Standard 8 · A", level: 2 }).waitFor();
          await page.getByRole("region", { name: "Pupil register" }).getByText("Asha Sharma").waitFor();
          await page.getByRole("button", { name: "Add pupil" }).waitFor();
          if (await page.getByText(/backlog|year.back|75% eligibility|fees pending/i).count()) throw new Error("College class terminology appears in the school register");
          await page.screenshot({ path: join(output, "class-teacher-classes.png"), fullPage: true });
          await page.goto("/manage/report-cards");
          await page.getByRole("heading", { name: "Report card desk", level: 1 }).waitFor();
          await page.screenshot({ path: join(output, "class-teacher-report-cards.png"), fullPage: true });
          await page.goto("/manage/attendance?date=2026-09-23");
          await page.getByRole("heading", { name: "Attendance recorded" }).waitFor();
          await page.getByText("Ishaan Verma").waitFor();
          await page.getByText("20 pupils in this section").waitFor();
          if (await page.getByRole("button", { name: "Save attendance" }).count()) throw new Error("Recorded register still shows a save action");
          await page.screenshot({ path: join(output, "class-teacher-existing-attendance.png"), fullPage: true });
          await page.goto("/manage/report-cards");
        } else if (account.role === "teacher") {
          await page.goto("/manage/attendance?date=2026-09-24");
          await page.getByRole("heading", { name: "Class attendance", level: 1 }).waitFor();
          await page.getByText("Asha Sharma").waitFor();
          await page.getByText("Ishaan Verma").waitFor();
          await page.getByText("20 pupils in this section").waitFor();
          const ashaStatus = page.getByRole("button", { name: /Asha Sharma, roll.*present/i });
          await ashaStatus.click();
          await page.getByRole("button", { name: /Asha Sharma, roll.*absent/i }).waitFor();
          await page.getByLabel("Mark Asha Sharma late or excused").selectOption("late");
          await page.getByRole("button", { name: /Asha Sharma, roll.*late/i }).waitFor();
          await page.getByLabel("Mark Asha Sharma late or excused").selectOption("");
          await page.screenshot({ path: join(output, "teacher-attendance.png"), fullPage: true });
          await page.goto("/manage/classes");
          await page.getByRole("heading", { name: "My class register", level: 1 }).waitFor();
          await page.getByRole("link", { name: "Enter marks" }).waitFor();
          if (await page.getByRole("button", { name: "Add pupil" }).count()) throw new Error("Subject teacher sees a class enrolment action");
          await page.screenshot({ path: join(output, "teacher-class-register.png"), fullPage: true });
          await page.goto("/manage/marks");
          await page.getByLabel("Term").waitFor();
          const termValue = await page.getByLabel("Term").locator("option").filter({ hasText: "Term 1" }).getAttribute("value");
          if (!termValue) throw new Error("Teacher cannot see Term 1");
          await page.getByLabel("Term").selectOption(termValue);
          await page.getByText("Mathematics term exam").first().waitFor();
          await page.screenshot({ path: join(output, "teacher-marks.png"), fullPage: true });
          await page.goto("/manage/my-timetable");
          await page.getByText("Mathematics").first().waitFor();
          await page.screenshot({ path: join(output, "teacher-timetable.png"), fullPage: true });
        } else if (account.role === "family") {
          await page.getByRole("tab", { name: "Vedant Sharma" }).waitFor();
          await page.getByRole("navigation", { name: "Family sections" }).waitFor();
          await page.getByRole("heading", { name: "Today" }).waitFor();
          await page.screenshot({ path: join(output, "family-overview.png"), fullPage: true });
          await page.getByRole("navigation", { name: "Family sections" }).getByRole("button", { name: "Learning" }).click();
          await page.getByRole("heading", { name: "Report cards" }).waitFor();
          const href = await page.getByRole("region", { name: "Report cards" }).getByRole("link", { name: "Download PDF" }).getAttribute("href");
          if (!href) throw new Error("Published report card has no PDF link");
          const pdf = await page.request.get(href);
          if (!pdf.ok() || (await pdf.body()).subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("Published PDF download failed");
          await page.screenshot({ path: join(output, "family-learning.png"), fullPage: true });
          await page.getByRole("navigation", { name: "Family sections" }).getByRole("button", { name: "Fees" }).click();
          await page.getByText("₹800.00 due").waitFor();
          await page.screenshot({ path: join(output, "family-fees.png"), fullPage: true });
          await page.getByRole("navigation", { name: "Family sections" }).getByRole("button", { name: "Notices" }).click();
          await page.getByText("Welcome to Standard 8").waitFor();
          await page.screenshot({ path: join(output, "family-notices.png"), fullPage: true });
          await page.getByRole("tab", { name: "Vedant Sharma" }).click();
          await page.getByRole("heading", { name: "Vedant Sharma", level: 1 }).waitFor();
          await page.getByRole("region", { name: "School notices" }).getByText("Term 2 family meeting").waitFor();
          if (await page.getByText("Welcome to Standard 8").count()) throw new Error("Standard 8 notice leaked into Vedant's family view");
          await page.getByRole("navigation", { name: "Family sections" }).getByRole("button", { name: "Learning" }).click();
          await page.getByText("No term marks released yet.").waitFor();
          await page.getByText("No report cards published yet.").waitFor();
          await page.screenshot({ path: join(output, "family-vedant-learning.png"), fullPage: true });
          await page.getByRole("navigation", { name: "Family sections" }).getByRole("button", { name: "Fees" }).click();
          await page.getByText("₹1,500.00 due").waitFor();
          await page.screenshot({ path: join(output, "family-vedant-fees.png"), fullPage: true });
          await page.getByRole("tab", { name: "Asha Sharma" }).click();
          await page.getByRole("heading", { name: "Asha Sharma", level: 1 }).waitFor();
          await page.getByText("₹800.00 due").waitFor();
          const staff = await page.request.get("/api/v1/people/colleges");
          if (staff.status() !== 403) throw new Error(`Family staff access returned ${staff.status()}, expected 403`);
          const teacherDirectory = await page.request.get("/api/v1/people/teachers?collegeId=col_unknown");
          if (teacherDirectory.status() !== 403) throw new Error(`Family teacher directory returned ${teacherDirectory.status()}, expected 403`);
        } else if (account.role === "student") {
          await page.getByRole("navigation", { name: "Explore your school workspace" }).waitFor();
          await page.getByRole("link", { name: "Timetable", exact: true }).waitFor();
          await page.screenshot({ path: join(output, "student-overview.png"), fullPage: true });
          for (const [route, heading, evidence] of [
            ["schedule", "My timetable", "Mathematics"],
            ["assignments", "Assignments & materials", "Observe a local ecosystem"],
            ["marks", "My marks", "My term marks"],
            ["exams", "My exams", "Term 2 assessment week"],
            ["syllabus", "What we're learning", "Living systems"],
            ["attendance", "My attendance", "Recent attendance"],
            ["fees", "My fees", "Tuition"],
            ["notices", "School notices", "Welcome to Standard 8"],
          ] as const) {
            await page.goto(`/portal/${route}`);
            await page.getByRole("heading", { name: heading, level: 1 }).waitFor();
            await page.getByText(evidence).first().waitFor();
            if (route === "assignments") {
              const material = page.getByRole("link", { name: "Download" }).first();
              const href = await material.getAttribute("href");
              if (!href) throw new Error("Student study material has no download link");
              const response = await page.request.get(href);
              const bytes = await response.body();
              if (!response.ok() || bytes.length < 500 || bytes.subarray(0, 5).toString("latin1") !== "%PDF-")
                throw new Error("Synthetic revision guide PDF failed to download");
              await writeFile(join(output, "student-revision-guide.pdf"), bytes);
            }
            await page.screenshot({ path: join(output, `student-${route}.png`), fullPage: true });
          }
        } else {
          await page.getByRole("heading", { name: "Coming up" }).waitFor();
          await page.getByText("Explore cells around us").waitFor();
          await page.screenshot({ path: join(output, "student-9a-overview.png"), fullPage: true });
          for (const [route, heading, evidence] of [
            ["schedule", "My timetable", "Mathematics 9"],
            ["assignments", "Assignments & materials", "Explore cells around us"],
            ["exams", "My exams", "Mathematics 9"],
            ["syllabus", "What we're learning", "Matter and living systems"],
            ["attendance", "My attendance", "Recent attendance"],
            ["fees", "My fees", "Tuition"],
            ["notices", "School notices", "Term 2 family meeting"],
          ] as const) {
            await page.goto(`/portal/${route}`);
            await page.getByRole("heading", { name: heading, level: 1 }).waitFor();
            await page.getByText(evidence).first().waitFor();
            await page.screenshot({ path: join(output, `student-9a-${route}.png`), fullPage: true });
          }
          await page.goto("/portal/marks");
          await page.getByRole("heading", { name: "My marks", level: 1 }).waitFor();
          await page.screenshot({ path: join(output, "student-9a-marks.png"), fullPage: true });
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.reload();
        await page.getByRole("heading", { level: 1 }).first().waitFor();
        if (account.role === "admin") await page.getByText("Asha Sharma").first().waitFor();
        if (account.role === "class-teacher") await page.getByRole("heading", { name: "Report card desk", level: 1 }).waitFor();
        if (account.role === "teacher") {
          const saturday = page.getByRole("button", { name: "Sat", exact: true });
          await saturday.waitFor();
          await saturday.click();
          if (await saturday.getAttribute("aria-pressed") !== "true") throw new Error("Mobile timetable day picker did not switch to Saturday");
          await page.getByRole("button", { name: "Thu", exact: true }).click();
          await page.goto("/manage/attendance?date=2026-09-24");
          await page.getByText("20 pupils in this section").waitFor();
          if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error("Attendance register overflows a 390px viewport");
          await page.screenshot({ path: join(output, "teacher-attendance-mobile.png"), fullPage: true });
        }
        if (account.role === "family") {
          await page.getByRole("heading", { name: "Today" }).waitFor();
          await page.getByRole("tab", { name: "Vedant Sharma" }).click();
          await page.getByRole("heading", { name: "Vedant Sharma", level: 1 }).waitFor();
        }
        if (account.role === "student") await page.getByText("Welcome to Standard 8").waitFor();
        if (account.role === "student-9a") await page.getByRole("heading", { name: "My marks", level: 1 }).waitFor();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        if (overflow) throw new Error(`${account.role} landing overflows a 390px viewport`);
        await page.screenshot({ path: join(output, `${account.role}-mobile.png`), fullPage: true });
        if (account.role === "student" || account.role === "student-9a") {
          await page.goto("/portal");
          await page.getByRole("heading", { name: "Coming up" }).waitFor();
          if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error(`${account.role} overview overflows a 390px viewport`);
          await page.screenshot({ path: join(output, `${account.role}-overview-mobile.png`), fullPage: true });
          await page.getByRole("button", { name: "Open menu" }).click();
          await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Timetable" }).waitFor();
          await page.waitForFunction(() => getComputedStyle(document.querySelector(".shell-side")!).transform === "none");
          await page.screenshot({ path: join(output, "student-nav-mobile.png"), fullPage: true });
          await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Timetable" }).click();
          await page.getByRole("heading", { name: "My timetable", level: 1 }).waitFor();
        }
        if (account.role === "class-teacher" || account.role === "teacher") {
          await page.goto("/manage/classes");
          await page.getByRole("heading", { name: "My class register", level: 1 }).waitFor();
          await page.getByRole("region", { name: "Pupil register" }).getByText("Asha Sharma").waitFor();
          if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error(`${account.role} class register overflows a 390px viewport`);
          await page.screenshot({ path: join(output, `${account.role}-class-register-mobile.png`), fullPage: true });
        }
        if (account.role === "admin" || account.role === "principal" || account.role === "class-teacher" || account.role === "teacher") {
          await page.goto("/dashboard");
          await page.getByRole("heading", { name: account.heading, level: 1 }).waitFor();
          const homeOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
          if (homeOverflow) throw new Error(`${account.role} dashboard overflows a 390px viewport`);
          await page.screenshot({ path: join(output, `${account.role}-home-mobile.png`), fullPage: true });
        }
        if (errors.length > 0) throw new Error(`${account.role} browser errors: ${errors.join("; ")}`);
        findings.push(`${account.role}: desktop + mobile passed`);
      } finally { await context.close(); }
    }
    console.log(findings.join("\n"));
    console.log(`Screenshots: ${output}`);
  } finally { await browser.close(); }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
