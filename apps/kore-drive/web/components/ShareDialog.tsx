"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { t, type MessageKey } from "@/lib/i18n";
import {
  defaultChoice,
  EXPIRY_CHOICES,
  expiryDays,
  expiryLabel,
  expiryText,
  nowSeconds,
  SHARE_PASSWORD_MIN,
  shareErrorKey,
  shareUrl,
  statusLabel,
  type ExpiryChoice,
  type Share,
  type ShareSettings,
} from "@/lib/shares";
import { CloseIcon, LinkIcon, LockIcon, NodeIcon } from "./icons";
import { Modal } from "./Modal";
import { Select } from "./Select";
import { PasswordInput } from "./share/PasswordInput";
import { useToast } from "./Toast";

type Target = { id: string; name: string; is_dir: boolean };
type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: MessageKey }
  | { kind: "create"; settings: ShareSettings }
  | { kind: "link"; share: Share };

const primary =
  "rounded-ui bg-accent px-3.5 py-1.5 font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60";
const secondary = "rounded-ui border border-border-strong px-3 py-1.5 font-medium hover:bg-white/5 disabled:opacity-60";
const small =
  "rounded-ui border border-border px-2 py-1 text-[12px] font-medium text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-60";


/** The expiry choice an existing link's remaining time is closest to (for the editor). */
function choiceFor(s: Share): ExpiryChoice {
  if (s.expires_at === null) return "never";
  const days = Math.max(0, (s.expires_at - nowSeconds()) / 86400);
  return days <= 1.5 ? "1" : days <= 10 ? "7" : "30";
}

/** Copies text, falling back to selecting it for a manual copy. */
async function copyText(text: string, input: HTMLInputElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    input?.select();
    return false;
  }
}

/**
 * "Share link" for one file or folder: create a public link (expiry and an
 * optional password), then copy it, change its expiry, set or clear its
 * password, or revoke it. With `initial` (the Shared links page) it edits
 * that link directly. A modal: focus trapped, Escape closes.
 */
export function ShareDialog({
  target,
  initial,
  onClose,
  onChanged,
  returnFocus,
}: {
  target: Target;
  initial?: Share;
  onClose: () => void;
  /** After any change (create, edit, revoke), e.g. to refresh a list. */
  onChanged?: () => void;
  returnFocus?: () => HTMLElement | null | undefined;
}) {
  const titleId = useId();
  const id = useId();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>(initial ? { kind: "link", share: initial } : { kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (initial) return;
    let live = true;
    Promise.all([
      api<ShareSettings>("/api/me/settings"),
      api<Share[]>(`/api/nodes/${encodeURIComponent(target.id)}/shares`),
    ]).then(
      ([settings, list]) => {
        if (!live) return;
        const active = list.find((s) => s.status === "active");
        if (active) setPhase({ kind: "link", share: active });
        else if (!settings.share_links_enabled) setPhase({ kind: "error", message: "share.error.disabled" });
        else setPhase({ kind: "create", settings });
      },
      (e: unknown) => live && setPhase({ kind: "error", message: shareErrorKey(e) }),
    );
    return () => {
      live = false;
    };
  }, [initial, target.id, attempt]);

  const changed = (share: Share) => {
    setPhase({ kind: "link", share });
    onChanged?.();
  };

  return (
    <Modal labelledBy={titleId} onClose={onClose} returnFocus={returnFocus} className="w-[min(500px,calc(100vw-32px))]">
      <div className="p-5" data-testid="share-dialog">
        <div className="flex items-center gap-2.5">
          <NodeIcon kind={target.is_dir ? "folder" : "file"} />
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.01em]">
            {t("share.title", { name: target.name })}
          </h2>
          <button type="button" onClick={onClose} aria-label={t("share.close")} className="rounded-ui p-1 text-muted hover:bg-white/5 hover:text-text">
            <CloseIcon />
          </button>
        </div>

        {phase.kind === "loading" && (
          <p role="status" className="mt-6 mb-2 text-muted">
            {t("share.loading")}
          </p>
        )}
        {phase.kind === "error" && (
          <div role="alert" className="mt-5 space-y-3">
            <p>{t(phase.message)}</p>
            {phase.message !== "share.error.disabled" && (
              <button
                type="button"
                className={secondary}
                onClick={() => {
                  setPhase({ kind: "loading" });
                  setAttempt((a) => a + 1);
                }}
              >
                {t("share.retry")}
              </button>
            )}
          </div>
        )}
        {phase.kind === "create" && (
          <CreateForm
            id={id}
            nodeId={target.id}
            settings={phase.settings}
            onCreated={(s) => {
              changed(s);
              void copyText(shareUrl(window.location.origin, s.token), null).then(
                (ok) => ok && toast.show({ message: t("share.createdCopied") }),
              );
            }}
          />
        )}
        {phase.kind === "link" && (
          <LinkView
            id={id}
            share={phase.share}
            onChanged={changed}
            onRevoked={() => {
              onChanged?.();
              toast.show({ message: t("share.revoked") });
              if (initial) onClose();
              else {
                setPhase({ kind: "loading" });
                setAttempt((a) => a + 1);
              }
            }}
          />
        )}
      </div>
    </Modal>
  );
}

