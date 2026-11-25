"use client";

import { Tooltip as RadixTooltip } from "radix-ui";
import type { ReactElement, ReactNode } from "react";
import { cn } from "../lib/cn";

export type TooltipProps = {
  /** The tooltip text. Short, no punctuation. Never the only place important information lives. */
  content: ReactNode;
  /** The trigger: one element that can hold a ref and focus (a button or link). */
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  /** Hover delay in ms. Default 400. */
  delay?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
};

/** Shares the hover delay between tooltips. `KoreProvider` includes one. */
export function TooltipProvider({ children, delay = 400 }: { children: ReactNode; delay?: number }) {
  return (
    <RadixTooltip.Provider delayDuration={delay} skipDelayDuration={300}>
      {children}
    </RadixTooltip.Provider>
  );
}

/** A small label shown on hover and keyboard focus. */
export function Tooltip({ content, children, side = "top", align = "center", delay, open, onOpenChange, className }: TooltipProps) {
  return (
    <RadixTooltip.Provider delayDuration={delay ?? 400} skipDelayDuration={300}>
      <RadixTooltip.Root open={open} onOpenChange={onOpenChange}>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            align={align}
            sideOffset={6}
            collisionPadding={8}
            className={cn(
              "z-[70] max-w-[280px] rounded-ui border border-border-strong bg-raised px-2 py-1 text-meta text-text",
              "shadow-overlay data-[state=closed]:animate-kore-fade-out data-[state=delayed-open]:animate-kore-fade-in",
              "data-[state=instant-open]:animate-kore-fade-in",
              className,
            )}
          >
            {content}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
