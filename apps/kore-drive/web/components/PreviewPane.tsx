"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { apiText, isApiError } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { t } from "@/lib/i18n";
import { fileKind, type ApiNode } from "@/lib/nodes";
import { defaultLineNumbers, isMarkdown, nodeUrls, PREVIEW_MAX_BYTES, previewKind, type PreviewUrls } from "@/lib/preview";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  DownloadIcon,
  ExpandIcon,
  ListNumbersIcon,
  NodeIcon,
  WrapIcon,
} from "./icons";
import { MarkdownView } from "./MarkdownView";
import { ImageView, PdfView } from "./MediaView";
import { Modal } from "./Modal";
import { TextView } from "./TextView";

type Loaded =
  | { status: "loading" }
  | { status: "ok"; text: string; truncated: boolean }
  | { status: "notFound" }
  | { status: "error" };

/** Keys that keep their own meaning on these elements (Space presses a button). */
const isControl = (el: EventTarget) => (el as Element).closest?.("button, a, input, textarea, select") != null;

/**
 * Quick-look preview in a modal: name, size, Download, Close (Escape or
 * Space), and ←/→ through `items` (the previewable siblings: text, images
 * and PDFs alike). Text comes from `GET /api/nodes/{id}/preview`; images
 * (fit or actual size: click or Z) and PDFs (the browser's viewer in a
 * frame) from `GET /api/nodes/{id}/view`. A 415 means the server disagrees
 * that the file can be shown: on the file the pane opened on, `onNotText`
 * takes over (download); an image/PDF reached with ←/→ shows a "can't be
 * previewed" panel with Download in the pane instead.
 */
