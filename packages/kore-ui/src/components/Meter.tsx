import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export type MeterTone = "accent" | "warning" | "danger";

export type MeterThresholds = {
  /** Fraction (0–1) from which the bar turns warning-coloured. Default 0.8. */
  warning?: number;
  /** Fraction (0–1) from which the bar turns red. Default 0.9. */
  danger?: number;
};

/** Which tone a fraction gets for the given thresholds. */
export function meterTone(fraction: number, thresholds: MeterThresholds = {}): MeterTone {
  const { warning = 0.8, danger = 0.9 } = thresholds;
  if (fraction >= danger) return "danger";
  if (fraction >= warning) return "warning";
  return "accent";
}

const FILL: Record<MeterTone, string> = { accent: "bg-accent", warning: "bg-warning", danger: "bg-danger" };

function clampFraction(value: number, max: number): number {
  if (!(max > 0) || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value / max));
}

export type MeterProps = {
  /** What is measured ("Storage"). Shown above the bar and used as its accessible name. */
  label: ReactNode;
  /** Accessible name when `label` isn't plain text. */
  "aria-label"?: string;
  value: number;
  /** Default 100. */
  max?: number;
  /** The amount in words, shown under the bar and read by screen readers ("12 MB of 64 MB used"). */
  valueText?: string;
  /** When the bar turns warning / danger. Defaults: 80% / 90%. Pass `false` to stay accent. */
  thresholds?: MeterThresholds | false;
  /** Force a tone instead of the thresholds. */
  tone?: MeterTone;
  /** Hide the label row visually (it stays the accessible name). */
  hideLabel?: boolean;
  className?: string;
};

/**
 * A measurement within a known range (storage used, quota): label, a 6px bar, the amount in words.
 * The bar turns warning, then danger past the thresholds. `role="meter"`.
 */
export function Meter({
  label,
  "aria-label": ariaLabel,
  value,
  max = 100,
  valueText,
  thresholds,
  tone,
  hideLabel = false,
  className,
}: MeterProps) {
  const fraction = clampFraction(value, max);
  const resolved = tone ?? (thresholds === false ? "accent" : meterTone(fraction, thresholds));
  const name = ariaLabel ?? (typeof label === "string" ? label : undefined);
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {hideLabel ? null : <p className="text-meta font-medium text-muted">{label}</p>}
      <div
        role="meter"
        aria-label={name}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.min(max, Math.max(0, value))}
        aria-valuetext={valueText}
        data-tone={resolved}
        className="h-1.5 overflow-hidden rounded-full bg-border"
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-300 ease-[var(--ease-standard)]", FILL[resolved])}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
      {valueText ? (
        <p className={cn("text-meta", resolved === "danger" ? "text-danger" : "text-muted")}>{valueText}</p>
      ) : null}
    </div>
  );
}

export type ProgressProps = {
  /** Accessible name ("Uploading 3 files"). */
  label: string;
  /** Omit for an indeterminate bar. */
  value?: number;
  max?: number;
  /** Progress in words ("2 of 3 files"). */
  valueText?: string;
  /** Show `label` and `valueText` above the bar. Default false (the bar alone). */
  showLabel?: boolean;
  tone?: MeterTone;
  className?: string;
};

/** Progress of a task (uploads, imports): determinate or indeterminate. `role="progressbar"`. */
export function Progress({ label, value, max = 100, valueText, showLabel = false, tone = "accent", className }: ProgressProps) {
  const indeterminate = value === undefined;
  const fraction = indeterminate ? 0 : clampFraction(value, max);
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {showLabel ? (
        <div className="flex items-baseline justify-between gap-3 text-meta">
          <span className="font-medium text-muted">{label}</span>
          {valueText ? <span className="text-muted tabular-nums">{valueText}</span> : null}
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={indeterminate ? undefined : 0}
        aria-valuemax={indeterminate ? undefined : max}
        aria-valuenow={indeterminate ? undefined : Math.min(max, Math.max(0, value))}
        aria-valuetext={valueText}
        aria-busy={indeterminate || undefined}
        className="relative h-1.5 overflow-hidden rounded-full bg-border"
      >
        <div
          className={cn(
            "h-full rounded-full",
            FILL[tone],
            indeterminate
              ? "absolute inset-y-0 w-1/3 animate-kore-indeterminate motion-reduce:left-0 motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-40"
              : "transition-[width] duration-300 ease-[var(--ease-standard)]",
          )}
          style={indeterminate ? undefined : { width: `${fraction * 100}%` }}
        />
      </div>
    </div>
  );
}
