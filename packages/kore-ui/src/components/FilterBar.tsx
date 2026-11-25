import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

export type FilterBarProps = ComponentProps<"div"> & {
  /** Accessible name ("Filter users"). */
  label: string;
};

/**
 * The row of controls above a list or table: a search `Input` and a few small `Select`s or `ToggleButton`s that
 * wrap on narrow screens. A named group, so assistive tech announces what the controls act on.
 */
export function FilterBar({ label, className, ...props }: FilterBarProps) {
  return <div role="group" aria-label={label} className={cn("flex flex-wrap items-center gap-2", className)} {...props} />;
}
