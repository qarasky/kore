"use client";

import { useEffect, useRef, useState } from "react";
import { apiHead, isApiError } from "@/lib/api";
import { t } from "@/lib/i18n";
import type { ApiNode } from "@/lib/nodes";
import { viewHref } from "@/lib/preview";
import { DownloadIcon } from "./icons";

type Check = "checking" | "ok" | "unavailable" | "notFound" | "error";

/**
 * Asks the server (HEAD /view) whether `node` can be shown inline before an
 * `<img>`/`<iframe>` points at it. A 415 (the bytes are not the image/PDF
 * the name claims) goes to `onUnavailable` (close and download), or, with
 * `onUnavailable` null (the pane was stepped onto this file), is reported
 * as "unavailable" so the pane shows a panel with a Download button.
 */
function useViewCheck(node: ApiNode, onUnavailable: ((node: ApiNode) => void) | null, attempt: number): Check {
  const [state, setState] = useState<{ id: string; attempt: number; check: Check } | null>(null);
  const unavailable = useRef(onUnavailable);
  useEffect(() => {
    unavailable.current = onUnavailable;
  });
  useEffect(() => {
    const ctrl = new AbortController();
    apiHead(viewHref(node.id), { signal: ctrl.signal }).then(
      () => setState({ id: node.id, attempt, check: "ok" }),
      (e: unknown) => {
        if (ctrl.signal.aborted) return;
        if (isApiError(e, 415) && unavailable.current) unavailable.current(node);
        else if (isApiError(e, 415)) setState({ id: node.id, attempt, check: "unavailable" });
        else setState({ id: node.id, attempt, check: isApiError(e, 404) ? "notFound" : "error" });
      },
    );
    return () => ctrl.abort();
  }, [node, attempt]);
  return state && state.id === node.id && state.attempt === attempt ? state.check : "checking";
}

function Loading() {
  return (
    <div role="status" className="absolute inset-0 flex items-center justify-center gap-2 text-muted">
      <span aria-hidden="true" className="size-3.5 animate-spin rounded-full border-[1.5px] border-muted border-t-transparent" />
      {t("preview.loading")}
    </div>
  );
}

function Problem({ message, onRetry, onDownload }: { message: string; onRetry?: () => void; onDownload?: () => void }) {
  const button = "inline-flex items-center gap-1.5 rounded-ui border border-border-strong px-3 py-1.5 font-medium hover:bg-white/5";
  return (
    <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <p>{message}</p>
      <div className="flex gap-2">
        {onRetry && (
          <button type="button" onClick={onRetry} className={button}>
            {t("preview.retry")}
          </button>
        )}
        {onDownload && (
          <button type="button" onClick={onDownload} className={button}>
            <DownloadIcon />
            {t("preview.download")}
          </button>
        )}
      </div>
    </div>
  );
}

function Unavailable({ node, onDownload }: { node: ApiNode; onDownload: (node: ApiNode) => void }) {
  return <Problem message={t("preview.cannotPreview", { name: node.name })} onDownload={() => onDownload(node)} />;
}

/**
 * An image from `/view`: fit to the pane, or at its actual size (scrolling)
 * when `actual`; a click on it toggles (`onToggleZoom`), as does Z in the
 * pane. Keyed by node id by the caller, so load state resets per file.
 */
export function ImageView({
  node,
  actual,
  onToggleZoom,
  onUnavailable,
  onDownload,
}: {
  node: ApiNode;
  actual: boolean;
  onToggleZoom: () => void;
  onUnavailable: ((node: ApiNode) => void) | null;
  onDownload: (node: ApiNode) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const check = useViewCheck(node, onUnavailable, attempt);
  const [img, setImg] = useState<"loading" | "ok" | "error">("loading");
  if (check === "unavailable") return <Unavailable node={node} onDownload={onDownload} />;
  if (check === "notFound") return <Problem message={t("preview.notFound")} />;
  if (check === "error") return <Problem message={t("preview.error")} onRetry={() => setAttempt((a) => a + 1)} />;
  if (img === "error") return <Problem message={t("preview.imageError")} onDownload={() => onDownload(node)} />;
  return (
    <div
      data-testid="image-view"
      data-zoom={actual ? "actual" : "fit"}
      className={`relative h-full w-full ${actual ? "overflow-auto" : "flex items-center justify-center overflow-hidden p-4"}`}
    >
      {(check === "checking" || img === "loading") && <Loading />}
      {check === "ok" && (
        // A plain <img>: same-origin, cookie-authenticated bytes that
        // next/image would try to proxy and resize.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={viewHref(node.id)}
          alt={node.name}
          title={t("preview.zoomHint")}
          onLoad={() => setImg("ok")}
          onError={() => setImg("error")}
          onClick={onToggleZoom}
          draggable={false}
          className={
            (actual ? "max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in object-contain") +
            (img === "ok" ? "" : " invisible")
          }
        />
      )}
    </div>
  );
}

/**
 * A PDF from `/view` in the browser's own viewer (an `<iframe>` filling the
 * pane), with a Download fallback underneath for when the viewer is blocked
 * or cannot render. Browsers without a built-in viewer
 * (`navigator.pdfViewerEnabled === false`) would download the frame's
 * content on their own, so they get only the fallback.
 */
export function PdfView({
  node,
  onUnavailable,
  onDownload,
}: {
  node: ApiNode;
  onUnavailable: ((node: ApiNode) => void) | null;
  onDownload: (node: ApiNode) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const check = useViewCheck(node, onUnavailable, attempt);
  const viewer = typeof navigator === "undefined" || navigator.pdfViewerEnabled !== false;
  if (check === "unavailable") return <Unavailable node={node} onDownload={onDownload} />;
  if (check === "notFound") return <Problem message={t("preview.notFound")} />;
  if (check === "error") return <Problem message={t("preview.error")} onRetry={() => setAttempt((a) => a + 1)} />;
  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1">
        {check === "checking" && <Loading />}
        {check === "ok" && viewer && (
          <iframe title={t("preview.pdfFrame", { name: node.name })} src={viewHref(node.id)} className="h-full w-full border-0 bg-bg" />
        )}
        {check === "ok" && !viewer && (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <p>{t("preview.pdfNoViewer")}</p>
          </div>
        )}
      </div>
      <div
        data-testid="pdf-fallback"
        className="flex shrink-0 items-center justify-center gap-2 border-t border-border bg-raised px-4 py-1.5 text-meta text-muted"
      >
        <span>{t("preview.pdfFallback")}</span>
        <button type="button" onClick={() => onDownload(node)} className="font-medium text-accent hover:underline">
          {t("preview.pdfFallbackDownload")}
        </button>
      </div>
    </div>
  );
}
