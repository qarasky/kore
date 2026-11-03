"use client";

import { Button, Card, Checkbox, Field, Input, Select, SectionHeader, useToast, type SelectOption } from "@qarasky/kore-ui";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { adminErrorKey, parseRetentionDays, type AdminSettings } from "@/lib/admin";
import { api } from "@/lib/api";
import { t, type MessageKey } from "@/lib/i18n";
import { FILE_SIZE_UNITS, parseSize, QUOTA_UNITS, splitSize, type SizeUnit } from "@/lib/size";
import { SizeInput } from "./controls";

type Form = {
  retention: string;
  unlimited: boolean;
  maxValue: string;
  maxUnit: SizeUnit;
  quotaValue: string;
  quotaUnit: SizeUnit;
  shareEnabled: boolean;
  shareExpiry: string;
};

function toForm(s: AdminSettings): Form {
  const max = splitSize(s.max_file_bytes > 0 ? s.max_file_bytes : 2 * 1024 ** 3, FILE_SIZE_UNITS);
  const quota = splitSize(s.default_quota_bytes, QUOTA_UNITS);
  return {
    retention: String(s.trash_retention_days),
    unlimited: s.max_file_bytes === 0,
    maxValue: max.value,
    maxUnit: max.unit,
    quotaValue: quota.value,
    quotaUnit: quota.unit,
    shareEnabled: s.share_links_enabled,
    shareExpiry: String(s.share_default_expiry_days),
  };
}

/** Default-expiry choices; a value set outside them (via the API) stays listed. */
function expiryOptions(current: string): SelectOption[] {
  const opts: SelectOption[] = [
    { value: "1", label: t("share.expiry.1") },
    { value: "7", label: t("share.expiry.7") },
    { value: "30", label: t("share.expiry.30") },
    { value: "0", label: t("share.expiry.never") },
  ];
  if (!opts.some((o) => o.value === current)) opts.push({ value: current, label: t("settings.shareDays", { days: current }) });
  return opts;
}

type Errors = Partial<Record<"retention" | "max" | "quota", MessageKey>>;

/** Field-level checks mirroring the server's ranges. */
function check(f: Form): { errors: Errors; retention: number | null; max: number | null; quota: number | null } {
  const errors: Errors = {};
  const retention = parseRetentionDays(f.retention);
  if (retention === null) errors.retention = "settings.error.retention";
  // Blank or 0 with the limit on also means "no limit" (what the server stores as 0).
  const max = f.unlimited || f.maxValue.trim() === "" ? 0 : parseSize(f.maxValue, f.maxUnit);
  if (max === null) errors.max = "settings.error.maxFileSize";
  const quota = parseSize(f.quotaValue, f.quotaUnit);
  if (quota === null) errors.quota = "settings.error.defaultQuota";
  return { errors, retention, max, quota };
}

function sameMax(a: Form, b: Form): boolean {
  if (a.unlimited || b.unlimited) return a.unlimited === b.unlimited;
  return a.maxValue.trim() === b.maxValue && a.maxUnit === b.maxUnit;
}

/**
 * `/admin/settings`: trash retention, maximum file size (or no limit) and the
 * default quota for new users. Inline errors mirror the server's ranges; an
 * "Unsaved changes" note (and a leave-page warning) shows while the form
 * differs from what is saved. Only changed values are sent.
 */
