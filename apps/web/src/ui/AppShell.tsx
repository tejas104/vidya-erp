"use client";
import { useEffect, useState, type ReactNode } from "react";
import { ToastProvider } from "@vidya/ui-system";
import type { Session } from "./api";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { SearchPalette } from "./search/SearchPalette";
import { Breadcrumbs } from "./Breadcrumbs";
import { InstallPrompt } from "./InstallPrompt";
import { LicenseBanner } from "./LicenseBanner";

export function AppShell({ session, year, children, edition = "college" }: { session: Session; year?: string; children: ReactNode; edition?: "college" | "school" }) {
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
    <ToastProvider>
      <div className="shell">
        <Sidebar roles={session.roles} edition={edition} open={drawer} onClose={() => setDrawer(false)} />
        {drawer ? <div className="shell-drawer-scrim" onMouseDown={() => setDrawer(false)} /> : null}
        <div className="shell-body">
          <Topbar
            displayName={session.displayName}
            year={year}
            onMenu={() => setDrawer((open) => !open)}
            onSearch={() => setSearchOpen(true)}
          />
          <LicenseBanner roles={session.roles} />
          <main id="main" className="page shell-page">
            <Breadcrumbs />
            {children}
          </main>
        </div>
        <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} roles={session.roles} edition={edition} />
        <InstallPrompt roles={session.roles} />
      </div>
    </ToastProvider>
  );
}
