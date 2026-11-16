"use client";

import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";
import { IconButton } from "./IconButton";

export type SelectionBarProps = Omit<ComponentProps<"div">, "children"> & {
  /** How many items are selected. The bar renders nothing at 0. */
  count: number;
  /** The summary in words, default "{count} selected". Translate here. */
  summary?: ReactNode;
  /** The actions on the selection: small Buttons (Delete last, `danger-outline`). */
  actions: ReactNode;
  /** Called by the × button. */
  onClear: () => void;
  /** Accessible names. Defaults: "Selection actions" and "Clear selection". */
  labels?: { toolbar?: string; clear?: string };
};

/**
 * A bar that floats at the bottom centre while rows are selected: "3 selected", the actions that apply to them, and
 * a × to clear. A `role="toolbar"` over the content (below dialogs and toasts), so keep the selection visible in
 * the list too. Render it always and let `count` show it.
 */
export function SelectionBar({ count, summary, actions, onClear, labels, className, ...props }: SelectionBarProps) {
  if (count <= 0) return null;
  return (
    <div
      role="toolbar"
      aria-label={labels?.toolbar ?? "Selection actions"}
      className={cn(
        "fixed bottom-6 left-1/2 z-(--z-drawer) flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2 rounded-overlay",
        "border border-border-strong bg-raised py-1.5 pr-1.5 pl-4 shadow-overlay animate-kore-toast-in",
        className,
      )}
      {...props}
    >
      <span className="text-sub font-medium whitespace-nowrap tabular-nums">{summary ?? `${count} selected`}</span>
      <span aria-hidden="true" className="mx-1 h-5 w-px bg-border-strong" />
      <div className="flex items-center gap-1.5">{actions}</div>
      <IconButton label={labels?.clear ?? "Clear selection"} icon={<X />} onClick={onClear} />
    </div>
  );
}
