"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useFileActions } from "@/hooks/useFileActions";
import { useMoveNodes } from "@/hooks/useMoveNodes";
import { usePreview } from "@/hooks/usePreview";
import { useSelection } from "@/hooks/useSelection";
import { collectDataTransfer } from "@/lib/dropEntries";
import { t, type MessageKey } from "@/lib/i18n";
import { activeMove, beginMove, endMove, isFileDrag, isNoopMove, type MoveDest, type MovePayload } from "@/lib/moveDrag";
import { otherSpace, spaceLabel } from "@/lib/moveTo";
import { folderHref, type ApiNode, type Space } from "@/lib/nodes";
import { isPreviewable } from "@/lib/preview";
import { useRegisterBrowser } from "./BrowserContext";
import { ContextMenu } from "./ContextMenu";
import { DropZone } from "./DropZone";
import { EmptyState } from "./EmptyState";
import { FileRow, ROW_GRID, type RowHandlers } from "./FileRow";
import {
  DownloadIcon,
  DriveIcon,
  FolderMoveIcon,
  FolderPlusIcon,
  NodeIcon,
  OpenIcon,
  PencilIcon,
  TrashIcon,
  UsersIcon,
} from "./icons";
import type { CloseReason, MenuAction } from "./Menu";
import { MoveDialog } from "./MoveDialog";
import { NameEditor, type EditEnd } from "./NameEditor";
import { useToast } from "./Toast";
import { useUploads } from "./UploadContext";

type Editing = { kind: "rename"; id: string } | { kind: "new" } | null;
type MenuState = { x: number; y: number; target: "rows" | "empty" } | null;

const isOnRow = (e: { target: EventTarget }) => (e.target as Element).closest('[role="option"]') !== null;

/**
 * The folder listing: a `role="listbox"` of dense rows with file-manager
 * selection (click, shift/ctrl-click, arrows, Ctrl/Cmd+A), inline rename
 * (F2), trash (Delete), open (Enter / double-click: folders navigate, text
 * files preview, other files download), quick look (Space), move (to the
 * other space's root, or anywhere via the Move to… dialog: M, the context
 * menu or the toolbar button shown while something is selected) and a
 * context menu. `select` (from `?select=<id>`) starts with that row selected and
 * scrolled into view.
 */
export function FileList({
  space,
  parentId,
  nodes,
  header,
  select = null,
}: {
  space: Space;
  parentId: string | null;
  nodes: ApiNode[];
  /** Breadcrumbs, rendered on the server. */
  header: ReactNode;
  /** A row to start selected (and scrolled to), e.g. from a search result. */
  select?: string | null;
}) {
  const ids = useMemo(() => nodes.map((n) => n.id), [nodes]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const sel = useSelection(ids, select);
  const actions = useFileActions({ space, parentId, byId });
  const [editing, setEditing] = useState<Editing>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const [moving, setMoving] = useState<MovePayload | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rowEls = useRef(new Map<string, HTMLDivElement>());
  /** A row to focus once it shows up (after create/rename refreshes). */
  const focusWhenShown = useRef<string | null>(null);
  const registerBrowser = useRegisterBrowser();
  const toast = useToast();
  const uploads = useUploads();
  const moveNodes = useMoveNodes();
  const preview = usePreview({
    onShow: (n) => sel.only(n.id),
    returnFocus: (n) => rowEls.current.get(n.id),
  });

  // Scroll to and focus the `select` row once, after mount.
  const selectRef = useRef(select);
  useEffect(() => {
    const el = selectRef.current ? rowEls.current.get(selectRef.current) : undefined;
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.focus({ preventScroll: true });
  }, []);

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
    else preview.openFile(n, nodes);
  }

  function trashSelected() {
    listRef.current?.focus(); // keep keyboard focus in the list as rows vanish
    // Trashed rows leave the selection at once, so a second Delete before the
    // refresh lands has nothing to (re-)trash.
    void actions.trash(sel.selectedIds, () => sel.clear());
  }

  /** The selection as a move payload (null when nothing is selected). */
  function selectionPayload(): MovePayload | null {
    const ids = sel.selectedIds;
    if (ids.length === 0) return null;
    return { ids, names: Object.fromEntries(ids.map((d) => [d, byId.get(d)?.name ?? ""])), space, parentId };
  }

  /** Runs a move; once something moved, focus goes to the list, since the
   *  moved rows (and whatever opened the move) vanish with the refresh and
   *  focus would otherwise drop to the page. Arrows then start from the top. */
  async function runMove(p: MovePayload, dest: MoveDest, destLabel: string) {
    const moved = await moveNodes(p, dest, { destLabel });
    if (moved > 0) listRef.current?.focus();
  }

  /** Moves the selection to the root of the other space. */
  function moveToOtherSpace() {
    const p = selectionPayload();
    if (!p) return;
    const to = otherSpace(space);
    void runMove(p, { space: to, parentId: null }, spaceLabel(to));
  }

  function openMoveDialog() {
    const p = selectionPayload();
    if (p) setMoving(p);
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
        void uploads.upload(collectDataTransfer(e.dataTransfer), { space, parent: node.id });
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
      case "m":
      case "M":
        if (mod || e.altKey) return;
        e.preventDefault();
        openMoveDialog();
        return;
      case " ": {
        // Space: select the cursor row and quick-look it; Ctrl/Cmd+Space toggles it.
        e.preventDefault();
        const id = sel.selection.focus;
        if (!id) return;
        sel.click(id, { toggle: mod });
        const n = byId.get(id);
        if (!mod && n && !n.is_dir && isPreviewable(n.name)) preview.openFile(n, nodes);
        return;
      }
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
          {
            id: "move-space",
            label: space === "personal" ? t("action.moveToShared") : t("action.moveToMine"),
            icon: space === "personal" ? <UsersIcon /> : <DriveIcon />,
            separated: true,
            onSelect: moveToOtherSpace,
          },
          { id: "move-to", label: t("action.moveTo"), icon: <FolderMoveIcon />, onSelect: openMoveDialog },
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
        <div className="flex shrink-0 items-center gap-3">
          <div aria-live="polite" className="flex items-center gap-2 text-[12px] text-muted">
            {actions.working ? (
              <>
                <span aria-hidden="true" className="size-3 animate-spin rounded-full border-[1.5px] border-muted border-t-transparent" />
                {t("list.working")}
              </>
            ) : count > 1 ? (
              t("list.selectedCount", { count })
            ) : null}
          </div>
          {count > 0 && (
            <button
              type="button"
              onClick={openMoveDialog}
              aria-keyshortcuts="M"
              title={t("action.moveToShortcut")}
              className={
                "flex items-center gap-1.5 rounded-ui border border-border px-2 py-1 text-[12px] font-medium text-muted " +
                "transition-colors hover:border-border-strong hover:text-text"
              }
            >
              <FolderMoveIcon className="size-3.5" />
              {t("action.moveTo")}
            </button>
          )}
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

      {preview.element}
      {moving && (
        <MoveDialog
          payload={moving}
          onClose={() => setMoving(null)}
          onMove={(dest, destLabel) => {
            setMoving(null);
            void runMove(moving, dest, destLabel);
          }}
        />
      )}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} label={t("list.contextMenu")} items={menuItems} onClose={closeMenu} />
      )}
    </div>
  );
}
