/** Trash shapes and helpers (pure). */
import type { ApiNode, Space } from "./nodes";

/** `GET /api/trash` item: a trash root with when it was trashed (Unix seconds). */
export type TrashedNode = ApiNode & { trashed_at: number };

/** The space a trash tab shows, from `?space=` (anything else is My trash). */
export function trashSpace(param: string | string[] | undefined): Space {
  return param === "shared" ? "shared" : "personal";
}

export function trashHref(space: Space): string {
  return space === "shared" ? "/trash?space=shared" : "/trash";
}
