import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

/** A keyboard key or shortcut, e.g. <Kbd>⌘K</Kbd>. */
export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-border-strong bg-raised px-1",
        "font-sans text-2xs leading-none font-medium text-muted",
        className,
      )}
      {...props}
    />
  );
}
