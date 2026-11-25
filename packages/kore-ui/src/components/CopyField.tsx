"use client";

import { cn } from "../lib/cn";
import { CopyButton, type CopyButtonProps } from "./CopyButton";
import { Input, type InputProps } from "./Input";

export type CopyFieldProps = Omit<InputProps, "value" | "readOnly" | "trailing" | "defaultValue"> & {
  /** The text shown and copied: a setup link, a token, a URL. */
  value: string;
  /** Props for the copy button (labels for translation). */
  copy?: Pick<CopyButtonProps, "label" | "copiedLabel" | "failedLabel" | "onCopied">;
  /** Show the value in the monospace font (tokens, hashes). */
  mono?: boolean;
};

/**
 * A read-only field with a Copy button inside its end: select-all on focus, then one click copies and says
 * "Copied". Put it in a `Field` for a label. For secrets shown once, say so in the hint.
 */
export function CopyField({ value, copy, mono = false, className, onFocus, ...props }: CopyFieldProps) {
  return (
    <Input
      readOnly
      value={value}
      onFocus={(e) => {
        e.currentTarget.select();
        onFocus?.(e);
      }}
      trailing={<CopyButton value={value} iconOnly {...copy} />}
      className={cn(mono && "font-mono text-sub", className)}
      {...props}
    />
  );
}
