"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ScopeDialog } from "@/components/ScopeDialog";
import { useToast } from "@/components/Toast";
import { allowedDeleteScopes, planDelete, type Scope } from "@/lib/editPlan";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n";
import { restoreEvent, runPlan } from "@/lib/mutations";
import type { Event, Occurrence } from "@/lib/types";

type Pending = { master: Event; occ: Occurrence | null; onDone?: () => void };

/**
 * Deleting an event: asks "which events?" for a repeating one, or confirms a
 * single one, then deletes. A whole-event delete offers Undo (restore) in the
 * toast. Returns `request(...)` to start it and `dialog` to render.
 */
export function useEventDelete(): { request: (master: Event, occ: Occurrence | null, onDone?: () => void) => void; dialog: ReactNode } {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState<Pending | null>(null);

  const perform = useCallback(
    async (p: Pending, scope: Scope) => {
      try {
        await runPlan(planDelete({ master: p.master, occurrence: p.occ, scope }));
      } catch (e) {
        toast(errorMessage(e), { kind: "error" });
        return;
      }
      setPending(null);
      p.onDone?.();
      toast(t("toast.deleted"), {
        action:
          scope === "all"
            ? {
                label: t("common.undo"),
                onClick: async () => {
                  try {
                    await restoreEvent(p.master.id);
                    toast(t("toast.restored"));
                    router.refresh();
                  } catch (e) {
                    toast(errorMessage(e), { kind: "error" });
                  }
                },
              }
            : undefined,
      });
      router.refresh();
    },
    [router, toast],
  );

  const request = useCallback((master: Event, occ: Occurrence | null, onDone?: () => void) => setPending({ master, occ, onDone }), []);

  let dialog: ReactNode = null;
  if (pending) {
    const scopes = allowedDeleteScopes(pending.master, pending.occ);
    dialog =
      scopes.length > 1 ? (
        <ScopeDialog
          title={t("scope.deleteTitle")}
          confirmLabel={t("scope.confirmDelete")}
          allowed={scopes}
          onChoose={(scope) => perform(pending, scope)}
          onCancel={() => setPending(null)}
        />
      ) : (
        <ConfirmDialog
          danger
          title={t("confirm.deleteTitle")}
          message={t("confirm.deleteBody", { title: pending.master.title })}
          confirmLabel={t("common.delete")}
          onConfirm={() => perform(pending, "all")}
          onCancel={() => setPending(null)}
        />
      );
  }
  return { request, dialog };
}
