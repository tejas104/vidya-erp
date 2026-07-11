"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
import { Icon } from "./Icon";
import { Menu } from "./Menu";

export function Topbar({ displayName, year, onMenu }: { displayName: string; year?: string; onMenu: () => void }) {
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

  async function signOut() {
    await api.logout();
    window.location.href = "/login";
  }

  return (
    <header className="shell-top">
      <button type="button" className="ui-iconbtn shell-hamburger" aria-label="Open menu" onClick={onMenu}>
        <Icon name="menu" />
      </button>
      <div className="shell-top-spacer" />
      {year !== undefined ? <span className="shell-top-year num">AY {year}</span> : null}
      <Menu
        label={displayName}
        items={[
          { label: theme === "dark" ? "Paper (light)" : "Chalk (dark)", icon: theme === "dark" ? "sun" : "moon", onSelect: toggleTheme },
          { label: "Sign out", icon: "signOut", onSelect: () => void signOut() },
        ]}
      />
    </header>
  );
}
