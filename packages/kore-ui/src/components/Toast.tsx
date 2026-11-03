"use client";

import { X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "../lib/cn";
import { Spinner } from "./Spinner";

export type ToastTone = "info" | "success" | "error";

export type ToastInput = {
  /** What happened, past tense, short: "Link copied", "Couldn't move 2 files". */
  message: ReactNode;
  tone?: ToastTone;
  /** One action, e.g. Undo. The toast shows a spinner while it runs, then closes. */
  action?: { label: string; onClick: () => Promise<void> | void };
  /** ms before it hides. Default 6000 (errors: 10000). Hover or focus pauses it. */
  duration?: number;
};

type ToastItem = ToastInput & { id: number; open: boolean };

export type ToastApi = {
  /** Shows a toast. A new one replaces the one on screen. Returns its id. */
  show: (toast: ToastInput) => number;
  /** Hides the toast (the current one, or the one with `id`). */
  dismiss: (id?: number) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

/** Exit animation length; the toast is removed after it (or right away under reduced motion). */
const EXIT_MS = 140;

export type ToastProviderProps = {
  children: ReactNode;
  /** Label of the × button. Default "Dismiss". */
  dismissLabel?: string;
  /** Screen-reader name of the region. Default "Notifications". */
  label?: string;
  /** Key that moves focus to the toast. Default "F8". */
  hotkey?: string;
};

/**
 * Hosts toasts: bottom centre, one at a time, in a polite live region. The region never
 * blocks clicks (only the toast itself is clickable), never takes Escape from an open dialog,
 * and a click on a toast doesn't count as "outside" an open dialog. `KoreProvider` includes it.
 */
export function ToastProvider({ children, dismissLabel = "Dismiss", label = "Notifications", hotkey = "F8" }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const regionRef = useRef<HTMLDivElement>(null);

  const show = useCallback((input: ToastInput) => {
    const id = nextId.current++;
    // One at a time: the previous toast leaves as the new one arrives.
    setToasts((list) => [...list.filter((t) => t.open).map((t) => ({ ...t, open: false })), { ...input, id, open: true }]);
    return id;
  }, []);

  const dismiss = useCallback((id?: number) => {
    setToasts((list) => list.map((t) => (id === undefined || t.id === id ? { ...t, open: false } : t)));
  }, []);

  const remove = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  // F8 jumps to the toast (and back is the user's own Shift+Tab / Escape).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== hotkey || e.altKey || e.ctrlKey || e.metaKey) return;
      const toast = regionRef.current?.querySelector<HTMLElement>('[data-kore-toast][data-state="open"]');
      if (!toast) return;
      e.preventDefault();
      toast.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hotkey]);

  return (
    <ToastContext value={api}>
      {children}
      <div
        ref={regionRef}
        role="region"
        aria-label={label}
        // A full-width strip: it must never swallow clicks; only the toast is interactive.
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4"
      >
        <div role="status" aria-live="polite" aria-atomic="true" className="contents">
          {toasts.map((t) => (
            <ToastView key={t.id} toast={t} dismissLabel={dismissLabel} onDismiss={() => dismiss(t.id)} onRemoved={() => remove(t.id)} />
          ))}
        </div>
      </div>
    </ToastContext>
  );
}

function ToastView({
  toast,
  dismissLabel,
  onDismiss,
  onRemoved,
}: {
  toast: ToastItem;
  dismissLabel: string;
  onDismiss: () => void;
  onRemoved: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [paused, setPaused] = useState(false);
  const error = toast.tone === "error";
  const duration = toast.duration ?? (error ? 10000 : 6000);

  // Auto-hide, paused while hovered/focused or while the action runs.
  useEffect(() => {
    if (!toast.open || pending || paused || !Number.isFinite(duration)) return;
    const id = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(id);
  }, [toast.open, pending, paused, duration, onDismiss]);

  // Removal after the exit animation (a timer, so it also happens without animations).
  useEffect(() => {
    if (toast.open) return;
    const id = window.setTimeout(onRemoved, EXIT_MS);
    return () => window.clearTimeout(id);
  }, [toast.open, onRemoved]);

  async function runAction() {
    if (!toast.action || pending) return;
    setPending(true);
    try {
      await toast.action.onClick();
    } finally {
      setPending(false);
      onDismiss();
    }
  }

  return (
    <div
      data-kore-toast=""
      data-state={toast.open ? "open" : "closed"}
      tabIndex={-1}
      aria-hidden={toast.open ? undefined : true}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
      }}
      onKeyDown={(e) => {
        // Only when focus is on the toast itself: Escape elsewhere belongs to the page (or a dialog).
        if (e.key === "Escape") {
          e.stopPropagation();
          onDismiss();
        }
      }}
      className={cn(
        "pointer-events-auto flex min-h-row w-fit max-w-[min(560px,calc(100vw-32px))] items-center gap-3 rounded-ui border bg-raised py-1.5 pr-2 pl-4 outline-none",
        "shadow-overlay focus-visible:ring-2 focus-visible:ring-accent",
        "data-[state=open]:animate-kore-toast-in data-[state=closed]:pointer-events-none data-[state=closed]:animate-kore-toast-out",
        error ? "border-danger/50" : "border-border-strong",
      )}
    >
      {toast.tone === "success" ? <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-status-up" /> : null}
      <div className={cn("min-w-0 flex-1", error && "text-danger")}>{toast.message}</div>
      {toast.action ? (
        <button
          type="button"
          onClick={() => void runAction()}
          disabled={pending}
          aria-busy={pending || undefined}
          className="inline-flex min-h-control-sm items-center gap-2 rounded-ui px-2.5 font-medium text-accent hover:bg-accent/10 disabled:cursor-wait"
        >
          {pending ? <Spinner size={14} /> : null}
          {toast.action.label}
        </button>
      ) : null}
      <button
        type="button"
        aria-label={dismissLabel}
        onClick={onDismiss}
        className="grid size-control-sm shrink-0 place-items-center rounded-ui text-muted hover:bg-white/5 hover:text-text"
      >
        <X aria-hidden className="size-3.5" />
      </button>
    </div>
  );
}

/** `const toast = useToast(); toast.show({ message: "Saved" })`. Needs a ToastProvider (or KoreProvider) above. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast() needs a <ToastProvider> (or <KoreProvider>) above it.");
  return ctx;
}
