"use client";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
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

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const push = useCallback((toast: ToastInput) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, AUTO_DISMISS_MS);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      {typeof document !== "undefined"
        ? createPortal(
            <div className={styles.stack}>
              {toasts.map((t) => (
                <div key={t.id} role="status" className={`${styles.toast} ${styles[t.status]}`}>
                  {t.icon !== undefined ? (
                    <span className={styles.icon} aria-hidden="true">
                      {t.icon}
                    </span>
                  ) : null}
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
