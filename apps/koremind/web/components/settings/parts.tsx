"use client";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { spring } from "@/lib/motion";

export function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <header className="mb-5">
      <h2 className="text-title font-semibold tracking-[-0.01em]">{title}</h2>
      {hint && <p className="mt-1 text-sub text-muted">{hint}</p>}
    </header>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-ui border border-border bg-surface ${className}`}>{children}</div>;
}

/** An on/off switch. The thumb travels on a spring. */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange(v: boolean): void; label: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${checked ? "justify-end bg-accent" : "justify-start bg-border-strong"}`}
    >
      <motion.span layout transition={spring} className="size-5 rounded-full bg-white" />
    </button>
  );
}

export function Chip({ active, onClick, children }: { active: boolean; onClick(): void; children: ReactNode }) {
  return (
    <motion.button
      type="button" aria-pressed={active} onClick={onClick} whileTap={{ scale: 0.96 }}
      className={`min-h-control-sm rounded-full border px-3 text-meta transition-colors ${active ? "border-accent bg-accent/15 text-text" : "border-border bg-surface text-muted hover:border-border-strong hover:text-text"}`}
    >
      {children}
    </motion.button>
  );
}