export function PreviewPane({
  items,
  index,
  onIndex,
  onClose,
  onNotText,
  onDownload,
  returnFocus,
  urls = nodeUrls,
}: {
  items: readonly ApiNode[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onNotText: (node: ApiNode) => void;
  onDownload: (node: ApiNode) => void;
  returnFocus?: () => HTMLElement | null | undefined;
  /** Where bytes come from (a share link's scoped endpoints on public pages). */
  urls?: PreviewUrls;
}) {
  const node = items[index];
  const titleId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [wrap, setWrap] = useState(false);
  const [numbers, setNumbers] = useState<Record<string, boolean>>({});
  const [actualSize, setActualSize] = useState<string | null>(null);
  /** The file the pane was opened on: a 415 there closes and downloads; on a
   *  file reached with ←/→ an image/PDF shows a panel in the pane instead. */
  const [openedOn] = useState(node.id);
  const lineNumbers = numbers[node.id] ?? defaultLineNumbers(node.name);
  const kind = previewKind(node.name) ?? "text";
  const markdown = isMarkdown(node.name);
  const actual = actualSize === node.id; // zoom resets on every file
  const toggleZoom = () => setActualSize((id) => (id === node.id ? null : node.id));
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  function go(delta: number) {
    const next = index + delta;
    if (next < 0 || next >= items.length) return;
    onIndex(next);
    bodyRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDialogElement>) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === " " && !isControl(e.target)) {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowLeft" && hasPrev) {
      e.preventDefault();
      go(-1);
    } else if (e.key === "ArrowRight" && hasNext) {
      e.preventDefault();
      go(1);
    } else if ((e.key === "z" || e.key === "Z") && kind === "image" && !isControl(e.target)) {
      e.preventDefault();
      toggleZoom();
    }
  }

  const toolButton =
    "inline-flex items-center gap-1.5 rounded-ui px-2 py-1 text-muted hover:bg-white/5 hover:text-text " +
    "disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-accent/15 aria-pressed:text-text";

  return (
    <Modal
      labelledBy={titleId}
      onClose={onClose}
      initialFocus={bodyRef}
      returnFocus={returnFocus}
      onKeyDown={onKeyDown}
      className="h-[min(88vh,960px)] w-[min(1100px,calc(100vw-48px))] max-w-none"
    >
      <div data-testid="preview" data-node-id={node.id} className="flex h-full flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border pr-2 pl-4">
          <NodeIcon kind={fileKind(node)} />
          <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
            <h2 id={titleId} className="truncate text-heading font-semibold" title={node.name}>
              {node.name}
            </h2>
            <span className="shrink-0 text-muted tabular-nums">{formatBytes(node.size)}</span>
            {items.length > 1 && (
              <span className="shrink-0 text-meta text-muted tabular-nums">
                {t("preview.position", { index: index + 1, count: items.length })}
              </span>
            )}
          </div>
          {items.length > 1 && (
            <div className="flex items-center">
              <button type="button" className={toolButton} onClick={() => go(-1)} disabled={!hasPrev} aria-label={t("preview.prev")} title={t("preview.prev")}>
                <ChevronLeftIcon />
              </button>
              <button type="button" className={toolButton} onClick={() => go(1)} disabled={!hasNext} aria-label={t("preview.next")} title={t("preview.next")}>
                <ChevronRightIcon />
              </button>
            </div>
          )}
          {kind === "image" && (
            <button type="button" className={toolButton} aria-pressed={actual} aria-keyshortcuts="Z" title={t("preview.zoomHint")} onClick={toggleZoom}>
              <ExpandIcon />
              {t("preview.actualSize")}
            </button>
          )}
          {kind === "text" && !markdown && (
            <div className="flex items-center gap-0.5">
              <button type="button" className={toolButton} aria-pressed={wrap} onClick={() => setWrap((w) => !w)}>
                <WrapIcon />
                {t("preview.wrap")}
              </button>
              <button
                type="button"
                className={toolButton}
                aria-pressed={lineNumbers}
                onClick={() => setNumbers((m) => ({ ...m, [node.id]: !lineNumbers }))}
              >
                <ListNumbersIcon />
                {t("preview.lineNumbers")}
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => onDownload(node)}
            className="inline-flex items-center gap-1.5 rounded-ui border border-border-strong px-2.5 py-1 font-medium hover:bg-white/5"
          >
            <DownloadIcon />
            {t("preview.download")}
          </button>
          <button type="button" onClick={onClose} aria-label={t("preview.close")} title={t("preview.close")} className={toolButton}>
            <CloseIcon />
          </button>
        </header>
        <div
          ref={bodyRef}
          tabIndex={0}
          role="region"
          aria-label={t("preview.content")}
          className={
            "min-h-0 flex-1 bg-surface outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-inset " +
            (kind === "text" ? "overflow-auto" : "overflow-hidden")
          }
        >
          {kind === "image" ? (
            <ImageView
              key={node.id}
              node={node}
              actual={actual}
              onToggleZoom={toggleZoom}
              onUnavailable={node.id === openedOn ? onNotText : null}
              onDownload={onDownload}
              urls={urls}
            />
          ) : kind === "pdf" ? (
            <PdfView key={node.id} node={node} onUnavailable={node.id === openedOn ? onNotText : null} onDownload={onDownload} urls={urls} />
          ) : (
            <PreviewBody
              key={node.id}
              node={node}
              markdown={markdown}
              wrap={wrap}
              lineNumbers={lineNumbers}
              onNotText={onNotText}
              onDownload={onDownload}
              urls={urls}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Loads and shows one file's content; keyed by node id so state resets per file. */
export function PreviewBody({
  node,
  markdown,
  wrap,
  lineNumbers,
  onNotText,
  onDownload,
  urls = nodeUrls,
}: {
  node: ApiNode;
  markdown: boolean;
  wrap: boolean;
  lineNumbers: boolean;
  onNotText: (node: ApiNode) => void;
  onDownload: (node: ApiNode) => void;
  urls?: PreviewUrls;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const notText = useRef(onNotText);
  useEffect(() => {
    notText.current = onNotText;
  });

  useEffect(() => {
    const ctrl = new AbortController();
    apiText(urls.text(node.id), { signal: ctrl.signal }).then(
      (body) => setLoaded({ status: "ok", ...body }),
      (e: unknown) => {
        if (ctrl.signal.aborted) return;
        if (isApiError(e, 415)) notText.current(node);
        else if (isApiError(e, 404)) setLoaded({ status: "notFound" });
        else setLoaded({ status: "error" });
      },
    );
    return () => ctrl.abort();
  }, [node, attempt, urls]);

  if (loaded.status === "loading") {
    return (
      <div role="status" className="flex h-full items-center justify-center gap-2 text-muted">
        <span aria-hidden="true" className="size-3.5 animate-spin rounded-full border-[1.5px] border-muted border-t-transparent" />
        {t("preview.loading")}
      </div>
    );
  }
  if (loaded.status !== "ok") {
    return (
      <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p>{loaded.status === "notFound" ? t("preview.notFound") : t("preview.error")}</p>
        {loaded.status === "error" && (
          <button
            type="button"
            onClick={() => {
              setLoaded({ status: "loading" });
              setAttempt((a) => a + 1);
            }}
            className="rounded-ui border border-border-strong px-3 py-1.5 font-medium hover:bg-white/5"
          >
            {t("preview.retry")}
          </button>
        )}
      </div>
    );
  }
  return (
    <>
      {loaded.truncated && (
        <div
          data-testid="preview-truncated"
          className="sticky top-0 left-0 z-10 flex items-center gap-2 border-b border-border bg-raised px-4 py-2 text-meta"
        >
          <span>{t("preview.truncated", { size: formatBytes(PREVIEW_MAX_BYTES) })}</span>
          <button type="button" onClick={() => onDownload(node)} className="font-medium text-accent hover:underline">
            {t("preview.truncatedDownload")}
          </button>
        </div>
      )}
      {loaded.text === "" ? (
        <p className="px-4 py-3 text-muted">{t("preview.empty")}</p>
      ) : markdown ? (
        <MarkdownView text={loaded.text} />
      ) : (
        <TextView text={loaded.text} wrap={wrap} lineNumbers={lineNumbers} />
      )}
    </>
  );
}
