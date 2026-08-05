"use client";
import { useState } from "react";
import { HelpPanel } from "./HelpPanel";

/**
 * The "?" affordance wired into a page via PageHeader's `help` slot, e.g.
 * `<PageHeader title="…" help={<HelpButton slug="attendance" />} />`.
 * Owns its own open/closed state and renders the HelpPanel — PageHeader
 * itself stays ignorant of slugs, docs, and panels.
 */
export function HelpButton({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="ui-iconbtn" aria-label="Help" onClick={() => setOpen(true)}>
        ?
      </button>
      <HelpPanel slug={slug} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
