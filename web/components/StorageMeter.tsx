"use client";

import { Meter } from "@qarasky/kore-ui";
import { useState } from "react";
import { formatBytes } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { Usage } from "@/lib/nodes";
import { usagePercent } from "@/lib/usage";
import { StorageDialog } from "./StorageDialog";

/** The sidebar footer: kore-ui Meter ("X of Y used"); a click opens the breakdown. */
export function StorageMeter({ usage }: { usage: Usage }) {
  const [open, setOpen] = useState(false);
  const { used_bytes: used, quota_bytes: quota } = usage;
  const label = t("storage.used", { used: formatBytes(used), quota: formatBytes(quota) });
  return (
    <div data-testid="storage-meter">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`${t("storage.label")}: ${label}. ${t("storage.percentUsed", { percent: Math.round(usagePercent(used, quota)) })}`}
        title={t("storage.details")}
        onClick={() => setOpen(true)}
        className="block w-full rounded-ui px-3 py-2.5 text-left transition-colors hover:bg-white/[0.04]"
      >
        <Meter label={t("storage.label")} value={usagePercent(used, quota)} max={100} valueText={label} />
      </button>
      {open && <StorageDialog onClose={() => setOpen(false)} />}
    </div>
  );
}
