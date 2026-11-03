"use client";

import { Check, Circle, Eye, EyeOff } from "lucide-react";
import { useId, useState, type ChangeEvent } from "react";
import { cn } from "../lib/cn";
import { Input, type InputProps } from "./Input";

export type PasswordRule = { label: string; test: (password: string) => boolean };

/** A rule for {@link PasswordInput}'s checklist: at least `n` characters. */
export function minLengthRule(n: number, label = `At least ${n} characters`): PasswordRule {
  return { label, test: (p) => p.length >= n };
}

export type PasswordInputProps = Omit<InputProps, "type" | "trailing"> & {
  /** A new password (sign-up, set password, change password): `autoComplete="new-password"`, so browsers
   *  offer to generate one and never fill in an old one. Default false: `current-password`. */
  newPassword?: boolean;
  /** Requirements shown as a live checklist under the field (and referenced by `aria-describedby`). */
  rules?: PasswordRule[];
  /** Accessible names of the toggle. Defaults "Show password" / "Hide password". */
  showLabel?: string;
  hideLabel?: string;
  /** Screen-reader suffixes for the checklist. Defaults "done" / "not yet". */
  ruleMetLabel?: string;
  ruleUnmetLabel?: string;
};

/**
 * A password field with a show/hide toggle inside it (a real button with `aria-pressed`) and the
 * right autocomplete. Put it in a Field for the label and error; pass `rules` for a checklist.
 */
export function PasswordInput({
  newPassword = false,
  rules,
  showLabel = "Show password",
  hideLabel = "Hide password",
  ruleMetLabel = "done",
  ruleUnmetLabel = "not yet",
  autoComplete,
  value,
  defaultValue,
  onChange,
  size = "md",
  disabled,
  className,
  "aria-describedby": describedBy,
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const [own, setOwn] = useState(String(defaultValue ?? ""));
  const current = value !== undefined ? String(value) : own;
  const rulesId = `${useId()}-rules`;

  return (
    <div className={cn("flex w-full flex-col gap-1.5", className)}>
      <Input
        {...props}
        size={size}
        disabled={disabled}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete ?? (newPassword ? "new-password" : "current-password")}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        defaultValue={value === undefined ? defaultValue : undefined}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          if (value === undefined) setOwn(e.target.value);
          onChange?.(e);
        }}
        aria-describedby={[describedBy, rules?.length ? rulesId : undefined].filter(Boolean).join(" ") || undefined}
        trailing={
          <button
            type="button"
            aria-label={visible ? hideLabel : showLabel}
            aria-pressed={visible}
            disabled={disabled}
            onClick={() => setVisible((v) => !v)}
            className={cn(
              "grid place-items-center rounded-[4px] text-muted transition-colors hover:bg-white/5 hover:text-text disabled:pointer-events-none",
              size === "sm" ? "size-6" : "size-7",
            )}
          >
            {visible ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
          </button>
        }
      />
      {rules?.length ? (
        <ul id={rulesId} className="flex flex-col gap-0.5 text-meta">
          {rules.map((rule) => {
            const met = rule.test(current);
            return (
              <li key={rule.label} data-met={met || undefined} className={cn("flex items-center gap-1.5", met ? "text-text" : "text-muted")}>
                {met ? <Check aria-hidden className="size-3.5 text-status-up" /> : <Circle aria-hidden className="size-3.5" />}
                {rule.label}
                <span className="sr-only">: {met ? ruleMetLabel : ruleUnmetLabel}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
