"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition, type KeyboardEvent, type MouseEvent } from "react";
import { useSelection } from "@/hooks/useSelection";
import { api, isApiError } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { settleLimited } from "@/lib/settle";
import { t } from "@/lib/i18n";
import { fileKind, folderHref, type ApiNode, type Space } from "@/lib/nodes";
import type { TrashedNode } from "@/lib/trash";
import { ConfirmDialog } from "./ConfirmDialog";
import { NodeIcon, RestoreIcon, TrashIcon } from "./icons";
import { PageMessage } from "./PageMessage";
import { RelativeTime } from "./RelativeTime";
import { useToast } from "./Toast";

const GRID = "grid grid-cols-[minmax(0,1fr)_150px_90px_72px] items-center gap-3 px-3";

/** `empty.ids` is null while the current trash contents are being fetched. */
type Confirm = { kind: "delete"; ids: string[] } | { kind: "empty"; ids: string[] | null } | null;

/** Parallel purge requests at a time. */
const PURGE_CONCURRENCY = 4;

const sectionName = (space: Space) => (space === "shared" ? t("nav.shared") : t("nav.myFiles"));

/** Name of the folder a restored node landed in (the section for the root). */
async function folderName(node: ApiNode): Promise<string> {
  if (!node.parent_id) return sectionName(node.space);
  try {
    const path = await api<ApiNode[]>(`/api/nodes/${encodeURIComponent(node.parent_id)}/path`);
    return path.at(-1)?.name ?? sectionName(node.space);
  } catch {
    return sectionName(node.space);
  }
}

/**
 * One trash section as a `role="listbox"` with the file list's selection
 * model. Restore, Delete forever (confirmed; also the Delete key) and Empty
 * trash (confirmed, states the count). Each action refreshes the page data.
 *
 * Empty trash re-reads the trash when its dialog opens and then purges
 * exactly those ids one by one, never the blanket `DELETE /api/trash`: in the
 * shared trash a teammate may trash something while the dialog is open, and
 * that must not be destroyed under a confirmation that never listed it.
 */
