"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

export function Masthead({ who, year }: { who?: string; year?: string }) {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("vidya-theme");
    if (stored === "light" || stored === "dark") {
      setTheme(stored);
    }
  }, []);

  function toggle() {
    const root = document.documentElement;
    const isDark =
      root.getAttribute("data-theme") === "dark" ||
      (root.getAttribute("data-theme") === null &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    const next = isDark ? "light" : "dark";
    root.setAttribute("data-theme", next);
    localStorage.setItem("vidya-theme", next);
    setTheme(next);
  }

  async function signOut() {
    await api.logout();
    window.location.href = "/login";
  }

  return (
    <header className="masthead">
      <div className="masthead-inner">
        <a href="/dashboard" className="wordmark" style={{ textDecoration: "none" }}>
          vidya<span>.</span>
        </a>
        <div className="masthead-meta">
          {year !== undefined ? <span>AY {year}</span> : null}
          {who !== undefined ? <span>{who}</span> : null}
          <button className="theme-toggle" onClick={toggle} type="button">
            {theme === "dark" ? "chalk" : "paper"}
          </button>
          {who !== undefined ? (
            <button className="theme-toggle" onClick={signOut} type="button">
              sign out
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
