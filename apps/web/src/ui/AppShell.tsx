"use client";
import { useEffect, useState, type ReactNode } from "react";
import type { Session } from "./api";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { SearchPalette } from "./search/SearchPalette";
import { Breadcrumbs } from "./Breadcrumbs";

export function AppShell({ session, year, children }: { session: Session; year?: string; children: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="shell">
      <Sidebar roles={session.roles} open={drawer} onClose={() => setDrawer(false)} />
      {drawer ? <div className="shell-drawer-scrim" onMouseDown={() => setDrawer(false)} /> : null}
      <div className="shell-body">
        <Topbar
          displayName={session.displayName}
          year={year}
          onMenu={() => setDrawer((open) => !open)}
          onSearch={() => setSearchOpen(true)}
        />
        <main id="main" className="page shell-page">
          <Breadcrumbs />
          {children}
        </main>
      </div>
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} roles={session.roles} />
    </div>
  );
}
