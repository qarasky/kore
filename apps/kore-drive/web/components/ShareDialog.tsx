"use client";

import { Button, Checkbox, Dialog, DialogBody, DialogContent, Field, Input, PasswordInput, Select, useToast } from "@qarasky/kore-ui";
import { Link2, Lock } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { t, type MessageKey } from "@/lib/i18n";
import { PASSWORD_INPUT_LABELS } from "@/lib/password";
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
import { NodeIcon } from "./NodeIcon";

type Target = { id: string; name: string; is_dir: boolean };
type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: MessageKey }
  | { kind: "create"; settings: ShareSettings }
  | { kind: "link"; share: Share };

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
 * that link directly. A modal: focus trapped, Escape closes; focus returns
 * to the opener, or to `returnFocus()` when given.
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
  const id = useId();
  const toast = useToast();
  // Feedback while the dialog is open is shown in it, not as a toast: a toast
  // is the top layer, so Escape would dismiss it instead of the dialog.
  const [notice, setNotice] = useState<Notice | null>(null);
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
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        title={
          <span className="flex min-w-0 items-center gap-2.5">
            <NodeIcon kind={target.is_dir ? "folder" : "file"} />
            <span className="truncate">{t("share.title", { name: target.name })}</span>
          </span>
        }
        closeLabel={t("share.close")}
        onCloseAutoFocus={(e) => {
          const el = returnFocus?.();
          if (el?.isConnected) {
            e.preventDefault();
            el.focus();
          }
        }}
      >
        <DialogBody data-testid="share-dialog" className="pt-2">
          {phase.kind === "loading" && (
            <p role="status" className="mt-4 mb-2 text-muted">
              {t("share.loading")}
            </p>
          )}
          {phase.kind === "error" && (
            <div role="alert" className="mt-3 space-y-3">
              <p>{t(phase.message)}</p>
              {phase.message !== "share.error.disabled" && (
                <Button
                  onClick={() => {
                    setPhase({ kind: "loading" });
                    setAttempt((a) => a + 1);
                  }}
                >
                  {t("share.retry")}
                </Button>
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
                  (ok) => ok && setNotice({ message: t("share.createdCopied") }),
                );
              }}
            />
          )}
          {phase.kind === "link" && (
            <LinkView
              id={id}
              share={phase.share}
              onChanged={changed}
              notify={setNotice}
              onRevoked={() => {
                onChanged?.();
                if (initial) {
                  onClose();
                  toast.show({ message: t("share.revoked") });
                } else {
                  setNotice({ message: t("share.revoked") });
                  setPhase({ kind: "loading" });
                  setAttempt((a) => a + 1);
                }
              }}
            />
          )}
          <p
            role="status"
            data-testid="share-notice"
            className={notice ? `mt-3 text-meta ${notice.tone === "error" ? "text-danger" : "text-muted"}` : undefined}
          >
            {notice?.message}
          </p>
        </DialogBody>
      </DialogContent>
    </Dialog>
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
    <form onSubmit={submit} className="space-y-4" noValidate>
      <p className="text-muted">{t("share.intro")}</p>
      <Field label={t("share.expiryLabel")}>
        <Select
          value={expiry}
          options={EXPIRY_CHOICES.map((c) => ({ value: c, label: expiryLabel(c) }))}
          onValueChange={setExpiry}
          className="w-[180px]"
        />
      </Field>
      <div className="space-y-2">
        <Checkbox
          label={t("share.requirePassword")}
          checked={usePassword}
          onCheckedChange={(c) => setUsePassword(c === true)}
          className="w-fit"
        />
        {usePassword && (
          <div className="space-y-1">
            <label htmlFor={`${id}-pw`} className="sr-only">
              {t("share.passwordLabel")}
            </label>
            <PasswordInput
              {...PASSWORD_INPUT_LABELS}
              id={`${id}-pw`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              aria-invalid={tooShort || undefined}
              autoComplete="new-password"
              placeholder={t("share.passwordPlaceholder")}
            />
            <p className="text-meta text-muted">{t("share.passwordHint")}</p>
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="text-meta text-danger">
          {t(error)}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={pending}>
          {pending ? t("share.creating") : t("share.create")}
        </Button>
      </div>
    </form>
  );
}

type Notice = { message: string; tone?: "error" };

function LinkView({
  id,
  share,
  onChanged,
  onRevoked,
  notify,
}: {
  id: string;
  share: Share;
  onChanged: (s: Share) => void;
  onRevoked: () => void;
  notify: (n: Notice) => void;
}) {
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
      if (done) notify({ message: done });
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
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Field label={t("share.linkLabel")}>
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              readOnly
              value={url}
              data-testid="share-url"
              onFocus={(e) => e.currentTarget.select()}
              className="font-mono text-meta"
            />
            {/* Not kore-ui's CopyButton: on failure the link is selected and the
                notice explains the manual copy, which a 2s button label can't. */}
            <Button
              variant="primary"
              onClick={async () => {
                const ok = await copyText(url, inputRef.current);
                notify(ok ? { message: t("share.copied") } : { message: t("share.copyFailed"), tone: "error" });
              }}
            >
              <Link2 />
              {t("share.copy")}
            </Button>
          </div>
        </Field>
        <p className="flex flex-wrap items-center gap-x-2 text-meta text-muted" data-testid="share-status">
          <span className={active ? "text-text" : "text-warning"}>{statusLabel(share.status)}</span>
          <span aria-hidden="true">·</span>
          <span>{expiryText(share.expires_at, nowSeconds())}</span>
          {share.has_password && (
            <>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1">
                <Lock aria-hidden="true" className="size-3" />
                {t("share.protected")}
              </span>
            </>
          )}
        </p>
      </div>

      <Field label={t("share.changeExpiry")} hint={t("share.changeExpiryHint")} disabled={pending}>
        <Select
          value={choiceFor(share)}
          options={EXPIRY_CHOICES.map((c) => ({ value: c, label: expiryLabel(c) }))}
          onValueChange={(c) => void patch({ expires_in_days: expiryDays(c) }, t("share.expiryChanged"))}
          className="w-[180px]"
        />
      </Field>

      <div className="space-y-1.5">
        <span className="block text-meta font-medium text-muted">{t("share.passwordLabel")}</span>
        {editingPw ? (
          <form onSubmit={savePassword} className="space-y-2" noValidate>
            <label htmlFor={`${id}-newpw`} className="sr-only">
              {t("share.newPassword")}
            </label>
            <PasswordInput
              {...PASSWORD_INPUT_LABELS}
              id={`${id}-newpw`}
              newPassword
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              placeholder={t("share.passwordPlaceholder")}
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={pending}>
                {t("share.savePassword")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingPw(false)}>
                {t("dialog.cancel")}
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted">{share.has_password ? t("share.passwordOn") : t("share.passwordOff")}</span>
            <Button size="sm" disabled={pending} onClick={() => setEditingPw(true)}>
              {share.has_password ? t("share.changePassword") : t("share.addPassword")}
            </Button>
            {share.has_password && (
              <Button size="sm" disabled={pending} onClick={() => void patch({ password: null }, t("share.passwordRemoved"))}>
                {t("share.removePassword")}
              </Button>
            )}
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-meta text-danger">
          {t(error)}
        </p>
      )}

      {share.status !== "revoked" && (
        <div className="flex justify-between gap-2 border-t border-border pt-4">
          <Button variant="danger-outline" size="sm" disabled={pending} onClick={() => void revoke()}>
            {t("share.revoke")}
          </Button>
        </div>
      )}
    </div>
  );
}
