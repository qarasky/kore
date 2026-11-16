import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";
import { Card } from "./Card";
import { Skeleton } from "./Skeleton";

export type StatTone = "default" | "accent" | "success" | "warning" | "danger";

const VALUE_TONE: Record<StatTone, string> = {
  default: "text-text",
  accent: "text-accent-fg",
  success: "text-status-up",
  warning: "text-warning",
  danger: "text-danger",
};

export type StatProps = Omit<ComponentProps<"dl">, "children"> & {
  /** What is measured, 13px muted: "Active users". */
  label: ReactNode;
  /** The figure, 24px semibold with tabular numbers: `12`, `99.98%`, `4m 12s`. */
  value: ReactNode;
  /** A muted line under the figure that gives it context: "of 20 seats", "since 06:00". */
  hint?: ReactNode;
  /** Colours the figure. The label or hint must still say what the colour means. */
  tone?: StatTone;
  /** Shows a placeholder bar instead of the figure while it loads. */
  loading?: boolean;
};

/**
 * One headline number in a Card: label above, figure, optional hint. Put several in a grid
 * (`grid gap-3 sm:grid-cols-2 lg:grid-cols-4`) for an overview row. Not for something that isn't a single
 * figure (a chart, a list) and not for a fraction of a limit (`Meter`).
 */
export function Stat({ label, value, hint, tone = "default", loading = false, className, ...props }: StatProps) {
  return (
    <Card className={cn("p-4", className)}>
      <dl className="flex flex-col gap-1" aria-busy={loading || undefined} {...props}>
        <dt className="text-meta text-muted">{label}</dt>
        <dd className={cn("text-display font-semibold tracking-[-0.01em] tabular-nums", VALUE_TONE[tone])}>
          {loading ? <Skeleton className="my-1 h-5 w-16" /> : value}
        </dd>
        {hint ? <dd className="text-meta text-muted">{hint}</dd> : null}
      </dl>
    </Card>
  );
}