export function TrashList({ space, items }: { space: Space; items: TrashedNode[] }) {
  const router = useRouter();
  const toast = useToast();
  const [refreshing, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const ids = useMemo(() => items.map((n) => n.id), [items]);
  const byId = useMemo(() => new Map(items.map((n) => [n.id, n])), [items]);
  const sel = useSelection(ids);
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  /** After a confirmed purge: focus the list (rows remain) or the section. */
  const focusAfter = useRef<"list" | "root" | null>(null);
  const emptyRequest = useRef(0);
  const rowEls = useRef(new Map<string, HTMLDivElement>());
  const working = busy || refreshing;
  const count = sel.selectedIds.length;

  const refresh = () => startTransition(() => router.refresh());

  async function restore(targets: string[]) {
    if (targets.length === 0 || working) return;
    setBusy(true);
    const results = await Promise.allSettled(
      targets.map((id) => api<ApiNode>(`/api/nodes/${encodeURIComponent(id)}/restore`, { method: "POST" })),
    );
    const restored = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    let message: string;
    let open: ApiNode | null = null;
    if (restored.length === 0) message = t("trash.restoreFailed");
    else if (restored.length < targets.length)
      message = t("trash.restorePartial", { done: restored.length, count: targets.length });
    else if (restored.length === 1) {
      open = restored[0];
      message = t("trash.restoredTo", { folder: await folderName(open) });
    } else message = t("trash.restoredMany", { count: restored.length });
    setBusy(false);
    sel.clear();
    listRef.current?.focus();
    refresh();
    const target = open;
    toast.show({
      message,
      tone: restored.length < targets.length ? "error" : "info",
      action: target
        ? {
            label: t("trash.openFolder"),
            run: () => router.push(`${folderHref(target.space, target.parent_id)}?select=${encodeURIComponent(target.id)}`),
          }
        : undefined,
    });
  }

  async function purge(targets: string[], kind: "delete" | "empty") {
    const results = await settleLimited(targets, PURGE_CONCURRENCY, (id) =>
      api(`/api/trash/${encodeURIComponent(id)}`, { method: "DELETE" }),
    );
    // Already gone (e.g. purged in another tab) counts as done.
    const done = targets.filter((_, i) => {
      const r = results[i];
      return r.status === "fulfilled" || isApiError(r.reason, 404);
    });
    const gone = new Set(done);
    focusAfter.current = items.some((n) => !gone.has(n.id)) ? "list" : "root";
    setConfirm(null);
    sel.clear();
    refresh();
    if (done.length < targets.length) {
      toast.show({
        message: done.length === 0 ? t("trash.deleteFailed") : t("trash.partial", { done: done.length, count: targets.length }),
        tone: "error",
      });
    } else if (kind === "empty") toast.show({ message: t("trash.emptied") });
    else if (done.length === 1) toast.show({ message: t("trash.deletedOne", { name: byId.get(done[0])?.name ?? "" }) });
    else toast.show({ message: t("trash.deletedMany", { count: done.length }) });
  }

  /** Opens the Empty trash dialog with the trash as it is now (refreshing the list too). */
  async function openEmpty() {
    if (working) return;
    const req = ++emptyRequest.current;
    setConfirm({ kind: "empty", ids: null });
    refresh();
    try {
      const fresh = await api<TrashedNode[]>(`/api/trash?space=${space}`);
      if (req !== emptyRequest.current) return;
      setConfirm((c) => (c?.kind === "empty" ? { kind: "empty", ids: fresh.map((n) => n.id) } : c));
    } catch {
      if (req !== emptyRequest.current) return;
      setConfirm((c) => (c?.kind === "empty" ? null : c));
      toast.show({ message: t("trash.emptyFailed"), tone: "error" });
    }
  }

  function cancelConfirm() {
    emptyRequest.current++;
    setConfirm(null);
  }

  function confirmReturnFocus(): HTMLElement | null | undefined {
    const where = focusAfter.current;
    focusAfter.current = null;
    if (where === "list") return listRef.current ?? rootRef.current;
    if (where === "root") return rootRef.current;
    return undefined; // cancelled: back to the opener
  }

  const askDelete = (targets: string[]) => {
    if (targets.length > 0 && !working) setConfirm({ kind: "delete", ids: targets });
  };

  function onKeyDown(e: KeyboardEvent) {
    const move = (delta: number) => {
      e.preventDefault();
      const id = sel.move(delta, e.shiftKey);
      if (id) rowEls.current.get(id)?.focus();
    };
    const mod = e.metaKey || e.ctrlKey;
    switch (e.key) {
      case "ArrowDown":
        return move(1);
      case "ArrowUp":
        return move(-1);
      case "Home":
        return move(-ids.length);
      case "End":
        return move(ids.length);
      case "Delete":
        e.preventDefault();
        askDelete(sel.selectedIds);
        return;
      case "Escape":
        sel.clear();
        return;
      case " ":
        e.preventDefault();
        if (sel.selection.focus) sel.click(sel.selection.focus, { toggle: mod });
        return;
    }
    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      sel.selectAll();
    }
  }

  const onRowClick = (id: string, e: MouseEvent) => {
    if ((e.target as Element).closest("button")) return;
    sel.click(id, { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey });
  };

  const toolbarButton =
    "inline-flex items-center gap-1.5 rounded-ui border border-border-strong px-2.5 py-1 font-medium " +
    "hover:bg-white/5 disabled:pointer-events-none disabled:opacity-40";
  const rowButton = "rounded-ui p-1 text-muted hover:bg-white/10 hover:text-text disabled:opacity-40";
  const tabbable = sel.selection.focus ?? ids[0] ?? null;

  return (
    <div ref={rootRef} tabIndex={-1} data-testid="trash-section" className="flex min-h-0 flex-1 flex-col outline-none">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
        <button type="button" className={toolbarButton} disabled={count === 0 || working} onClick={() => restore(sel.selectedIds)}>
          <RestoreIcon />
          {t("trash.restore")}
        </button>
        <button type="button" className={toolbarButton} disabled={count === 0 || working} onClick={() => askDelete(sel.selectedIds)}>
          <TrashIcon />
          {t("trash.deleteForever")}
        </button>
        <span aria-live="polite" className="text-[12px] text-muted">
          {working ? t("list.working") : count > 0 ? t("list.selectedCount", { count }) : null}
        </span>
        <button
          type="button"
          className={`${toolbarButton} ml-auto text-danger`}
          disabled={items.length === 0 || working}
          onClick={openEmpty}
        >
          {t("trash.empty")}
        </button>
      </div>

      {items.length === 0 ? (
        <PageMessage title={t("trash.emptyStateTitle")} testId="trash-empty">
          {space === "shared" ? t("trash.emptyStateShared") : t("trash.emptyState")}
        </PageMessage>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col overflow-auto" onClick={(e) => e.target === e.currentTarget && sel.clear()}>
          <div className={`${GRID} sticky top-0 z-10 h-8 shrink-0 border-b border-border bg-surface text-[12px] font-medium text-muted`}>
            <span className="pl-[26px]">{t("list.name")}</span>
            <span>{t("trash.deleted")}</span>
            <span className="text-right">{t("list.size")}</span>
            <span />
          </div>
          <div
            ref={listRef}
            role="listbox"
            aria-label={t("trash.list")}
            aria-multiselectable="true"
            aria-busy={working || undefined}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            className="flex-1 pb-10 outline-none"
          >
            {items.map((node) => {
              const selected = sel.isSelected(node.id);
              const nameId = `trash-name-${node.id}`;
              return (
                <div
                  key={node.id}
                  ref={(el) => {
                    if (el) rowEls.current.set(node.id, el);
                    else rowEls.current.delete(node.id);
                  }}
                  role="option"
                  aria-selected={selected}
                  aria-labelledby={nameId}
                  tabIndex={node.id === tabbable ? 0 : -1}
                  data-id={node.id}
                  onClick={(e) => onRowClick(node.id, e)}
                  className={
                    `${GRID} group h-8 cursor-default border-b border-border/60 select-none outline-none ` +
                    "focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset " +
                    (selected ? "bg-accent/15 text-text" : "hover:bg-white/[0.03]")
                  }
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <NodeIcon kind={fileKind(node)} />
                    <span id={nameId} className="truncate" title={node.name}>
                      {node.name}
                    </span>
                  </div>
                  <div className="truncate text-muted">
                    <RelativeTime unixSeconds={node.trashed_at} />
                  </div>
                  <div className="text-right text-muted tabular-nums">
                    {node.is_dir ? <span aria-hidden="true">—</span> : formatBytes(node.size)}
                  </div>
                  <div className="flex justify-end gap-0.5 opacity-0 group-hover:opacity-100 group-aria-selected:opacity-100 focus-within:opacity-100">
                    <button
                      type="button"
                      tabIndex={-1}
                      className={rowButton}
                      disabled={working}
                      aria-label={t("trash.restoreItem", { name: node.name })}
                      title={t("trash.restore")}
                      onClick={() => restore([node.id])}
                    >
                      <RestoreIcon />
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      className={rowButton}
                      disabled={working}
                      aria-label={t("trash.deleteForeverItem", { name: node.name })}
                      title={t("trash.deleteForever")}
                      onClick={() => askDelete([node.id])}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {confirm?.kind === "delete" && (
        <ConfirmDialog
          danger
          title={t("trash.deleteTitle")}
          message={
            confirm.ids.length === 1
              ? t("trash.deleteMessageOne", { name: byId.get(confirm.ids[0])?.name ?? "" })
              : t("trash.deleteMessageMany", { count: confirm.ids.length })
          }
          confirmLabel={t("trash.deleteForever")}
          onConfirm={() => purge(confirm.ids, "delete")}
          onCancel={cancelConfirm}
          returnFocus={confirmReturnFocus}
        />
      )}
      {confirm?.kind === "empty" && (
        <ConfirmDialog
          danger
          title={t("trash.emptyTitle")}
          message={emptyMessage(confirm.ids, space)}
          confirmLabel={t("trash.empty")}
          confirmDisabled={!confirm.ids || confirm.ids.length === 0}
          onConfirm={() => (confirm.ids ? purge(confirm.ids, "empty") : undefined)}
          onCancel={cancelConfirm}
          returnFocus={confirmReturnFocus}
        />
      )}
    </div>
  );
}

function emptyMessage(ids: string[] | null, space: Space): string {
  if (!ids) return t("trash.emptyChecking");
  if (ids.length === 0) return t("trash.emptyNothing");
  const section = space === "shared" ? t("trash.shared") : t("trash.mine");
  return ids.length === 1
    ? t("trash.emptyMessageOne", { section })
    : t("trash.emptyMessageMany", { count: ids.length, section });
}
