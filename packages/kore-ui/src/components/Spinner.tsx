import { cn } from "../lib/cn";

export type SpinnerProps = {
  /** Pixel size. Default 16. */
  size?: number;
  /** Announced to screen readers. Omit when the surrounding text already says it (e.g. "Saving…"). */
  label?: string;
  className?: string;
};

/** An indeterminate progress ring in the current text colour. */
export function Spinner({ size = 16, label, className }: SpinnerProps) {
  return (
    <span
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("inline-flex shrink-0", className)}
    >
      <svg viewBox="0 0 16 16" width={size} height={size} fill="none" className="animate-spin">
        <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.75" />
        <path d="M14.25 8A6.25 6.25 0 0 0 8 1.75" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    </span>
  );
}
