"use client";

import { Check } from "lucide-react";
import { RadioGroup as RadixRadioGroup } from "radix-ui";
import { useEffect, useId, useState } from "react";
import { cn } from "../lib/cn";
import { isHexColor, normalizeHex, readableOn } from "./color";
import { useField } from "./Field";
import { Input } from "./Input";

export type ColorSwatch = { value: string; label: string };

export type ColorSwatchPickerProps = {
  /** The colour, as hex (`#5b8def`). */
  value?: string;
  defaultValue?: string;
  onValueChange?: (hex: string) => void;
  /** The swatches: hex strings, or `{ value, label }` for readable names ("Blue"). */
  colors: readonly (string | ColorSwatch)[];
  /** Also offer a hex field for any other colour. */
  allowCustom?: boolean;
  /** Accessible name of the swatch group (when not inside a Field). */
  "aria-label"?: string;
  /** Accessible name of the hex field. Default "Custom colour (hex)". */
  customLabel?: string;
  /** Placeholder of the hex field. Default "#5b8def". */
  customPlaceholder?: string;
  /** Adds a hidden input for plain forms. */
  name?: string;
  disabled?: boolean;
  /** sm 24px, md 32px (default) swatches. */
  size?: "sm" | "md";
  className?: string;
};

/**
 * Pick a colour from a row of swatches (a radio group: Tab in, arrow keys move and select)
 * with a check on the selected one, plus an optional hex field.
 */
export function ColorSwatchPicker({
  value: valueProp,
  defaultValue = "",
  onValueChange,
  colors,
  allowCustom = false,
  "aria-label": ariaLabel,
  customLabel = "Custom colour (hex)",
  customPlaceholder = "#5b8def",
  name,
  disabled,
  size = "md",
  className,
}: ColorSwatchPickerProps) {
  const field = useField();
  const customId = useId();
  const swatches = colors.map((c) => (typeof c === "string" ? { value: normalizeHex(c), label: c } : { ...c, value: normalizeHex(c.value) }));
  const [own, setOwn] = useState(normalizeHex(defaultValue));
  const value = valueProp !== undefined ? normalizeHex(valueProp) : own;
  const [text, setText] = useState(value);
  const [invalid, setInvalid] = useState(false);

  // Keep the hex field in step when the value changes from a swatch or from outside, but never rewrite
  // what is being typed ("#e5a" is already a valid colour on the way to "#e5a54b").
  useEffect(() => {
    setText((t) => (isHexColor(t) && normalizeHex(t) === value ? t : value));
    setInvalid(false);
  }, [value]);

  const set = (hex: string) => {
    const v = normalizeHex(hex);
    if (valueProp === undefined) setOwn(v);
    onValueChange?.(v);
  };

  const isSwatch = swatches.some((s) => s.value === value);

  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      <RadixRadioGroup.Root
        value={isSwatch ? value : ""}
        onValueChange={set}
        disabled={disabled || field?.disabled}
        orientation="horizontal"
        loop
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : field?.labelId}
        aria-describedby={field?.describedBy}
        className="flex flex-wrap gap-1.5"
      >
        {swatches.map((s) => {
          const selected = s.value === value;
          return (
            <RadixRadioGroup.Item
              key={s.value}
              value={s.value}
              aria-label={s.label}
              title={s.label}
              className={cn(
                "grid shrink-0 place-items-center rounded-full ring-offset-2 ring-offset-raised transition-[box-shadow,transform]",
                "hover:scale-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100",
                "focus-visible:outline-offset-[3px] data-[state=checked]:ring-2 data-[state=checked]:ring-white/40",
                size === "sm" ? "size-6" : "size-control-sm",
              )}
              style={{ backgroundColor: s.value, color: readableOn(s.value) }}
            >
              {selected ? <Check aria-hidden strokeWidth={3} className={size === "sm" ? "size-3.5" : "size-4"} /> : null}
            </RadixRadioGroup.Item>
          );
        })}
      </RadixRadioGroup.Root>
      {allowCustom ? (
        <Input
          id={customId}
          aria-label={customLabel}
          placeholder={customPlaceholder}
          value={text}
          size={size === "sm" ? "sm" : "md"}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          disabled={disabled || field?.disabled}
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            const v = e.target.value.trim();
            setText(v);
            const ok = isHexColor(v);
            setInvalid(v !== "" && !ok);
            if (ok) set(v);
          }}
          leadingIcon={<span className="block size-3.5 rounded-full border border-white/20" style={{ backgroundColor: isHexColor(text) ? text : "transparent" }} />}
          className="w-[132px] font-mono"
        />
      ) : null}
      {name ? <input type="hidden" name={name} value={value} /> : null}
    </div>
  );
}
