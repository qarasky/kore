import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function Button({ variant = "primary", className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const v = { primary: "bg-accent text-white hover:bg-accent-hover", ghost: "bg-raised text-text hover:bg-border", danger: "bg-raised text-danger hover:bg-border" }[variant];
  return <button {...p} className={`min-h-control rounded-ui px-4 text-sub font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${v} ${className}`} />;
}

export function Field({ label, hint, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-meta text-muted">{label}</span>
      <input {...p} className="min-h-control w-full rounded-ui border border-border bg-surface px-3 text-sub text-text placeholder:text-muted focus:border-accent" />
      {hint && <span className="mt-1 block text-2xs text-muted">{hint}</span>}
    </label>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? <p role="alert" className="text-meta text-danger">{children}</p> : null;
}
