"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useToast } from "@/components/Toast";
import { api, isApiError } from "@/lib/api";
import { downloadFile, downloadZip } from "@/lib/download";
import { t, type MessageKey } from "@/lib/i18n";
import type { ApiNode, Space } from "@/lib/nodes";

const nodePath = (id: string) => `/api/nodes/${encodeURIComponent(id)}`;

/** Message for a failed create/rename. */
export function nameErrorKey(e: unknown): MessageKey {
  if (isApiError(e, 409)) return "rename.error.nameTaken";
  if (isApiError(e, 400) && e.code === "invalid_name") return "rename.error.invalid";
  if (isApiError(e, 404)) return "rename.error.notFound";
  return "rename.error.generic";
}

/**
 * The file browser's mutations. Each calls the API, then `router.refresh()`
 * so the server components re-render with fresh data; nothing is applied
 * optimistically. `working` is true while a request, refresh or navigation runs.
 * `after` callbacks run inside the refresh transition, so UI state changes
 * (closing an editor, selecting a new row) land together with the new data.
 */
export function useFileActions({ space, parentId, byId }: { space: Space; parentId: string | null; byId: Map<string, ApiNode> }) {
  const router = useRouter();
  const toast = useToast();
  const [transitioning, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  const refresh = (after?: () => void) =>
    startTransition(() => {
      router.refresh();
      after?.();
    });

  async function restore(ids: string[]) {
    const results = await Promise.allSettled(ids.map((id) => api(`${nodePath(id)}/restore`, { method: "POST" })));
    // Plain refresh: the list that started this may have unmounted by now.
    router.refresh();
    if (results.some((r) => r.status === "rejected")) {
      toast.show({ message: t("toast.restoreFailed"), tone: "error" });
    }
  }

  async function trash(ids: string[]) {
    if (ids.length === 0 || busy) return;
    setBusy(true);
    const results = await Promise.allSettled(ids.map((id) => api(nodePath(id), { method: "DELETE" })));
    setBusy(false);
    const done = ids.filter((_, i) => results[i].status === "fulfilled");
    refresh();
    if (done.length === 0) {
      toast.show({ message: t("toast.trashFailed"), tone: "error" });
      return;
    }
    const partial = done.length < ids.length;
    const message = partial
      ? t("toast.trashFailed")
      : done.length === 1
        ? t("toast.trashedOne", { name: byId.get(done[0])?.name ?? "" })
        : t("toast.trashedMany", { count: done.length });
    toast.show({
      message,
      tone: partial ? "error" : "info",
      action: { label: t("toast.undo"), run: () => restore(done) },
    });
  }

  async function rename(id: string, name: string, after: () => void): Promise<MessageKey | null> {
    try {
      await api(nodePath(id), { method: "PATCH", body: JSON.stringify({ name }) });
    } catch (e) {
      return nameErrorKey(e);
    }
    refresh(after);
    return null;
  }

  async function createFolder(name: string, after: (created: ApiNode) => void): Promise<MessageKey | null> {
    let created: ApiNode;
    try {
      created = await api<ApiNode>("/api/nodes", {
        method: "POST",
        body: JSON.stringify({ space, parent_id: parentId, name }),
      });
    } catch (e) {
      return nameErrorKey(e);
    }
    refresh(() => after(created));
    return null;
  }

  /** A single file downloads as itself; folders or several items as one zip. */
  function download(ids: string[]) {
    if (ids.length === 0) return;
    const onError = () => toast.show({ message: t("toast.downloadFailed"), tone: "error" });
    const one = ids.length === 1 ? byId.get(ids[0]) : undefined;
    if (one && !one.is_dir) downloadFile(one.id, onError);
    else downloadZip(ids, onError);
  }

  /** Client navigation (e.g. into a folder) with the pending indicator shown. */
  const navigate = (href: string) => startTransition(() => router.push(href));

  return { working: busy || transitioning, trash, rename, createFolder, download, navigate };
}
