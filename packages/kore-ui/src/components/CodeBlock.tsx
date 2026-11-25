"use client";

import type { ComponentProps } from "react";
import { cn } from "../lib/cn";
import { CopyButton, type CopyButtonProps } from "./CopyButton";

export type CodeBlockProps = Omit<ComponentProps<"div">, "children"> & {
  /** The code, shown and copied as is. */
  value: string;
  /** A name shown top left ("bash", "json"). Decorative: there is no syntax colouring. */
  language?: string;
  /** Wrap long lines instead of scrolling sideways. Default false. */
  wrap?: boolean;
  /** Props for the copy button (labels for translation). */
  copy?: Pick<CopyButtonProps, "label" | "copiedLabel" | "failedLabel" | "onCopied">;
};

/** A block of code or a command: monospace on a quiet well, scrolls sideways, with a Copy button in the corner. */
export function CodeBlock({ value, language, wrap = false, copy, className, ...props }: CodeBlockProps) {
  return (
    <div className={cn("relative rounded-ui border border-border bg-bg/60", className)} {...props}>
      <div className="flex min-h-control-sm items-center justify-between gap-2 border-b border-border pr-1 pl-3">
        <span className="font-mono text-2xs text-muted">{language}</span>
        <CopyButton value={value} iconOnly {...copy} />
      </div>
      <pre className={cn("overflow-x-auto p-3 font-mono text-sub leading-[1.5]", wrap && "break-words whitespace-pre-wrap")}>
        <code>{value}</code>
      </pre>
    </div>
  );
}
