"use client";

import { useCallback, useState } from "react";
import { fileKind, type ApiNode } from "@/lib/nodes";
import { NodeIcon } from "./icons";

/** Extensions the server can thumbnail (`thumbFamilies` in
 *  `api/internal/transfer/thumb.go`; AVIF and SVG keep the icon). */
const THUMB_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);

export function hasThumb(node: Pick<ApiNode, "is_dir" | "name">): boolean {
  if (node.is_dir) return false;
  const dot = node.name.lastIndexOf(".");
  return dot > 0 && THUMB_EXTS.has(node.name.slice(dot + 1).toLowerCase());
}

/** A file's icon; for a supported image, a small picture of its content
 *  instead. Falls back to the icon if the thumbnail cannot load. */
export function NodeThumb({ node }: { node: ApiNode }) {
  const [failed, setFailed] = useState(false);
  // The image is server-rendered, so it can fail before React attaches onError.
  const ref = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth === 0) setFailed(true);
  }, []);
  if (failed || !hasThumb(node)) return <NodeIcon kind={fileKind(node)} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a tiny authenticated API image, not a static asset
    <img
      ref={ref}
      src={`/api/nodes/${encodeURIComponent(node.id)}/thumb?v=${node.updated_at}`}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      className="size-icon shrink-0 rounded-[3px] bg-raised object-cover"
    />
  );
}
