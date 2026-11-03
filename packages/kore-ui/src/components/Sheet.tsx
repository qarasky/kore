"use client";

import { X } from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";
import { CaptureOpener, useReturnFocus } from "../lib/focus";
import { withToastGuard } from "../lib/overlay";
import { overlayClass } from "./Dialog";

/** Root: `open` / `onOpenChange` or `defaultOpen`. Modal: focus is trapped, Escape and the overlay close it. */
export const Sheet = RadixDialog.Root;
export const SheetTrigger = RadixDialog.Trigger;
export const SheetClose = RadixDialog.Close;

const SIZE = { sm: "sm:w-[360px]", md: "sm:w-[480px]", lg: "sm:w-[640px]", xl: "sm:w-[880px]" };

const SIDE = {
  right:
    "sm:inset-y-0 sm:right-0 sm:rounded-l-overlay sm:border-l " +
    "sm:data-[state=open]:animate-kore-sheet-right-in sm:data-[state=closed]:animate-kore-sheet-right-out",
  left:
    "sm:inset-y-0 sm:left-0 sm:rounded-r-overlay sm:border-r " +
    "sm:data-[state=open]:animate-kore-sheet-left-in sm:data-[state=closed]:animate-kore-sheet-left-out",
};

export type SheetContentProps = Omit<ComponentProps<typeof RadixDialog.Content>, "title"> & {
  /** Required: names the panel ("Monitor details"). Set `hideTitle` to keep it for screen readers only. */
  title: ReactNode;
  description?: ReactNode;
  /** Visually hide the header title (the content has its own heading). */
  hideTitle?: boolean;
  /** Which edge it slides from at ≥ 640px. Below that it is always a bottom sheet. Default "right". */
  side?: "right" | "left";
  /** sm 360, md 480 (default), lg 640, xl 880px wide (capped to the viewport). */
  size?: keyof typeof SIZE;
  showClose?: boolean;
  closeLabel?: string;
};

/**
 * A side panel over the page for details and secondary tasks that keep the page's context
 * (a monitor's peek, an event's details, filters). Full height at the right or left edge;
 * a bottom sheet (max 85% tall) on phones. Use SheetBody (scrolls) and SheetFooter.
 */
export function SheetContent({
  title,
  description,
  hideTitle = false,
  side = "right",
  size = "md",
  showClose = true,
  closeLabel = "Close",
  className,
  children,
  onCloseAutoFocus,
  onPointerDownOutside,
  onInteractOutside,
  ...props
}: SheetContentProps) {
  const focus = useReturnFocus(onCloseAutoFocus);
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className={overlayClass} />
      <RadixDialog.Content
        {...(description ? {} : { "aria-describedby": undefined })}
        data-side={side}
        onCloseAutoFocus={focus.onCloseAutoFocus}
        onPointerDownOutside={withToastGuard(onPointerDownOutside)}
        onInteractOutside={withToastGuard(onInteractOutside)}
        className={cn(
          "fixed z-50 flex flex-col overflow-hidden border-border-strong bg-raised text-text shadow-dialog outline-none",
          // Phones: a bottom sheet.
          "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-overlay border-t",
          "data-[state=open]:animate-kore-sheet-bottom-in data-[state=closed]:animate-kore-sheet-bottom-out",
          // ≥ 640px: a full-height side panel.
          "sm:inset-x-auto sm:max-h-none sm:max-w-[calc(100vw-48px)] sm:rounded-t-none sm:border-t-0",
          SIDE[side],
          SIZE[size],
          className,
        )}
        {...props}
      >
        <CaptureOpener onMount={focus.capture} />
        <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border-strong sm:hidden" />
        <div className={cn("flex shrink-0 items-start gap-3 px-5 pt-4 pb-1 sm:pt-5", hideTitle && !description && "pb-0")}>
          <div className={cn("min-w-0 flex-1", hideTitle && "sr-only")}>
            <RadixDialog.Title className="text-title font-semibold tracking-[-0.01em]">{title}</RadixDialog.Title>
            {description ? <RadixDialog.Description className="mt-1 text-muted">{description}</RadixDialog.Description> : null}
          </div>
          {hideTitle ? <div className="flex-1" /> : null}
          {showClose ? (
            <RadixDialog.Close
              aria-label={closeLabel}
              className="-mt-1 -mr-2 grid size-control-sm shrink-0 place-items-center rounded-ui text-muted transition-colors hover:bg-white/5 hover:text-text"
            >
              <X aria-hidden className="size-4" />
            </RadixDialog.Close>
          ) : null}
        </div>
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

/** The scrolling middle of a Sheet. */
export function SheetBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4", className)} {...props} />;
}

/** Actions pinned to the bottom of a Sheet, primary last. */
export function SheetFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex shrink-0 flex-col-reverse gap-2 border-t border-border px-5 py-3 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}
