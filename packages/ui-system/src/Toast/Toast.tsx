"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import styles from "./Toast.module.css";

export type ToastStatus = "good" | "danger" | "info";

export interface ToastInput {
  status: ToastStatus;
  message: string;
  icon?: ReactNode;
}

interface ToastItem extends ToastInput {
  id: number;
}

const AUTO_DISMISS_MS = 4000;

/** Non-color status signal shown when the caller doesn't pass an `icon`, so
 * status is never conveyed by border/color alone. */
const STATUS_GLYPH: Record<ToastStatus, string> = {
  good: "✓",
  danger: "✕",
  info: "i",
};

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (toast: ToastInput) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { ...toast, id }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), AUTO_DISMISS_MS),
      );
    },
    [dismiss],
  );

  // Unmounting with toasts still pending would otherwise fire their timers
  // into a dead component (setState-after-unmount warning / leak).
  useEffect(() => {
    return () => {
      timers.current.forEach((timer) => clearTimeout(timer));
      timers.current.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      {typeof document !== "undefined"
        ? createPortal(
            <div className={styles.stack}>
              {toasts.map((t) => (
                <div key={t.id} role="status" className={`${styles.toast} ${styles[t.status]}`}>
                  <span className={styles.icon} aria-hidden="true">
                    {t.icon ?? STATUS_GLYPH[t.status]}
                  </span>
                  <span>{t.message}</span>
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </ToastContext.Provider>
  );
}

/** Returns `push({ status, message, icon? })` to enqueue a toast. Must be
 * called under a mounted `ToastProvider`. */
export function useToast(): { push: (toast: ToastInput) => void } {
  const push = useContext(ToastContext);
  if (!push) throw new Error("useToast must be used within a ToastProvider");
  return { push };
}
