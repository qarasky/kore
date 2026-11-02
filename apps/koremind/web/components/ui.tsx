"use client";
import { AnimatePresence, motion } from "motion/react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function Button({ variant = "primary", className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const v = { primary: "bg-accent text-white hover:bg-accent-hover", ghost: "bg-raised text-text hover:bg-border", danger: "bg-raised text-danger hover:bg-border" }[variant];
  return <button {...p} className={`min-h-control rounded-ui px-4 text-sub font-medium transition-[background-color,transform] active:scale-[0.97] disabled:active:scale-100 disabled:opacity-50 disabled:cursor-not-allowed ${v} ${className}`} />;
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
  return (
    <AnimatePresence initial={false}>
      {children ? <motion.p key="e" role="alert" initial={{ opacity: 0, height: 0, y: -4 }} animate={{ opacity: 1, height: "auto", y: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.16 }} className="overflow-hidden text-meta text-danger">{children}</motion.p> : null}
    </AnimatePresence>
  );
}

/** Fades and lifts its children in once. Used for whole screens (sign-in, connect). */
export function Appear({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return <motion.div className={className} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, delay, ease: [0.2, 0, 0, 1] }}>{children}</motion.div>;
}
