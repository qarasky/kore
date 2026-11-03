"use client";

import { X } from "lucide-react";
import { Toast as RadixToast } from "radix-ui";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
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

export type ToastProviderProps = {
  children: ReactNode;
  /** Label of the × button. Default "Dismiss". */
  dismissLabel?: string;
  /** Screen-reader name of the region (F8 jumps to it). Default "Notifications ({hotkey})". */
  label?: string;
};

/** Hosts toasts (bottom centre, one at a time, in a polite live region). `KoreProvider` includes it. */
export function ToastProvider({ children, dismissLabel = "Dismiss", label }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const show = useCallback(
    (input: ToastInput) => {
      const id = nextId.current++;
      // One at a time: the previous toast closes (and animates out) as the new one opens.
      setToasts((list) => [...list.filter((t) => t.open).map((t) => ({ ...t, open: false })), { ...input, id, open: true }]);
      return id;
    },
    [],
  );

  const dismiss = useCallback((id?: number) => {
    setToasts((list) => list.map((t) => (id === undefined || t.id === id ? { ...t, open: false } : t)));
  }, []);

  const remove = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext value={api}>
      <RadixToast.Provider swipeDirection="down" label={label}>
        {children}
        {toasts.map((t) => (
          <ToastView
            key={t.id}
            toast={t}
            dismissLabel={dismissLabel}
            onOpenChange={(open) => {
              if (!open) dismiss(t.id);
            }}
            onClosed={() => remove(t.id)}
          />
        ))}
        <RadixToast.Viewport className="fixed inset-x-0 bottom-4 z-[60] m-0 flex list-none flex-col items-center gap-2 px-4 outline-none" />
      </RadixToast.Provider>
    </ToastContext>
  );
}

function ToastView({
  toast,
  dismissLabel,
  onOpenChange,
  onClosed,
}: {
  toast: ToastItem;
  dismissLabel: string;
  onOpenChange: (open: boolean) => void;
  onClosed: () => void;
}) {
  const [pending, setPending] = useState(false);
  const error = toast.tone === "error";

  async function runAction() {
    if (!toast.action || pending) return;
    setPending(true);
    try {
      await toast.action.onClick();
    } finally {
      setPending(false);
      onOpenChange(false);
    }
  }

  return (
    <RadixToast.Root
      open={toast.open}
      onOpenChange={onOpenChange}
      duration={pending ? Infinity : (toast.duration ?? (error ? 10000 : 6000))}
      type={error ? "foreground" : "background"}
      onAnimationEnd={() => {
        if (!toast.open) onClosed();
      }}
      className={cn(
        "pointer-events-auto flex min-h-row w-fit max-w-[min(560px,calc(100vw-32px))] items-center gap-3 rounded-ui border bg-raised py-1.5 pr-2 pl-4",
        "shadow-overlay data-[state=open]:animate-kore-toast-in data-[state=closed]:animate-kore-toast-out",
        "data-[swipe=move]:translate-y-[var(--radix-toast-swipe-move-y)] data-[swipe=cancel]:translate-y-0 data-[swipe=end]:animate-kore-toast-out",
        error ? "border-danger/50" : "border-border-strong",
      )}
    >
      {toast.tone === "success" ? <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-status-up" /> : null}
      <RadixToast.Description className={cn("min-w-0 flex-1", error && "text-danger")}>{toast.message}</RadixToast.Description>
      {toast.action ? (
        <RadixToast.Action altText={toast.action.label} asChild>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              void runAction();
            }}
            disabled={pending}
            aria-busy={pending || undefined}
            className="inline-flex min-h-control-sm items-center gap-2 rounded-ui px-2.5 font-medium text-accent hover:bg-accent/10 disabled:cursor-wait"
          >
            {pending ? <Spinner size={14} /> : null}
            {toast.action.label}
          </button>
        </RadixToast.Action>
      ) : null}
      <RadixToast.Close
        aria-label={dismissLabel}
        className="grid size-control-sm shrink-0 place-items-center rounded-ui text-muted hover:bg-white/5 hover:text-text"
      >
        <X aria-hidden className="size-3.5" />
      </RadixToast.Close>
    </RadixToast.Root>
  );
}

/** `const toast = useToast(); toast.show({ message: "Saved" })`. Needs a ToastProvider (or KoreProvider) above. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast() needs a <ToastProvider> (or <KoreProvider>) above it.");
  return ctx;
}
