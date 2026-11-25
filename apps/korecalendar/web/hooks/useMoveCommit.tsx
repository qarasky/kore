"use client";

import { useToast } from "@qarasky/kore-ui";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition, type ReactNode } from "react";
import { ScopeDialog } from "@/components/ScopeDialog";
import { droppedMessage, planMove, type Scope } from "@/lib/editPlan";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n";
import { fetchEvent, runPlan } from "@/lib/mutations";
import { api } from "@/lib/api";
import type { Event, Occurrence } from "@/lib/types";

export type Move = { deltaDays: number; deltaMinutes: number; newDurationMinutes?: number };

type Pending = { master: Event; occ: Occurrence; move: Move; allowed: Scope[]; warning?: string };

/**
 * Applies a drag or keyboard move of an occurrence: fetches the series (for its
 * version and rule), asks "which events?" when it repeats, runs the request and
 * refreshes. A single event's move offers Undo. `busy` stays true until the
 * refreshed data has arrived, so the dropped block can stay where it landed.
 */
export function useMoveCommit(): { commit: (occ: Occurrence, move: Move) => Promise<void>; dialog: ReactNode; busy: boolean } {
  const router = useRouter();
  const toast = useToast();
  const [working, setWorking] = useState(false);
  const [refreshing, startTransition] = useTransition();
  // `pending` outlives `open` so the dialog keeps its text while it animates out.
  const [pending, setPending] = useState<Pending | null>(null);
  const [open, setOpen] = useState(false);

  const apply = useCallback(
    async (master: Event, occ: Occurrence, move: Move, scope: Scope) => {
      const plan = planMove({ master, occurrence: occ, ...move, scope });
      if (plan.requests.length === 0) {
        setWorking(false);
        return;
      }
      let results: unknown[];
      try {
        results = await runPlan(plan);
      } catch (e) {
        toast.show({ message: errorMessage(e), tone: "error" });
        setWorking(false);
        return;
      }
      const dropped = droppedMessage(results);
      const single = !occ.is_recurring;
      // One toast at a time (kore-ui): the reset-occurrences note rides along with "Event moved".
      toast.show({
        message: dropped ? `${t("toast.moved")}. ${dropped}` : t("toast.moved"),
        action: single
          ? {
              label: t("common.undo"),
              onClick: async () => {
                try {
                  await api(`/api/events/${master.id}`, { method: "PATCH", body: JSON.stringify({ start: master.start, end: master.end }) });
                  router.refresh();
                } catch (e) {
                  toast.show({ message: errorMessage(e), tone: "error" });
                }
              },
            }
          : undefined,
      });
      startTransition(() => router.refresh());
      setWorking(false);
    },
    [router, toast],
  );

  const commit = useCallback(
    async (occ: Occurrence, move: Move) => {
      setWorking(true);
      let master: Event;
      try {
        master = await fetchEvent(occ.event_id);
      } catch (e) {
        toast.show({ message: errorMessage(e), tone: "error" });
        setWorking(false);
        return;
      }
      const plan = planMove({ master, occurrence: occ, ...move, scope: "this" });
      if (plan.requests.length === 0) {
        setWorking(false);
        return;
      }
      if (occ.is_recurring && plan.allowedScopes.length > 1) {
        setPending({ master, occ, move, allowed: plan.allowedScopes, warning: plan.warnings[0] ? t(plan.warnings[0]) : undefined });
        setOpen(true);
        return;
      }
      await apply(master, occ, move, occ.is_recurring ? plan.allowedScopes[0] : "all");
    },
    [apply, toast],
  );

  const dialog = pending ? (
    <ScopeDialog
      key={pending.occ.key}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setWorking(false);
      }}
      title={t("scope.moveTitle")}
      confirmLabel={t("scope.confirmMove")}
      allowed={pending.allowed}
      hint={pending.warning}
      onChoose={async (scope) => {
        setOpen(false);
        await apply(pending.master, pending.occ, pending.move, scope);
      }}
    />
  ) : null;

  return { commit, dialog, busy: working || refreshing };
}
