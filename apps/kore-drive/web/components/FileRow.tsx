"use client";

import { type DragEvent, type MouseEvent, type ReactNode, type Ref } from "react";
import { useDropTarget } from "@/hooks/useDropTarget";
import { formatBytes } from "@/lib/format";
import { fileKind, type ApiNode } from "@/lib/nodes";
import { NodeIcon } from "./icons";
import { RelativeTime } from "./RelativeTime";

/** Shared column layout for the header row and the file rows. */
export const ROW_GRID = "grid grid-cols-[minmax(0,1fr)_150px_90px] items-center gap-3 px-3";

export type RowHandlers = {
  onClick: (id: string, e: MouseEvent) => void;
  onDoubleClick: (id: string) => void;
  onContextMenu: (id: string, e: MouseEvent) => void;
  onDragStart: (id: string, e: DragEvent) => void;
  onDragEnd: () => void;
  /** Whether a drag hovering folder row `node` can be dropped there. */
  acceptsDrop: (node: ApiNode, e: DragEvent) => boolean;
  onDrop: (node: ApiNode, e: DragEvent) => void;
};

/** One dense `role="option"` row: icon, name (or the inline editor), modified, size. */
export function FileRow({
  node,
  selected,
  tabbable,
  editor,
  handlers,
  rowRef,
}: {
  node: ApiNode;
  selected: boolean;
  tabbable: boolean;
  /** Replaces the name while renaming. */
  editor?: ReactNode;
  handlers: RowHandlers;
  rowRef: Ref<HTMLDivElement>;
}) {
  const kind = fileKind(node);
  const nameId = `row-name-${node.id}`;
  const drop = useDropTarget<HTMLDivElement>({
    accepts: (e) => node.is_dir && handlers.acceptsDrop(node, e),
    onDrop: (e) => handlers.onDrop(node, e),
    effect: (e) => ([...e.dataTransfer.types].includes("Files") ? "copy" : "move"),
  });
  return (
    <div
      ref={rowRef}
      {...drop.props}
      draggable={!editor}
      onDragStart={(e) => handlers.onDragStart(node.id, e)}
      onDragEnd={handlers.onDragEnd}
      data-name={node.name}
      data-drop-target={drop.active || undefined}
      role="option"
      aria-selected={selected}
      aria-labelledby={nameId}
      tabIndex={tabbable ? 0 : -1}
      data-id={node.id}
      data-kind={kind}
      onClick={(e) => handlers.onClick(node.id, e)}
      onDoubleClick={() => handlers.onDoubleClick(node.id)}
      onContextMenu={(e) => handlers.onContextMenu(node.id, e)}
      className={
        `${ROW_GRID} h-8 cursor-default border-b border-border/60 select-none outline-none ` +
        "focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset " +
        (drop.active
          ? "bg-accent/25 text-text ring-2 ring-accent ring-inset"
          : selected
            ? "bg-accent/15 text-text"
            : "hover:bg-white/[0.03]")
      }
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <NodeIcon kind={kind} />
        {editor ?? (
          <span id={nameId} className="truncate" title={node.name}>
            {node.name}
          </span>
        )}
        {editor && (
          <span id={nameId} className="sr-only">
            {node.name}
          </span>
        )}
      </div>
      <div className="truncate text-muted">
        <RelativeTime unixSeconds={node.updated_at} />
      </div>
      <div className="text-right text-muted tabular-nums">
        {node.is_dir ? <span aria-hidden="true">—</span> : formatBytes(node.size)}
      </div>
    </div>
  );
}
