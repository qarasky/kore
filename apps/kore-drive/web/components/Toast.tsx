"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { t } from "@/lib/i18n";

export type ToastInput = {
  message: string;
  tone?: "info" | "error";
  /** An action button (e.g. Undo). The toast shows a pending state while the
   *  returned promise runs, then closes. */
  action?: { label: string; run: () => Promise<void> | void };
};

type Toast = ToastInput & { id: number };

type ToastApi = { show: (t: ToastInput) => void; dismiss: () => void };

const ToastContext = createContext<ToastApi | null>(null);

const TIMEOUT_MS = 8000;

/** Hosts one toast at a time (a new one replaces the old) in a polite live region. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);

  const show = useCallback((input: ToastInput) => {
    setToast((prev) => ({ ...input, id: (prev?.id ?? 0) + 1 }));
  }, []);
  const dismiss = useCallback(() => setToast(null), []);
  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4"
      >
        {toast && (
          <ToastView
            key={toast.id}
            toast={toast}
            onDone={() => setToast((cur) => (cur?.id === toast.id ? null : cur))}
          />
        )}
      </div>
    </ToastContext>
  );
}

function ToastView({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  const [pending, setPending] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (pending || hovered) return;
    const id = window.setTimeout(onDone, TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [pending, hovered, onDone]);

  async function runAction() {
    if (!toast.action || pending) return;
    setPending(true);
    try {
      await toast.action.run();
    } finally {
      onDone();
    }
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={
        "pointer-events-auto flex min-h-row max-w-[560px] items-center gap-3 rounded-ui border bg-raised py-1.5 pr-2 pl-4 " +
        "shadow-[0_12px_32px_-8px_rgba(0,0,0,0.7)] " +
        (toast.tone === "error" ? "border-danger/50" : "border-border-strong")
      }
    >
      <span className={`min-w-0 truncate ${toast.tone === "error" ? "text-danger" : ""}`}>{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={runAction}
          disabled={pending}
          className="min-h-control-sm rounded-ui px-2.5 font-medium text-accent hover:bg-accent/10 disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? t("list.working") : toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={onDone}
        aria-label={t("toast.dismiss")}
        className="flex size-control-sm items-center justify-center rounded-ui text-muted hover:bg-white/5 hover:text-text"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5" stroke="currentColor" strokeWidth={1.6}>
          <path d="m4 4 8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast() outside <ToastProvider>");
  return ctx;
}
