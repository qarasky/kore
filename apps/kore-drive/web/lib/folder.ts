import "server-only";

import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { api, isApiError } from "./api";
import { folderHref, type ApiNode, type Space } from "./nodes";

export type Folder = {
  /** null for the section root. */
  id: string | null;
  /** Ancestors down to and including the folder (empty at the root). */
  path: ApiNode[];
  children: ApiNode[];
};

/** Maps an API 404 to `notFound()`; every other error propagates unchanged
 *  (503 etc. reach the error boundary). */
async function or404<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (isApiError(e, 404)) notFound();
    throw e;
  }
}

/** The folder id from a `[[...folder]]` param: none for the root, one id, or a 404. */
export function folderIdFrom(segments: string[] | undefined): string | null {
  if (!segments || segments.length === 0) return null;
  if (segments.length > 1) notFound();
  return segments[0];
}

/**
 * Loads a folder for the `space` section (cached per request so metadata and
 * the page share the calls). Unknown, inaccessible or non-folder ids are a
 * 404; a folder from the other space redirects to its own section.
 */
export const loadFolder = cache(async (space: Space, id: string | null): Promise<Folder> => {
  let path: ApiNode[] = [];
  if (id !== null) {
    path = await or404(api<ApiNode[]>(`/api/nodes/${encodeURIComponent(id)}/path`));
    const self = path.at(-1);
    if (!self || self.id !== id || !self.is_dir) notFound();
    if (self.space !== space) redirect(folderHref(self.space, id));
  }
  const q = new URLSearchParams({ space });
  if (id !== null) q.set("parent", id);
  const children = await or404(api<ApiNode[]>(`/api/nodes?${q}`));
  return { id, path, children };
});
