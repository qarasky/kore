"use client";

import { X } from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";
import { CaptureOpener, useReturnFocus } from "../lib/focus";
import { withToastGuard } from "../lib/overlay";

/** Root: `open` / `onOpenChange` (controlled) or `defaultOpen`. Focus is trapped inside and returns to the opener on close. */
export const Dialog = RadixDialog.Root;
/** The element that opens the dialog (use `asChild` with a Button). */
export const DialogTrigger = RadixDialog.Trigger;
/** Closes the dialog (use `asChild` with a Button). */
export const DialogClose = RadixDialog.Close;

const WIDTH = { sm: "w-[min(420px,calc(100vw-32px))]", md: "w-[min(520px,calc(100vw-32px))]", lg: "w-[min(680px,calc(100vw-32px))]" };

export const overlayClass =
  "fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-kore-fade-in data-[state=closed]:animate-kore-fade-out";

export type DialogContentProps = Omit<ComponentProps<typeof RadixDialog.Content>, "title"> & {
  /** Required: names the dialog. Sentence case, says what it is for ("Add user"). */
  title: ReactNode;
  /** One line under the title. Also the dialog's accessible description. */
  description?: ReactNode;
  /** sm 420px (confirmations), md 520px (forms, default), lg 680px. */
  size?: keyof typeof WIDTH;
  /** Show the × button. Default true. */
  showClose?: boolean;
  /** Label of the × button. Default "Close". */
  closeLabel?: string;
};

/** The dialog panel: title, optional description, your content (use DialogBody/DialogFooter). */
export function DialogContent({
  title,
  description,
  size = "md",
  showClose = true,
  closeLabel = "Close",
  className,
  children,
  onCloseAutoFocus,
  onPointerDownOutside,
  onInteractOutside,
  ...props
}: DialogContentProps) {
  const focus = useReturnFocus(onCloseAutoFocus);
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className={overlayClass} />
      <RadixDialog.Content
        {...(description ? {} : { "aria-describedby": undefined })}
        className={cn(
          "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-32px)] -translate-x-1/2 -translate-y-1/2 flex-col",
          "overflow-hidden rounded-overlay border border-border-strong bg-raised text-text shadow-dialog outline-none",
          "data-[state=open]:animate-kore-dialog-in data-[state=closed]:animate-kore-dialog-out",
          WIDTH[size],
          className,
        )}
        onCloseAutoFocus={focus.onCloseAutoFocus}
        onPointerDownOutside={withToastGuard(onPointerDownOutside)}
        onInteractOutside={withToastGuard(onInteractOutside)}
        {...props}
      >
        <CaptureOpener onMount={focus.capture} />
        <div className="flex shrink-0 items-start gap-3 px-5 pt-5 pb-1">
          <div className="min-w-0 flex-1">
            <RadixDialog.Title className="text-title font-semibold tracking-[-0.01em]">{title}</RadixDialog.Title>
            {description ? (
              <RadixDialog.Description className="mt-1 text-muted">{description}</RadixDialog.Description>
            ) : null}
          </div>
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

/** Scrollable middle of a dialog. */
export function DialogBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4", className)} {...props} />;
}

/** Actions, right-aligned: secondary first, the primary action last. */
export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex shrink-0 flex-col-reverse gap-2 px-5 pt-1 pb-5 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}
