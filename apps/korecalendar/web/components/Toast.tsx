"use client";

import { AnimatePresence, m } from "motion/react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { t } from "@/lib/i18n";
import { duration, ease, spring } from "@/lib/motion";
import { XIcon } from "./icons";

export type ToastOptions = {
  kind?: "info" | "error";
  /** A button in the toast, e.g. Undo. The toast closes when it is pressed. */
  action?: { label: string; onClick: () => void | Promise<void> };
  /** Milliseconds before it goes away; errors stay longer. */
  duration?: number;
};

type Toast = ToastOptions & { id: number; message: string };
type Show = (message: string, options?: ToastOptions) => void;

const ToastContext = createContext<Show>(() => {});

/** `const toast = useToast(); toast("Saved")`. */
export function useToast(): Show {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((x) => x.id !== id)), []);

  const show = useCallback<Show>(
    (message, options = {}) => {
      const id = next.current++;
      setToasts((all) => [...all.slice(-3), { id, message, ...options }]);
      setTimeout(() => dismiss(id), options.duration ?? (options.kind === "error" ? 9000 : options.action ? 8000 : 4500));
    },
    [dismiss],
  );

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4">
        <AnimatePresence mode="popLayout" initial={false}>
        {toasts.map((x) => (
          <m.div
            key={x.id}
            layout
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0, transition: { duration: duration.enter, ease: ease.standard } }}
            exit={{ opacity: 0, transition: { duration: duration.exit, ease: ease.exit } }}
            transition={{ layout: spring.settle }}
            role={x.kind === "error" ? "alert" : "status"}
            className={
              "pointer-events-auto flex max-w-md items-center gap-3 rounded-ui border bg-raised px-4 py-2.5 text-sub shadow-lg shadow-black/40 " +
              (x.kind === "error" ? "border-danger/60" : "border-border-strong")
            }
          >
            <span className="min-w-0 flex-1">{x.message}</span>
            {x.action ? (
              <button
                type="button"
                className="rounded-ui px-2 py-1 font-medium text-accent hover:bg-accent/10"
                onClick={() => {
                  dismiss(x.id);
                  void x.action!.onClick();
                }}
              >
                {x.action.label}
              </button>
            ) : null}
            <button type="button" aria-label={t("toast.dismiss")} className="rounded-ui p-1 text-muted hover:text-text" onClick={() => dismiss(x.id)}>
              <XIcon size={16} />
            </button>
          </m.div>
        ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
