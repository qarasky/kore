import type { Transition, Variants } from "motion/react";

/** One motion language for the whole app: short, springy, never decorative. */
export const spring: Transition = { type: "spring", stiffness: 520, damping: 42, mass: 0.9 };
export const quick: Transition = { duration: 0.14, ease: [0.2, 0, 0, 1] };
export const smooth: Transition = { duration: 0.22, ease: [0.2, 0, 0, 1] };

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: smooth },
  exit: { opacity: 0, y: -4, transition: quick },
};
export const pop: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  show: { opacity: 1, scale: 1, transition: quick },
  exit: { opacity: 0, scale: 0.96, transition: { duration: 0.1 } },
};
export const collapse: Variants = {
  hidden: { height: 0, opacity: 0 },
  show: { height: "auto", opacity: 1, transition: smooth },
  exit: { height: 0, opacity: 0, transition: quick },
};
