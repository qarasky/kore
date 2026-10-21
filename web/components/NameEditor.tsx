"use client";

import { useId, useRef, useState } from "react";
import { t, type MessageKey } from "@/lib/i18n";

/**
 * Inline name input for rename and new folder. Enter (or blur) submits,
 * Escape cancels. `onSubmit` resolves to an error key to stay open showing
 * it, or null when done. While a submit is in flight the input is read-only
 * (not disabled: disabling would blur it and re-submit).
 */
export function NameEditor({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: string;
  onSubmit: (name: string) => Promise<MessageKey | null>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<MessageKey | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const errorId = useId();

  async function submit() {
    if (busy.current) return;
    const name = value.trim();
    if (name === "") {
      onCancel();
      return;
    }
    busy.current = true;
    setPending(true);
    setError(null);
    const err = await onSubmit(name);
    if (err) {
      busy.current = false;
      setPending(false);
      setError(err);
    }
    // On success the parent unmounts us; stay busy so a late blur is ignored.
  }

  return (
    <div className="relative min-w-0 flex-1">
      <input
        aria-label={t("rename.label")}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        aria-busy={pending || undefined}
        readOnly={pending}
        autoFocus
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        onFocus={(e) => {
          // Select the base name, not the extension, like most file managers.
          const dot = e.target.value.lastIndexOf(".");
          e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            busy.current = true;
            onCancel();
          }
        }}
        onBlur={() => {
          if (busy.current) return;
          // Leaving a rejected name abandons the edit rather than retrying it.
          if (error) {
            busy.current = true;
            onCancel();
          } else {
            void submit();
          }
        }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
        className={
          "block h-6 w-full max-w-[420px] rounded-[4px] border bg-bg px-1.5 text-text outline-none " +
          "focus:ring-2 focus:ring-accent/25 read-only:opacity-70 " +
          (error ? "border-danger/70" : "border-accent")
        }
      />
      {error && (
        <p
          id={errorId}
          role="alert"
          className="absolute top-full left-0 z-10 mt-1 rounded-[4px] border border-danger/40 bg-raised px-2 py-1 text-[12px] whitespace-nowrap text-danger shadow-lg"
        >
          {t(error)}
        </p>
      )}
    </div>
  );
}
