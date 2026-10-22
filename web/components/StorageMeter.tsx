"use client";

import { useId, useState } from "react";
import { formatBytes } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { Usage } from "@/lib/nodes";
import { StorageDialog } from "./StorageDialog";

/** "X of Y used" with a bar (red above 90%, the percentage given to screen
 *  readers as the button's description); a click opens the breakdown. */
export function StorageMeter({ usage }: { usage: Usage }) {
  const [open, setOpen] = useState(false);
  const percentId = useId();
  const { used_bytes: used, quota_bytes: quota } = usage;
  const pct = quota > 0 ? Math.min(100, (used / quota) * 100) : used > 0 ? 100 : 0;
  const label = t("storage.used", { used: formatBytes(used), quota: formatBytes(quota) });
  return (
    <div data-testid="storage-meter">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-describedby={percentId}
        title={t("storage.details")}
        onClick={() => setOpen(true)}
        className="block w-full rounded-ui px-3 py-2.5 text-left transition-colors hover:bg-white/[0.04]"
      >
        <span className="mb-1.5 block text-meta font-medium text-muted">{t("storage.label")}</span>
        <span aria-hidden="true" className="block h-1.5 overflow-hidden rounded-full bg-border">
          <span className={`block h-full rounded-full ${pct > 90 ? "bg-danger" : "bg-accent"}`} style={{ width: `${pct}%` }} />
        </span>
        <span className="mt-1.5 block text-meta text-muted">{label}</span>
      </button>
      {/* The bar is decorative; its value reaches assistive tech here. */}
      <span id={percentId} className="sr-only">
        {t("storage.percentUsed", { percent: Math.round(pct) })}
      </span>
      {open && <StorageDialog onClose={() => setOpen(false)} />}
    </div>
  );
}
