"use client";
import { useEffect, useState } from "react";
import { api, ApiError, type Session } from "@/ui/api";
import { Masthead } from "@/ui/Masthead";
import { ManageNav } from "@/ui/ManageNav";

export default function ManageLayout({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    api.session().then(setSession).catch((e) => {
      if (e instanceof ApiError && e.status === 401) window.location.href = "/login";
    });
  }, []);
  return (
    <>
      <Masthead who={session?.displayName} />
      <main id="main" className="page">
        {session ? <ManageNav roles={session.roles} /> : null}
        {children}
      </main>
    </>
  );
}
