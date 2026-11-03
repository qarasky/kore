"use client";

import { Button, Dialog, DialogBody, DialogContent, DialogFooter, Field, Input, Select } from "@qarasky/kore-ui";
import { useRef, useState, type FormEvent } from "react";
import { adminErrorKey, type AdminUser } from "@/lib/admin";
import { api, isApiError } from "@/lib/api";
import { t, type MessageKey } from "@/lib/i18n";
import type { Role } from "@/lib/session";
import { parseSize, QUOTA_UNITS, splitSize, type SizeUnit } from "@/lib/size";
import { SizeInput } from "./controls";

type Errors = Partial<Record<"email" | "quota" | "form", MessageKey>>;

/** Which field a server error code belongs to (anything else is form-level). */
function errorField(code: string): keyof Errors {
  if (code === "invalid_email" || code === "email_in_use") return "email";
  if (code === "invalid_quota") return "quota";
  return "form";
}

/** Light client-side check; the server has the final say. */
const looksLikeEmail = (e: string) => /^[^\s@]+@[^\s@]+$/.test(e);

/**
 * Edit a user (email, role, quota; only changed fields are sent). Accounts come
 * from Kore ID, so this dialog never sets a password. An admin editing
 * themselves cannot change their own role. Mounted while open; closing calls
 * `onClose`.
 */
export function UserDialog({
  user,
  isSelf = false,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  isSelf?: boolean;
  onClose: () => void;
  /** Called after a successful save with a toast message. */
  onSaved: (message: string) => void;
}) {
  const emailRef = useRef<HTMLInputElement>(null);
  const initialQuota = splitSize(user.quota_bytes, QUOTA_UNITS);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState<Role>(user.role);
  const [quota, setQuota] = useState<{ value: string; unit: SizeUnit }>(initialQuota);
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);

  const quotaChanged = quota.value.trim() !== initialQuota.value || quota.unit !== initialQuota.unit;

  function validate(): { errors: Errors; quotaBytes: number | null } {
    const errs: Errors = {};
    if (!looksLikeEmail(email.trim())) errs.email = "admin.error.invalidEmail";
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
    } catch (err) {
      const field = isApiError(err) ? errorField(err.code) : "form";
      setErrors({ [field]: adminErrorKey(err) });
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
      <DialogContent
        title={t("admin.edit.title", { email: user.email })}
        description={t("admin.edit.ssoNote")}
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
              {pending ? t("admin.form.saving") : t("admin.edit.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
