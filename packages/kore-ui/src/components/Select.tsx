"use client";

import { Check, ChevronDown } from "lucide-react";
import { Select as RadixSelect } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";
import { useFieldControl } from "./Field";
import { controlClass } from "./Input";

export type SelectOption<V extends string = string> = { value: V; label: ReactNode; disabled?: boolean };

export type SelectProps<V extends string = string> = {
  value?: V;
  defaultValue?: V;
  onValueChange?: (value: V) => void;
  /** The choices. Or pass `SelectItem`s as children. */
  options?: readonly SelectOption<V>[];
  children?: ReactNode;
  placeholder?: string;
  /** Adds a hidden input so plain form submission works. */
  name?: string;
  id?: string;
  disabled?: boolean;
  required?: boolean;
  size?: "md" | "sm";
  /** Classes for the trigger. */
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * Pick one value from a short list (up to ~15; use a searchable combobox beyond that).
 * Keyboard: Enter/Space/arrows open, arrows + type-ahead move, Enter selects, Escape closes.
 */
export function Select<V extends string = string>({
  value,
  defaultValue,
  onValueChange,
  options,
  children,
  placeholder,
  name,
  disabled,
  required,
  size = "md",
  className,
  open,
  onOpenChange,
  ...rest
}: SelectProps<V>) {
  const control = useFieldControl({ ...rest, disabled, required });
  return (
    <RadixSelect.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange as ((v: string) => void) | undefined}
      name={name}
      disabled={control.disabled}
      required={control.required}
      open={open}
      onOpenChange={onOpenChange}
    >
      <RadixSelect.Trigger
        id={control.id}
        aria-label={control["aria-label"]}
        aria-labelledby={control["aria-labelledby"]}
        aria-describedby={control["aria-describedby"]}
        aria-invalid={control["aria-invalid"] || undefined}
        className={cn(
          controlClass,
          "flex items-center justify-between gap-2 text-left data-[placeholder]:text-muted",
          size === "sm" ? "min-h-control-sm text-sub" : "min-h-control",
          className,
        )}
      >
        <span className="truncate">
          <RadixSelect.Value placeholder={placeholder} />
        </span>
        <RadixSelect.Icon asChild>
          <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          collisionPadding={8}
          className={cn(
            "z-50 max-h-[min(360px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)]",
            "overflow-hidden rounded-ui border border-border-strong bg-raised text-text shadow-overlay",
            "data-[state=open]:animate-kore-pop-in data-[state=closed]:animate-kore-pop-out origin-[var(--radix-select-content-transform-origin)]",
          )}
        >
          <RadixSelect.Viewport className="py-1">
            {options?.map((o) => (
              <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </SelectItem>
            ))}
            {children}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

/** One option of a `Select` (when composing children instead of passing `options`). */
export function SelectItem({ className, children, ...props }: ComponentProps<typeof RadixSelect.Item>) {
  return (
    <RadixSelect.Item
      className={cn(
        "relative flex min-h-control cursor-default items-center gap-2 py-1.5 pr-3 pl-9 outline-none select-none",
        "data-[highlighted]:bg-white/5 data-[disabled]:opacity-40 data-[state=checked]:font-medium",
        className,
      )}
      {...props}
    >
      <RadixSelect.ItemIndicator className="absolute left-3 flex items-center text-accent">
        <Check aria-hidden className="size-4" />
      </RadixSelect.ItemIndicator>
      <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
    </RadixSelect.Item>
  );
}

/** A labelled group of options inside a `Select`. */
export function SelectGroup({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <RadixSelect.Group>
      <RadixSelect.Label className="px-3 pt-2 pb-1 text-2xs font-medium text-muted">{label}</RadixSelect.Label>
      {children}
    </RadixSelect.Group>
  );
}