export function SettingsForm({ settings }: { settings: AdminSettings }) {
  const router = useRouter();
  const toast = useToast();
  const [base, setBase] = useState<Form>(() => toForm(settings));
  const [form, setForm] = useState<Form>(base);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<MessageKey | null>(null);

  const c = check(form);
  const changed = {
    retention: form.retention.trim() !== base.retention,
    max: !sameMax(form, base),
    quota: form.quotaValue.trim() !== base.quotaValue || form.quotaUnit !== base.quotaUnit,
  };
  const changedShare = {
    enabled: form.shareEnabled !== base.shareEnabled,
    expiry: form.shareExpiry !== base.shareExpiry,
  };
  const dirty = changed.retention || changed.max || changed.quota || changedShare.enabled || changedShare.expiry;

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setFormError(null);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending || !dirty) return;
    if (Object.keys(c.errors).length > 0) {
      setFormError("settings.fixErrors");
      return;
    }
    const body: Partial<AdminSettings> = {};
    if (changed.retention && c.retention !== null) body.trash_retention_days = c.retention;
    if (changed.max && c.max !== null) body.max_file_bytes = c.max;
    if (changed.quota && c.quota !== null) body.default_quota_bytes = c.quota;
    if (changedShare.enabled) body.share_links_enabled = form.shareEnabled;
    if (changedShare.expiry) body.share_default_expiry_days = Number(form.shareExpiry);
    setPending(true);
    setFormError(null);
    try {
      const next = await api<AdminSettings>("/api/admin/settings", { method: "PATCH", body: JSON.stringify(body) });
      const f = toForm(next);
      setBase(f);
      setForm(f);
      toast.show({ message: t("settings.saved") });
      router.refresh();
    } catch (err) {
      setFormError(adminErrorKey(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mx-auto flex max-w-form flex-col gap-6 p-4 md:p-6" data-testid="settings-form">
      <SectionHeader title={t("settings.title")} className="mb-0" />

      <Field label={t("settings.retention")} hint={t("settings.retentionHint")} error={c.errors.retention && t(c.errors.retention)}>
        <div className="flex items-center gap-2">
          <Input
            inputMode="numeric"
            autoComplete="off"
            value={form.retention}
            onChange={(e) => set({ retention: e.target.value })}
            className="max-w-[120px]"
          />
          <span className="text-muted">{t("settings.days")}</span>
        </div>
      </Field>

      <div className="flex flex-col gap-2">
        <Field label={t("settings.maxFileSize")} hint={t("settings.maxFileSizeHint")} error={c.errors.max && t(c.errors.max)}>
          <SizeInput
            label={t("settings.maxFileSize")}
            value={form.unlimited ? "" : form.maxValue}
            unit={form.maxUnit}
            units={FILE_SIZE_UNITS}
            disabled={form.unlimited}
            onChange={(maxValue, maxUnit) => set({ maxValue, maxUnit })}
          />
        </Field>
        <Checkbox
          label={t("settings.unlimited")}
          checked={form.unlimited}
          onCheckedChange={(v) => set({ unlimited: v === true })}
        />
      </div>

      <Field label={t("settings.defaultQuota")} hint={t("settings.defaultQuotaHint")} error={c.errors.quota && t(c.errors.quota)}>
        <SizeInput
          label={t("settings.defaultQuota")}
          value={form.quotaValue}
          unit={form.quotaUnit}
          units={QUOTA_UNITS}
          onChange={(quotaValue, quotaUnit) => set({ quotaValue, quotaUnit })}
        />
      </Field>

      <Card className="flex flex-col gap-4 p-4" data-testid="share-settings">
        <div>
          <h3 className="font-semibold">{t("settings.shareTitle")}</h3>
          <p className="mt-0.5 text-meta text-muted">{t("settings.shareHint")}</p>
        </div>
        <Checkbox
          label={t("settings.shareEnabled")}
          checked={form.shareEnabled}
          onCheckedChange={(v) => set({ shareEnabled: v === true })}
        />
        <Field label={t("settings.shareDefaultExpiry")}>
          <Select
            value={form.shareExpiry}
            options={expiryOptions(form.shareExpiry)}
            onValueChange={(shareExpiry) => set({ shareExpiry })}
            className="w-[180px]"
          />
        </Field>
      </Card>

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <Button type="submit" variant="primary" disabled={!dirty} loading={pending}>
          {pending ? t("settings.saving") : t("settings.save")}
        </Button>
        {dirty && (
          <Button disabled={pending} onClick={() => setForm(base)}>
            {t("settings.discard")}
          </Button>
        )}
        <p aria-live="polite" data-testid="unsaved" className="text-meta text-muted">
          {dirty ? t("settings.unsaved") : ""}
        </p>
      </div>
      {formError && (
        <p role="alert" data-testid="form-error" className="text-meta text-danger">
          {t(formError)}
        </p>
      )}
    </form>
  );
}
