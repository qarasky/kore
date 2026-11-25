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
  Switch,
  Textarea,
  useToast,
} from "@qarasky/kore-ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useEventDelete } from "@/hooks/useEventDelete";
import { addDays, diffDays } from "@/lib/dates";
import {
  droppedMessage,
  formFromEvent,
  newFormValues,
  nextAttempt,
  planCreate,
  planUpdate,
  validateForm,
  type Attempt,
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
import { RecurrenceEditor } from "./RecurrenceEditor";
import { RemindersEditor } from "./RemindersEditor";
import { ScopeDialog } from "./ScopeDialog";
import { useShell } from "./ShellContext";
import { TimezoneSelect } from "./TimezoneSelect";

export type EditorMode =
  | { kind: "new"; at?: { day: string; minutes: number; durationMinutes?: number; allDay?: boolean } }
  | { kind: "edit"; occ: Occurrence };

/** Loads the series for an edit, then shows the form (kore-ui Dialog). `open` false plays the exit animation. */
export function EventEditor({ mode, open, onClose }: { mode: EditorMode; open: boolean; onClose: () => void }) {
  const [master, setMaster] = useState<Event | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const eventId = mode.kind === "edit" ? mode.occ.event_id : null;

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
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent title={t("editor.editTitle")} size="sm" closeLabel={t("common.close")}>
          <DialogBody>
            <p role={failed ? "alert" : "status"} className={failed ? "text-danger" : "text-muted"}>
              {failed ?? t("editor.loading")}
            </p>
          </DialogBody>
          <DialogFooter>
            <Button onClick={onClose}>{t("common.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
  return <EditorForm mode={mode} master={master} open={open} onClose={onClose} />;
}

function EditorForm({ mode, master, open, onClose }: { mode: EditorMode; master: Event | null; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const { me, calendars, today } = useShell();
  const isEdit = mode.kind === "edit" && master !== null;
  const occ = mode.kind === "edit" ? mode.occ : null;
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
  const attempt = useRef<Attempt | null>(null);
  // `scopePrompt` outlives `scopeOpen` so the dialog keeps its text while it animates out.
  const [scopePrompt, setScopePrompt] = useState<{ allowed: Scope[]; warning?: string } | null>(null);
  const [scopeOpen, setScopeOpen] = useState(false);

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
    if (busy) return; // Ctrl+Enter twice must not send twice
    setBusy(true);
    setProblem(null);
    try {
      if (isEdit) {
        const results = await runPlan(planUpdate({ master: master!, occurrence: occ, form, scope }));
        const dropped = droppedMessage(results);
        toast.show({ message: dropped ? `${t("toast.saved")}. ${dropped}` : t("toast.saved") });
      } else {
        // A retry of the same form after an error is replayed by the API instead of creating a second event.
        const plan = planCreate(form);
        attempt.current = nextAttempt(attempt.current, plan.requests[0], () => crypto.randomUUID());
        plan.requests[0].idempotencyKey = attempt.current.key;
        await runPlan(plan);
        toast.show({ message: t("toast.created") });
      }
      router.refresh();
      onClose();
    } catch (e) {
      setProblem({ message: errorMessage(e), conflict: isApiError(e, 412) });
      setScopeOpen(false);
      setBusy(false);
    }
  }

  async function save() {
    if (busy) return;
    const found = validateForm(form);
    setErrors(found);
    if (found.title || found.end) return;
    if (!isEdit) return execute("all");
    const plan = planUpdate({ master: master!, occurrence: occ, form, scope: "all" });
    if (plan.requests.length === 0) return onClose();
    if (recurring && plan.allowedScopes.length > 1) {
      setScopePrompt({ allowed: plan.allowedScopes, warning: plan.warnings[0] ? t(plan.warnings[0]) : undefined });
      setScopeOpen(true);
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
        <span className="w-12 shrink-0 text-meta font-medium text-muted">{t(kind === "start" ? "editor.start" : "editor.end")}</span>
        <Input
          type="date"
          required
          aria-label={t(kind === "start" ? "editor.startDate" : "editor.endDate")}
          value={day}
          aria-invalid={kind === "end" && errors.end ? true : undefined}
          onChange={(e) => e.target.value && (kind === "start" ? changeStart(e.target.value, form.startTime) : set({ endDay: e.target.value }))}
          className="min-w-0 flex-1"
        />
        {form.allDay ? null : (
          <Input
            type="time"
            required
            aria-label={t(kind === "start" ? "editor.startTime" : "editor.endTime")}
            value={time}
            aria-invalid={kind === "end" && errors.end ? true : undefined}
            onChange={(e) => (kind === "start" ? changeStart(form.startDay, e.target.value) : set({ endTime: e.target.value }))}
            className="w-36 shrink-0"
          />
        )}
      </div>
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent
          title={t(isEdit ? "editor.editTitle" : "editor.newTitle")}
          closeLabel={t("common.close")}
          size="md"
          className="w-[min(560px,calc(100vw-24px))]"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            titleRef.current?.focus();
          }}
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
            className="flex min-h-0 flex-1 flex-col"
          >
            <DialogBody className="flex flex-col gap-4">
              <Field label={t("editor.title")} error={errors.title ? t(errors.title) : undefined}>
                <Input
                  ref={titleRef}
                  name="title"
                  aria-label={t("editor.title")}
                  placeholder={t("editor.titlePlaceholder")}
                  maxLength={200}
                  value={form.title}
                  onChange={(e) => set({ title: e.target.value })}
                />
              </Field>
              <Switch checked={form.allDay} onCheckedChange={(allDay) => set({ allDay })} label={t("editor.allDay")} />
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
                  <Select aria-label={t("editor.calendar")} value={form.calendarId} options={calendarOptions} onValueChange={(calendarId) => set({ calendarId })} />
                )}
              </Field>
              <Field label={t("editor.location")}>
                <Input value={form.location} onChange={(e) => set({ location: e.target.value })} />
              </Field>
              <Field label={t("editor.notes")}>
                <Textarea rows={3} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
              </Field>
              {problem ? (
                <div role="alert" className="flex items-center justify-between gap-3 rounded-ui border border-danger/50 bg-danger/10 px-3 py-2 text-sub text-danger">
                  <span>{problem.conflict ? t("editor.conflict") : problem.message}</span>
                  {problem.conflict ? (
                    <Button
                      size="sm"
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
            </DialogBody>

            <DialogFooter className="border-t border-border pt-4">
              {isEdit ? (
                <Button variant="danger-outline" onClick={() => del.request(master!, occ, onClose)} disabled={busy} className="sm:mr-auto">
                  {t("common.delete")}
                </Button>
              ) : null}
              <Button onClick={onClose} disabled={busy}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="primary" loading={busy} disabled={noCalendars}>
                {busy ? t("editor.saving") : t("editor.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {scopePrompt ? (
        <ScopeDialog
          open={scopeOpen}
          onOpenChange={setScopeOpen}
          title={t("scope.editTitle")}
          confirmLabel={t("scope.confirmEdit")}
          allowed={scopePrompt.allowed}
          hint={scopePrompt.warning}
          onChoose={execute}
        />
      ) : null}
      {del.dialog}
    </>
  );
}
