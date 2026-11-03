"use client";

import { AnimatePresence, m } from "motion/react";
import { duration, ease } from "@/lib/motion";
import { useState } from "react";
import { useMutate } from "@/hooks/useMutate";
import { isApiError } from "@/lib/api";
import { CALENDAR_COLORS } from "@/lib/colors";
import { t } from "@/lib/i18n";
import { createCalendar, deleteCalendar, restoreCalendar, updateCalendar } from "@/lib/mutations";
import type { Calendar } from "@/lib/types";
import { Button, ConfirmDialog, Field, IconButton, Input, SettingsSection, useToast } from "@qarasky/kore-ui";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { ColorPicker } from "../ColorPicker";
import { useShell } from "../ShellContext";

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
  // `confirm` outlives `confirmOpen` so the dialog keeps its text while it animates out.
  const [confirm, setConfirm] = useState<Calendar | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

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
      if (!force && isApiError(e, 409)) {
        setConfirm(c);
        setConfirmOpen(true);
        return;
      }
      await run(() => Promise.reject(e));
      return;
    }
    setConfirmOpen(false);
    toast.show({ message: t("cal.deleted"), action: undo(c) });
    await run(async () => undefined);
  }

  return (
    <SettingsSection title={t("cal.heading")} description={t("cal.intro")}>
      <ul className="flex flex-col divide-y divide-border rounded-overlay border border-border empty:hidden" data-testid="calendar-list">
        <AnimatePresence initial={false}>
        {calendars.map((c) => (
          <m.li key={c.id} layout="position"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0, transition: { duration: duration.enter, ease: ease.standard } }}
            exit={{ opacity: 0, transition: { duration: duration.exit, ease: ease.exit } }}
            data-testid="calendar-row">
            {editing === c.id ? (
              <div className="flex flex-col gap-4 p-4">
                <Field label={t("cal.name")} id={`name-${c.id}`} error={nameError ? t("cal.nameRequired") : null}>
                  <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
                </Field>
                <Field label={t("cal.color")}>
                  <ColorPicker value={color} onChange={setColor} />
                </Field>
                <div className="flex gap-2">
                  <Button variant="primary" size="sm" onClick={() => save(c)} disabled={pending}>
                    {t("common.save")}
                  </Button>
                  <Button size="sm" onClick={() => setEditing(null)}>
                    {t("common.cancel")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex min-h-row items-center gap-3 px-4">
                <Swatch color={c.color} />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <IconButton label={t("cal.rename", { name: c.name })} icon={<PencilIcon />} onClick={() => startEdit(c)} />
                <IconButton variant="danger" label={t("cal.delete", { name: c.name })} icon={<Trash2Icon />} onClick={() => remove(c, false)} />
              </div>
            )}
          </m.li>
        ))}
        </AnimatePresence>
      </ul>

      {adding ? (
        <div className="flex flex-col gap-4 rounded-overlay border border-border p-4">
          <Field label={t("cal.name")} id="new-cal-name" error={nameError ? t("cal.nameRequired") : null}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
          </Field>
          <Field label={t("cal.color")}>
            <ColorPicker value={color} onChange={setColor} />
          </Field>
          <div className="flex gap-2">
            <Button variant="primary" size="sm" onClick={add} disabled={pending}>
              {t("cal.create")}
            </Button>
            <Button size="sm" onClick={() => setAdding(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          className="self-start"
          size="sm"
          onClick={() => {
            setEditing(null);
            setAdding(true);
            setName("");
            setColor(CALENDAR_COLORS[calendars.length % CALENDAR_COLORS.length]);
            setNameError(false);
          }}
        >
          <PlusIcon />
          {t("cal.add")}
        </Button>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        danger
        title={t("cal.confirmTitle")}
        description={confirm ? t("cal.confirmBody", { name: confirm.name }) : undefined}
        confirmLabel={t("cal.confirmDelete")}
        cancelLabel={t("common.cancel")}
        pendingLabel={t("common.working")}
        onConfirm={() => (confirm ? remove(confirm, true) : undefined)}
      />
    </SettingsSection>
  );
}
