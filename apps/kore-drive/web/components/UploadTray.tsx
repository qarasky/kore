"use client";

import { useState, useSyncExternalStore } from "react";
import { formatBytes } from "@/lib/format";
import { t } from "@/lib/i18n";
import { fileKind } from "@/lib/nodes";
import type { UploadItem, UploadQueue } from "@/lib/uploadQueue";
import { ChevronDownIcon, NodeIcon } from "./icons";

const NONE: readonly UploadItem[] = [];

function summary(items: readonly UploadItem[]): string {
  const active = items.filter((i) => i.state === "queued" || i.state === "uploading").length;
  if (active > 0) return active === 1 ? t("upload.summary.activeOne") : t("upload.summary.activeMany", { count: active });
  const failed = items.filter((i) => i.state === "error").length;
  if (failed > 0) return t("upload.summary.failed", { failed, count: items.length });
  const done = items.filter((i) => i.state === "done").length;
  if (done === 0) return t("upload.summary.canceled");
  return done === 1 ? t("upload.summary.doneOne") : t("upload.summary.doneMany", { count: done });
}

const XIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={1.6}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </svg>
);

const RetryIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
    <path d="M13 8a5 5 0 1 1-1.5-3.55M13 2.5v2.5h-2.5" />
  </svg>
);

const iconButton = "flex size-6 shrink-0 items-center justify-center rounded-ui text-muted hover:bg-white/5 hover:text-text";

/** Bottom-right panel listing uploads with progress, cancel and retry. Hidden while empty. */
export function UploadTray({ queue }: { queue: UploadQueue }) {
  const items = useSyncExternalStore(queue.subscribe, queue.getSnapshot, () => NONE);
  const [collapsed, setCollapsed] = useState(false);
  if (items.length === 0) return null;
  const active = queue.isActive();

  return (
    <section
      aria-label={t("upload.tray")}
      data-testid="upload-tray"
      className={
        "fixed right-4 bottom-4 z-50 w-[360px] overflow-hidden rounded-ui border border-border-strong bg-raised " +
        "shadow-[0_12px_32px_-8px_rgba(0,0,0,0.7)]"
      }
    >
      <header className="flex h-10 items-center gap-1 border-b border-border pr-1.5 pl-3.5">
        <h2 aria-live="polite" data-testid="upload-summary" className="min-w-0 flex-1 truncate font-medium">
          {summary(items)}
        </h2>
        <button
          type="button"
          aria-label={collapsed ? t("upload.expand") : t("upload.collapse")}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}
          className={iconButton}
        >
          <ChevronDownIcon className={`size-3.5 transition-transform ${collapsed ? "rotate-180" : ""}`} />
        </button>
        {!active && (
          <button type="button" aria-label={t("upload.close")} onClick={() => queue.clearFinished()} className={iconButton}>
            <XIcon />
          </button>
        )}
      </header>
      {!collapsed && (
        <ul className="max-h-[280px] overflow-y-auto py-1">
          {items.map((item) => (
            <UploadRow key={item.id} item={item} queue={queue} />
          ))}
        </ul>
      )}
    </section>
  );
}

function UploadRow({ item, queue }: { item: UploadItem; queue: UploadQueue }) {
  const { file, state } = item;
  const pct = file.size === 0 ? (state === "done" ? 100 : 0) : Math.round((item.loaded / file.size) * 100);
  const status =
    state === "error"
      ? t(item.error ?? "upload.error.generic")
      : state === "done"
        ? t("upload.state.done")
        : state === "canceled"
          ? t("upload.state.canceled")
          : state === "queued"
            ? t("upload.state.queued")
            : t("upload.progress", { loaded: formatBytes(item.loaded), total: formatBytes(file.size) });

  return (
    <li data-testid="upload-item" data-state={state} className="flex items-center gap-2.5 px-3.5 py-1.5">
      <NodeIcon kind={fileKind({ is_dir: false, name: file.name, mime: file.type })} />
      <div className="min-w-0 flex-1">
        <div className="truncate" title={file.name}>
          {file.name}
        </div>
        <div className={`truncate text-[12px] ${state === "error" ? "text-danger" : "text-muted"}`}>{status}</div>
        {(state === "uploading" || state === "queued") && (
          <div
            role="progressbar"
            aria-label={file.name}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            className="mt-1 h-1 overflow-hidden rounded-full bg-border"
          >
            <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      {(state === "queued" || state === "uploading") && (
        <button type="button" aria-label={t("upload.cancel", { name: file.name })} onClick={() => queue.cancel(item.id)} className={iconButton}>
          <XIcon />
        </button>
      )}
      {state === "error" && (
        <button
          type="button"
          aria-label={t("upload.retry", { name: file.name })}
          title={t("upload.retryShort")}
          onClick={() => queue.retry(item.id)}
          className={iconButton}
        >
          <RetryIcon />
        </button>
      )}
    </li>
  );
}
