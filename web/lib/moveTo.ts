/**
 * Pure helpers for moving nodes with explicit actions (Move to Shared space /
 * My files, the Move to… dialog) and for the move result toasts.
 */
import { t } from "./i18n";
import type { MoveDest, MovePayload } from "./moveDrag";
import type { Space } from "./nodes";

export const otherSpace = (s: Space): Space => (s === "shared" ? "personal" : "shared");

export const spaceLabel = (s: Space): string => (s === "shared" ? t("nav.shared") : t("nav.myFiles"));

/** `PATCH /api/nodes/{id}` body moving a node to `dest` (a folder, or a space root). */
export function moveBody(dest: MoveDest): { parent_id: string } | { parent_id: null; space: Space } {
  return dest.parentId !== null ? { parent_id: dest.parentId } : { parent_id: null, space: dest.space };
}

/** A place in the Move to… picker: a space and the folder ids from its root down. */
export type PickerLocation = { space: Space; path: readonly string[] };

export const locationDest = (loc: PickerLocation): MoveDest => ({
  space: loc.space,
  parentId: loc.path.length > 0 ? loc.path[loc.path.length - 1] : null,
});

/**
 * Why `loc` can't take the moved items: `here` (that is where they are) or
 * `inside` (one of the moved folders, or somewhere inside one); else null.
 */
export function destinationProblem(p: Pick<MovePayload, "ids" | "space" | "parentId">, loc: PickerLocation): "here" | "inside" | null {
  if (loc.path.some((id) => p.ids.includes(id))) return "inside";
  const d = locationDest(loc);
  if (d.space === p.space && d.parentId === p.parentId) return "here";
  return null;
}

/** Folders being moved are not destinations, so the picker doesn't open them. */
export const canOpenFolder = (p: Pick<MovePayload, "ids">, folderId: string): boolean => !p.ids.includes(folderId);

/** "Moved “a.txt”", "Moved 3 items", or with a destination "… to Shared space". */
export function moveDoneMessage(ids: readonly string[], names: Record<string, string>, dest?: string): string {
  if (ids.length === 1) {
    const name = names[ids[0]] ?? "";
    return dest ? t("move.doneOneTo", { name, dest }) : t("move.doneOne", { name });
  }
  return dest ? t("move.doneManyTo", { count: ids.length, dest }) : t("move.doneMany", { count: ids.length });
}
