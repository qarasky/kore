"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useTransition, type KeyboardEvent } from "react";
import { usePreview } from "@/hooks/usePreview";
import { useSelection } from "@/hooks/useSelection";
import { formatBytes } from "@/lib/format";
import { t } from "@/lib/i18n";
import { fileKind } from "@/lib/nodes";
import { isPreviewable } from "@/lib/preview";
import { locationHref, resultHref, type SearchHit } from "@/lib/search";
import { ChevronRightIcon, NodeIcon } from "./icons";
import { RelativeTime } from "./RelativeTime";
import { UploaderCell, UploaderHeader } from "./UploaderCell";

const GRID = "grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_150px_90px] items-center gap-3 px-3";
/** With "Uploaded by" (some hit is in the shared space), shown from `lg` up. */
const GRID_UPLOADER =
  "grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_150px_90px] lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,200px)_150px_90px] items-center gap-3 px-3";

/**
 * Search hits as a `role="listbox"` (same selection model as the file list).
 * Clicking a name opens a folder, or a file's folder with the file selected.
 * Enter / double-click: folders open, text, image and PDF files preview,
 * other files show in their folder. Space quick-looks a previewable file.
 */
export function SearchResults({ hits }: { hits: SearchHit[] }) {
  const router = useRouter();
  const [navigating, startTransition] = useTransition();
  const ids = useMemo(() => hits.map((h) => h.id), [hits]);
  const byId = useMemo(() => new Map(hits.map((h) => [h.id, h])), [hits]);
  const sel = useSelection(ids);
  const rowEls = useRef(new Map<string, HTMLDivElement>());
  const preview = usePreview({
    onShow: (n) => sel.only(n.id),
    returnFocus: (n) => rowEls.current.get(n.id),
  });

  const go = (href: string) => startTransition(() => router.push(href));

  function open(id: string) {
    const hit = byId.get(id);
    if (!hit) return;
    if (hit.is_dir || !isPreviewable(hit.name)) go(resultHref(hit));
    else preview.openFile(hit, hits);
  }

  function focusRow(id: string | null) {
    if (id) rowEls.current.get(id)?.focus();
  }

  function onKeyDown(e: KeyboardEvent) {
    const move = (delta: number) => {
      e.preventDefault();
      focusRow(sel.move(delta, e.shiftKey));
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
      case "Enter":
        e.preventDefault();
        if (sel.selectedIds.length === 1) open(sel.selectedIds[0]);
        return;
      case "Escape":
        sel.clear();
        return;
      case " ": {
        e.preventDefault();
        const id = sel.selection.focus;
        if (!id) return;
        sel.click(id, { toggle: mod });
        const hit = byId.get(id);
        if (!mod && hit && !hit.is_dir && isPreviewable(hit.name)) preview.openFile(hit, hits);
        return;
      }
    }
    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      sel.selectAll();
    }
  }

  const tabbable = sel.selection.focus ?? ids[0] ?? null;
  const showUploader = hits.some((h) => h.space === "shared");
  const grid = showUploader ? GRID_UPLOADER : GRID;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-auto" aria-busy={navigating || undefined}>
      <div className={`${grid} sticky top-0 z-10 h-8 shrink-0 border-b border-border bg-surface text-[12px] font-medium text-muted`}>
        <span className="pl-[26px]">{t("list.name")}</span>
        <span>{t("search.location")}</span>
        {showUploader && <UploaderHeader label={t("list.uploadedBy")} />}
        <span>{t("list.modified")}</span>
        <span className="text-right">{t("list.size")}</span>
      </div>
      <div
        role="listbox"
        aria-label={t("search.results")}
        aria-multiselectable="true"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="flex-1 pb-10 outline-none"
      >
        {hits.map((hit) => {
          const selected = sel.isSelected(hit.id);
          const crumbs = [hit.space === "shared" ? t("nav.shared") : t("nav.myFiles"), ...hit.path];
          const nameId = `hit-name-${hit.id}`;
          return (
            <div
              key={hit.id}
              ref={(el) => {
                if (el) rowEls.current.set(hit.id, el);
                else rowEls.current.delete(hit.id);
              }}
              role="option"
              aria-selected={selected}
              aria-labelledby={nameId}
              tabIndex={hit.id === tabbable ? 0 : -1}
              data-id={hit.id}
              onClick={(e) => sel.click(hit.id, { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey })}
              onDoubleClick={() => open(hit.id)}
              className={
                `${grid} h-9 cursor-default border-b border-border/60 select-none outline-none ` +
                "focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset " +
                (selected ? "bg-accent/15 text-text" : "hover:bg-white/[0.03]")
              }
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <NodeIcon kind={fileKind(hit)} />
                <Link
                  id={nameId}
                  href={resultHref(hit)}
                  tabIndex={-1}
                  title={hit.name}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey) return; // the browser opens a new tab
                    e.preventDefault(); // shift: range select only, no new window
                    if (!e.shiftKey) go(resultHref(hit));
                  }}
                  className="truncate hover:underline"
                >
                  {hit.name}
                </Link>
              </div>
              <Link
                href={locationHref(hit)}
                tabIndex={-1}
                onClick={(e) => {
                  if (e.shiftKey) e.preventDefault();
                }}
                title={`${t("search.showInFolder")}: ${crumbs.join(" / ")}`}
                data-testid="hit-path"
                className="flex min-w-0 items-center gap-0.5 truncate text-muted hover:text-text"
              >
                {crumbs.map((c, i) => (
                  <span key={i} className="flex min-w-0 items-center gap-0.5">
                    {i > 0 && <ChevronRightIcon className="size-3" />}
                    <span className="truncate">{c}</span>
                  </span>
                ))}
              </Link>
              {showUploader && <UploaderCell email={hit.uploader_email} />}
              <div className="truncate text-muted">
                <RelativeTime unixSeconds={hit.updated_at} />
              </div>
              <div className="text-right text-muted tabular-nums">
                {hit.is_dir ? <span aria-hidden="true">—</span> : formatBytes(hit.size)}
              </div>
            </div>
          );
        })}
      </div>
      {preview.element}
    </div>
  );
}
