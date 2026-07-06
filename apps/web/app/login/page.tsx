"use client";

import { useState } from "react";
import { api, ApiError } from "@/ui/api";
import { Masthead } from "@/ui/Masthead";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
    <>
      <Masthead />
      <main id="main" className="page" style={{ maxWidth: 440, paddingTop: 56 }}>
        <p className="eyebrow">The staff register</p>
        <h1 className="page-title">Sign in</h1>
        <p className="page-lede">Your dashboard shows only the classes and records in your scope.</p>
        <form onSubmit={submit} className="card" noValidate>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              name="username"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          <p className="formerror" role="alert" aria-live="polite">
            {error}
          </p>
          <button className="btn" type="submit" disabled={busy} style={{ width: "100%" }}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </main>
    </>
  );
}
