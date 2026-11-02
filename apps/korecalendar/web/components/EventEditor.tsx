"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useEventDelete } from "@/hooks/useEventDelete";
import { addDays, diffDays } from "@/lib/dates";
import {
  formFromEvent,
  newFormValues,
  planCreate,
  planUpdate,
  validateForm,
  type FormValues,
  type Scope,
} from "@/lib/editPlan";
import { errorMessage } from "@/lib/errors";
import { isApiError } from "@/lib/api";
import { t } from "@/lib/i18n";
import { fetchEvent, runPlan } from "@/lib/mutations";
import { matchPreset, presets } from "@/lib/rrule";
import { utcToLocal } from "@/lib/tz";
import { diffMinutes, formatTimeInput, parseTimeInput, shiftWall, wallString } from "@/lib/wall";
import type { Event, Occurrence } from "@/lib/types";
import { Button } from "./Button";
import { Field, inputClass } from "./Field";
import { Modal } from "./Modal";
import { RecurrenceEditor } from "./RecurrenceEditor";
import { RemindersEditor } from "./RemindersEditor";
import { ScopeDialog } from "./ScopeDialog";
import { Select } from "./Select";
import { useShell } from "./ShellContext";
import { Switch } from "./Switch";
import { TimezoneSelect } from "./TimezoneSelect";
import { useToast } from "./Toast";

export type EditorMode =
  | { kind: "new"; at?: { day: string; minutes: number; durationMinutes?: number; allDay?: boolean } }
  | { kind: "edit"; occ: Occurrence };

/** Loads the series for an edit, then shows the form. */
export function EventEditor({ mode, onClose }: { mode: EditorMode; onClose: () => void }) {
  const [master, setMaster] = useState<Event | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const eventId = mode.kind === "edit" ? mode.occ.event_id : null;
  const titleId = useId();

  useEffect(() => {
    if (eventId === null) return;
    const ac = new AbortController();
    fetchEvent(eventId, ac.signal)
      .then(setMaster)
      .catch((e) => {
        if (!ac.signal.aborted) setFailed(errorMessage(e));
      });
    return () => ac.abort();
  }, [eventId]);

  if (mode.kind === "edit" && master === null) {
    return (
      <Modal labelledBy={titleId} onClose={onClose} className="w-[min(420px,calc(100vw-32px))]">
        <div className="p-5">
          <h2 id={titleId} className="text-title font-semibold">
            {t("editor.editTitle")}
          </h2>
          <p role={failed ? "alert" : "status"} className={`mt-3 text-sub ${failed ? "text-danger" : "text-muted"}`}>
            {failed ?? t("editor.loading")}
          </p>
          <div className="mt-4 flex justify-end">
            <Button onClick={onClose}>{t("common.close")}</Button>
          </div>
        </div>
      </Modal>
    );
  }
  return <EditorForm mode={mode} master={master} onClose={onClose} />;
}

