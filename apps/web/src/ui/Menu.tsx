"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { pushOverlay, popOverlay, isTopOverlay } from "./overlayStack";

export interface MenuItem {
  label: string;
  icon?: IconName;
  onSelect: () => void;
}

export function Menu({ label, items }: { label: ReactNode; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const overlayId = pushOverlay();
    function onDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (!isTopOverlay(overlayId)) return;
        setOpen(false);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const buttons = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>(".ui-menu-item") ?? []);
        if (buttons.length === 0) return;
        event.preventDefault();
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          event.key === "ArrowDown"
            ? buttons[(index + 1) % buttons.length]
            : buttons[(index - 1 + buttons.length) % buttons.length];
        next?.focus();
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      popOverlay(overlayId);
    };
  }, [open]);

  return (
    <div className="ui-menu-root" ref={rootRef}>
      <button type="button" className="ui-menubtn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label}
        <Icon name="chevronDown" size={14} />
      </button>
      {open ? (
        <div className="ui-menu" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="ui-menu-item"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon !== undefined ? <Icon name={item.icon} size={15} /> : null}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
