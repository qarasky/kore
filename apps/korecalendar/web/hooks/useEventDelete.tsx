"use client";

import { ConfirmDialog, useToast } from "@qarasky/kore-ui";
import { useRouter } from "next/navigation";
import { useCallback, useState, type ReactNode } from "react";
import { ScopeDialog } from "@/components/ScopeDialog";
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
export function useEventDelete(): { request: (master: Event, occ: Occurrence | null, onDone?: () => void) => void; dialog: ReactNode; open: boolean } {
  const router = useRouter();
  const toast = useToast();
  // `pending` outlives `open` so the dialog keeps its text while it animates out.
  const [pending, setPending] = useState<Pending | null>(null);
  const [open, setOpen] = useState(false);

  const perform = useCallback(
    async (p: Pending, scope: Scope) => {
      try {
        await runPlan(planDelete({ master: p.master, occurrence: p.occ, scope }));
      } catch (e) {
        toast.show({ message: errorMessage(e), tone: "error" });
        throw e; // keeps the dialog open
      }
      setOpen(false);
      p.onDone?.();
      toast.show({
        message: t("toast.deleted"),
        action:
          scope === "all"
            ? {
                label: t("common.undo"),
                onClick: async () => {
                  try {
                    await restoreEvent(p.master.id);
                    toast.show({ message: t("toast.restored") });
                    router.refresh();
                  } catch (e) {
                    toast.show({ message: errorMessage(e), tone: "error" });
                  }
                },
              }
            : undefined,
      });
      router.refresh();
    },
    [router, toast],
  );

  const request = useCallback((master: Event, occ: Occurrence | null, onDone?: () => void) => {
    setPending({ master, occ, onDone });
    setOpen(true);
  }, []);

  let dialog: ReactNode = null;
  if (pending) {
    const scopes = allowedDeleteScopes(pending.master, pending.occ);
    dialog =
      scopes.length > 1 ? (
        <ScopeDialog
          key={pending.master.id + (pending.occ?.key ?? "")}
          open={open}
          onOpenChange={setOpen}
          danger
          title={t("scope.deleteTitle")}
          confirmLabel={t("scope.confirmDelete")}
          allowed={scopes}
          onChoose={(scope) => perform(pending, scope)}
        />
      ) : (
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          danger
          title={t("confirm.deleteTitle")}
          description={t("confirm.deleteBody", { title: pending.master.title })}
          confirmLabel={t("common.delete")}
          cancelLabel={t("common.cancel")}
          pendingLabel={t("common.working")}
          onConfirm={() => perform(pending, "all")}
        />
      );
  }
  return { request, dialog, open };
}
