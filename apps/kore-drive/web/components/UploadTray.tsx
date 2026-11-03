"use client";

import { IconButton, Progress } from "@qarasky/kore-ui";
import { ChevronDown, RotateCw, X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { formatBytes } from "@/lib/format";
import { t } from "@/lib/i18n";
import { fileKind } from "@/lib/nodes";
import type { UploadItem, UploadQueue } from "@/lib/uploadQueue";
import { NodeIcon } from "./NodeIcon";

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
        "fixed right-4 bottom-4 z-50 w-[min(400px,calc(100vw-32px))] overflow-hidden rounded-overlay border border-border-strong bg-raised " +
        "shadow-overlay"
      }
    >
      <header className="flex h-row items-center gap-1 border-b border-border pr-2 pl-4">
        <h2 aria-live="polite" data-testid="upload-summary" className="min-w-0 flex-1 truncate font-medium">
          {summary(items)}
        </h2>
        <IconButton
          label={collapsed ? t("upload.expand") : t("upload.collapse")}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}
          icon={<ChevronDown className={`transition-transform ${collapsed ? "rotate-180" : ""}`} />}
        />
        {!active && <IconButton label={t("upload.close")} onClick={() => queue.clearFinished()} icon={<X />} />}
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
    <li data-testid="upload-item" data-state={state} className="flex min-h-row items-center gap-3 px-4 py-1.5">
      <NodeIcon kind={fileKind({ is_dir: false, name: file.name, mime: file.type })} />
      <div className="min-w-0 flex-1">
        <div className="truncate" title={file.name}>
          {file.name}
        </div>
        <div className={`truncate text-meta ${state === "error" ? "text-danger" : "text-muted"}`}>{status}</div>
        {(state === "uploading" || state === "queued") && <Progress label={file.name} value={pct} className="mt-1" />}
      </div>
      {(state === "queued" || state === "uploading") && (
        <IconButton label={t("upload.cancel", { name: file.name })} onClick={() => queue.cancel(item.id)} icon={<X />} />
      )}
      {state === "error" && (
        <IconButton label={t("upload.retry", { name: file.name })} onClick={() => queue.retry(item.id)} icon={<RotateCw />} />
      )}
    </li>
  );
}
