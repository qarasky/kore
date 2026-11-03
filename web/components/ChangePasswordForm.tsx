"use client";

import { Button, Field, PasswordInput } from "@qarasky/kore-ui";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { adminErrorKey } from "@/lib/admin";
import { api, isApiError } from "@/lib/api";
import { t, type MessageKey } from "@/lib/i18n";
import { PASSWORD_INPUT_LABELS, passwordProblem, passwordRules } from "@/lib/password";

type Errors = Partial<Record<"current" | "next" | "confirm" | "form", MessageKey>>;

/**
 * Current + new + confirm. The API revokes every session of the user and
 * sets a fresh cookie on this response, so this browser stays signed in.
 */
export function ChangePasswordForm() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    const errs: Errors = {};
    if (current === "") errs.current = "account.error.currentRequired";
    const p = passwordProblem(next);
    if (p) errs.next = p === "too_short" ? "admin.error.passwordTooShort" : "admin.error.passwordTooLong";
    else if (confirm !== next) errs.confirm = "account.error.mismatch";
    setErrors(errs);
    setDone(false);
    if (Object.keys(errs).length > 0) return;
    setPending(true);
    try {
      await api("/api/me/password", {
        method: "POST",
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(true);
      router.refresh();
    } catch (err) {
      if (isApiError(err, 403) && err.code === "wrong_password") setErrors({ current: "account.error.wrongPassword" });
      else if (isApiError(err) && err.code.startsWith("password_")) setErrors({ next: adminErrorKey(err) });
      else setErrors({ form: adminErrorKey(err) });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field label={t("account.currentPassword")} error={errors.current && t(errors.current)}>
        <PasswordInput {...PASSWORD_INPUT_LABELS} value={current} onChange={(e) => setCurrent(e.target.value)} />
      </Field>
      <Field label={t("account.newPassword")} error={errors.next && t(errors.next)}>
        <PasswordInput {...PASSWORD_INPUT_LABELS} newPassword rules={passwordRules()} value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>
      <Field label={t("account.confirmPassword")} error={errors.confirm && t(errors.confirm)}>
        <PasswordInput {...PASSWORD_INPUT_LABELS} newPassword value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      {errors.form && (
        <p role="alert" className="text-meta text-danger">
          {t(errors.form)}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" loading={pending}>
          {pending ? t("account.submitting") : t("account.submit")}
        </Button>
      </div>
      <p role="status" data-testid="password-changed" className="text-meta text-status-up">
        {done ? t("account.changed") : ""}
      </p>
    </form>
  );
}
