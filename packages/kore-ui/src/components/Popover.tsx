"use client";

import { Popover as RadixPopover } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

/** A small non-modal panel anchored to a trigger (details, quick edits, pickers). Escape and outside-click close it; focus returns to the trigger. */
export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverAnchor = RadixPopover.Anchor;
export const PopoverClose = RadixPopover.Close;

export type PopoverContentProps = ComponentProps<typeof RadixPopover.Content> & {
  /** Remove the default 16px padding (for lists that reach the edges). */
  flush?: boolean;
};

export function PopoverContent({ className, sideOffset = 6, align = "center", flush = false, ...props }: PopoverContentProps) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        sideOffset={sideOffset}
        align={align}
        collisionPadding={8}
        className={cn(
          "z-50 w-[320px] max-w-[calc(100vw-16px)] rounded-overlay border border-border-strong bg-raised text-text shadow-overlay outline-none",
          "origin-[var(--radix-popover-content-transform-origin)] data-[state=open]:animate-kore-pop-in data-[state=closed]:animate-kore-pop-out",
          !flush && "p-4",
          className,
        )}
        {...props}
      />
    </RadixPopover.Portal>
  );
}
