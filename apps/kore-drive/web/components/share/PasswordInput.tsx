"use client";

import { useState } from "react";
import { t } from "@/lib/i18n";

/** A password field with a Show/Hide toggle. */
export function PasswordInput({
  id,
  value,
  onChange,
  autoFocus,
  autoComplete = "new-password",
  invalid,
  describedBy,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  autoComplete?: string;
  invalid?: boolean;
  describedBy?: string;
  placeholder?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="flex items-stretch gap-1.5">
      <input
        id={id}
        type={shown ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        spellCheck={false}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={
          "block w-full min-w-0 rounded-ui border border-border bg-bg/60 px-3 py-1.5 text-text placeholder:text-muted " +
          "outline-none transition-colors hover:border-border-strong focus:border-accent focus:ring-2 focus:ring-accent/25 " +
          "aria-invalid:border-danger/70"
        }
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-pressed={shown}
        aria-controls={id}
        className="shrink-0 rounded-ui border border-border px-2.5 text-[12px] font-medium text-muted hover:border-border-strong hover:text-text"
      >
        {shown ? t("share.hidePassword") : t("share.showPassword")}
      </button>
    </div>
  );
}
