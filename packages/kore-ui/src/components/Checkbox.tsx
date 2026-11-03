"use client";

import { Check, Minus } from "lucide-react";
import { Checkbox as RadixCheckbox } from "radix-ui";
import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { useFieldControl } from "./Field";

export type CheckboxProps = Omit<ComponentProps<typeof RadixCheckbox.Root>, "children"> & {
  /** Visible label to the right. Without it, pass `aria-label`. */
  label?: ReactNode;
  /** A second, muted line under the label. */
  description?: ReactNode;
};

/** A checkbox (Radix): on, off, or `checked="indeterminate"` (e.g. "select all" with some selected). */
export function Checkbox({ label, description, className, id, ...rest }: CheckboxProps) {
  const generated = useId();
  const props = useFieldControl({ ...rest, id: id ?? (label ? generated : undefined) });
  const descId = description ? `${props.id}-desc` : undefined;
  const box = (
    <RadixCheckbox.Root
      {...props}
      aria-describedby={[props["aria-describedby"], descId].filter(Boolean).join(" ") || undefined}
      className={cn(
        "peer grid size-4 shrink-0 place-items-center rounded-[4px] border border-border-strong bg-bg/60 text-white transition-colors",
        "hover:border-muted data-[state=checked]:border-accent data-[state=checked]:bg-accent",
        "data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent",
        "disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger/70",
        !label && className,
      )}
    >
      <RadixCheckbox.Indicator className="grid place-items-center">
        {props.checked === "indeterminate" ? (
          <Minus aria-hidden className="size-3" strokeWidth={3} />
        ) : (
          <Check aria-hidden className="size-3" strokeWidth={3} />
        )}
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );
  if (!label) return box;
  return (
    <div className={cn("flex items-start gap-2.5 py-1", className)}>
      <span className="flex h-[1.45em] items-center">{box}</span>
      <div className="min-w-0">
        <label htmlFor={props.id} className="cursor-pointer peer-disabled:cursor-not-allowed peer-disabled:opacity-60">
          {label}
        </label>
        {description ? (
          <p id={descId} className="text-meta text-muted">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
