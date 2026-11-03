"use client";

import { Button, Dialog, DialogBody, DialogContent, DialogFooter, Field } from "@qarasky/kore-ui";
import { useId, useState, type FormEvent } from "react";
import { adminErrorKey, type AdminUser } from "@/lib/admin";
import { api } from "@/lib/api";
import { t, type MessageKey } from "@/lib/i18n";
import { passwordProblem } from "@/lib/password";
import { GeneratedPasswordInput, OneTimePassword } from "./controls";

/**
 * Sets a new password for `user` (the API also signs them out everywhere).
 * A generated password is shown once more after the reset, with Copy.
 * Mounted while open; closing calls `onClose`.
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
  const fieldId = `${useId()}-pw`;
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

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      {done ? (
        <DialogContent title={t("admin.reset.doneTitle")} size="sm" closeLabel={t("dialog.close")}>
          <DialogBody data-testid="password-reset-done" className="flex flex-col gap-3">
            {done.password ? (
              <>
                <p className="text-muted">{t("admin.reset.donePassword", { email: user.email })}</p>
                <OneTimePassword value={done.password} />
              </>
            ) : (
              <p className="text-muted">{t("admin.reset.doneTyped", { email: user.email })}</p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="primary" autoFocus onClick={onClose}>
              {t("admin.form.done")}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : (
        <DialogContent
          title={t("admin.reset.title", { email: user.email })}
          description={t("admin.reset.message", { email: user.email })}
          closeLabel={t("dialog.close")}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            document.getElementById(fieldId)?.focus();
          }}
        >
          <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
            <DialogBody>
              <Field id={fieldId} label={t("admin.reset.newPassword")} error={error && t(error)}>
                <GeneratedPasswordInput
                  value={password}
                  onChange={(v, gen) => {
                    setPassword(v);
                    setGenerated(gen);
                  }}
                />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button onClick={onClose} disabled={pending}>
                {t("dialog.cancel")}
              </Button>
              <Button type="submit" variant="primary" loading={pending}>
                {pending ? t("admin.form.saving") : t("admin.reset.submit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
