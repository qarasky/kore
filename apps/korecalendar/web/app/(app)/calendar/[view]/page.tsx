import { notFound } from "next/navigation";
import { NoCalendars } from "@/components/EmptyState";
import { CalendarView } from "@/components/CalendarView";
import { api } from "@/lib/api";
import { isValidDay } from "@/lib/dates";
import { getPrefs } from "@/lib/prefs-server";
import { loadRange, parseView, viewRange } from "@/lib/range";
import { requireUser } from "@/lib/session";
import { todayIn } from "@/lib/tz";
import type { Calendar, Occurrence } from "@/lib/types";

export const metadata = { title: "Calendar" };

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ view: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const view = parseView((await params).view);
  if (!view) notFound();
  const me = await requireUser();
  const sp = await searchParams;
  const date = Array.isArray(sp.date) ? sp.date[0] : sp.date;
  if (date !== undefined && !isValidDay(date)) notFound();
  const day = date ?? todayIn(me.timezone);

  const prefs = await getPrefs();
  const { days } = viewRange(view, day, me.timezone, prefs.weekStart);
  const range = loadRange(view, day, me.timezone, prefs.weekStart);
  const calendars = await api<Calendar[]>("/api/calendars");
  const visible = calendars.filter((c) => !prefs.hidden.includes(c.id));

  if (calendars.length === 0) return <NoCalendars />;

  let occurrences: Occurrence[] = [];
  if (visible.length > 0) {
    const q = new URLSearchParams({ from: range.from.toISOString(), to: range.to.toISOString() });
    // All calendars visible: no filter, so a calendar created in the meantime still shows.
    if (visible.length < calendars.length) visible.forEach((c) => q.append("calendar_id", c.id));
    occurrences = await api<Occurrence[]>(`/api/occurrences?${q}`);
  }

  return <CalendarView view={view} day={day} days={days} occurrences={occurrences} />;
}
