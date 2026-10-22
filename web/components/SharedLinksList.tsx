"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { t } from "@/lib/i18n";
import { expiryText, nowSeconds, shareErrorKey, shareUrl, statusLabel, type Share } from "@/lib/shares";
import { ConfirmDialog } from "./ConfirmDialog";
import { LinkIcon, LockIcon, NodeIcon } from "./icons";
import { PageMessage } from "./PageMessage";
import { RelativeTime } from "./RelativeTime";
import { ShareDialog } from "./ShareDialog";
import { useToast } from "./Toast";

const GRID = "grid grid-cols-[minmax(0,1fr)_96px_110px_130px_80px_auto] items-center gap-3 px-4";
const action =
  "rounded-ui px-2 py-1 text-[12px] font-medium text-muted transition-colors hover:bg-white/5 hover:text-text disabled:opacity-50";

const CHIP: Record<Share["status"], string> = {
  active: "bg-[#3fa66b]/15 text-[#7fd18b]",
  expired: "bg-warning/15 text-warning",
  revoked: "bg-white/5 text-muted",
  item_trashed: "bg-danger/15 text-danger",
  unavailable: "bg-danger/15 text-danger",
};

/**
 * The caller's links: item, status, created, expiry, downloads, password;
 * Copy, Edit (the share dialog), Revoke and Delete (confirmed). Every change
 * refreshes the server-rendered list.
 */
export function SharedLinksList({ shares }: { shares: Share[] }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<Share | null>(null);
  const [deleting, setDeleting] = useState<Share | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const [now] = useState(nowSeconds);

  async function run(s: Share, fn: () => Promise<unknown>, done: string) {
    setBusy(s.id);
    try {
      await fn();
      toast.show({ message: done });
      router.refresh();
    } catch (e) {
      toast.show({ message: t(shareErrorKey(e)), tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function copy(s: Share) {
    try {
      await navigator.clipboard.writeText(shareUrl(window.location.origin, s.token));
      toast.show({ message: t("share.copied") });
    } catch {
      toast.show({ message: t("share.copyFailed"), tone: "error" });
    }
  }

  if (shares.length === 0) {
    return (
      <PageMessage title={t("sharedLinks.emptyTitle")} testId="shared-links-empty">
        {t("sharedLinks.empty")}
      </PageMessage>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className={`${GRID} sticky top-0 z-10 h-8 border-b border-border bg-surface text-[12px] font-medium text-muted`}>
        <span className="pl-[26px]">{t("sharedLinks.item")}</span>
        <span>{t("sharedLinks.status")}</span>
        <span>{t("sharedLinks.created")}</span>
        <span>{t("sharedLinks.expires")}</span>
        <span className="text-right">{t("sharedLinks.downloads")}</span>
        <span className="sr-only">{t("sharedLinks.actions")}</span>
      </div>
      <ul aria-label={t("sharedLinks.title")} data-testid="shared-links">
        {shares.map((s) => {
          const name = s.node_name || t("sharedLinks.hiddenItem");
          const live = s.status !== "revoked";
          return (
            <li
              key={s.id}
              data-id={s.id}
              data-name={s.node_name}
              data-status={s.status}
              ref={(el) => {
                if (el) rowRefs.current.set(s.id, el);
                else rowRefs.current.delete(s.id);
              }}
              className={`${GRID} min-h-10 border-b border-border/60 py-1 hover:bg-white/[0.03]`}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <NodeIcon kind={s.is_dir ? "folder" : "file"} />
                <span className="truncate" title={name}>
                  {name}
                </span>
                {s.has_password && (
                  <span title={t("share.protected")} className="shrink-0 text-muted">
                    <LockIcon className="size-3.5" />
                    <span className="sr-only">{t("share.protected")}</span>
                  </span>
                )}
                {!s.is_dir && s.node_name && <span className="shrink-0 text-[12px] text-muted tabular-nums">{formatBytes(s.size)}</span>}
              </div>
              <span>
                <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${CHIP[s.status] ?? CHIP.unavailable}`}>
                  {statusLabel(s.status)}
                </span>
              </span>
              <span className="truncate text-muted">
                <RelativeTime unixSeconds={s.created_at} />
              </span>
              <span className="truncate text-muted" suppressHydrationWarning>{s.status === "revoked" ? "" : expiryText(s.expires_at, now)}</span>
              <span className="text-right text-muted tabular-nums">{s.download_count}</span>
              <span className="flex justify-end gap-0.5">
                {live && (
                  <button type="button" className={`${action} inline-flex items-center gap-1`} onClick={() => void copy(s)}>
                    <LinkIcon className="size-3.5" />
                    {t("share.copy")}
                  </button>
                )}
                {live && (
                  <button type="button" className={action} onClick={() => setEditing(s)}>
                    {t("sharedLinks.edit")}
                  </button>
                )}
                {live && (
                  <button
                    type="button"
                    className={action}
                    disabled={busy === s.id}
                    onClick={() =>
                      void run(s, () => api(`/api/shares/${encodeURIComponent(s.id)}`, { method: "DELETE" }), t("share.revoked"))
                    }
                  >
                    {t("share.revoke")}
                  </button>
                )}
                <button type="button" className={`${action} hover:text-danger`} disabled={busy === s.id} onClick={() => setDeleting(s)}>
                  {t("sharedLinks.delete")}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      {editing && (
        <ShareDialog
          target={{ id: editing.node_id, name: editing.node_name || t("sharedLinks.hiddenItem"), is_dir: editing.is_dir }}
          initial={editing}
          onClose={() => setEditing(null)}
          onChanged={() => router.refresh()}
          returnFocus={() => rowRefs.current.get(editing.id)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={t("sharedLinks.deleteTitle")}
          message={t("sharedLinks.deleteMessage", { name: deleting.node_name || t("sharedLinks.hiddenItem") })}
          confirmLabel={t("sharedLinks.delete")}
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            const s = deleting;
            await run(s, () => api(`/api/shares/${encodeURIComponent(s.id)}?purge=1`, { method: "DELETE" }), t("sharedLinks.deleted"));
            setDeleting(null);
          }}
        />
      )}
    </div>
  );
}
