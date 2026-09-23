"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";
import type { Role } from "./api";
import type { Edition } from "./editionVocabulary";
import { Icon } from "./Icon";
import { domainLabel, visibleNav, SETUP_GROUP, type NavEntry } from "./navConfig";

const COLLAPSE_KEY = "vidya-nav-collapsed";

function loadCollapsed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = JSON.parse(window.localStorage.getItem(COLLAPSE_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

export function Sidebar({ roles, open, onClose, edition = "college" }: { roles: Role[]; open: boolean; onClose: () => void; edition?: Edition }) {
  const pathname = usePathname();
  const groups = visibleNav(roles, edition);
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);

  function toggle(group: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  function renderLink(entry: NavEntry) {
    const active = pathname === entry.href || pathname.startsWith(`${entry.href}/`);
    return (
      <a
        key={entry.href}
        href={entry.href}
        className={`shell-nav-link${active ? " active" : ""}`}
        aria-current={active ? "page" : undefined}
        onClick={onClose}
      >
        <Icon name={entry.icon} size={17} />
        {entry.label}
      </a>
    );
  }

  return (
    <aside className={`shell-side${open ? " open" : ""}`}>
      <div className="shell-side-head">
        <a href="/dashboard" className="wordmark" style={{ textDecoration: "none" }}>
          vidya<span>.</span>
        </a>
        <button type="button" className="ui-iconbtn shell-side-close" aria-label="Close menu" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <nav aria-label="Primary" className="shell-nav">
        {groups.map(({ group, entries }) =>
          group === "TOP" ? (
            <div key={group} className="shell-nav-group">
              {entries.map(renderLink)}
            </div>
          ) : (
            <div key={group} className={group === SETUP_GROUP ? "shell-nav-group shell-nav-group--setup" : "shell-nav-group"}>
              <button
                type="button"
                className="shell-nav-title"
                aria-expanded={!collapsed.has(group)}
                onClick={() => toggle(group)}
              >
                {domainLabel(group)}
                <Icon name="chevronDown" size={14} />
              </button>
              {!collapsed.has(group) ? entries.map(renderLink) : null}
            </div>
          ),
        )}
      </nav>
      <p className="shell-side-foot">Records you're allowed to read — nothing else.</p>
    </aside>
  );
}
