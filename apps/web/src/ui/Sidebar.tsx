"use client";
import { usePathname } from "next/navigation";
import type { Role } from "./api";
import { Icon } from "./Icon";
import { visibleNav } from "./navConfig";

export function Sidebar({ roles, open, onClose }: { roles: Role[]; open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const groups = visibleNav(roles);
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
        {groups.map(({ group, entries }) => (
          <div key={group} className="shell-nav-group">
            <p className="shell-nav-title">{group}</p>
            {entries.map((entry) => {
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
            })}
          </div>
        ))}
      </nav>
      <p className="shell-side-foot">Records you're allowed to read — nothing else.</p>
    </aside>
  );
}
