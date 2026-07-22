"use client";
import { useEffect, useRef, type RefObject } from "react";
import { pushOverlay, popOverlay, isTopOverlay } from "./overlayStack";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Shared a11y wiring for Modal + SlideOver: registers with the stacked-
 * overlay tracker so only the topmost overlay reacts to Escape, moves focus
 * into the panel on open, traps Tab within it, and restores focus to the
 * opener on close. */
export function useOverlayTrap(
  open: boolean,
  onClose: () => void,
  panelRef: RefObject<HTMLElement | null>,
): void {
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    const overlayId = pushOverlay();
    openerRef.current = document.activeElement;
    const panel = panelRef.current;
    const focusables = () => Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    (focusables()[0] ?? panel)?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (!isTopOverlay(overlayId)) return;
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      popOverlay(overlayId);
      (openerRef.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose, panelRef]);
}
