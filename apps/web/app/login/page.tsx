"use client";

import { useEffect, useState } from "react";
import { Button, Input } from "@vidya/ui-system";
import { api, ApiError, type Session } from "@/ui/api";
import styles from "./login.module.css";

export const dynamic = "force-dynamic";

// One sign-in for every account. The session comes from the server; choosing a
// destination here never grants a role or changes what an account can read.
export function landingFor(session: Session): string {
  if (session.kind === "guardian") return "/family";
  if (session.roles.length > 0 && session.roles.every((role) => role === "student")) return "/portal";
  if (session.roles.length > 0 && session.roles.every((role) => role === "accountant")) return "/manage/accounting";
  return "/dashboard";
}

const IS_DEV = process.env.NODE_ENV !== "production";
const DEMO_ACCOUNTS = [
  { label: "Administrator", username: "demo-admin", password: "demo-admin-pass-2026!" },
  { label: "Principal", username: "demo-principal", password: "demo-staff-pass-2026!" },
  { label: "Class teacher", username: "demo-ct-fycs", password: "demo-teacher-pass-2026!" },
  { label: "Teacher", username: "demo-teacher-ds", password: "demo-teacher-pass-2026!" },
  { label: "Student", username: "demo-student", password: "demo-student-pass-2026!" },
] as const;

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("vidya-theme");
    if (stored === "light" || stored === "dark") setTheme(stored);
  }, []);

  function toggleTheme() {
    const root = document.documentElement;
    const isDark = root.getAttribute("data-theme") === "dark" ||
      (root.getAttribute("data-theme") === null && window.matchMedia("(prefers-color-scheme: dark)").matches);
    const next = isDark ? "light" : "dark";
    root.setAttribute("data-theme", next);
    localStorage.setItem("vidya-theme", next);
    setTheme(next);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.login(username.trim(), password);
      const session = await api.session().catch(() => null);
      window.location.href = session ? landingFor(session) : "/dashboard";
    } catch (caught) {
      const status = caught instanceof ApiError ? caught.status : 0;
      setError(status === 429
        ? "Too many attempts. Wait a few minutes and try again."
        : status === 403
          ? "Your password needs to be reset. Contact your school office."
          : "That username and password don't match.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <aside className={styles.story} aria-label="Vidya school workspace">
        <div className={styles.storyTop}>
          <span className={styles.word}>vidya<span>.</span></span>
          <span className={styles.storyEdition}>School workspace</span>
        </div>
        <div className={styles.storyMiddle}>
          <p className={styles.storyEyebrow}>A better day at school</p>
          <h2>Everyone in the school day, in one place.</h2>
          <p>From the first register to the final report card, the right work opens with the right account.</p>
          <div className={styles.storyBoard} aria-hidden="true">
            <div><span>01</span><strong>Run the school</strong><small>People · records · fees</small></div>
            <div><span>02</span><strong>Teach the class</strong><small>Attendance · lessons · marks</small></div>
            <div><span>03</span><strong>Follow the journey</strong><small>Progress · notices · family</small></div>
          </div>
        </div>
        <p className={styles.storyFooter}>One secure account. Your own view of Vidya.</p>
      </aside>

      <main id="main" className={styles.main}>
        <div className={styles.mainTop}>
          <span className={styles.mobileWord}>vidya<span>.</span></span>
          <button type="button" className={styles.themeToggle} onClick={toggleTheme} aria-label={theme === "dark" ? "Use light theme" : "Use dark theme"}>
            {theme === "dark" ? "Light theme" : "Dark theme"}
          </button>
        </div>
        <div className={styles.formWrap}>
          <p className={styles.eyebrow}>Welcome to Vidya</p>
          <h1>Sign in to your school.</h1>
          <p className={styles.lede}>Teachers, school staff, students and families use the same sign-in. Your workspace opens automatically.</p>
          <form onSubmit={submit} noValidate>
            <Input
              id="username"
              name="username"
              label="Username"
              autoComplete="username"
              autoFocus
              className={styles.fieldInput}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
            <div className={styles.passwordWrap}>
              <Input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                label="Password"
                autoComplete="current-password"
                className={styles.passwordInput}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button type="button" className={styles.passwordToggle} onClick={() => setShowPassword((shown) => !shown)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            <p className={styles.error} role="alert" aria-live="polite">{error}</p>
            <Button type="submit" className={`login-submit ${styles.submit}`} disabled={busy}>
              {busy ? "Opening your workspace…" : "Sign in"}<span aria-hidden="true">→</span>
            </Button>
          </form>
          <div className={styles.accessHelp}>
            <p>New parent or guardian? <a href="/activate">Activate your invitation</a>.</p>
            <p>Need an account or password reset? Contact your school office.</p>
          </div>
          {IS_DEV ? (
            <details className={styles.demos}>
              <summary>Local development accounts</summary>
              <div className={styles.demoList}>
                {DEMO_ACCOUNTS.map((account) => (
                  <button key={account.username} type="button" onClick={() => { setUsername(account.username); setPassword(account.password); setError(""); }}>
                    {account.label}
                  </button>
                ))}
              </div>
            </details>
          ) : null}
        </div>
        <p className={styles.mainFooter}>Private school records stay with the people authorised to see them.</p>
      </main>
    </div>
  );
}
