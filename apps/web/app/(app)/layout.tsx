"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, currentAcademicYear, type Session } from "@/ui/api";
import { AppShell } from "@/ui/AppShell";
import { ToastProvider } from "@/ui/Toast";
import { Skeleton } from "@/ui/Skeleton";

type Gate = { state: "loading" } | { state: "ok"; session: Session } | { state: "error" };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const year = useMemo(() => currentAcademicYear(), []);
  const [gate, setGate] = useState<Gate>({ state: "loading" });

  const load = useCallback(() => {
    setGate({ state: "loading" });
    api
      .session()
      .then((session) => setGate({ state: "ok", session }))
      .catch((caught) => {
        if (caught instanceof ApiError && caught.status === 401) {
          window.location.href = "/login";
          return;
        }
        setGate({ state: "error" });
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (gate.state === "loading") {
    return (
      <main id="main" style={{ padding: "var(--space-7)" }}>
        <Skeleton lines={4} />
      </main>
    );
  }
  if (gate.state === "error") {
    return (
      <main id="main" className="page" style={{ paddingTop: "var(--space-7)" }}>
        <div className="state">
          <strong>Couldn't reach the register.</strong> The server didn't answer — check your
          connection and try again.
          <div style={{ marginTop: "var(--space-4)" }}>
            <button type="button" className="btn" onClick={load}>
              Try again
            </button>
          </div>
        </div>
      </main>
    );
  }
  return (
    <ToastProvider>
      <AppShell session={gate.session} year={year}>
        {children}
      </AppShell>
    </ToastProvider>
  );
}
