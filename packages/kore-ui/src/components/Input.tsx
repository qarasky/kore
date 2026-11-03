"use client";

import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";
import { useFieldControl } from "./Field";

/** Shared look of text inputs, textareas and select triggers. */
export const controlClass =
  "block w-full min-w-0 rounded-ui border border-border bg-bg/60 px-3 text-text outline-none transition-colors " +
  "placeholder:text-muted hover:border-border-strong focus:border-accent focus:ring-2 focus:ring-accent/25 " +
  "focus-visible:outline-none aria-invalid:border-danger/70 aria-invalid:focus:ring-danger/25 " +
  "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border";

export type InputProps = Omit<ComponentProps<"input">, "size"> & {
  /** An icon inside the start of the field (e.g. a search icon). */
  leadingIcon?: ReactNode;
  /** Content inside the end of the field (a unit, a clear button). */
  trailing?: ReactNode;
  /** sm: 32px tall, for toolbars and table filters. */
  size?: "md" | "sm";
  /** filled: raised, borderless until focused (the top-bar search). */
  variant?: "default" | "filled";
};

/** A single-line text input. Put it in a `Field` for a label, hint and error. */
export function Input({ className, leadingIcon, trailing, size = "md", variant = "default", type = "text", ...rest }: InputProps) {
  const props = useFieldControl(rest);
  const input = (
    <input
      type={type}
      className={cn(
        controlClass,
        size === "sm" ? "min-h-control-sm py-1 text-sub" : "min-h-control py-1.5",
        variant === "filled" && "border-transparent bg-raised hover:border-transparent focus:border-accent",
        leadingIcon && "pl-9",
        trailing && "pr-10",
        !leadingIcon && !trailing && className,
      )}
      {...props}
    />
  );
  if (!leadingIcon && !trailing) return input;
  return (
    <div className={cn("relative w-full", className)}>
      {leadingIcon ? (
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted [&_svg]:size-4">
          {leadingIcon}
        </span>
      ) : null}
      {input}
      {trailing ? <span className="absolute inset-y-0 right-1.5 flex items-center text-muted">{trailing}</span> : null}
    </div>
  );
}

export type TextareaProps = ComponentProps<"textarea">;

/** Multi-line text. Grows with `rows`; resize is vertical only. */
export function Textarea({ className, rows = 4, ...rest }: TextareaProps) {
  const props = useFieldControl(rest);
  return <textarea rows={rows} className={cn(controlClass, "resize-y py-2 leading-[1.5]", className)} {...props} />;
}
