"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
import { vocabularyFor, type Edition } from "./editionVocabulary";
import { Icon } from "./Icon";
import { Menu } from "./Menu";
import { NotificationBell } from "./NotificationBell";

export function Topbar({
  displayName,
  year,
  edition = "college",
  onMenu,
  onSearch,
  family = false,
}: {
  displayName: string;
  year?: string;
  edition?: Edition;
  onMenu: () => void;
  onSearch?: () => void;
  /** ADR-0027 guardian session: no staff menu, search or notifications. */
  family?: boolean;
}) {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  const vocabulary = vocabularyFor(edition);

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
      {family ? (
        <a href="/family" className="wordmark shell-top-wordmark">
          vidya<span>.</span>
        </a>
      ) : (
        <>
          <button type="button" className="ui-iconbtn shell-hamburger" aria-label="Open menu" onClick={onMenu}>
            <Icon name="menu" />
          </button>
          <button type="button" className="shell-search-btn" aria-label="Search" onClick={onSearch}>
            <Icon name="search" size={16} />
            <span>Search… ⌘K</span>
          </button>
        </>
      )}
      {year !== undefined ? <span className="shell-top-year num" aria-label={`${vocabulary.academicYear} ${year}`}>AY {year}</span> : null}
      {family ? null : <NotificationBell />}
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
