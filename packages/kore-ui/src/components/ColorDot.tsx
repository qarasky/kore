import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

export type ColorDotProps = Omit<ComponentProps<"span">, "color"> & {
  /** The colour (hex or any CSS colour). */
  color: string;
  /** sm 10px, md 16px (default). */
  size?: "sm" | "md";
  /** `round` (default) or a rounded `square`, like a calendar's key. */
  shape?: "round" | "square";
};

/** A small swatch of a user-chosen colour (a calendar, a label). Decorative: the name is always written next to it. */
export function ColorDot({ color, size = "md", shape = "round", className, style, ...props }: ColorDotProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block shrink-0 border border-border-strong",
        size === "sm" ? "size-2.5" : "size-4",
        shape === "round" ? "rounded-full" : size === "sm" ? "rounded-[3px]" : "rounded-[4px]",
        className,
      )}
      style={{ backgroundColor: color, ...style }}
      {...props}
    />
  );
}
