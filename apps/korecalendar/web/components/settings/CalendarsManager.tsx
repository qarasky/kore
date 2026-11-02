"use client";

import { useState } from "react";
import { useMutate } from "@/hooks/useMutate";
import { isApiError } from "@/lib/api";
import { CALENDAR_COLORS } from "@/lib/colors";
import { t } from "@/lib/i18n";
import { createCalendar, deleteCalendar, restoreCalendar, updateCalendar } from "@/lib/mutations";
import type { Calendar } from "@/lib/types";
import { Button } from "../Button";
import { ColorPicker } from "../ColorPicker";
import { ConfirmDialog } from "../ConfirmDialog";
import { Field, inputClass } from "../Field";
import { PencilIcon, PlusIcon, Trash2Icon } from "../icons";
import { useShell } from "../ShellContext";
import { useToast } from "../Toast";
import { SettingsSection } from "./Section";

function Swatch({ color }: { color: string }) {
  return <span aria-hidden="true" className="size-4 shrink-0 rounded-[4px]" style={{ backgroundColor: color }} />;
}

/** Create, rename, recolour and delete calendars. Deleting is undoable for 30 days. */
export function CalendarsManager() {
  const { calendars } = useShell();
  const { run, pending } = useMutate();
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(CALENDAR_COLORS[0]);
  const [adding, setAdding] = useState(false);
  const [nameError, setNameError] = useState(false);
  const [confirm, setConfirm] = useState<Calendar | null>(null);

  const startEdit = (c: Calendar) => {
    setAdding(false);
    setEditing(c.id);
    setName(c.name);
    setColor(c.color);
    setNameError(false);
  };

  async function save(c: Calendar) {
    if (name.trim() === "") return setNameError(true);
    const ok = await run(() => updateCalendar(c.id, { name: name.trim(), color }), { message: t("cal.saved") });
    if (ok) setEditing(null);
  }

  async function add() {
    if (name.trim() === "") return setNameError(true);
    const ok = await run(() => createCalendar(name.trim(), color), { message: t("cal.created") });
    if (ok) {
      setAdding(false);
      setName("");
    }
  }

  const undo = (c: Calendar) => ({
    label: t("common.undo"),
    onClick: async () => {
      await run(() => restoreCalendar(c.id), { message: t("cal.restored") });
    },
  });

  async function remove(c: Calendar, force: boolean) {
    try {
      await deleteCalendar(c.id, force);
    } catch (e) {
      if (!force && isApiError(e, 409)) return setConfirm(c);
      await run(() => Promise.reject(e));
      return;
    }
    setConfirm(null);
    toast(t("cal.deleted"), { action: undo(c) });
    await run(async () => undefined);
  }

  return (
    <SettingsSection title={t("cal.heading")} description={t("cal.intro")}>
      <ul className="flex flex-col gap-2" data-testid="calendar-list">
        {calendars.map((c) => (
          <li key={c.id} className="rounded-ui border border-border" data-testid="calendar-row">
            {editing === c.id ? (
              <div className="flex flex-col gap-4 p-3">
                <Field label={t("cal.name")} htmlFor={`name-${c.id}`} error={nameError ? t("cal.nameRequired") : null}>
                  <input id={`name-${c.id}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className={`${inputClass} w-full`} autoFocus />
                </Field>
                <Field label={t("cal.color")}>
                  <ColorPicker value={color} onChange={setColor} />
                </Field>
                <div className="flex gap-2">
                  <Button variant="primary" small onClick={() => save(c)} disabled={pending}>
                    {t("common.save")}
                  </Button>
                  <Button small onClick={() => setEditing(null)}>
                    {t("common.cancel")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex min-h-control items-center gap-3 px-3">
                <Swatch color={c.color} />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <button type="button" aria-label={t("cal.rename", { name: c.name })} onClick={() => startEdit(c)} className="grid size-control-sm place-items-center rounded-ui text-muted hover:bg-raised hover:text-text">
                  <PencilIcon size={16} />
                </button>
                <button type="button" aria-label={t("cal.delete", { name: c.name })} onClick={() => remove(c, false)} className="grid size-control-sm place-items-center rounded-ui text-muted hover:bg-danger/10 hover:text-danger">
                  <Trash2Icon size={16} />
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {adding ? (
        <div className="mt-3 flex flex-col gap-4 rounded-ui border border-border p-3">
          <Field label={t("cal.name")} htmlFor="new-cal-name" error={nameError ? t("cal.nameRequired") : null}>
            <input id="new-cal-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className={`${inputClass} w-full`} autoFocus />
          </Field>
          <Field label={t("cal.color")}>
            <ColorPicker value={color} onChange={setColor} />
          </Field>
          <div className="flex gap-2">
            <Button variant="primary" small onClick={add} disabled={pending}>
              {t("cal.create")}
            </Button>
            <Button small onClick={() => setAdding(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          className="mt-3"
          small
          onClick={() => {
            setEditing(null);
            setAdding(true);
            setName("");
            setColor(CALENDAR_COLORS[calendars.length % CALENDAR_COLORS.length]);
            setNameError(false);
          }}
        >
          <PlusIcon size={16} />
          {t("cal.add")}
        </Button>
      )}

      {confirm ? (
        <ConfirmDialog
          danger
          title={t("cal.confirmTitle")}
          message={t("cal.confirmBody", { name: confirm.name })}
          confirmLabel={t("cal.confirmDelete")}
          onConfirm={() => remove(confirm, true)}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </SettingsSection>
  );
}
