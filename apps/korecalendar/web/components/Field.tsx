import type { ReactNode } from "react";

export const inputClass =
  "min-h-control rounded-ui border border-border bg-bg/60 px-3 text-text outline-none transition-colors " +
  "placeholder:text-muted hover:border-border-strong focus:border-accent focus:ring-2 focus:ring-accent/25 " +
  "aria-invalid:border-danger/70 disabled:cursor-not-allowed disabled:opacity-60";

/** A labelled form control with optional hint and error text. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  className = "",
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={htmlFor} className="text-sub text-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-meta text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-meta text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
