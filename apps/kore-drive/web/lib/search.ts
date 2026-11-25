/** Search result shapes and helpers (pure; shared by the page and the list). */
import type { MessageKey } from "./i18n";
import { folderHref, type ApiNode } from "./nodes";

/** `GET /api/search` item: a node plus the names of its ancestor folders. */
export type SearchHit = ApiNode & { path: string[] };

/** Results asked for per search (the API caps at 200). */
export const SEARCH_LIMIT = 100;

/** The folder holding `hit`, with `hit` selected there (`?select=`). */
export function locationHref(hit: Pick<ApiNode, "id" | "space" | "parent_id">): string {
  return `${folderHref(hit.space, hit.parent_id)}?${new URLSearchParams({ select: hit.id })}`;
}

/** Where clicking a result goes: a folder opens, a file shows in its folder. */
export function resultHref(hit: Pick<ApiNode, "id" | "space" | "parent_id" | "is_dir">): string {
  return hit.is_dir ? folderHref(hit.space, hit.id) : locationHref(hit);
}

/** Message for a 400 from `/api/search`; `null` for an empty query (show the prompt). */
export function searchErrorKey(code: string): MessageKey | null {
  if (code === "empty_query") return null;
  if (code === "query_too_long") return "search.tooLong";
  return "search.invalid";
}
