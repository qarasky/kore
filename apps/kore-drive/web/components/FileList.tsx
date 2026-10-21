"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useFileActions } from "@/hooks/useFileActions";
import { useMoveNodes } from "@/hooks/useMoveNodes";
import { useSelection } from "@/hooks/useSelection";
import { collectDataTransfer } from "@/lib/dropEntries";
import { t, type MessageKey } from "@/lib/i18n";
import { activeMove, beginMove, endMove, isFileDrag, isNoopMove } from "@/lib/moveDrag";
import { folderHref, type ApiNode, type Space } from "@/lib/nodes";
import { useRegisterBrowser } from "./BrowserContext";
import { ContextMenu } from "./ContextMenu";
import { DropZone } from "./DropZone";
import { EmptyState } from "./EmptyState";
import { FileRow, ROW_GRID, type RowHandlers } from "./FileRow";
import { DownloadIcon, FolderPlusIcon, NodeIcon, OpenIcon, PencilIcon, TrashIcon } from "./icons";
import type { CloseReason, MenuAction } from "./Menu";
import { NameEditor, type EditEnd } from "./NameEditor";
import { useToast } from "./Toast";
import { useUploads } from "./UploadContext";

type Editing = { kind: "rename"; id: string } | { kind: "new" } | null;
type MenuState = { x: number; y: number; target: "rows" | "empty" } | null;

const isOnRow = (e: { target: EventTarget }) => (e.target as Element).closest('[role="option"]') !== null;

/**
 * The folder listing: a `role="listbox"` of dense rows with file-manager
 * selection (click, shift/ctrl-click, arrows, Ctrl/Cmd+A), inline rename
 * (F2), trash (Delete), open (Enter / double-click) and a context menu.
 */