function CreateForm({
  id,
  nodeId,
  settings,
  onCreated,
}: {
  id: string;
  nodeId: string;
  settings: ShareSettings;
  onCreated: (s: Share) => void;
}) {
  const [expiry, setExpiry] = useState<ExpiryChoice>(defaultChoice(settings.share_default_expiry_days));
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const tooShort = usePassword && password.length > 0 && password.length < SHARE_PASSWORD_MIN;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (usePassword && password.length < SHARE_PASSWORD_MIN) {
      setError("share.error.passwordShort");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const s = await api<Share>("/api/shares", {
        method: "POST",
        body: JSON.stringify({ node_id: nodeId, expires_in_days: expiryDays(expiry), ...(usePassword ? { password } : {}) }),
      });
      onCreated(s);
    } catch (err) {
      setError(shareErrorKey(err));
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-4" noValidate>
      <p className="text-muted">{t("share.intro")}</p>
      <div className="space-y-1.5">
        <span id={`${id}-exp`} className="block font-medium">
          {t("share.expiryLabel")}
        </span>
        <Select
          aria-labelledby={`${id}-exp`}
          value={expiry}
          options={EXPIRY_CHOICES.map((c) => ({ value: c, label: expiryLabel(c) }))}
          onChange={setExpiry}
          className="w-[180px]"
        />
      </div>
      <div className="space-y-2">
        <label className="flex w-fit items-center gap-2">
          <input
            type="checkbox"
            checked={usePassword}
            onChange={(e) => setUsePassword(e.target.checked)}
            className="size-3.5 accent-[var(--color-accent)]"
          />
          {t("share.requirePassword")}
        </label>
        {usePassword && (
          <div className="space-y-1">
            <label htmlFor={`${id}-pw`} className="sr-only">
              {t("share.passwordLabel")}
            </label>
            <PasswordInput id={`${id}-pw`} value={password} onChange={setPassword} autoFocus invalid={tooShort} placeholder={t("share.passwordPlaceholder")} />
            <p className="text-[12px] text-muted">{t("share.passwordHint")}</p>
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="text-[12px] text-danger">
          {t(error)}
        </p>
      )}
      <div className="flex justify-end">
        <button type="submit" disabled={pending} aria-busy={pending || undefined} className={primary}>
          {pending ? t("share.creating") : t("share.create")}
        </button>
      </div>
    </form>
  );
}