function EditorForm({ mode, master, onClose }: { mode: EditorMode; master: Event | null; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const { me, calendars, today } = useShell();
  const isEdit = mode.kind === "edit" && master !== null;
  const occ = mode.kind === "edit" ? mode.occ : null;
  const ids = { title: useId(), heading: useId() };
  const titleRef = useRef<HTMLInputElement>(null);
  const del = useEventDelete();

  const [orig] = useState<FormValues>(() => {
    if (mode.kind === "edit" && master) return formFromEvent(master, mode.occ);
    const at = mode.kind === "new" ? mode.at : undefined;
    const nowLocal = utcToLocal(new Date(), me.timezone);
    const nextHour = Math.ceil((nowLocal.minutes + 1) / 60) * 60;
    return newFormValues({
      day: at?.day ?? (nextHour >= 1440 ? addDays(today, 1) : today),
      minutes: at?.minutes ?? nextHour % 1440,
      durationMinutes: at?.durationMinutes,
      allDay: at?.allDay,
      tz: me.timezone,
      calendarId: calendars[0]?.id ?? "",
    });
  });
  const [form, setForm] = useState<FormValues>(orig);
  const [errors, setErrors] = useState<ReturnType<typeof validateForm>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ message: string; conflict: boolean } | null>(null);
  const [scopePrompt, setScopePrompt] = useState<{ allowed: Scope[]; warning?: string } | null>(null);

  const recurring = isEdit && (occ?.is_recurring ?? master!.rrule !== "");

  const set = (patch: Partial<FormValues>) => setForm((f) => ({ ...f, ...patch }));

  /** Moving the start moves the end with it, keeping the length. */
  function changeStart(day: string, time: string) {
    setForm((f) => {
      if (f.allDay) {
        const length = Math.max(0, diffDays(f.startDay, f.endDay));
        return { ...f, startDay: day, endDay: addDays(day, length), recurrence: rebase(f, day) };
      }
      const oldStart = parseTimeInput(f.startTime);
      const oldEnd = parseTimeInput(f.endTime);
      const newStart = parseTimeInput(time);
      if (oldStart === null || oldEnd === null || newStart === null) return { ...f, startDay: day, startTime: time };
      const length = diffMinutes(wallString(f.startDay, oldStart), wallString(f.endDay, oldEnd));
      const end = shiftWall(wallString(day, newStart), length);
      return { ...f, startDay: day, startTime: time, endDay: end.day, endTime: formatTimeInput(end.minutes), recurrence: rebase(f, day) };
    });
  }

  /** For a new event, a preset repeat ("every week on Wednesday") follows the start date. */
  function rebase(f: FormValues, newDay: string): FormValues["recurrence"] {
    if (isEdit) return f.recurrence;
    const id = matchPreset(f.recurrence, f.startDay);
    return (id && presets(newDay).find((p) => p.id === id)?.recurrence) || f.recurrence;
  }

  async function execute(scope: Scope) {
    setBusy(true);
    setProblem(null);
    try {
      if (isEdit) {
        await runPlan(planUpdate({ master: master!, occurrence: occ, form, scope }));
        toast(t("toast.saved"));
      } else {
        await runPlan(planCreate(form));
        toast(t("toast.created"));
      }
      router.refresh();
      onClose();
    } catch (e) {
      setProblem({ message: errorMessage(e), conflict: isApiError(e, 412) });
      setScopePrompt(null);
      setBusy(false);
    }
  }

  async function save() {
    const found = validateForm(form);
    setErrors(found);
    if (found.title || found.end) return;
    if (!isEdit) return execute("all");
    const plan = planUpdate({ master: master!, occurrence: occ, form, scope: "all" });
    if (plan.requests.length === 0) return onClose();
    if (recurring && plan.allowedScopes.length > 1) {
      setScopePrompt({ allowed: plan.allowedScopes, warning: plan.warnings[0] ? t(plan.warnings[0]) : undefined });
      return;
    }
    return execute(recurring ? plan.allowedScopes[0] : "all");
  }

  const calendarOptions = calendars.map((c) => ({ value: c.id, label: c.name }));
  const noCalendars = calendars.length === 0;

  const dateTime = (kind: "start" | "end"): ReactNode => {
    const day = kind === "start" ? form.startDay : form.endDay;
    const time = kind === "start" ? form.startTime : form.endTime;
    return (
      <div className="flex items-center gap-2">
        <span className="w-12 shrink-0 text-sub text-muted">{t(kind === "start" ? "editor.start" : "editor.end")}</span>
        <input
          type="date"
          required
          aria-label={t(kind === "start" ? "editor.startDate" : "editor.endDate")}
          value={day}
          aria-invalid={kind === "end" && errors.end ? true : undefined}
          onChange={(e) => e.target.value && (kind === "start" ? changeStart(e.target.value, form.startTime) : set({ endDay: e.target.value }))}
          className={`${inputClass} min-w-0 flex-1`}
        />
        {form.allDay ? null : (
          <input
            type="time"
            required
            aria-label={t(kind === "start" ? "editor.startTime" : "editor.endTime")}
            value={time}
            aria-invalid={kind === "end" && errors.end ? true : undefined}
            onChange={(e) => (kind === "start" ? changeStart(form.startDay, e.target.value) : set({ endTime: e.target.value }))}
            className={`${inputClass} w-36 shrink-0`}
          />
        )}
      </div>
    );
  };

  return (
    <>
      <Modal
        labelledBy={ids.heading}
        onClose={() => !busy && onClose()}
        initialFocus={titleRef}
        className="w-[min(560px,calc(100vw-24px))]"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          }
        }}
      >
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="flex max-h-[calc(100vh-1.5rem)] flex-col"
        >
          <header className="px-5 pt-5">
            <h2 id={ids.heading} className="sr-only">
              {t(isEdit ? "editor.editTitle" : "editor.newTitle")}
            </h2>
            <input
              ref={titleRef}
              id={ids.title}
              type="text"
              name="title"
              aria-label={t("editor.title")}
              aria-invalid={errors.title ? true : undefined}
              placeholder={t("editor.titlePlaceholder")}
              maxLength={200}
              value={form.title}
              onChange={(e) => set({ title: e.target.value })}
              className="w-full border-b border-border bg-transparent pb-2 text-display font-semibold tracking-[-0.02em] outline-none placeholder:text-muted focus:border-accent aria-invalid:border-danger"
            />
            {errors.title ? (
              <p role="alert" className="mt-1 text-meta text-danger">
                {t(errors.title)}
              </p>
            ) : null}
          </header>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
            <Switch checked={form.allDay} onChange={(allDay) => set({ allDay })} label={t("editor.allDay")} />
            <div className="flex flex-col gap-2">
              {dateTime("start")}
              {dateTime("end")}
              {errors.end ? (
                <p role="alert" className="pl-14 text-meta text-danger">
                  {t(errors.end)}
                </p>
              ) : null}
            </div>
            <Field label={t("editor.timezone")}>
              <TimezoneSelect value={form.tz} onChange={(tz) => set({ tz })} ariaLabel={t("editor.timezone")} />
            </Field>
            <RecurrenceEditor value={form.recurrence} onChange={(recurrence) => set({ recurrence })} start={isEdit ? orig.startDay : form.startDay} />
            <RemindersEditor value={form.reminders} onChange={(reminders) => set({ reminders })} allDay={form.allDay} />
            <Field label={t("editor.calendar")}>
              {noCalendars ? (
                <p className="text-sub text-danger">{t("editor.noCalendar")}</p>
              ) : (
                <Select aria-label={t("editor.calendar")} value={form.calendarId} options={calendarOptions} onChange={(calendarId) => set({ calendarId })} />
              )}
            </Field>
            <Field label={t("editor.location")} htmlFor={`${ids.title}-loc`}>
              <input id={`${ids.title}-loc`} type="text" value={form.location} onChange={(e) => set({ location: e.target.value })} className={`${inputClass} w-full`} />
            </Field>
            <Field label={t("editor.notes")} htmlFor={`${ids.title}-notes`}>
              <textarea
                id={`${ids.title}-notes`}
                rows={3}
                value={form.notes}
                onChange={(e) => set({ notes: e.target.value })}
                className={`${inputClass} min-h-24 w-full resize-y py-2`}
              />
            </Field>
          </div>

          {problem ? (
            <div role="alert" className="mx-5 mb-3 flex items-center justify-between gap-3 rounded-ui border border-danger/50 bg-danger/10 px-3 py-2 text-sub text-danger">
              <span>{problem.conflict ? t("editor.conflict") : problem.message}</span>
              {problem.conflict ? (
                <Button
                  small
                  onClick={() => {
                    router.refresh();
                    onClose();
                  }}
                >
                  {t("editor.reload")}
                </Button>
              ) : null}
            </div>
          ) : null}

          <footer className="flex items-center gap-2 border-t border-border px-5 py-3">
            {isEdit ? (
              <Button variant="danger" onClick={() => del.request(master!, occ, onClose)} disabled={busy}>
                {t("common.delete")}
              </Button>
            ) : null}
            <div className="flex-1" />
            <Button onClick={onClose} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={busy || noCalendars}>
              {busy ? t("editor.saving") : t("editor.save")}
            </Button>
          </footer>
        </form>
      </Modal>
      {scopePrompt ? (
        <ScopeDialog
          title={t("scope.editTitle")}
          confirmLabel={t("scope.confirmEdit")}
          allowed={scopePrompt.allowed}
          hint={scopePrompt.warning}
          onChoose={execute}
          onCancel={() => setScopePrompt(null)}
        />
      ) : null}
      {del.dialog}
    </>
  );
}
