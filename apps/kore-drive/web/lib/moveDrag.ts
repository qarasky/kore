/**
 * State of an in-page row drag (moving nodes). During `dragover` the browser
 * hides `dataTransfer` data from drop targets (only `types` is readable), so
 * the dragged ids live here for the drag's duration; `types` containing
 * {@link MOVE_DRAG_TYPE} tells targets the drag is ours (and not stale).
 * Browser-only.
 */
import { isApiError } from "./api";
import { t, type MessageKey } from "./i18n";
import type { Space } from "./nodes";

export const MOVE_DRAG_TYPE = "application/x-kore-nodes";

export type MovePayload = {
  ids: string[];
  /** Names by id, for the result toast. */
  names: Record<string, string>;
  /** Where the dragged nodes are now. */
  space: Space;
  parentId: string | null;
};

/** A drop destination: a folder (`parentId`) or the root of `space`. */
export type MoveDest = { space: Space; parentId: string | null };

let current: MovePayload | null = null;

type DragLike = { dataTransfer: DataTransfer | null };

export function isFileDrag(e: DragLike): boolean {
  return !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
}

/** The payload of the row drag in progress over this event, or null (OS file drags, other pages). */
export function activeMove(e: DragLike): MovePayload | null {
  return current && e.dataTransfer && [...e.dataTransfer.types].includes(MOVE_DRAG_TYPE) ? current : null;
}

/** Dropping onto one of the dragged items, or where they already are, does nothing. */
export function isNoopMove(p: MovePayload, dest: MoveDest): boolean {
  if (dest.parentId !== null && p.ids.includes(dest.parentId)) return true;
  return p.space === dest.space && p.parentId === dest.parentId;
}

/** Starts a row drag: records the payload and, for several items, shows an "N items" drag image. */
export function beginMove(e: { dataTransfer: DataTransfer }, payload: MovePayload): void {
  current = payload;
  const dt = e.dataTransfer;
  dt.effectAllowed = "move";
  dt.setData(MOVE_DRAG_TYPE, JSON.stringify(payload.ids));
  if (payload.ids.length > 1) {
    const badge = document.createElement("div");
    badge.textContent = t("move.dragCount", { count: payload.ids.length });
    badge.className =
      "fixed -top-24 left-0 rounded-ui border border-border-strong bg-raised px-2.5 py-1 text-[13px] font-medium text-text";
    document.body.append(badge);
    dt.setDragImage(badge, -10, -10);
    setTimeout(() => badge.remove(), 0);
  }
}

export function endMove(): void {
  current = null;
}

/** The toast message for a failed `PATCH /api/nodes/{id}` move. */
export function moveErrorKey(e: unknown): MessageKey {
  if (isApiError(e, 409)) return "move.error.nameTaken";
  if (isApiError(e, 400) && e.code === "invalid_move") return "move.error.intoItself";
  if (isApiError(e, 404)) return "move.error.notFound";
  if (isApiError(e, 507)) return "move.error.quota";
  return "move.error.generic";
}
