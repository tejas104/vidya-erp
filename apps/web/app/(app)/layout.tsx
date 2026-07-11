"use client";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError, currentAcademicYear, type Session } from "@/ui/api";
import { AppShell } from "@/ui/AppShell";
import { ToastProvider } from "@/ui/Toast";
import { Skeleton } from "@/ui/Skeleton";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const year = useMemo(() => currentAcademicYear(), []);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    api.session().then(setSession).catch((caught) => {
      if (caught instanceof ApiError && caught.status === 401) window.location.href = "/login";
    });
  }, []);

  if (session === null) {
    return (
      <div style={{ padding: "var(--space-7)" }}>
        <Skeleton lines={4} />
      </div>
    );
  }
  return (
    <ToastProvider>
      <AppShell session={session} year={year}>
        {children}
      </AppShell>
    </ToastProvider>
  );
}
