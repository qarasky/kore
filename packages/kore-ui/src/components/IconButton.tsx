"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";
import { Tooltip } from "./Tooltip";

export const iconButtonVariants = cva(
  "inline-grid shrink-0 place-items-center rounded-ui transition-colors disabled:cursor-not-allowed disabled:opacity-60 " +
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        ghost: "text-muted hover:bg-white/5 hover:text-text disabled:hover:bg-transparent disabled:hover:text-muted",
        secondary: "border border-border-strong text-text hover:bg-white/5",
        primary: "bg-accent text-white hover:bg-accent-hover",
        danger: "text-muted hover:bg-danger/10 hover:text-danger",
      },
      size: {
        md: "size-control [&_svg:not([class*='size-'])]:size-[18px]",
        sm: "size-control-sm",
      },
    },
    defaultVariants: { variant: "ghost", size: "sm" },
  },
);

export type IconButtonProps = Omit<ComponentProps<"button">, "children"> &
  VariantProps<typeof iconButtonVariants> & {
    /** Accessible name (required: the button has no visible text). Also the tooltip text. */
    label: string;
    /** The icon (a lucide icon). */
    icon?: ReactNode;
    children?: ReactNode;
    /** Show `label` as a tooltip on hover/focus. Default true. */
    tooltip?: boolean;
    asChild?: boolean;
  };

/** A square, icon-only button: 32px (`sm`, default) or 40px (`md`). */
export function IconButton({
  label,
  icon,
  children,
  variant,
  size,
  tooltip = true,
  asChild = false,
  className,
  type,
  ...props
}: IconButtonProps) {
  const classes = cn(iconButtonVariants({ variant, size }), className);
  const button = asChild ? (
    <Slot.Root aria-label={label} className={classes} {...props}>
      {children}
    </Slot.Root>
  ) : (
    <button type={type ?? "button"} aria-label={label} className={classes} {...props}>
      {icon ?? children}
    </button>
  );
  return tooltip ? <Tooltip content={label}>{button}</Tooltip> : button;
}
