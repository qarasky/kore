"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { formatBytes } from "@/lib/format";
import { t } from "@/lib/i18n";
import { fileKind } from "@/lib/nodes";
import { isPreviewable } from "@/lib/preview";
import { shareUrls, sharePageHref, type PublicListing } from "@/lib/shares";
import { ChevronRightIcon, DownloadIcon, NodeIcon, OpenIcon } from "../icons";
import { PreviewPane } from "../PreviewPane";
import { RelativeTime } from "../RelativeTime";
import { asPreviewNode, primaryLink } from "./ShareFileView";

const GRID = "grid grid-cols-[minmax(0,1fr)_120px_90px_92px] items-center gap-3 px-6";

/**
 * A shared folder: breadcrumb from the shared folder down, rows (folders
 * open in place via `?folder=`, files download or preview), and the whole
 * current folder as a zip.
 */
export function ShareFolderView({
  token,
  name,
  size,
  expiry,
  listing,
}: {
  token: string;
  name: string;
  size: number;
  expiry: string;
  listing: PublicListing;
}) {
  const urls = useMemo(() => shareUrls(token), [token]);
  const crumbs = listing.breadcrumb;
  const current = crumbs.at(-1);
  const atRoot = crumbs.length <= 1;
  const files = useMemo(
    () => listing.children.filter((c) => !c.is_dir && isPreviewable(c.name)).map((c) => asPreviewNode(c)),
    [listing.children],
  );
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const download = (id: string) => window.location.assign(urls.download(id));

  return (
    <div data-testid="share-folder">
      <div className="flex flex-wrap items-center gap-4 border-b border-border px-6 py-5">
        <NodeIcon kind="folder" className="size-8" />
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
        <a href={urls.zip(atRoot ? "" : (current?.id ?? ""))} download className={primaryLink} data-testid="share-zip">
          <DownloadIcon />
          {atRoot ? t("publicShare.downloadAll") : t("publicShare.downloadFolder")}
        </a>
      </div>

      <nav aria-label={t("publicShare.breadcrumb")} className="flex min-h-11 flex-wrap items-center gap-1 border-b border-border px-6 py-2">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={c.id} className="flex items-center gap-1">
              {i > 0 && <ChevronRightIcon className="size-3.5 text-muted" />}
              {last ? (
                <span aria-current="page" className="font-medium">
                  {c.name}
                </span>
              ) : (
                <Link href={sharePageHref(token, i === 0 ? undefined : c.id)} className="rounded-ui px-1 text-muted hover:text-text">
                  {c.name}
                </Link>
              )}
            </span>
          );
        })}
      </nav>

      <div className={`${GRID} h-10 border-b border-border text-meta font-medium text-muted`}>
        <span className="pl-[26px]">{t("list.name")}</span>
        <span>{t("list.modified")}</span>
        <span className="text-right">{t("list.size")}</span>
        <span className="sr-only">{t("publicShare.actions")}</span>
      </div>
      {listing.children.length === 0 ? (
        <p className="px-6 py-10 text-center text-muted">{t("publicShare.emptyFolder")}</p>
      ) : (
        <ul aria-label={t("list.label")} data-testid="share-rows">
          {listing.children.map((c) => {
            const pi = c.is_dir ? -1 : files.findIndex((f) => f.id === c.id);
            return (
              <li key={c.id} data-name={c.name} className={`${GRID} h-row border-b border-border/60 last:border-b-0 hover:bg-white/[0.03]`}>
                <div className="flex min-w-0 items-center gap-2.5">
                  <NodeIcon kind={fileKind(c)} />
                  {c.is_dir ? (
                    <Link href={sharePageHref(token, c.id)} className="truncate hover:underline" title={c.name}>
                      {c.name}
                    </Link>
                  ) : (
                    <span className="truncate" title={c.name}>
                      {c.name}
                    </span>
                  )}
                </div>
                <span className="truncate text-muted">
                  <RelativeTime unixSeconds={c.updated_at} />
                </span>
                <span className="truncate text-right text-muted tabular-nums">{formatBytes(c.size)}</span>
                <span className="flex justify-end gap-1">
                  {pi >= 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        opener.current = e.currentTarget;
                        setPreviewIndex(pi);
                      }}
                      aria-label={t("publicShare.previewItem", { name: c.name })}
                      title={t("publicShare.preview")}
                      className="rounded-ui p-1.5 text-muted hover:bg-white/5 hover:text-text"
                    >
                      <OpenIcon />
                    </button>
                  )}
                  {c.is_dir ? (
                    <a
                      href={urls.zip(c.id)}
                      download
                      aria-label={t("publicShare.downloadItem", { name: c.name })}
                      title={t("publicShare.downloadZip")}
                      className="rounded-ui p-1.5 text-muted hover:bg-white/5 hover:text-text"
                    >
                      <DownloadIcon />
                    </a>
                  ) : (
                    <a
                      href={urls.download(c.id)}
                      download
                      aria-label={t("publicShare.downloadItem", { name: c.name })}
                      title={t("publicShare.download")}
                      className="rounded-ui p-1.5 text-muted hover:bg-white/5 hover:text-text"
                    >
                      <DownloadIcon />
                    </a>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {previewIndex !== null && files[previewIndex] && (
        <PreviewPane
          items={files}
          index={previewIndex}
          onIndex={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
          onNotText={(n) => {
            setPreviewIndex(null);
            download(n.id);
          }}
          onDownload={(n) => download(n.id)}
          returnFocus={() => opener.current}
          urls={urls}
        />
      )}
    </div>
  );
}
