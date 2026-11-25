"use client";

import { Switch as RadixSwitch } from "radix-ui";
import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { useFieldControl } from "./Field";

export type SwitchProps = Omit<ComponentProps<typeof RadixSwitch.Root>, "children"> & {
  /** Visible label. Names the setting, not the action ("Use in model picker"). Without it, pass `aria-label`. */
  label?: ReactNode;
  /** A muted line under the label. */
  description?: ReactNode;
  /** Put the label left and the switch right (settings rows). Default false: switch first. */
  labelFirst?: boolean;
};

/** An on/off setting that applies immediately (no Save). For form choices submitted later, use a Checkbox. */
export function Switch({ label, description, labelFirst = false, className, id, ...rest }: SwitchProps) {
  const generated = useId();
  const props = useFieldControl({ ...rest, id: id ?? (label ? generated : undefined) });
  const descId = description ? `${props.id}-desc` : undefined;
  const control = (
    <RadixSwitch.Root
      {...props}
      aria-describedby={[props["aria-describedby"], descId].filter(Boolean).join(" ") || undefined}
      className={cn(
        "peer relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-border-strong p-0.5 transition-colors",
        "data-[state=checked]:bg-accent disabled:cursor-not-allowed",
        !label && ["disabled:opacity-50", className],
      )}
    >
      <RadixSwitch.Thumb
        className={cn(
          "block size-4 rounded-full bg-white shadow-sm transition-transform duration-150 ease-[var(--ease-standard)]",
          "data-[state=checked]:translate-x-4",
        )}
      />
    </RadixSwitch.Root>
  );
  if (!label) return control;
  return (
    <div className={cn("flex items-start gap-3 py-1 has-disabled:opacity-50 has-disabled:[&_label]:cursor-not-allowed", labelFirst && "flex-row-reverse justify-between", className)}>
      <span className="flex h-[1.45em] items-center">{control}</span>
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
