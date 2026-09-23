"use client";

import { useState } from "react";
import { Button, Input } from "@vidya/ui-system";
import { api, ApiError } from "@/ui/api";
import styles from "../login/login.module.css";

export const dynamic = "force-dynamic";

/**
 * Guardian account set-up (ADR-0027). Public: the adult has no account yet,
 * and the single-use invitation code the school handed them is the
 * credential. The password is theirs alone — staff never see it.
 */
export default function ActivatePage() {
  const [code, setCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ child: string; pending: boolean; username: string } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (password.length < 12) {
      setError("Choose a password of at least 12 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const result = await api.guardianActivate({ code: code.trim(), fullName: fullName.trim(), username: username.trim(), password });
      setDone({ child: result.child.fullName, pending: result.status === "pending", username: result.username });
    } catch (caught) {
      const status = caught instanceof ApiError ? caught.status : 0;
      if (status === 409) setError("That username is taken. Choose another.");
      else if (status === 429) setError("Too many attempts. Wait a few minutes and try again.");
      else if (status === 400) setError("This invitation code can't be used. Check it, or ask the school for a new one.");
      else setError("Something went wrong. Try again shortly.");
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
          <p className={styles.tagline}>Follow your child's school year: attendance, marks and timetable, as the school records them.</p>
        </div>
      </aside>

      <main id="main" className={styles.main}>
        <div className={styles.card}>
          <p className={`eyebrow ${styles.eyebrow}`}>Parent account</p>
          {done !== null ? (
            <>
              <h1 className={styles.title}>You're set up</h1>
              <p className={styles.lede}>
                {done.pending
                  ? `Your link to ${done.child} is waiting for the school office to confirm you. You can sign in now; their records appear once you're confirmed.`
                  : `You're linked to ${done.child}.`}
              </p>
              <p className={styles.hint}>
                Sign in as <strong>{done.username}</strong>.
              </p>
              <a className={`login-submit ${styles.submit}`} href="/login">
                Go to sign in
              </a>
            </>
          ) : (
            <>
              <h1 className={styles.title}>Set up your account</h1>
              <p className={styles.lede}>Enter the invitation code the school gave you. Codes work once and expire after 72 hours.</p>
              <form onSubmit={submit} noValidate>
                <Input id="code" label="Invitation code" autoComplete="off" autoFocus className={styles.fieldInput} value={code} onChange={(event) => setCode(event.target.value)} hint="e.g. ABCDE-FGHJK-MNPQR-STVWX" required />
                <Input id="fullName" label="Your full name" autoComplete="name" className={styles.fieldInput} value={fullName} onChange={(event) => setFullName(event.target.value)} required />
                <Input id="username" label="Choose a username" autoComplete="username" className={styles.fieldInput} value={username} onChange={(event) => setUsername(event.target.value)} hint="Letters, digits and . _ @ -" required />
                <Input id="password" type="password" label="Choose a password" autoComplete="new-password" className={styles.fieldInput} value={password} onChange={(event) => setPassword(event.target.value)} hint="At least 12 characters" required />
                <Input id="confirm" type="password" label="Type it again" autoComplete="new-password" className={styles.fieldInput} value={confirm} onChange={(event) => setConfirm(event.target.value)} required />
                <p className="formerror" role="alert" aria-live="polite">
                  {error}
                </p>
                <Button type="submit" className={`login-submit ${styles.submit}`} disabled={busy}>
                  {busy ? "Setting up…" : "Create account"}
                </Button>
              </form>
              <p className={styles.hint}>
                Already have an account? <a href="/login">Sign in</a>, then link another child from your family page.
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
