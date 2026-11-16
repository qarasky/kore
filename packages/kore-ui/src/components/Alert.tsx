"use client";

import { Check, CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { IconButton } from "./IconButton";
import { Spinner } from "./Spinner";

export type AlertTone = "info" | "success" | "warning" | "danger";

const BOX: Record<AlertTone, string> = {
  info: "border-border-strong bg-hover-subtle",
  success: "border-status-up/40 bg-status-up/10",
  warning: "border-warning/40 bg-warning/10",
  danger: "border-danger/40 bg-danger/10",
};

const ICON_TONE: Record<AlertTone, string> = {
  info: "text-muted",
  success: "text-status-up",
  warning: "text-warning",
  danger: "text-danger",
};

const DEFAULT_ICON: Record<AlertTone, ReactNode> = {
  info: <Info />,
  success: <CircleCheck />,
  warning: <TriangleAlert />,
  danger: <CircleAlert />,
};

export type AlertProps = Omit<ComponentProps<"div">, "title"> & {
  /** info (default) | success | warning | danger. Danger is announced at once (`role="alert"`), the rest politely. */
  tone?: AlertTone;
  /** A short statement in medium weight above the body ("Backups are paused"). The body stays `text` colour: `muted` on a tinted fill is under AA. */
  title?: ReactNode;
  /** Replaces the tone's icon, or `false` for none. */
  icon?: ReactNode | false;
  /** One action, usually a small Button or a link, under the text on phones and to its right otherwise. */
  action?: ReactNode;
  /** Adds a close button (named by `dismissLabel`) that calls this. */
  onDismiss?: () => void;
  /** Accessible name of the close button. Default "Dismiss". */
  dismissLabel?: string;
  /** A full-width strip across the top of a page or panel: square corners, a bottom hairline only. */
  banner?: boolean;
};

/**
 * A message that stays in the page until the situation changes: a warning card, a notice above a form, a
 * paused-state strip. Say what is going on and what to do about it. Not for results of an action (a Toast)
 * and not for one field's error (`Field error`).
 */
export function Alert({
  tone = "info",
  title,
  icon,
  action,
  onDismiss,
  dismissLabel = "Dismiss",
  banner = false,
  role,
  className,
  children,
  ...props
}: AlertProps) {
  const glyph = icon === false ? null : (icon ?? DEFAULT_ICON[tone]);
  return (
    <div
      role={role ?? (tone === "danger" ? "alert" : "status")}
      data-tone={tone}
      className={cn(
        "flex items-start gap-3 border px-3.5 py-3 text-text",
        banner ? "rounded-none border-x-0 border-t-0" : "rounded-ui",
        BOX[tone],
        className,
      )}
      {...props}
    >
      {glyph ? (
        <span aria-hidden="true" className={cn("mt-0.5 flex shrink-0 [&_svg]:size-4", ICON_TONE[tone])}>
          {glyph}
        </span>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
        <div className="min-w-0 flex-1">
          {title ? <p className="font-medium">{title}</p> : null}
          {children ? <div className="text-sub">{children}</div> : null}
        </div>
        {action ? <div className="mt-2 shrink-0 sm:mt-0">{action}</div> : null}
      </div>
      {onDismiss ? (
        <IconButton label={dismissLabel} icon={<X />} onClick={onDismiss} className="-my-1 -mr-1.5 shrink-0" />
      ) : null}
    </div>
  );
}

export type InlineMessageTone = "danger" | "warning" | "success" | "muted";

const INLINE_TONE: Record<InlineMessageTone, string> = {
  danger: "text-danger",
  warning: "text-warning",
  success: "text-status-up",
  muted: "text-muted",
};

export type InlineMessageProps = ComponentProps<"p"> & {
  /** danger (default) | warning | success | muted. Danger is `role="alert"`, the others `role="status"`. */
  tone?: InlineMessageTone;
  /** A lucide icon before the text. Optional: the words carry the meaning. */
  icon?: ReactNode;
  /** Open smoothly (height and fade, 200ms) when it appears, for a message that pops in under a control. Reduced motion skips it. */
  animated?: boolean;
};

/**
 * One line of 13px feedback that is not tied to a single field: "Couldn't reach the server. Check your connection
 * and try again." Use `Field error` for a field, `Alert` for something that needs a box.
 */
export function InlineMessage({ tone = "danger", icon, animated = false, role, className, children, ...props }: InlineMessageProps) {
  const [open, setOpen] = useState(!animated);
  useEffect(() => {
    if (!animated) return;
    const frame = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(frame);
  }, [animated]);
  const message = (
    <p
      role={role ?? (tone === "danger" ? "alert" : "status")}
      data-tone={tone}
      className={cn("flex items-start gap-1.5 text-meta", INLINE_TONE[tone], !animated && className)}
      {...props}
    >
      {icon ? (
        <span aria-hidden="true" className="mt-px flex shrink-0 [&_svg]:size-3.5">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0">{children}</span>
    </p>
  );
  if (!animated) return message;
  return (
    <div
      data-open={open || undefined}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-(--ease-standard)",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        className,
      )}
    >
      <div className="min-h-0 overflow-hidden">{message}</div>
    </div>
  );
}

export type SaveState = "idle" | "saving" | "saved" | "error";

export type SaveStatusProps = {
  state: SaveState;
  /** Strings for each state; defaults are English. */
  labels?: { saving?: string; saved?: string; error?: string };
  className?: string;
};

/**
 * The "Saving…" / "Saved" / "Couldn't save" status of an autosaving form, in words (DESIGN §1: show state in
 * words). Idle renders nothing visible but keeps its live region mounted so the next change is announced.
 */
export function SaveStatus({ state, labels, className }: SaveStatusProps) {
  const text = {
    saving: labels?.saving ?? "Saving…",
    saved: labels?.saved ?? "Saved",
    error: labels?.error ?? "Couldn't save. Try again.",
  };
  return (
    <span className={cn("inline-flex min-h-5 items-center text-meta", className)}>
      <span role="status" className="inline-flex items-center gap-1.5 text-muted">
        {state === "saving" ? (
          <>
            <Spinner size={12} />
            {text.saving}
          </>
        ) : null}
        {state === "saved" ? (
          <>
            <Check aria-hidden className="size-3.5 text-status-up" />
            {text.saved}
          </>
        ) : null}
      </span>
      {state === "error" ? (
        <span role="alert" className="text-danger">
          {text.error}
        </span>
      ) : null}
    </span>
  );
}
