"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";
import { Spinner } from "./Spinner";

export const buttonVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-2 rounded-ui font-medium whitespace-nowrap " +
    "transition-colors select-none disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed " +
    "aria-disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        /** The one main action of a view, card or dialog. */
        primary: "bg-accent text-white hover:bg-accent-hover disabled:hover:bg-accent",
        /** Everything else that is a button. */
        secondary: "border border-border-strong text-text hover:bg-white/5 disabled:hover:bg-transparent",
        /** Low-emphasis actions in toolbars and rows. */
        ghost: "text-text hover:bg-white/5 disabled:hover:bg-transparent",
        /** Confirms something destructive (inside a ConfirmDialog). */
        danger: "bg-danger-solid text-white hover:bg-danger-solid-hover disabled:hover:bg-danger-solid",
        /** Opens a destructive flow (row "Delete"): quiet until hovered. */
        "danger-outline":
          "border border-border-strong text-danger hover:border-danger/60 hover:bg-danger/10 disabled:hover:bg-transparent",
        /** Inline text action. */
        link: "h-auto! min-h-0! px-0! text-accent underline-offset-2 hover:underline",
      },
      size: {
        md: "min-h-control px-4 text-[15px]",
        sm: "min-h-control-sm px-3 text-sub",
      },
      fullWidth: { true: "w-full" },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    /** Render the child element (e.g. a link) with button styles instead of a `<button>`. */
    asChild?: boolean;
    /** Shows a spinner, disables the button and sets `aria-busy`. Keep the label (or swap it for "Saving…"). */
    loading?: boolean;
  };

/**
 * A button. `variant`: primary | secondary (default) | ghost | danger | danger-outline | link.
 * `size`: md (40px) | sm (32px). Icons go in `children` before the label.
 */
export function Button({
  className,
  variant,
  size,
  fullWidth,
  asChild = false,
  loading = false,
  disabled,
  type,
  children,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size, fullWidth }), loading && "cursor-wait!", className);
  if (asChild) {
    return (
      <Slot.Root className={classes} aria-busy={loading || undefined} {...props}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button
      type={type ?? "button"}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={classes}
      {...props}
    >
      {loading ? <Spinner size={14} /> : null}
      {children}
    </button>
  );
}
