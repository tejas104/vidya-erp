"use client";
import { useEffect, useState } from "react";
import { Button, Card } from "@vidya/ui-system";
import type { Role } from "./api";
import styles from "./InstallPrompt.module.css";

const SEEN_KEY = "vidya-a2hs-seen";
// Matches the shell's own drawer breakpoint (globals.css `@media (max-width: 959px)`)
// rather than inventing a second "mobile" threshold.
const MOBILE_QUERY = "(max-width: 959px)";

// No official DOM lib type for this event yet — minimal shape we use.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * "Add to Home Screen" nudge — teacher/student roles, mobile viewport only,
 * shown at most once ever (persisted in localStorage the moment it's shown,
 * not just on explicit dismissal — so a refresh mid-decision doesn't bring
 * it back).
 */
export function InstallPrompt({ roles }: { roles: Role[] }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  const eligibleRole = roles.some((r) => r === "teacher" || r === "student");

  useEffect(() => {
    if (!eligibleRole) return;
    if (typeof window === "undefined" || window.localStorage.getItem(SEEN_KEY)) return;
    if (!window.matchMedia(MOBILE_QUERY).matches) return;

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      window.localStorage.setItem(SEEN_KEY, "1"); // shown-once: mark on show, not just on dismiss
      setVisible(true);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, [eligibleRole]);

  if (!visible || deferred === null) return null;

  async function install() {
    await deferred?.prompt();
    await deferred?.userChoice;
    setVisible(false);
  }

  return (
    <div className={styles.wrap}>
      <Card>
        <div className={styles.row}>
          <div>
            <p className={styles.title}>Add Vidya to your home screen</p>
            <p className={styles.lede}>Quicker access to attendance and marks — no browser bar.</p>
          </div>
          <div className={styles.actions}>
            <Button size="sm" variant="ghost" onClick={() => setVisible(false)}>Not now</Button>
            <Button size="sm" onClick={install}>Install</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
