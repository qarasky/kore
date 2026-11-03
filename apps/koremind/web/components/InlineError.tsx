"use client";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

/**
 * An error next to where it happened that isn't a form field's (composer, chat, a settings card). Field errors use kore-ui
 * `Field error`; sign-in errors use `AuthScreen error`. Announced; slides in and out.
 */
export function InlineError({ children }: { children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {children ? (
        <motion.p key="e" role="alert" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.15, ease: [0.2, 0, 0, 1] }} className="overflow-hidden text-meta text-danger">
          {children}
        </motion.p>
      ) : null}
    </AnimatePresence>
  );
}
