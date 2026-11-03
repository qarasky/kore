"use client";
import { Button, cn, type ButtonProps } from "@qarasky/kore-ui";

/**
 * A pressed/unpressed choice (tone presets, thinking level): kore-ui's small secondary Button with `aria-pressed`, tinted with
 * the accent when on. kore-ui has no toggle or segmented button; DESIGN.md (kore-ui §8, KoreMind) asks for exactly this.
 */
export function ToggleChip({ pressed, className, ...props }: Omit<ButtonProps, "variant" | "size"> & { pressed: boolean }) {
  return <Button {...props} size="sm" variant="secondary" aria-pressed={pressed} className={cn(pressed && "border-accent/60 bg-accent/15 hover:bg-accent/20", className)} />;
}
