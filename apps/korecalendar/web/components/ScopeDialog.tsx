"use client";

import { ConfirmDialog, RadioGroup, RadioGroupItem } from "@qarasky/kore-ui";
import { useState } from "react";
import type { Scope } from "@/lib/editPlan";
import { t, type MessageKey } from "@/lib/i18n";

/**
 * "Which events?" for a repeating event: this one, this and the ones after it, or all of them
 * (kore-ui's ConfirmDialog with a RadioGroup). Only the scopes the change can safely use are
 * offered. `onChoose` may reject to keep the dialog open.
 */
export function ScopeDialog({
  open,
  onOpenChange,
  title,
  confirmLabel,
  allowed,
  hint,
  danger = false,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  confirmLabel: string;
  allowed: Scope[];
  hint?: string;
  danger?: boolean;
  onChoose: (scope: Scope) => void | Promise<void>;
}) {
  const [scope, setScope] = useState<Scope>(allowed[0]);
  const value = allowed.includes(scope) ? scope : allowed[0];
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={hint}
      confirmLabel={confirmLabel}
      cancelLabel={t("common.cancel")}
      pendingLabel={t("common.working")}
      danger={danger}
      onConfirm={() => onChoose(value)}
    >
      <RadioGroup aria-label={t("scope.options")} value={value} onValueChange={(v) => setScope(v as Scope)}>
        {allowed.map((s) => (
          <RadioGroupItem key={s} value={s} label={t(`scope.${s}` as MessageKey)} />
        ))}
      </RadioGroup>
    </ConfirmDialog>
  );
}
