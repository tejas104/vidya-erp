"use client";
import { useEffect, useRef, useState } from "react";
import { api, type NoticeView, type NoticeKind } from "./api";
import { Icon } from "./Icon";
import { pushOverlay, popOverlay, isTopOverlay } from "./overlayStack";

const SEEN_KEY = "vidya-notifs-seen";

const KIND_TONE: Record<NoticeKind, string> = {
  holiday: "var(--good)",
  exam: "var(--bad)",
  event: "var(--brand)",
  notice: "var(--ink-2)",
};
const KIND_SOFT: Record<NoticeKind, string> = {
  holiday: "var(--good-soft)",
  exam: "var(--bad-soft)",
  event: "var(--brand-soft)",
  notice: "var(--line-2)",
};

/** "just now" / "3h ago" / "2d ago" / a date past a week. */
function ago(iso: string): string {
  const secs = (Date.now() - new Date(iso).getTime()) / 1000;
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

type Load =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ok"; notices: NoticeView[] };

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [seen, setSeen] = useState<string>("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSeen(localStorage.getItem(SEEN_KEY) ?? "");
    let alive = true;
    api
      .ntcVisible()
      .then((r) => alive && setLoad({ state: "ok", notices: r.notices }))
      .catch(() => alive && setLoad({ state: "error" }));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const overlayId = pushOverlay();
    function onDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && isTopOverlay(overlayId)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      popOverlay(overlayId);
    };
  }, [open]);

  const notices = load.state === "ok" ? load.notices : [];
  const unread = notices.filter((n) => n.publishAt > seen).length;

  function toggle() {
    setOpen((wasOpen) => {
      if (!wasOpen) {
        // opening clears the badge — mark everything seen as of now
        const now = new Date().toISOString();
        localStorage.setItem(SEEN_KEY, now);
        setSeen(now);
      }
      return !wasOpen;
    });
  }

  return (
    <div className="ui-menu-root notif-root" ref={rootRef}>
      <button
        type="button"
        className="ui-iconbtn notif-btn"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <Icon name="bell" />
        {unread > 0 ? <span className="notif-badge num">{unread > 9 ? "9+" : unread}</span> : null}
      </button>
      {open ? (
        <div className="ui-menu notif-panel" role="menu" aria-label="Notifications">
          <div className="notif-head">Notifications</div>
          {load.state === "loading" ? (
            <div className="notif-msg">Loading…</div>
          ) : load.state === "error" ? (
            <div className="notif-msg">Couldn’t load notifications.</div>
          ) : notices.length === 0 ? (
            <div className="notif-msg">No notices yet.</div>
          ) : (
            <ul className="notif-list">
              {notices.map((n) => (
                <li key={n.id} className="notif-item">
                  <span
                    className="notif-dot"
                    style={{ background: KIND_SOFT[n.kind], borderColor: KIND_TONE[n.kind] }}
                    aria-hidden="true"
                  />
                  <div className="notif-body">
                    <div className="notif-title">{n.title}</div>
                    <div className="notif-meta">
                      <span style={{ textTransform: "capitalize", color: KIND_TONE[n.kind] }}>{n.kind}</span>
                      {" · "}
                      {n.audienceLabel} · <span className="num">{ago(n.publishAt)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
