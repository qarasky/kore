"use client";

import { useMemo, useState } from "react";
import { formatBytes } from "@/lib/format";
import { t } from "@/lib/i18n";
import { fileKind, type ApiNode } from "@/lib/nodes";
import { defaultLineNumbers, isMarkdown, previewKind } from "@/lib/preview";
import { shareUrls } from "@/lib/shares";
import { DownloadIcon, NodeIcon } from "../icons";
import { ImageView, PdfView } from "../MediaView";
import { PreviewBody } from "../PreviewPane";

/** A node shape for the shared preview components ("" = the shared item). */
export function asPreviewNode(n: { id: string; name: string; size: number; mime: string; updated_at?: number }): ApiNode {
  return { id: n.id, name: n.name, is_dir: false, size: n.size, mime: n.mime, parent_id: null, space: "shared", updated_at: n.updated_at ?? 0 };
}

export const primaryLink =
  "inline-flex items-center justify-center gap-2 rounded-ui bg-accent px-4 py-2 font-medium text-white " +
  "transition-colors hover:bg-accent-hover";

/** A shared file: name, size, expiry, Download, and an inline preview when the file has one. */
export function ShareFileView({ token, name, size, mime, expiry }: { token: string; name: string; size: number; mime: string; expiry: string }) {
  const urls = useMemo(() => shareUrls(token), [token]);
  const node = useMemo(() => asPreviewNode({ id: "", name, size, mime }), [name, size, mime]);
  const kind = previewKind(name);
  const [noPreview, setNoPreview] = useState(false);
  const download = () => window.location.assign(urls.download(""));
  const showPreview = kind !== null && !noPreview;

  return (
    <div data-testid="share-file">
      <div className="flex flex-wrap items-center gap-4 border-b border-border px-6 py-5">
        <NodeIcon kind={fileKind({ is_dir: false, name, mime })} className="size-8" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-heading font-semibold" title={name} data-testid="share-name">
            {name}
          </h1>
          <p className="text-muted">
            <span className="tabular-nums">{formatBytes(size)}</span>
            <span aria-hidden="true"> · </span>
            <span data-testid="share-expiry">{expiry}</span>
          </p>
        </div>
        <a href={urls.download("")} download className={primaryLink} data-testid="share-download">
          <DownloadIcon />
          {t("publicShare.download")}
        </a>
      </div>
      {showPreview ? (
        <div data-testid="share-preview" className={"overflow-hidden rounded-b-[10px] " + (kind === "text" ? "max-h-[70vh] overflow-auto" : "h-[70vh]")}>
          {kind === "image" ? (
            <ImageView node={node} actual={false} onToggleZoom={() => {}} onUnavailable={() => setNoPreview(true)} onDownload={download} urls={urls} />
          ) : kind === "pdf" ? (
            <PdfView node={node} onUnavailable={() => setNoPreview(true)} onDownload={download} urls={urls} />
          ) : (
            <PreviewBody
              node={node}
              markdown={isMarkdown(name)}
              wrap={false}
              lineNumbers={defaultLineNumbers(name)}
              onNotText={() => setNoPreview(true)}
              onDownload={download}
              urls={urls}
            />
          )}
        </div>
      ) : (
        <p className="px-6 py-8 text-center text-muted">{t("publicShare.noPreview")}</p>
      )}
    </div>
  );
}
