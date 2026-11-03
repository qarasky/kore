"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../lib/cn";
import { Button, type ButtonProps } from "./Button";
import { Tooltip } from "./Tooltip";

type State = "idle" | "copied" | "failed";

export type CopyButtonProps = Omit<ButtonProps, "onClick" | "children"> & {
  /** The text to copy. */
  value: string;
  /** Default "Copy". */
  label?: string;
  /** Default "Copied". */
  copiedLabel?: string;
  /** Default "Couldn't copy". */
  failedLabel?: string;
  /** Icon-only (32px square, tooltip = label). */
  iconOnly?: boolean;
  onCopied?: () => void;
};

/** Copies `value` to the clipboard and says so in words for 2 seconds (announced politely). */
export function CopyButton({
  value,
  label = "Copy",
  copiedLabel = "Copied",
  failedLabel = "Couldn't copy",
  iconOnly = false,
  onCopied,
  variant = "secondary",
  size = "sm",
  className,
  ...props
}: CopyButtonProps) {
  const [state, setState] = useState<State>("idle");

  useEffect(() => {
    if (state === "idle") return;
    const id = window.setTimeout(() => setState("idle"), 2000);
    return () => window.clearTimeout(id);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
      onCopied?.();
    } catch {
      setState("failed");
    }
  }

  const text = state === "copied" ? copiedLabel : state === "failed" ? failedLabel : label;
  const icon = state === "copied" ? <Check aria-hidden className="text-status-up" /> : <Copy aria-hidden />;

  if (iconOnly) {
    return (
      <Tooltip content={text} open={state === "idle" ? undefined : true}>
        <Button
          variant={variant === "secondary" ? "ghost" : variant}
          size={size}
          aria-label={label}
          onClick={() => void copy()}
          className={cn("w-control-sm px-0 text-muted hover:text-text", className)}
          {...props}
        >
          {icon}
          <span role="status" className="sr-only">
            {state === "idle" ? "" : text}
          </span>
        </Button>
      </Tooltip>
    );
  }

  return (
    <Button variant={variant} size={size} onClick={() => void copy()} className={className} {...props}>
      {icon}
      <span role="status" aria-live="polite" className={cn(state === "failed" && "text-danger")}>
        {text}
      </span>
    </Button>
  );
}
