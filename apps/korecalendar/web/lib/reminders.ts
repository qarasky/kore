/** Reminder offsets: the presets, wording, and bounds the API enforces (0–28 days, at most 20). */
import { t, type MessageKey } from "./i18n";

export const MAX_REMINDER_MINUTES = 40320;
export const MAX_REMINDERS = 20;

export type ReminderUnit = "minutes" | "hours" | "days" | "weeks";

/** The quick choices, shortest lead first. */
export const reminderPresets: readonly { minutes: number }[] = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080].map((minutes) => ({ minutes }));

function amount(n: number, unit: "minute" | "hour" | "day" | "week"): string {
  return t(`unit.${unit}.${n === 1 ? "one" : "other"}` as MessageKey, { n });
}

/** "30 minutes before", "1 hour 30 minutes before", "At time of event". */
export function describeReminder(minutes: number, allDay: boolean): string {
  if (minutes === 0) return t(allDay ? "reminder.atMidnight" : "reminder.atStart");
  let text: string;
  if (minutes % 10080 === 0) text = amount(minutes / 10080, "week");
  else if (minutes % 1440 === 0) text = amount(minutes / 1440, "day");
  else if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    text = m === 0 ? amount(h, "hour") : `${amount(h, "hour")} ${amount(m, "minute")}`;
  } else text = amount(minutes, "minute");
  return t(allDay ? "reminder.beforeMidnight" : "reminder.before", { amount: text });
}

const PER_UNIT: Record<ReminderUnit, number> = { minutes: 1, hours: 60, days: 1440, weeks: 10080 };

/** A custom amount in minutes, or null if it is not a whole number in range. */
export function toMinutes(value: number, unit: ReminderUnit): number | null {
  const minutes = value * PER_UNIT[unit];
  return Number.isInteger(minutes) && minutes >= 0 && minutes <= MAX_REMINDER_MINUTES ? minutes : null;
}

/** Adds an offset: no duplicates, longest lead first, at most 20. */
export function addReminder(list: number[], minutes: number): number[] {
  if (list.includes(minutes) || list.length >= MAX_REMINDERS) return list;
  return [...list, minutes].sort((a, b) => b - a);
}
