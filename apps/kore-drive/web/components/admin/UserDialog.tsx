"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { adminErrorKey, type AdminUser } from "@/lib/admin";
import { api, isApiError } from "@/lib/api";
import { t, type MessageKey } from "@/lib/i18n";
import { passwordProblem } from "@/lib/password";
import type { Role } from "@/lib/session";
import { parseSize, QUOTA_UNITS, splitSize, type SizeUnit } from "@/lib/size";
import { Modal } from "../Modal";
import { Select } from "../Select";
import {
  CopyButton,
  Field,
  fieldIds,
  inputClass,
  PasswordInput,
  primaryButton,
  secondaryButton,
  SizeInput,
} from "./fields";

type Errors = Partial<Record<"email" | "password" | "quota" | "form", MessageKey>>;

/** Which field a server error code belongs to (anything else is form-level). */
function errorField(code: string): keyof Errors {
  if (code === "invalid_email" || code === "email_in_use") return "email";
  if (code.startsWith("password_")) return "password";
  if (code === "invalid_quota") return "quota";
  return "form";
}

/** Light client-side check; the server has the final say. */
const looksLikeEmail = (e: string) => /^[^\s@]+@[^\s@]+$/.test(e);

/**
 * Add user (email, initial password with generator, role, quota defaulting to
 * the default quota) or edit one (email, role, quota; only changed fields are
 * sent). An admin editing themselves cannot change their own role.
 */
