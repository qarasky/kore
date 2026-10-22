"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { t } from "@/lib/i18n";
import { fileKind } from "@/lib/nodes";
import { categoryColor, categoryLabelKey, largestHref, sharePercent, type Breakdown } from "@/lib/storage";
import { trashHref } from "@/lib/trash";
import { CloseIcon, NodeIcon } from "./icons";
import { Modal } from "./Modal";

type State = { status: "loading" } | { status: "ok"; data: Breakdown } | { status: "error" };

/**
 * "Storage": what the caller's quota is spent on, from
 * `GET /api/me/usage/breakdown`. Bars per file type (largest first, size and
 * percent of what is used), uploads in progress, the trashed part per trash
 * tab with a link to it (nothing is deleted here) and the largest files, each linking
 * to its folder with the file selected.
 */
export function StorageDialog({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    api<Breakdown>("/api/me/usage/breakdown", { signal: ctrl.signal }).then(
      (data) => setState({ status: "ok", data }),
      () => {
        if (!ctrl.signal.aborted) setState({ status: "error" });
      },
    );
    return () => ctrl.abort();
  }, [attempt]);

  return (
    <Modal labelledBy={titleId} onClose={onClose} initialFocus={closeRef} className="w-[min(560px,calc(100vw-32px))]">
      <div className="flex max-h-[min(80vh,720px)] flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border pr-2 pl-4">
          <h2 id={titleId} className="flex-1 text-heading font-semibold">
            {t("storage.title")}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t("storage.close")}
            title={t("storage.close")}
            className="rounded-ui p-1.5 text-muted hover:bg-white/5 hover:text-text"
          >
            <CloseIcon />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
          {state.status === "loading" ? (
            <p role="status" className="flex items-center gap-2 text-muted">
              <span aria-hidden="true" className="size-3.5 animate-spin rounded-full border-[1.5px] border-muted border-t-transparent" />
              {t("storage.loading")}
            </p>
          ) : state.status === "error" ? (
            <div role="alert" className="flex flex-col items-start gap-3">
              <p>{t("storage.error")}</p>
              <button
                type="button"
                onClick={() => {
                  setState({ status: "loading" });
                  setAttempt((a) => a + 1);
                }}
                className="rounded-ui border border-border-strong px-3 py-1.5 font-medium hover:bg-white/5"
              >
                {t("storage.retry")}
              </button>
            </div>
          ) : (
            <BreakdownView data={state.data} onNavigate={onClose} />
          )}
        </div>
      </div>
    </Modal>
  );
}

function BreakdownView({ data, onNavigate }: { data: Breakdown; onNavigate: () => void }) {
  const used = data.used_bytes;
  return (
    <div className="space-y-5">
      <div>
        <p className="text-title font-semibold tabular-nums">
          {t("storage.used", { used: formatBytes(used), quota: formatBytes(data.quota_bytes) })}
        </p>
        <div aria-hidden="true" className="mt-2 flex h-2 overflow-hidden rounded-full bg-border">
          {used > 0 &&
            data.categories.map((c) => (
              <div
                key={c.key}
                style={{ width: `${(c.bytes / Math.max(used, data.quota_bytes)) * 100}%`, background: categoryColor(c.key) }}
              />
            ))}
        </div>
      </div>

      {used === 0 ? (
        <p className="text-muted">{t("storage.empty")}</p>
      ) : (
        <>
          <section aria-labelledby="storage-by-type">
            <h3 id="storage-by-type" className="mb-2 text-meta font-medium text-muted">
              {t("storage.byType")}
            </h3>
            <ul aria-labelledby="storage-by-type" className="space-y-2.5">
              {data.categories.map((c) => {
                const share = sharePercent(c.bytes, used);
                return (
                  <li key={c.key} data-category={c.key}>
                    <div className="flex items-baseline gap-2">
                      <span aria-hidden="true" className="size-2.5 shrink-0 self-center rounded-[2px]" style={{ background: categoryColor(c.key) }} />
                      <span className="font-medium">{t(categoryLabelKey(c.key))}</span>
                      <span className="text-meta text-muted">
                        {c.count === 1 ? t("storage.filesOne") : t("storage.files", { count: c.count })}
                      </span>
                      <span className="ml-auto tabular-nums">{formatBytes(c.bytes)}</span>
                      <span className="w-10 text-right text-meta text-muted tabular-nums">
                        {t("storage.percent", { percent: Math.round(share) })}
                      </span>
                    </div>
                    <div aria-hidden="true" className="mt-1 h-1.5 overflow-hidden rounded-full bg-border">
                      <div className="h-full rounded-full" style={{ width: `${share}%`, background: categoryColor(c.key) }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {(data.uploading_bytes > 0 || data.trash_bytes > 0) && (
            <div className="space-y-1.5 border-t border-border pt-3 text-meta">
              {data.uploading_bytes > 0 && (
                <p data-testid="storage-uploading" className="text-muted">
                  {t("storage.uploading", { size: formatBytes(data.uploading_bytes) })}
                </p>
              )}
              {data.trash_personal_bytes > 0 && (
                <TrashLine
                  testId="storage-trash-personal"
                  text={t("storage.trashMine", { size: formatBytes(data.trash_personal_bytes) })}
                  href={trashHref("personal")}
                  link={t("storage.openTrashMine")}
                  onNavigate={onNavigate}
                />
              )}
              {data.trash_shared_bytes > 0 && (
                <TrashLine
                  testId="storage-trash-shared"
                  text={t("storage.trashShared", { size: formatBytes(data.trash_shared_bytes) })}
                  href={trashHref("shared")}
                  link={t("storage.openTrashShared")}
                  onNavigate={onNavigate}
                />
              )}
            </div>
          )}

          {data.largest.length > 0 && (
            <section aria-labelledby="storage-largest" className="border-t border-border pt-3">
              <h3 id="storage-largest" className="text-meta font-medium text-muted">
                {t("storage.largest")}
              </h3>
              <p className="mb-2 text-meta text-muted">{t("storage.largestHint")}</p>
              <ul aria-labelledby="storage-largest" className="-mx-2">
                {data.largest.map((f) => (
                  <li key={f.id}>
                    <Link
                      href={largestHref(f)}
                      onClick={onNavigate}
                      className="flex items-center gap-2.5 rounded-ui px-2 py-1.5 hover:bg-white/[0.04]"
                    >
                      <NodeIcon kind={fileKind({ is_dir: false, name: f.name, mime: "" })} />
                      <span className="min-w-0 flex-1 truncate" title={f.name}>
                        {f.name}
                      </span>
                      <span className="shrink-0 text-meta text-muted">
                        {t("storage.where", { where: f.space === "shared" ? t("nav.shared") : t("nav.myFiles") })}
                      </span>
                      <span className="w-16 shrink-0 text-right text-muted tabular-nums">{formatBytes(f.size)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** A trashed share with a link to the trash tab that holds it (nothing is deleted here). */
function TrashLine({
  testId,
  text,
  href,
  link,
  onNavigate,
}: {
  testId: string;
  text: string;
  href: string;
  link: string;
  onNavigate: () => void;
}) {
  return (
    <p data-testid={testId} className="flex items-baseline gap-3 text-muted">
      <span>{text}</span>
      <Link href={href} onClick={onNavigate} className="font-medium text-accent hover:underline">
        {link}
      </Link>
    </p>
  );
}
