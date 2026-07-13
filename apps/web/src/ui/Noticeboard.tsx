"use client";
import { useEffect, useState } from "react";
import { api, type NoticeView } from "./api";
import { Badge } from "./Badge";
import { EmptyState } from "./EmptyState";

const INITIAL_SHOWN = 5;

/** The staff-room noticeboard card — shared by the dashboard and the portal.
 * Renders nothing at all while the notices module isn't answering, an
 * EmptyState when the board is clear, and rules-divided entries otherwise. */
export function Noticeboard() {
  const [notices, setNotices] = useState<NoticeView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    api.ntcVisible()
      .then((result) => setNotices(result.notices))
      .catch(() => setFailed(true));
  }, []);

  if (failed || notices === null) return null;

  const shown = showAll ? notices : notices.slice(0, INITIAL_SHOWN);
  return (
    <section className="section" aria-label="Noticeboard">
      <div className="section-head"><h2>Noticeboard</h2></div>
      {notices.length === 0 ? (
        <EmptyState title="Nothing on the board." message="Notices from the college appear here." />
      ) : (
        <div style={{ display: "grid", gap: 0 }}>
          {shown.map((notice) => (
            <article key={notice.id} style={{ borderTop: "1px solid var(--rule)", padding: "var(--space-3) 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                <strong>{notice.title}</strong>
                <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                  <Badge>{notice.audienceLabel}</Badge>
                  <span className="num" style={{ fontSize: 12, color: "var(--ink-3)" }}>{notice.publishAt.slice(0, 10)}</span>
                </span>
              </div>
              <p style={{ margin: "4px 0 0", fontSize: 13.5, whiteSpace: "pre-wrap" }}>{notice.body}</p>
            </article>
          ))}
          {notices.length > INITIAL_SHOWN && !showAll ? (
            <button type="button" className="btn ghost" style={{ justifySelf: "start", marginTop: "var(--space-2)" }} onClick={() => setShowAll(true)}>
              Older notices ({notices.length - INITIAL_SHOWN})
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
