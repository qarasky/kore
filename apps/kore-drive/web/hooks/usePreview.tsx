"use client";

import { useState } from "react";
import { PreviewPane } from "@/components/PreviewPane";
import { useToast } from "@/components/Toast";
import { downloadFile } from "@/lib/download";
import { t } from "@/lib/i18n";
import type { ApiNode } from "@/lib/nodes";
import { isPreviewable, previewable } from "@/lib/preview";

type Open = { items: ApiNode[]; index: number };

/**
 * "Open a file": text-like files (by the shared allowlist) show in the
 * preview pane, everything else downloads. `siblings` gives the pane its
 * ←/→ order. `onShow` fires when the pane moves to another file (so the
 * list can follow); `returnFocus` picks the element focused on close.
 */
export function usePreview({
  onShow,
  returnFocus,
}: {
  onShow?: (node: ApiNode) => void;
  returnFocus?: (node: ApiNode) => HTMLElement | null | undefined;
} = {}) {
  const [open, setOpen] = useState<Open | null>(null);
  const toast = useToast();

  function download(node: ApiNode) {
    downloadFile(node.id, () => toast.show({ message: t("toast.downloadFailed"), tone: "error" }));
  }

  /** Previews `node` if it looks like text, else downloads it. Folders are ignored. */
  function openFile(node: ApiNode, siblings: readonly ApiNode[] = [node]) {
    if (node.is_dir) return;
    if (!isPreviewable(node.name)) {
      download(node);
      return;
    }
    let items = previewable(siblings);
    let index = items.findIndex((n) => n.id === node.id);
    if (index < 0) {
      items = [node];
      index = 0;
    }
    setOpen({ items, index });
  }

  const current = open ? open.items[open.index] : null;
  const element =
    open && current ? (
      <PreviewPane
        items={open.items}
        index={open.index}
        onIndex={(index) => {
          setOpen({ ...open, index });
          onShow?.(open.items[index]);
        }}
        onClose={() => setOpen(null)}
        onNotText={(node) => {
          setOpen(null);
          toast.show({ message: t("preview.notText", { name: node.name }) });
          download(node);
        }}
        onDownload={download}
        returnFocus={returnFocus && (() => returnFocus(current))}
      />
    ) : null;

  return { openFile, isOpen: open !== null, element };
}
