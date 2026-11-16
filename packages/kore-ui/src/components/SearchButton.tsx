"use client";

import { Search } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";
import { Kbd } from "./Kbd";

export type SearchButtonProps = Omit<ComponentProps<"button">, "children"> & {
  /** What it searches, shown as the placeholder and used as the name: "Search monitors". Default "Search". */
  label?: string;
  /** The shortcut shown at the end, default "⌘K". Pass `null` for none. */
  hint?: string | null;
};

/**
 * The top bar's search box when searching opens something else (a `CommandPalette`): it looks like the filled
 * search `Input` but is a button, so there is no half-working text field. Wire `onClick` to open the palette.
 */
export function SearchButton({ label = "Search", hint = "⌘K", className, type, ...props }: SearchButtonProps) {
  return (
    <button
      type={type ?? "button"}
      className={cn(
        "flex min-h-control w-full max-w-[420px] min-w-0 items-center gap-2.5 rounded-ui border border-transparent bg-raised px-3 text-left text-muted",
        "transition-colors hover:border-border-strong hover:text-text",
        className,
      )}
      {...props}
    >
      <Search aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint ? <Kbd aria-hidden="true">{hint}</Kbd> : null}
    </button>
  );
}
