import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

export type Status = "up" | "warn" | "down" | "maint" | "off" | "accent";

const DOT: Record<Status, string> = {
  up: "rounded-full bg-status-up",
  warn: "rounded-full bg-status-warn",
  // Down is a diamond, so it reads without colour.
  down: "rotate-45 rounded-[1.5px] bg-status-down scale-90",
  maint: "rounded-full border-2 border-status-maint",
  off: "rounded-full border-2 border-status-off",
  accent: "rounded-full bg-accent",
};

const TEXT: Record<Status, string> = {
  up: "text-text",
  warn: "text-status-warn",
  down: "text-status-down",
  maint: "text-status-maint",
  off: "text-muted",
  accent: "text-text",
};

export type StatusDotProps = Omit<ComponentProps<"span">, "children"> & {
  status: Status;
  /** The state in words ("Up", "Connected"). Shown next to the dot. Without it the dot is decorative. */
  label?: string;
  /** Colour the label like the dot (default true for warn/down/maint). */
  tintLabel?: boolean;
  /** A slow pulse for live/active states. */
  pulse?: boolean;
};

/**
 * A status indicator: up (green), warn (yellow), down (red diamond), maint (violet ring),
 * off (grey ring), accent (connected). Always pair it with words.
 */
export function StatusDot({ status, label, tintLabel = true, pulse = false, className, ...props }: StatusDotProps) {
  const dot = (
    <span aria-hidden="true" className="relative inline-flex size-2 shrink-0">
      {pulse ? (
        <span className={cn("absolute inset-0 animate-ping opacity-50", DOT[status])} />
      ) : null}
      <span className={cn("relative size-2", DOT[status])} />
    </span>
  );
  if (!label) return <span className={cn("inline-flex items-center", className)} {...props}>{dot}</span>;
  return (
    <span className={cn("inline-flex items-center gap-2", className)} {...props}>
      {dot}
      <span className={cn("text-sub", tintLabel ? TEXT[status] : "text-text")}>{label}</span>
    </span>
  );
}
