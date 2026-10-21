"use client";

import { useEffect, useState, type ReactNode } from "react";
import { t } from "@/lib/i18n";
import { generatePassword, passwordHints } from "@/lib/password";
import { SIZE_UNITS, type SizeUnit } from "@/lib/size";

const controlClass =
  "block min-w-0 rounded-ui border border-border bg-bg/60 px-3 py-1.5 text-text " +
  "placeholder:text-muted outline-none transition-colors " +
  "hover:border-border-strong focus:border-accent focus:ring-2 focus:ring-accent/25 " +
  "aria-invalid:border-danger/70 disabled:opacity-60";
export const inputClass = `${controlClass} w-full`;
export const selectClass = `${controlClass} w-auto pr-8`;

export const primaryButton =
  "rounded-ui bg-accent px-3.5 py-1.5 font-medium text-white transition-colors hover:bg-accent-hover " +
  "disabled:cursor-not-allowed disabled:opacity-60";
export const dangerButton =
  "rounded-ui bg-[#c94b4f] px-3.5 py-1.5 font-medium text-white hover:bg-[#d65b5f] " +
  "disabled:cursor-not-allowed disabled:opacity-60";
export const secondaryButton =
  "rounded-ui border border-border-strong px-3.5 py-1.5 font-medium hover:bg-white/5 disabled:opacity-60";
export const smallButton =
  "rounded-ui border border-border px-2 py-1 text-[12px] font-medium text-muted transition-colors " +
  "hover:border-border-strong hover:text-text disabled:opacity-60";

/** ids for a field's hint and error, and the matching aria-describedby. */
export function fieldIds(id: string, hint: boolean, error: boolean) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(" ") || undefined;
  return { hintId, errorId, describedBy };
}

/** Label, control, optional hint and inline error (announced via role=alert). */
export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  const ids = fieldIds(id, !!hint, !!error);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[12px] font-medium text-muted">
        {label}
      </label>
      {children}
      {hint && (
        <p id={ids.hintId} className="text-[12px] text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={ids.errorId} role="alert" className="text-[12px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** A number field plus a unit select (binary units, labelled like the storage meter). */
export function SizeInput({
  id,
  label,
  value,
  unit,
  units,
  onChange,
  invalid,
  describedBy,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  unit: SizeUnit;
  units: readonly SizeUnit[];
  onChange: (value: string, unit: SizeUnit) => void;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value, unit)}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={`${inputClass} max-w-[160px]`}
      />
      <select
        aria-label={t("admin.form.unit", { field: label })}
        value={unit}
        disabled={disabled}
        onChange={(e) => onChange(value, e.target.value as SizeUnit)}
        className={selectClass}
      >
        {units
          .slice()
          .sort((a, b) => SIZE_UNITS[a] - SIZE_UNITS[b])
          .map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
      </select>
    </div>
  );
}

/** Copies `text` to the clipboard; the label confirms or explains a failure. */
export function CopyButton({ text, className = smallButton }: { text: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state !== "copied") return;
    const id = window.setTimeout(() => setState("idle"), 2000);
    return () => window.clearTimeout(id);
  }, [state]);
  return (
    <>
      <button
        type="button"
        aria-label={t("password.copyLabel")}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setState("copied");
          } catch {
            setState("failed");
          }
        }}
        className={className}
      >
        {state === "copied" ? t("password.copied") : t("password.copy")}
      </button>
      {state === "failed" && (
        <span role="alert" className="text-[12px] text-danger">
          {t("password.copyFailed")}
        </span>
      )}
    </>
  );
}

/**
 * Password input with show/hide, and for new passwords an optional generator
 * (which reveals the generated value so it can be read or copied) and the
 * strength hints. `autoComplete` is `new-password` unless it is the current
 * password, so browsers never autofill an old one into a new-password field.
 */
export function PasswordInput({
  id,
  value,
  onChange,
  current = false,
  generate = false,
  hints = false,
  invalid,
  describedBy,
  disabled,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (value: string, generated: boolean) => void;
  current?: boolean;
  generate?: boolean;
  hints?: boolean;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const hintsId = `${id}-strength`;
  const h = passwordHints(value);
  const items: [boolean, string][] = [
    [h.minLength, t("password.hint.minLength")],
    [h.long, t("password.hint.long")],
    [h.mixed, t("password.hint.mixed")],
  ];
  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={current ? "current-password" : "new-password"}
          spellCheck={false}
          autoCapitalize="off"
          value={value}
          disabled={disabled}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value, false)}
          aria-invalid={invalid || undefined}
          aria-describedby={[describedBy, hints && hintsId].filter(Boolean).join(" ") || undefined}
          className={`${inputClass} font-mono`}
        />
        <button
          type="button"
          aria-pressed={visible}
          aria-label={visible ? t("password.hide") : t("password.show")}
          onClick={() => setVisible((v) => !v)}
          disabled={disabled}
          className={smallButton}
        >
          <EyeIcon open={!visible} />
        </button>
        {generate && (
          <button
            type="button"
            aria-label={t("password.generateLabel")}
            disabled={disabled}
            onClick={() => {
              setVisible(true);
              onChange(generatePassword(), true);
            }}
            className={smallButton}
          >
            {t("password.generate")}
          </button>
        )}
      </div>
      {hints && (
        <ul id={hintsId} aria-label={t("password.hints")} className="space-y-0.5 text-[12px]">
          {items.map(([met, label]) => (
            <li key={label} data-met={met} className={`flex items-center gap-1.5 ${met ? "text-text" : "text-muted"}`}>
              <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} className={`size-3.5 ${met ? "text-accent" : ""}`}>
                {met ? <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" /> : <circle cx="8" cy="8" r="4.5" />}
              </svg>
              {label}
              <span className="sr-only">{met ? t("password.hintMet") : t("password.hintUnmet")}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      className="size-4"
    >
      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="2" />
      {!open && <path d="m2.5 13.5 11-11" />}
    </svg>
  );
}
