"use client";

import { RadioGroup as RadixRadioGroup } from "radix-ui";
import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { useField } from "./Field";

export type RadioGroupProps = ComponentProps<typeof RadixRadioGroup.Root>;

/** One choice from a few (2–5) visible options. Arrow keys move and select. */
export function RadioGroup({ className, ...props }: RadioGroupProps) {
  const field = useField();
  return (
    <RadixRadioGroup.Root
      aria-labelledby={props["aria-label"] ? undefined : field?.labelId}
      aria-describedby={field?.describedBy}
      aria-invalid={field?.invalid || undefined}
      required={field?.required || undefined}
      disabled={field?.disabled || undefined}
      className={cn("flex flex-col gap-1", className)}
      {...props}
    />
  );
}

export type RadioGroupItemProps = Omit<ComponentProps<typeof RadixRadioGroup.Item>, "children"> & {
  label: ReactNode;
  description?: ReactNode;
};

/** One option of a `RadioGroup`, with its label (and an optional description). */
export function RadioGroupItem({ label, description, className, id, ...props }: RadioGroupItemProps) {
  const generated = useId();
  const itemId = id ?? generated;
  const descId = description ? `${itemId}-desc` : undefined;
  return (
    <div className={cn("flex items-start gap-2.5 py-1 has-disabled:opacity-50 has-disabled:[&_label]:cursor-not-allowed", className)}>
      <span className="flex h-[1.45em] items-center">
        <RadixRadioGroup.Item
          id={itemId}
          aria-describedby={descId}
          className={cn(
            "peer grid size-4 shrink-0 place-items-center rounded-full border border-border-strong bg-bg/60 transition-colors",
            "hover:border-muted data-[state=checked]:border-accent disabled:cursor-not-allowed disabled:hover:border-border-strong",
          )}
          {...props}
        >
          <RadixRadioGroup.Indicator className="size-2 rounded-full bg-accent" />
        </RadixRadioGroup.Item>
      </span>
      <div className="min-w-0">
        <label htmlFor={itemId} className="cursor-pointer">
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