export function UserDialog({
  mode,
  user,
  isSelf = false,
  defaultQuota,
  onClose,
  onSaved,
}: {
  mode: "add" | "edit";
  user?: AdminUser;
  isSelf?: boolean;
  defaultQuota: number;
  onClose: () => void;
  /** Called after a successful save with a toast message. */
  onSaved: (message: string) => void;
}) {
  const titleId = useId();
  const id = useId();
  const emailRef = useRef<HTMLInputElement>(null);
  const initialQuota = splitSize(user?.quota_bytes ?? defaultQuota, QUOTA_UNITS);
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [generated, setGenerated] = useState(false);
  const [role, setRole] = useState<Role>(user?.role ?? "user");
  const [quota, setQuota] = useState<{ value: string; unit: SizeUnit }>(initialQuota);
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  /** After creating: the generated password, shown this one time. */
  const [created, setCreated] = useState<{ email: string; password: string | null } | null>(null);

  const quotaChanged = quota.value.trim() !== initialQuota.value || quota.unit !== initialQuota.unit;

  function validate(): { errors: Errors; quotaBytes: number | null } {
    const errs: Errors = {};
    if (!looksLikeEmail(email.trim())) errs.email = "admin.error.invalidEmail";
    if (mode === "add") {
      const p = passwordProblem(password);
      if (p === "too_short") errs.password = "admin.error.passwordTooShort";
      if (p === "too_long") errs.password = "admin.error.passwordTooLong";
    }
    const quotaBytes = parseSize(quota.value, quota.unit);
    if (quotaBytes === null) errs.quota = "admin.error.invalidQuota";
    return { errors: errs, quotaBytes };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    const v = validate();
    setErrors(v.errors);
    if (Object.keys(v.errors).length > 0) return;
    setPending(true);
    try {
      if (mode === "add") {
        const body = { email: email.trim(), password, role, quota_bytes: v.quotaBytes };
        const u = await api<AdminUser>("/api/admin/users", { method: "POST", body: JSON.stringify(body) });
        onSaved(t("admin.add.created", { email: u.email }));
        setCreated({ email: u.email, password: generated ? password : null });
      } else if (user) {
        const patch: Record<string, unknown> = {};
        if (email.trim() !== user.email) patch.email = email.trim();
        if (!isSelf && role !== user.role) patch.role = role;
        if (quotaChanged) patch.quota_bytes = v.quotaBytes;
        if (Object.keys(patch).length > 0) {
          const u = await api<AdminUser>(`/api/admin/users/${encodeURIComponent(user.id)}`, {
            method: "PATCH",
            body: JSON.stringify(patch),
          });
          onSaved(t("admin.edit.saved", { email: u.email }));
        }
        onClose();
      }
    } catch (err) {
      const field = isApiError(err) ? errorField(err.code) : "form";
      setErrors({ [field]: adminErrorKey(err) });
    } finally {
      setPending(false);
    }
  }

  const title = mode === "add" ? t("admin.add.title") : t("admin.edit.title", { email: user?.email ?? "" });

  if (created) {
    return (
      <Modal labelledBy={titleId} onClose={onClose} className="w-[min(440px,calc(100vw-32px))]">
        <div className="space-y-4 p-5" data-testid="user-created">
          <h2 id={titleId} className="text-[15px] font-semibold tracking-[-0.01em]">
            {t("admin.add.createdTitle")}
          </h2>
          {created.password ? (
            <>
              <p className="text-muted">{t("admin.add.createdPassword", { email: created.email })}</p>
              <div className="flex flex-wrap items-center gap-2">
                <code data-testid="one-time-password" className="rounded-ui border border-border bg-bg px-2.5 py-1.5 font-mono select-all">
                  {created.password}
                </code>
                <CopyButton text={created.password} />
              </div>
            </>
          ) : (
            <p className="text-muted">{t("admin.add.createdTyped", { email: created.email })}</p>
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

  const emailIds = fieldIds(`${id}-email`, false, !!errors.email);
  const pwIds = fieldIds(`${id}-password`, false, !!errors.password);
  const roleIds = fieldIds(`${id}-role`, true, false);
  const quotaIds = fieldIds(`${id}-quota`, true, !!errors.quota);

  return (
    <Modal
      labelledBy={titleId}
      onClose={() => !pending && onClose()}
      initialFocus={emailRef}
      className="w-[min(480px,calc(100vw-32px))]"
    >
      <form onSubmit={submit} noValidate className="space-y-4 p-5">
        <h2 id={titleId} className="truncate text-[15px] font-semibold tracking-[-0.01em]">
          {title}
        </h2>
        <Field id={`${id}-email`} label={t("admin.form.email")} error={errors.email && t(errors.email)}>
          <input
            ref={emailRef}
            id={`${id}-email`}
            type="email"
            autoComplete="off"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!errors.email || undefined}
            aria-describedby={emailIds.describedBy}
            className={inputClass}
          />
        </Field>
        {mode === "add" && (
          <Field id={`${id}-password`} label={t("admin.form.password")} error={errors.password && t(errors.password)}>
            <PasswordInput
              id={`${id}-password`}
              value={password}
              onChange={(v, gen) => {
                setPassword(v);
                setGenerated(gen);
              }}
              generate
              hints
              invalid={!!errors.password}
              describedBy={pwIds.describedBy}
            />
          </Field>
        )}
        <Field
          id={`${id}-role`}
          label={t("admin.form.role")}
          hint={isSelf ? t("admin.form.selfRole") : t("admin.form.roleHint")}
        >
          <Select<Role>
            id={`${id}-role`}
            name="role"
            value={role}
            disabled={isSelf}
            onChange={setRole}
            options={[
              { value: "user", label: t("admin.role.user") },
              { value: "admin", label: t("admin.role.admin") },
            ]}
            aria-labelledby={roleIds.labelId}
            aria-describedby={roleIds.describedBy}
          />
        </Field>
        <Field
          id={`${id}-quota`}
          label={t("admin.form.quota")}
          hint={t("admin.form.quotaHint")}
          error={errors.quota && t(errors.quota)}
        >
          <SizeInput
            id={`${id}-quota`}
            label={t("admin.form.quota")}
            value={quota.value}
            unit={quota.unit}
            units={QUOTA_UNITS}
            onChange={(value, unit) => setQuota({ value, unit })}
            invalid={!!errors.quota}
            describedBy={quotaIds.describedBy}
          />
        </Field>
        {errors.form && (
          <p role="alert" data-testid="dialog-error" className="text-[12px] text-danger">
            {t(errors.form)}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={pending} className={secondaryButton}>
            {t("dialog.cancel")}
          </button>
          <button type="submit" disabled={pending} aria-busy={pending || undefined} className={primaryButton}>
            {pending ? t("admin.form.saving") : mode === "add" ? t("admin.add.submit") : t("admin.edit.submit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
