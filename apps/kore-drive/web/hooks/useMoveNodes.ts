"use client";

import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { isNoopMove, moveErrorKey, type MoveDest, type MovePayload } from "@/lib/moveDrag";

/**
 * Moves dragged nodes with `PATCH /api/nodes/{id}` (into a folder via
 * `parent_id`, or to a space root via `parent_id: null` + `space`), all at
 * once with `Promise.allSettled`; then refreshes and reports the outcome
 * (partial failures included) in a toast. No-op drops send nothing.
 */
export function useMoveNodes() {
  const router = useRouter();
  const toast = useToast();

  return async function move(p: MovePayload, dest: MoveDest): Promise<void> {
    if (isNoopMove(p, dest)) return;
    const body = dest.parentId !== null ? { parent_id: dest.parentId } : { parent_id: null, space: dest.space };
    const results = await Promise.allSettled(
      p.ids.map((id) => api(`/api/nodes/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) })),
    );
    router.refresh();
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    const done = results.length - failed.length;
    if (failed.length === 0) {
      const message = done === 1 ? t("move.doneOne", { name: p.names[p.ids[0]] ?? "" }) : t("move.doneMany", { count: done });
      toast.show({ message });
      return;
    }
    const reason = t(moveErrorKey(failed[0].reason));
    toast.show({
      message: done === 0 ? reason : t("move.partial", { done, count: results.length, reason }),
      tone: "error",
    });
  };
}
