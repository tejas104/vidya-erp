"use client";

import { useEffect, useState } from "react";
import { Button, Input } from "@vidya/ui-system";
import { api, ApiError } from "@/ui/api";
import styles from "./login.module.css";

export const dynamic = "force-dynamic";

type Role = "student" | "parent" | "staff";

const COPY: Record<Role, { eyebrow: string; lede: string; hint: string }> = {
  student: {
    eyebrow: "Student portal",
    lede: "See your attendance, marks and notices for the term.",
    hint: "Use the sign-in your college linked to your record.",
  },
  parent: {
    eyebrow: "Parent sign-in",
    lede: "See your child's attendance, marks and timetable.",
    hint: "Use the username you chose when you set up your account.",
  },
  staff: {
    eyebrow: "Staff sign-in",
    lede: "Your dashboard shows only the classes and records in your scope.",
    hint: "Use your staff username.",
  },
};

// Dev-only convenience: Next inlines NODE_ENV at build, so this whole block
// disappears from production bundles. One representative account per role from
// scripts/seed-demo.ts — click to fill the form.
const IS_DEV = process.env.NODE_ENV !== "production";
const DEMO_ACCOUNTS: { label: string; username: string; password: string }[] = [
  { label: "Admin", username: "demo-admin", password: "demo-admin-pass-2026!" },
  { label: "Principal", username: "demo-principal", password: "demo-staff-pass-2026!" },
  { label: "HoD", username: "demo-hod-cse", password: "demo-staff-pass-2026!" },
  { label: "Class teacher", username: "demo-ct-fycs", password: "demo-teacher-pass-2026!" },
  { label: "Teacher", username: "demo-teacher-ds", password: "demo-teacher-pass-2026!" },
  { label: "Accountant", username: "demo-accountant", password: "demo-accountant-pass-2026!" },
  { label: "Student", username: "demo-student", password: "demo-student-pass-2026!" },
];

export default function LoginPage() {
  const [role, setRole] = useState<Role>("student");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("vidya-theme");
    if (stored === "light" || stored === "dark") setTheme(stored);
  }, []);

  function toggleTheme() {
    const root = document.documentElement;
    const isDark =
      root.getAttribute("data-theme") === "dark" ||
      (root.getAttribute("data-theme") === null && window.matchMedia("(prefers-color-scheme: dark)").matches);
    const next = isDark ? "light" : "dark";
    root.setAttribute("data-theme", next);
    localStorage.setItem("vidya-theme", next);
    setTheme(next);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.login(username.trim(), password);
      window.location.href = "/dashboard";
    } catch (caught) {
      const status = caught instanceof ApiError ? caught.status : 0;
      if (status === 429) {
        setError("Too many attempts. Wait a few minutes and try again.");
      } else if (status === 403) {
        setError("Your password needs to be reset before you can sign in. Ask your administrator.");
      } else {
        setError("That username and password don't match.");
      }
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <aside className={styles.hero} aria-hidden="true">
        <div className={styles.heroInner}>
          <span className={styles.word}>
            vidya<span>.</span>
          </span>
          <p className={styles.tagline}>
            Sign in to see your attendance, marks and notices — everything scoped to you.
          </p>
          <ul className={styles.points}>
            <li>Attendance</li>
            <li>Marks &amp; results</li>
            <li>Notices &amp; calendar</li>
          </ul>
        </div>
      </aside>

      <main id="main" className={styles.main}>
        <button type="button" className={styles.themeToggle} onClick={toggleTheme}>
          {theme === "dark" ? "paper" : "chalk"}
        </button>

        <div className={styles.card}>
          <div className={styles.seg} role="tablist" aria-label="Who is signing in">
            {(["student", "parent", "staff"] as Role[]).map((r) => (
              <button
                key={r}
                type="button"
                role="tab"
                aria-selected={role === r}
                data-on={role === r ? "" : undefined}
                onClick={() => setRole(r)}
              >
                {r === "student" ? "Student" : r === "parent" ? "Parent" : "Staff"}
              </button>
            ))}
          </div>

          <p className={`eyebrow ${styles.eyebrow}`}>{COPY[role].eyebrow}</p>
          <h1 className={styles.title}>Welcome back</h1>
          <p className={styles.lede}>{COPY[role].lede}</p>
          <p className={styles.hint}>{COPY[role].hint}</p>

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
            <Input
              id="password"
              name="password"
              type="password"
              label="Password"
              autoComplete="current-password"
              className={styles.fieldInput}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <p className="formerror" role="alert" aria-live="polite">
              {error}
            </p>
            <Button type="submit" className={`login-submit ${styles.submit}`} disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          {role === "parent" ? (
            <p className={styles.hint}>
              New here? <a href="/activate">Set up your parent account</a> with the invitation code the school gave you.
            </p>
          ) : null}

          {IS_DEV ? (
            <div className={styles.demos}>
              <span className={styles.demosLabel}>Demo accounts (dev only)</span>
              <div className={styles.demosChips}>
                {DEMO_ACCOUNTS.map((acc) => (
                  <button
                    key={acc.username}
                    type="button"
                    className={styles.demoChip}
                    title={`${acc.username} / ${acc.password}`}
                    onClick={() => {
                      setUsername(acc.username);
                      setPassword(acc.password);
                      setError("");
                    }}
                  >
                    {acc.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
