"use client";
import { useEffect, useState, type ReactNode } from "react";
import { ToastProvider } from "@vidya/ui-system";
import type { Session } from "./api";
import type { Edition } from "./editionVocabulary";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { SearchPalette } from "./search/SearchPalette";
import { Breadcrumbs } from "./Breadcrumbs";
import { InstallPrompt } from "./InstallPrompt";
import { LicenseBanner } from "./LicenseBanner";
import { HelpEditionProvider } from "./help/HelpEditionContext";

export function AppShell({ session, year, children, edition = "college" }: { session: Session; year?: string; children: ReactNode; edition?: Edition }) {
  const [drawer, setDrawer] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // ADR-0027: a guardian gets the same shell without any staff surface — no
  // rail, search, licence banner or install prompt. The server refuses them
  // those routes anyway; this keeps the screen from offering dead ends.
  const family = session.kind === "guardian";

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (family) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [family]);

  return (
    <ToastProvider>
      <HelpEditionProvider edition={edition}>
        <div className="shell">
          {family ? null : <Sidebar roles={session.roles} edition={edition} open={drawer} onClose={() => setDrawer(false)} />}
          {drawer && !family ? <div className="shell-drawer-scrim" onMouseDown={() => setDrawer(false)} /> : null}
          <div className="shell-body">
            <Topbar
              displayName={session.displayName}
              year={year}
              edition={edition}
              onMenu={() => setDrawer((open) => !open)}
              onSearch={() => setSearchOpen(true)}
              family={family}
            />
            {family ? null : <LicenseBanner roles={session.roles} />}
            <main id="main" className="page shell-page">
              <Breadcrumbs edition={edition} />
              {children}
            </main>
          </div>
          {family ? null : (
            <>
              <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} roles={session.roles} edition={edition} />
              <InstallPrompt roles={session.roles} />
            </>
          )}
        </div>
      </HelpEditionProvider>
    </ToastProvider>
  );
}