export function FileList({
  space,
  parentId,
  nodes,
  header,
}: {
  space: Space;
  parentId: string | null;
  nodes: ApiNode[];
  /** Breadcrumbs, rendered on the server. */
  header: ReactNode;
}) {
  const ids = useMemo(() => nodes.map((n) => n.id), [nodes]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const sel = useSelection(ids);
  const actions = useFileActions({ space, parentId, byId });
  const [editing, setEditing] = useState<Editing>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rowEls = useRef(new Map<string, HTMLDivElement>());
  /** A row to focus once it shows up (after create/rename refreshes). */
  const focusWhenShown = useRef<string | null>(null);
  const registerBrowser = useRegisterBrowser();
  const toast = useToast();
  const uploads = useUploads();
  const moveNodes = useMoveNodes();

  useEffect(() => {
    registerBrowser({
      space,
      parentId,
      newFolder: () => {
        setMenu(null);
        setEditing({ kind: "new" });
      },
    });
    return () => registerBrowser(null);
  }, [registerBrowser, space, parentId]);

  useEffect(() => {
    const id = focusWhenShown.current;
    const el = id ? rowEls.current.get(id) : undefined;
    if (el && !editing) {
      el.focus();
      focusWhenShown.current = null;
    }
  });

  const focusRow = (id: string | null) => {
    const el = id ? rowEls.current.get(id) : undefined;
    (el ?? listRef.current)?.focus();
  };

  /** The row Enter/F2/Open/Rename act on: only ever a lone selection. */
  const single = (): string | null => (sel.selectedIds.length === 1 ? sel.selectedIds[0] : null);

  function open(id: string) {
    const n = byId.get(id);
    if (!n) return;
    if (n.is_dir) actions.navigate(folderHref(space, n.id));
    else actions.download([n.id]); // preview arrives in task 15
  }

  function trashSelected() {
    listRef.current?.focus(); // keep keyboard focus in the list as rows vanish
    // Trashed rows leave the selection at once, so a second Delete before the
    // refresh lands has nothing to (re-)trash.
    void actions.trash(sel.selectedIds, () => sel.clear());
  }

  function startRename(id: string) {
    sel.click(id);
    setEditing({ kind: "rename", id });
  }

  /** Ends an edit without saving. After Escape focus returns to the row; after
   *  a blur it stays wherever the user moved it. An error from an abandoned
   *  blur-submit is reported in a toast since the inline message goes away. */
  function cancelEdit(how: EditEnd, error?: MessageKey) {
    const id = editing?.kind === "rename" ? editing.id : sel.selection.focus;
    setEditing(null);
    if (how === "escape") focusRow(id);
    if (error) toast.show({ message: t(error), tone: "error" });
  }

  async function submitRename(id: string, name: string) {
    if (name === byId.get(id)?.name) {
      setEditing(null);
      focusRow(id);
      return null;
    }
    return actions.rename(id, name, () => {
      focusWhenShown.current = id;
      setEditing(null);
    });
  }

  async function submitNew(name: string) {
    return actions.createFolder(name, (created) => {
      focusWhenShown.current = created.id;
      setEditing(null);
      sel.only(created.id);
    });
  }

  function openMenuAt(x: number, y: number, target: "rows" | "empty") {
    setMenu({ x, y, target });
  }

  function closeMenu(reason: CloseReason) {
    setMenu(null);
    // Back to the list so arrows keep working; an action that moves focus
    // itself (inline rename's input, navigation) runs after this and wins.
    if (reason !== "outside") focusRow(sel.selection.focus);
  }

  const handlers: RowHandlers = {
    onClick: (id, e) => {
      if (editing?.kind === "rename" && editing.id === id) return;
      sel.click(id, { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey });
    },
    onDoubleClick: (id) => {
      if (!editing) open(id);
    },
    onContextMenu: (id, e) => {
      e.preventDefault();
      e.stopPropagation();
      if (editing) return;
      if (!sel.isSelected(id)) sel.click(id);
      openMenuAt(e.clientX, e.clientY, "rows");
    },
    // Dragging a selected row drags the whole selection; any other row drags alone.
    onDragStart: (id, e) => {
      const dragged = sel.isSelected(id) ? sel.selectedIds : [id];
      const names = Object.fromEntries(dragged.map((d) => [d, byId.get(d)?.name ?? ""]));
      beginMove(e, { ids: dragged, names, space, parentId });
    },
    onDragEnd: endMove,
    acceptsDrop: (node, e) => {
      if (isFileDrag(e)) return true;
      const p = activeMove(e);
      return p !== null && !isNoopMove(p, { space, parentId: node.id });
    },
    onDrop: (node, e) => {
      if (isFileDrag(e)) {
        void collectDataTransfer(e.dataTransfer).then((set) => uploads.upload(set, { space, parent: node.id }));
        return;
      }
      const p = activeMove(e);
      endMove();
      if (p) void moveNodes(p, { space, parentId: node.id });
    },
  };

  function onAreaClick(e: MouseEvent) {
    if (!isOnRow(e) && !editing) sel.clear();
  }

  function onAreaContextMenu(e: MouseEvent) {
    if (isOnRow(e)) return;
    e.preventDefault();
    if (editing) return;
    sel.clear();
    listRef.current?.focus();
    openMenuAt(e.clientX, e.clientY, "empty");
  }

  function onKeyDown(e: KeyboardEvent) {
    if (editing || menu) return;
    const mod = e.metaKey || e.ctrlKey;
    const target = single();
    const move = (delta: number) => {
      e.preventDefault();
      focusRow(sel.move(delta, e.shiftKey));
    };
    switch (e.key) {
      case "ArrowDown":
        return move(1);
      case "ArrowUp":
        return move(-1);
      case "Home":
        return move(-ids.length);
      case "End":
        return move(ids.length);
      case "Enter":
        e.preventDefault();
        if (target) open(target);
        return;
      case "Delete":
        e.preventDefault();
        trashSelected();
        return;
      case "F2":
        e.preventDefault();
        if (target) startRename(target);
        return;
      case "Escape":
        sel.clear();
        return;
      case " ":
        e.preventDefault();
        if (sel.selection.focus) sel.click(sel.selection.focus, { toggle: mod });
        return;
      case "ContextMenu":
      case "F10":
        if (e.key === "F10" && !e.shiftKey) return;
        e.preventDefault();
        {
          const rect = (target ? rowEls.current.get(target) : undefined)?.getBoundingClientRect();
          if (rect) openMenuAt(rect.left + 32, rect.bottom, "rows");
          else {
            const area = listRef.current?.getBoundingClientRect();
            openMenuAt((area?.left ?? 0) + 32, (area?.top ?? 0) + 8, "empty");
          }
        }
        return;
    }
    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      sel.selectAll();
    }
  }

  const count = sel.selectedIds.length;
  const target1 = count === 1 ? sel.selectedIds[0] : null;
  const menuItems: MenuAction[] =
    menu?.target === "rows"
      ? [
          { id: "open", label: t("action.open"), icon: <OpenIcon />, disabled: count !== 1, onSelect: () => target1 && open(target1) },
          { id: "rename", label: t("action.rename"), icon: <PencilIcon />, disabled: count !== 1, onSelect: () => target1 && startRename(target1) },
          { id: "download", label: t("action.download"), icon: <DownloadIcon />, onSelect: () => actions.download(sel.selectedIds) },
          { id: "trash", label: t("action.trash"), icon: <TrashIcon />, danger: true, separated: true, onSelect: trashSelected },
        ]
      : [
          { id: "new-folder", label: t("new.folder"), icon: <FolderPlusIcon />, onSelect: () => setEditing({ kind: "new" }) },
        ];
  const tabbable = sel.selection.focus ?? sel.selectedIds[0] ?? ids[0] ?? null;
  const sharedRoot = space === "shared" && parentId === null;
  const empty = nodes.length === 0 && editing?.kind !== "new";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border px-4">
        {header}
        <div aria-live="polite" className="flex shrink-0 items-center gap-2 text-[12px] text-muted">
          {actions.working ? (
            <>
              <span aria-hidden="true" className="size-3 animate-spin rounded-full border-[1.5px] border-muted border-t-transparent" />
              {t("list.working")}
            </>
          ) : count > 1 ? (
            t("list.selectedCount", { count })
          ) : null}
        </div>
      </div>

      <DropZone target={{ space, parent: parentId }}>
        <div
          data-testid="list-area"
          className="relative flex min-h-0 flex-1 flex-col overflow-auto"
          onClick={onAreaClick}
          onContextMenu={onAreaContextMenu}
        >
          <div
            className={`${ROW_GRID} sticky top-0 z-10 h-8 shrink-0 border-b border-border bg-surface text-[12px] font-medium text-muted`}
          >
            <span className="pl-[26px]">{t("list.name")}</span>
            <span>{t("list.modified")}</span>
            <span className="text-right">{t("list.size")}</span>
          </div>
          <div
            ref={listRef}
            role="listbox"
            aria-label={t("list.label")}
            aria-multiselectable="true"
            aria-busy={actions.working || undefined}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            className="flex-1 pb-10 outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-inset"
          >
            {editing?.kind === "new" && (
              <div role="option" aria-selected="true" aria-label={t("new.folder")} className={`${ROW_GRID} h-8 border-b border-border/60 bg-accent/15`}>
                <div className="flex min-w-0 items-center gap-2.5">
                  <NodeIcon kind="folder" />
                  <NameEditor initial={t("new.folderDefault")} onSubmit={submitNew} onCancel={cancelEdit} />
                </div>
              </div>
            )}
            {nodes.map((node) => (
              <FileRow
                key={node.id}
                node={node}
                selected={sel.isSelected(node.id)}
                tabbable={node.id === tabbable}
                handlers={handlers}
                rowRef={(el) => {
                  if (el) rowEls.current.set(node.id, el);
                  else rowEls.current.delete(node.id);
                }}
                editor={
                  editing?.kind === "rename" && editing.id === node.id ? (
                    <NameEditor initial={node.name} onSubmit={(name) => submitRename(node.id, name)} onCancel={cancelEdit} />
                  ) : undefined
                }
              />
            ))}
          </div>
          {empty && <EmptyState sharedRoot={sharedRoot} />}
        </div>
      </DropZone>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} label={t("list.contextMenu")} items={menuItems} onClose={closeMenu} />
      )}
    </div>
  );
}
