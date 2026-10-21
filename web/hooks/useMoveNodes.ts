"use client";

import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { isNoopMove, moveErrorKey, type MoveDest, type MovePayload } from "@/lib/moveDrag";
import { moveBody, moveDoneMessage } from "@/lib/moveTo";

const patchTo = (ids: readonly string[], dest: MoveDest) =>
  Promise.allSettled(
    ids.map((id) => api(`/api/nodes/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(moveBody(dest)) })),
  );

/**
 * Moves nodes with `PATCH /api/nodes/{id}` (into a folder via `parent_id`,
 * or to a space root via `parent_id: null` + `space`), all at once with
 * `Promise.allSettled`; then refreshes and reports the outcome (partial
 * failures included) in a toast, naming the destination when `destLabel` is
 * given. Whatever moved can be undone from the toast: a best-effort move
 * back to where it came from that reports its own failures. No-op moves
 * send nothing.
 */
export function useMoveNodes() {
  const router = useRouter();
  const toast = useToast();

  async function undo(ids: string[], from: MoveDest): Promise<void> {
    const results = await patchTo(ids, from);
    router.refresh();
    const failed = results.filter((r) => r.status === "rejected").length;
    toast.show(
      failed === 0
        ? { message: t("move.undone") }
        : { message: t("move.undoFailed", { count: failed, total: ids.length }), tone: "error" },
    );
  }

  return async function move(p: MovePayload, dest: MoveDest, opts: { destLabel?: string } = {}): Promise<void> {
    if (isNoopMove(p, dest)) return;
    const results = await patchTo(p.ids, dest);
    router.refresh();
    const moved = p.ids.filter((_, i) => results[i].status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    const action =
      moved.length > 0
        ? { label: t("toast.undo"), run: () => undo(moved, { space: p.space, parentId: p.parentId }) }
        : undefined;
    if (failed.length === 0) {
      toast.show({ message: moveDoneMessage(moved, p.names, opts.destLabel), action });
      return;
    }
    const reason = t(moveErrorKey(failed[0].reason));
    toast.show({
      message: moved.length === 0 ? reason : t("move.partial", { done: moved.length, count: results.length, reason }),
      tone: "error",
      action,
    });
  };
}