function LinkView({
  id,
  share,
  onChanged,
  onRevoked,
}: {
  id: string;
  share: Share;
  onChanged: (s: Share) => void;
  onRevoked: () => void;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  // Only rendered in the browser (the dialog opens on a click).
  const url = shareUrl(window.location.origin, share.token);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [editingPw, setEditingPw] = useState(false);
  const [password, setPassword] = useState("");

  async function patch(body: object, done?: string) {
    setPending(true);
    setError(null);
    try {
      const s = await api<Share>(`/api/shares/${encodeURIComponent(share.id)}`, { method: "PATCH", body: JSON.stringify(body) });
      onChanged(s);
      if (done) toast.show({ message: done });
      return true;
    } catch (err) {
      setError(shareErrorKey(err));
      return false;
    } finally {
      setPending(false);
    }
  }

  async function revoke() {
    setPending(true);
    setError(null);
    try {
      await api(`/api/shares/${encodeURIComponent(share.id)}`, { method: "DELETE" });
      onRevoked();
    } catch (err) {
      setError(shareErrorKey(err));
      setPending(false);
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (password.length < SHARE_PASSWORD_MIN) {
      setError("share.error.passwordShort");
      return;
    }
    if (await patch({ password }, t("share.passwordSaved"))) {
      setEditingPw(false);
      setPassword("");
    }
  }

  const active = share.status === "active";

  return (
    <div className="mt-4 space-y-4">
      <div className="space-y-1.5">
        <label htmlFor={`${id}-url`} className="block font-medium">
          {t("share.linkLabel")}
        </label>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            id={`${id}-url`}
            readOnly
            value={url}
            data-testid="share-url"
            onFocus={(e) => e.currentTarget.select()}
            className="block w-full min-w-0 rounded-ui border border-border bg-bg/60 px-3 py-1.5 font-mono text-[12px] text-text outline-none focus:border-accent"
          />
          <button
            type="button"
            className={primary + " inline-flex shrink-0 items-center gap-1.5"}
            onClick={async () => {
              const ok = await copyText(url, inputRef.current);
              toast.show(ok ? { message: t("share.copied") } : { message: t("share.copyFailed"), tone: "error" });
            }}
          >
            <LinkIcon />
            {t("share.copy")}
          </button>
        </div>
        <p className="flex flex-wrap items-center gap-x-2 text-[12px] text-muted" data-testid="share-status">
          <span className={active ? "text-text" : "text-warning"}>{statusLabel(share.status)}</span>
          <span aria-hidden="true">·</span>
          <span>{expiryText(share.expires_at, nowSeconds())}</span>
          {share.has_password && (
            <>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1">
                <LockIcon className="size-3" />
                {t("share.protected")}
              </span>
            </>
          )}
        </p>
      </div>

      <div className="space-y-1.5">
        <span id={`${id}-exp2`} className="block font-medium">
          {t("share.changeExpiry")}
        </span>
        <Select
          aria-labelledby={`${id}-exp2`}
          value={choiceFor(share)}
          options={EXPIRY_CHOICES.map((c) => ({ value: c, label: expiryLabel(c) }))}
          onChange={(c) => void patch({ expires_in_days: expiryDays(c) }, t("share.expiryChanged"))}
          disabled={pending}
          className="w-[180px]"
        />
        <p className="text-[12px] text-muted">{t("share.changeExpiryHint")}</p>
      </div>

      <div className="space-y-2">
        <span className="block font-medium">{t("share.passwordLabel")}</span>
        {editingPw ? (
          <form onSubmit={savePassword} className="space-y-2" noValidate>
            <label htmlFor={`${id}-newpw`} className="sr-only">
              {t("share.newPassword")}
            </label>
            <PasswordInput id={`${id}-newpw`} value={password} onChange={setPassword} autoFocus placeholder={t("share.passwordPlaceholder")} />
            <div className="flex gap-2">
              <button type="submit" disabled={pending} className={small}>
                {t("share.savePassword")}
              </button>
              <button type="button" onClick={() => setEditingPw(false)} className={small}>
                {t("dialog.cancel")}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted">{share.has_password ? t("share.passwordOn") : t("share.passwordOff")}</span>
            <button type="button" disabled={pending} onClick={() => setEditingPw(true)} className={small}>
              {share.has_password ? t("share.changePassword") : t("share.addPassword")}
            </button>
            {share.has_password && (
              <button type="button" disabled={pending} onClick={() => void patch({ password: null }, t("share.passwordRemoved"))} className={small}>
                {t("share.removePassword")}
              </button>
            )}
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-[12px] text-danger">
          {t(error)}
        </p>
      )}

      {share.status !== "revoked" && (
        <div className="flex justify-between gap-2 border-t border-border pt-4">
          <button type="button" disabled={pending} onClick={() => void revoke()} className="rounded-ui px-2 py-1.5 font-medium text-danger hover:bg-danger/10 disabled:opacity-60">
            {t("share.revoke")}
          </button>
        </div>
      )}
    </div>
  );
}
