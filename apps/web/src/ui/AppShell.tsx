"use client";
import { useState, type ReactNode } from "react";
import type { Session } from "./api";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppShell({ session, year, children }: { session: Session; year?: string; children: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  return (
    <div className="shell">
      <Sidebar roles={session.roles} open={drawer} onClose={() => setDrawer(false)} />
      {drawer ? <div className="shell-drawer-scrim" onMouseDown={() => setDrawer(false)} /> : null}
      <div className="shell-body">
        <Topbar displayName={session.displayName} year={year} onMenu={() => setDrawer((open) => !open)} />
        <main id="main" className="page shell-page">
          {children}
        </main>
      </div>
    </div>
  );
}
