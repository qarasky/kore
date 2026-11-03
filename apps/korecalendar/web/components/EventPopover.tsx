"use client";

import { useEffect, useRef, useState } from "react";
import { useEventDelete } from "@/hooks/useEventDelete";
import { calendarTint } from "@/lib/colors";
import { formatRange } from "@/lib/format";
import { t } from "@/lib/i18n";
import { describeReminder } from "@/lib/reminders";
import { describeRule } from "@/lib/rrule";
import { fetchEvent } from "@/lib/mutations";
import { parseWall } from "@/lib/wall";
import type { Event, Occurrence } from "@/lib/types";
import { Button, IconButton, Popover, PopoverAnchor, PopoverContent } from "@qarasky/kore-ui";
import { AlignLeftIcon, BellIcon, CalendarDaysIcon, ClockIcon, MapPinIcon, RepeatIcon, XIcon } from "lucide-react";
import { useShell } from "./ShellContext";

function Row({ icon, children, testId }: { icon: React.ReactNode; children: React.ReactNode; testId?: string }) {
  return (
    <div className="flex gap-3 text-sub" data-testid={testId}>
      <span className="mt-0.5 shrink-0 text-muted">{icon}</span>
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

/**
 * The quick look at an event (kore-ui Popover anchored to the clicked block): when, where,
 * repeat, reminders, notes, with Edit and Delete. Focus goes back to the block on close.
 */
export function EventPopover({ occ, anchor, onClose, onEdit }: { occ: Occurrence; anchor: HTMLElement; onClose: () => void; onEdit: () => void }) {
  const { me, prefs, calendars } = useShell();
  const [master, setMaster] = useState<Event | null>(null);
  const del = useEventDelete();
  const anchorRef = useRef(anchor);
  const calendar = calendars.find((c) => c.id === occ.calendar_id);
  const tint = calendarTint(calendar?.color ?? "#5b8def");

  useEffect(() => {
    const ac = new AbortController();
    fetchEvent(occ.event_id, ac.signal)
      .then(setMaster)
      .catch(() => {});
    return () => ac.abort();
  }, [occ.event_id]);

  const range = occ.all_day ? null : formatRange(occ.start_utc, occ.end_utc, me.timezone, prefs.clock);
  const ownZone = !occ.all_day && occ.tz !== me.timezone ? formatRange(occ.start_utc, occ.end_utc, occ.tz, prefs.clock) : null;
  const allDayText = occ.all_day ? (occ.end > addOne(occ.start) ? `${occ.start} – ${lastDay(occ.end)}` : occ.start) : null;

  return (
    <>
      <Popover open onOpenChange={(open) => !open && onClose()}>
        <PopoverAnchor virtualRef={anchorRef} />
        <PopoverContent
          flush
          side="right"
          align="start"
          sideOffset={8}
          aria-label={occ.title || t("grid.untitled")}
          className="w-[340px] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto"
          // The delete confirmation sits above the popover; using it must not close the popover.
          onInteractOutside={(e) => del.open && e.preventDefault()}
          // Only a press outside or Escape closes it: focus moving away on its own (another overlay
          // returning focus to its trigger as it closes) must not.
          onFocusOutside={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            if (anchor.isConnected) anchor.focus();
          }}
        >
        <div data-testid="event-popover">
          <div className="flex items-start gap-3 border-b border-border p-4 pb-3" style={{ boxShadow: `inset 4px 0 0 ${tint.edge}` }}>
            <h2 className="min-w-0 flex-1 pl-2 text-title font-semibold tracking-[-0.01em] break-words">{occ.title || t("grid.untitled")}</h2>
            <IconButton label={t("popover.close")} tooltip={false} icon={<XIcon />} onClick={onClose} className="-mt-1 -mr-2" />
          </div>
          <div className="flex flex-col gap-2.5 p-4">
            <Row icon={<ClockIcon size={16} />} testId="popover-when">
              <div>{range ?? allDayText}</div>
              {ownZone ? <div className="text-meta text-muted">{t("popover.inZone", { range: ownZone, zone: occ.tz })}</div> : null}
            </Row>
            {master && master.rrule ? (
              <Row icon={<RepeatIcon size={16} />} testId="popover-repeat">
                {describeRule(master.rrule, parseWall(master.start).day, { tz: master.tz, allDay: master.all_day })}
              </Row>
            ) : null}
            {occ.location ? <Row icon={<MapPinIcon size={16} />}>{occ.location}</Row> : null}
            {occ.reminders.length > 0 ? (
              <Row icon={<BellIcon size={16} />}>
                {occ.reminders.map((r) => (
                  <div key={r.minutes_before}>{describeReminder(r.minutes_before, occ.all_day)}</div>
                ))}
              </Row>
            ) : null}
            {occ.notes ? (
              <Row icon={<AlignLeftIcon size={16} />}>
                <p className="whitespace-pre-wrap">{occ.notes}</p>
              </Row>
            ) : null}
            <Row icon={<CalendarDaysIcon size={16} />}>
              <span className="inline-flex items-center gap-2">
                <span aria-hidden="true" className="size-2.5 rounded-[3px]" style={{ backgroundColor: tint.edge }} />
                {calendar?.name}
              </span>
            </Row>
          </div>
          <div className="flex justify-end gap-2 border-t border-border p-3">
            <Button size="sm" variant="danger-outline" disabled={!master} onClick={() => master && del.request(master, occ, onClose)}>
              {t("popover.delete")}
            </Button>
            <Button size="sm" variant="primary" onClick={onEdit}>
              {t("popover.edit")}
            </Button>
          </div>
        </div>
        </PopoverContent>
      </Popover>
      {del.dialog}
    </>
  );
}

const addOne = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const lastDay = (exclusiveEnd: string) => {
  const d = new Date(`${exclusiveEnd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
