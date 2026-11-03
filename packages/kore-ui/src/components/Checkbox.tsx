"use client";

import { Check, Minus } from "lucide-react";
import { Checkbox as RadixCheckbox } from "radix-ui";
import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { readableOn } from "./color";
import { useFieldControl } from "./Field";

export type CheckboxProps = Omit<ComponentProps<typeof RadixCheckbox.Root>, "children"> & {
  /** Visible label to the right. Without it, pass `aria-label`. */
  label?: ReactNode;
  /** A second, muted line under the label. */
  description?: ReactNode;
  /** Use this colour (hex) instead of the accent: border always, fill when checked. For things that have a
   *  colour of their own (calendars, labels). The check turns black on light colours. */
  color?: string;
};

/** A checkbox (Radix): on, off, or `checked="indeterminate"` (e.g. "select all" with some selected). */
export function Checkbox({ label, description, className, id, color, style, ...rest }: CheckboxProps) {
  const generated = useId();
  const props = useFieldControl({ ...rest, id: id ?? (label ? generated : undefined) });
  const descId = description ? `${props.id}-desc` : undefined;
  const box = (
    <RadixCheckbox.Root
      {...props}
      aria-describedby={[props["aria-describedby"], descId].filter(Boolean).join(" ") || undefined}
      data-color={color ? "" : undefined}
      style={color ? { ...style, borderColor: color, ["--kore-checkbox" as string]: color, color: readableOn(color) } : style}
      className={cn(
        "peer grid size-4 shrink-0 place-items-center rounded-[4px] border border-border-strong bg-bg/60 text-white transition-colors",
        color &&
          "border-2 data-[state=checked]:border-[var(--kore-checkbox)] data-[state=checked]:bg-[var(--kore-checkbox)] data-[state=indeterminate]:border-[var(--kore-checkbox)] data-[state=indeterminate]:bg-[var(--kore-checkbox)] hover:brightness-110",
        "hover:border-muted data-[state=checked]:border-accent data-[state=checked]:bg-accent",
        "data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent",
        "disabled:cursor-not-allowed disabled:hover:border-border-strong aria-invalid:border-danger/70",
        !label && ["disabled:opacity-50", className],
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
    <div className={cn("flex items-start gap-2.5 py-1 has-disabled:opacity-50 has-disabled:[&_label]:cursor-not-allowed", className)}>
      <span className="flex h-[1.45em] items-center">{box}</span>
      <div className="min-w-0">
        <label htmlFor={props.id} className="cursor-pointer">
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
