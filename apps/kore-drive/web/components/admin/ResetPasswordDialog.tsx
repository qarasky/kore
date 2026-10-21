"use client";

import { useId, useState, type FormEvent } from "react";
import { adminErrorKey, type AdminUser } from "@/lib/admin";
import { api } from "@/lib/api";
import { t, type MessageKey } from "@/lib/i18n";
import { passwordProblem } from "@/lib/password";
import { Modal } from "../Modal";
import { CopyButton, Field, fieldIds, PasswordInput, primaryButton, secondaryButton } from "./fields";

/**
 * Sets a new password for `user` (the API also signs them out everywhere).
 * A generated password is shown once more after the reset, with Copy.
 */
export function ResetPasswordDialog({
  user,
  onClose,
  onDone,
}: {
  user: AdminUser;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const titleId = useId();
  const messageId = useId();
  const id = useId();
  const [password, setPassword] = useState("");
  const [generated, setGenerated] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<{ password: string | null } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    const p = passwordProblem(password);
    if (p) {
      setError(p === "too_short" ? "admin.error.passwordTooShort" : "admin.error.passwordTooLong");
      return;
    }
    setError(null);
    setPending(true);
    try {
      await api(`/api/admin/users/${encodeURIComponent(user.id)}/password`, {
        method: "POST",
        body: JSON.stringify({ new_password: password }),
      });
      onDone(t("admin.reset.doneTitle"));
      setDone({ password: generated ? password : null });
      setPassword("");
    } catch (err) {
      setError(adminErrorKey(err));
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <Modal labelledBy={titleId} onClose={onClose} className="w-[min(440px,calc(100vw-32px))]">
        <div className="space-y-4 p-5" data-testid="password-reset-done">
          <h2 id={titleId} className="text-[15px] font-semibold tracking-[-0.01em]">
            {t("admin.reset.doneTitle")}
          </h2>
          {done.password ? (
            <>
              <p className="text-muted">{t("admin.reset.donePassword", { email: user.email })}</p>
              <div className="flex flex-wrap items-center gap-2">
                <code data-testid="one-time-password" className="rounded-ui border border-border bg-bg px-2.5 py-1.5 font-mono select-all">
                  {done.password}
                </code>
                <CopyButton text={done.password} />
              </div>
            </>
          ) : (
            <p className="text-muted">{t("admin.reset.doneTyped", { email: user.email })}</p>
          )}
          <div className="flex justify-end">
            <button type="button" autoFocus onClick={onClose} className={primaryButton}>
              {t("admin.form.done")}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  const ids = fieldIds(`${id}-pw`, false, !!error);
  return (
    <Modal
      labelledBy={titleId}
      describedBy={messageId}
      onClose={() => !pending && onClose()}
      className="w-[min(460px,calc(100vw-32px))]"
    >
      <form onSubmit={submit} noValidate className="space-y-4 p-5">
        <div>
          <h2 id={titleId} className="truncate text-[15px] font-semibold tracking-[-0.01em]">
            {t("admin.reset.title", { email: user.email })}
          </h2>
          <p id={messageId} className="mt-2 text-muted">
            {t("admin.reset.message", { email: user.email })}
          </p>
        </div>
        <Field id={`${id}-pw`} label={t("admin.reset.newPassword")} error={error && t(error)}>
          <PasswordInput
            id={`${id}-pw`}
            value={password}
            onChange={(v, gen) => {
              setPassword(v);
              setGenerated(gen);
            }}
            generate
            hints
            autoFocus
            invalid={!!error}
            describedBy={ids.describedBy}
          />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={pending} className={secondaryButton}>
            {t("dialog.cancel")}
          </button>
          <button type="submit" disabled={pending} aria-busy={pending || undefined} className={primaryButton}>
            {pending ? t("admin.form.saving") : t("admin.reset.submit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
