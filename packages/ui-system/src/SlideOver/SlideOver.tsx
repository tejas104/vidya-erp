"use client";
import { useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useOverlayTrap } from "../overlayTrap";
import styles from "./SlideOver.module.css";

export function SlideOver({
  open,
  onClose,
  title,
  children,
  width,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlayTrap(open, onClose, panelRef);

  if (!open) return null;
  const style: CSSProperties | undefined = width ? { width } : undefined;
  return createPortal(
    <div
      className={styles.scrim}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={styles.panel}
        style={style}
        tabIndex={-1}
      >
        <div className={styles.head}>
          <h2 className={styles.title}>{title}</h2>
          <button type="button" className={styles.closeBtn} aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className={styles.body}>{children}</div>
      </aside>
    </div>,
    document.body,
  );
}
