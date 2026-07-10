"use client";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

type Tone = "good" | "danger" | "info";
interface ToastItem {
  id: number;
  message: string;
  tone: Tone;
}

const ToastCtx = createContext<{ show: (message: string, tone?: Tone) => void } | null>(null);
let seq = 0;

/** No-op outside a provider so pages remain unit-testable without wrapping. */
export function useToast() {
  const ctx = useContext(ToastCtx);
  return ctx ?? { show: () => undefined };
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const show = useCallback((message: string, tone: Tone = "info") => {
    const id = ++seq;
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <div className="ui-toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`ui-toast ${toast.tone}`}>
            <Icon name={toast.tone === "good" ? "check" : toast.tone === "danger" ? "alert" : "info"} size={16} />
            {toast.message}
            <button
              type="button"
              className="ui-iconbtn"
              aria-label="Dismiss"
              onClick={() => setToasts((current) => current.filter((t) => t.id !== toast.id))}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
