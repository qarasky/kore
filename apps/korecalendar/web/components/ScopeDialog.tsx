"use client";

import { useId, useRef, useState } from "react";
import type { Scope } from "@/lib/editPlan";
import { t, type MessageKey } from "@/lib/i18n";
import { Button } from "./Button";
import { Modal } from "./Modal";

/**
 * "Which events?" for a repeating event: this one, this and the ones after
 * it, or all of them. Only the scopes the change can safely use are offered.
 */
export function ScopeDialog({
  title,
  confirmLabel,
  allowed,
  hint,
  onChoose,
  onCancel,
}: {
  title: string;
  confirmLabel: string;
  allowed: Scope[];
  hint?: string;
  onChoose: (scope: Scope) => void | Promise<void>;
  onCancel: () => void;
}) {
  const titleId = useId();
  const group = useId();
  const [scope, setScope] = useState<Scope>(allowed[0]);
  const [busy, setBusy] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    try {
      await onChoose(scope);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal labelledBy={titleId} onClose={() => !busy && onCancel()} initialFocus={firstRef} className="w-[min(420px,calc(100vw-32px))]">
      <form
        className="p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
      >
        <h2 id={titleId} className="text-title font-semibold tracking-[-0.01em]">
          {title}
        </h2>
        {hint ? <p className="mt-2 text-sub text-muted">{hint}</p> : null}
        <fieldset className="mt-4 flex flex-col gap-1" aria-label={t("scope.options")}>
          {allowed.map((s, i) => (
            <label key={s} className="flex min-h-control cursor-pointer items-center gap-3 rounded-ui px-2 hover:bg-bg/50">
              <input
                ref={i === 0 ? firstRef : undefined}
                type="radio"
                name={group}
                value={s}
                checked={scope === s}
                onChange={() => setScope(s)}
                className="size-4 accent-[var(--color-accent)]"
              />
              <span>{t(`scope.${s}` as MessageKey)}</span>
            </label>
          ))}
        </fieldset>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onCancel} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant={confirmLabel === t("scope.confirmDelete") ? "danger" : "primary"} disabled={busy}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
