"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { adminErrorKey } from "@/lib/admin";
import { api, isApiError } from "@/lib/api";
import { t, type MessageKey } from "@/lib/i18n";
import { passwordProblem } from "@/lib/password";
import { Field, fieldIds, PasswordInput, primaryButton } from "./admin/fields";

type Errors = Partial<Record<"current" | "next" | "confirm" | "form", MessageKey>>;

/**
 * Current + new + confirm. The API revokes every session of the user and
 * sets a fresh cookie on this response, so this browser stays signed in.
 */
export function ChangePasswordForm() {
  const router = useRouter();
  const id = useId();
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

  const f = (name: "current" | "next" | "confirm") => {
    const fid = `${id}-${name}`;
    return { fid, ids: fieldIds(fid, false, !!errors[name]) };
  };
  const cur = f("current");
  const nw = f("next");
  const cf = f("confirm");

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field id={cur.fid} label={t("account.currentPassword")} error={errors.current && t(errors.current)}>
        <PasswordInput
          id={cur.fid}
          current
          value={current}
          onChange={setCurrent}
          invalid={!!errors.current}
          describedBy={cur.ids.describedBy}
        />
      </Field>
      <Field id={nw.fid} label={t("account.newPassword")} error={errors.next && t(errors.next)}>
        <PasswordInput
          id={nw.fid}
          value={next}
          onChange={setNext}
          hints
          invalid={!!errors.next}
          describedBy={nw.ids.describedBy}
        />
      </Field>
      <Field id={cf.fid} label={t("account.confirmPassword")} error={errors.confirm && t(errors.confirm)}>
        <PasswordInput
          id={cf.fid}
          value={confirm}
          onChange={setConfirm}
          invalid={!!errors.confirm}
          describedBy={cf.ids.describedBy}
        />
      </Field>
      {errors.form && (
        <p role="alert" className="text-[12px] text-danger">
          {t(errors.form)}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} aria-busy={pending || undefined} className={primaryButton}>
          {pending ? t("account.submitting") : t("account.submit")}
        </button>
      </div>
      <p role="status" data-testid="password-changed" className="text-[12px] text-accent">
        {done ? t("account.changed") : ""}
      </p>
    </form>
  );
}
