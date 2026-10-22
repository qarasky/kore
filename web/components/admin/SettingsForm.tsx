"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type FormEvent } from "react";
import { adminErrorKey, parseRetentionDays, type AdminSettings } from "@/lib/admin";
import { api } from "@/lib/api";
import { t, type MessageKey } from "@/lib/i18n";
import { FILE_SIZE_UNITS, parseSize, QUOTA_UNITS, splitSize, type SizeUnit } from "@/lib/size";
import { Select, type SelectOption } from "../Select";
import { useToast } from "../Toast";
import { Field, fieldIds, inputClass, primaryButton, secondaryButton, SizeInput } from "./fields";

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
  const id = useId();
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

  const retentionIds = fieldIds(`${id}-retention`, true, !!c.errors.retention);
  const maxIds = fieldIds(`${id}-max`, true, !!c.errors.max);
  const quotaIds = fieldIds(`${id}-quota`, true, !!c.errors.quota);

  return (
    <form onSubmit={submit} noValidate className="mx-auto max-w-[640px] space-y-6 p-6" data-testid="settings-form">
      <h2 className="text-title font-semibold tracking-[-0.01em]">{t("settings.title")}</h2>

      <Field
        id={`${id}-retention`}
        label={t("settings.retention")}
        hint={t("settings.retentionHint")}
        error={c.errors.retention && t(c.errors.retention)}
      >
        <div className="flex items-center gap-2">
          <input
            id={`${id}-retention`}
            inputMode="numeric"
            autoComplete="off"
            value={form.retention}
            onChange={(e) => set({ retention: e.target.value })}
            aria-invalid={!!c.errors.retention || undefined}
            aria-describedby={retentionIds.describedBy}
            className={`${inputClass} max-w-[120px]`}
          />
          <span className="text-muted">{t("settings.days")}</span>
        </div>
      </Field>

      <Field
        id={`${id}-max`}
        label={t("settings.maxFileSize")}
        hint={t("settings.maxFileSizeHint")}
        error={c.errors.max && t(c.errors.max)}
      >
        <div className="space-y-2">
          <label className="flex w-fit items-center gap-2">
            <input
              type="checkbox"
              checked={form.unlimited}
              onChange={(e) => set({ unlimited: e.target.checked })}
              className="size-3.5 accent-[var(--color-accent)]"
            />
            {t("settings.unlimited")}
          </label>
          <SizeInput
            id={`${id}-max`}
            label={t("settings.maxFileSize")}
            value={form.unlimited ? "" : form.maxValue}
            unit={form.maxUnit}
            units={FILE_SIZE_UNITS}
            disabled={form.unlimited}
            onChange={(maxValue, maxUnit) => set({ maxValue, maxUnit })}
            invalid={!!c.errors.max}
            describedBy={maxIds.describedBy}
          />
        </div>
      </Field>

      <Field
        id={`${id}-quota`}
        label={t("settings.defaultQuota")}
        hint={t("settings.defaultQuotaHint")}
        error={c.errors.quota && t(c.errors.quota)}
      >
        <SizeInput
          id={`${id}-quota`}
          label={t("settings.defaultQuota")}
          value={form.quotaValue}
          unit={form.quotaUnit}
          units={QUOTA_UNITS}
          onChange={(quotaValue, quotaUnit) => set({ quotaValue, quotaUnit })}
          invalid={!!c.errors.quota}
          describedBy={quotaIds.describedBy}
        />
      </Field>

      <section aria-labelledby={`${id}-share-title`} className="space-y-3 rounded-[8px] border border-border bg-raised/40 p-4" data-testid="share-settings">
        <h3 id={`${id}-share-title`} className="font-semibold">
          {t("settings.shareTitle")}
        </h3>
        <p className="text-[12px] text-muted">{t("settings.shareHint")}</p>
        <label className="flex w-fit items-center gap-2">
          <input
            type="checkbox"
            checked={form.shareEnabled}
            onChange={(e) => set({ shareEnabled: e.target.checked })}
            className="size-3.5 accent-[var(--color-accent)]"
          />
          {t("settings.shareEnabled")}
        </label>
        <div className="space-y-1.5">
          <span id={`${id}-share-expiry`} className="block font-medium">
            {t("settings.shareDefaultExpiry")}
          </span>
          <Select
            aria-labelledby={`${id}-share-expiry`}
            value={form.shareExpiry}
            options={expiryOptions(form.shareExpiry)}
            onChange={(shareExpiry) => set({ shareExpiry })}
            className="w-[180px]"
          />
        </div>
      </section>

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <button type="submit" disabled={pending || !dirty} aria-busy={pending || undefined} className={primaryButton}>
          {pending ? t("settings.saving") : t("settings.save")}
        </button>
        {dirty && (
          <button type="button" disabled={pending} onClick={() => setForm(base)} className={secondaryButton}>
            {t("settings.discard")}
          </button>
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
