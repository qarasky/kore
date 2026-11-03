"use client";

import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  Field,
  Input,
  Select,
} from "@qarasky/kore-ui";
import { useRef, useState, type FormEvent } from "react";
import { adminErrorKey, type AdminUser } from "@/lib/admin";
import { api, isApiError } from "@/lib/api";
import { t, type MessageKey } from "@/lib/i18n";
import { passwordProblem } from "@/lib/password";
import type { Role } from "@/lib/session";
import { parseSize, QUOTA_UNITS, splitSize, type SizeUnit } from "@/lib/size";
import { OneTimePassword, PasswordInput, SizeInput } from "./controls";

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
 * Mounted while open; closing calls `onClose`.
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

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      {created ? (
        <DialogContent title={t("admin.add.createdTitle")} size="sm" closeLabel={t("dialog.close")}>
          <DialogBody data-testid="user-created" className="flex flex-col gap-3">
            {created.password ? (
              <>
                <p className="text-muted">{t("admin.add.createdPassword", { email: created.email })}</p>
                <OneTimePassword value={created.password} />
              </>
            ) : (
              <p className="text-muted">{t("admin.add.createdTyped", { email: created.email })}</p>
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
          title={title}
          closeLabel={t("dialog.close")}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            emailRef.current?.focus();
          }}
        >
          <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
            <DialogBody className="flex flex-col gap-4">
              <Field label={t("admin.form.email")} error={errors.email && t(errors.email)}>
                <Input
                  ref={emailRef}
                  type="email"
                  autoComplete="off"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              {mode === "add" && (
                <Field label={t("admin.form.password")} error={errors.password && t(errors.password)}>
                  <PasswordInput
                    value={password}
                    onChange={(v, gen) => {
                      setPassword(v);
                      setGenerated(gen);
                    }}
                    generate
                    hints
                  />
                </Field>
              )}
              <Field label={t("admin.form.role")} hint={isSelf ? t("admin.form.selfRole") : t("admin.form.roleHint")}>
                <Select<Role>
                  name="role"
                  value={role}
                  disabled={isSelf}
                  onValueChange={setRole}
                  options={[
                    { value: "user", label: t("admin.role.user") },
                    { value: "admin", label: t("admin.role.admin") },
                  ]}
                />
              </Field>
              <Field label={t("admin.form.quota")} hint={t("admin.form.quotaHint")} error={errors.quota && t(errors.quota)}>
                <SizeInput
                  label={t("admin.form.quota")}
                  value={quota.value}
                  unit={quota.unit}
                  units={QUOTA_UNITS}
                  onChange={(value, unit) => setQuota({ value, unit })}
                />
              </Field>
              {errors.form && (
                <p role="alert" data-testid="dialog-error" className="text-meta text-danger">
                  {t(errors.form)}
                </p>
              )}
            </DialogBody>
            <DialogFooter>
              <Button onClick={onClose} disabled={pending}>
                {t("dialog.cancel")}
              </Button>
              <Button type="submit" variant="primary" loading={pending}>
                {pending ? t("admin.form.saving") : mode === "add" ? t("admin.add.submit") : t("admin.edit.submit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
