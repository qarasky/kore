"use client";

import { useRef, useState } from "react";
import { useMutate } from "@/hooks/useMutate";
import { apiText } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { exportFileName, summarizeImport } from "@/lib/ics";
import { t } from "@/lib/i18n";
import { importIcs } from "@/lib/mutations";
import { todayIn } from "@/lib/tz";
import type { ImportResult } from "@/lib/types";
import { Button } from "../Button";
import { Field } from "../Field";
import { DownloadIcon, UploadIcon } from "../icons";
import { Select } from "../Select";
import { useShell } from "../ShellContext";
import { useToast } from "../Toast";
import { SettingsSection } from "./Section";

const MAX_BYTES = 5 * 1024 * 1024;

/** Import an .ics file (with a per-event report) and export your events as one. */
export function ImportExport() {
  const { calendars, me } = useShell();
  const { run, pending } = useMutate();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState(calendars[0]?.id ?? "");
  const [exportCal, setExportCal] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (f.size > MAX_BYTES) return toast(t("import.tooBig"), { kind: "error" });
    const text = await f.text();
    const r = await run(() => importIcs(text, target || undefined));
    if (r) setResult(r);
    if (file.current) file.current.value = "";
  }

  async function download() {
    try {
      const text = await apiText(`/api/export${exportCal ? `?calendar_id=${encodeURIComponent(exportCal)}` : ""}`);
      const url = URL.createObjectURL(new Blob([text], { type: "text/calendar" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = exportFileName(calendars.find((c) => c.id === exportCal)?.name ?? null, todayIn(me.timezone));
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(e instanceof Error ? errorMessage(e) : t("export.failed"), { kind: "error" });
    }
  }

  const summary = result ? summarizeImport(result) : null;

  return (
    <>
      <SettingsSection title={t("import.heading")} description={t("import.intro")}>
        <Field label={t("import.calendar")}>
          <Select aria-label={t("import.calendar")} value={target} options={calendars.map((c) => ({ value: c.id, label: c.name }))} onChange={setTarget} />
        </Field>
        <input ref={file} type="file" accept=".ics,text/calendar" className="sr-only" aria-label={t("import.choose")} data-testid="import-file" onChange={(e) => onFile(e.target.files?.[0])} />
        <Button className="mt-3" onClick={() => file.current?.click()} disabled={pending || calendars.length === 0}>
          <UploadIcon size={16} />
          {pending ? t("import.working") : t("import.choose")}
        </Button>
        {summary ? (
          <div role="status" data-testid="import-summary" className="mt-4 rounded-ui border border-border p-3">
            <p className="font-medium">{summary.headline}</p>
            {summary.issues.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1.5 text-sub">
                {summary.issues.map((i, n) => (
                  <li key={n} data-testid="import-issue" className={i.kind === "error" ? "text-danger" : "text-warning"}>
                    <span className="font-medium">{i.label}:</span> <span className="text-text">{i.reason}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection title={t("export.heading")} description={t("export.intro")}>
        <Field label={t("export.calendar")}>
          <Select
            aria-label={t("export.calendar")}
            value={exportCal}
            options={[{ value: "", label: t("export.all") }, ...calendars.map((c) => ({ value: c.id, label: c.name }))]}
            onChange={setExportCal}
          />
        </Field>
        <Button className="mt-3" onClick={download}>
          <DownloadIcon size={16} />
          {t("export.download")}
        </Button>
      </SettingsSection>
    </>
  );
}
