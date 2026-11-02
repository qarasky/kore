import { redirect } from "next/navigation";
import { getPrefs } from "@/lib/prefs-server";
import { calendarHref } from "@/lib/range";
import { requireUser } from "@/lib/session";
import { todayIn } from "@/lib/tz";

/** `/` opens the last-used view on today (in the person's own time zone). */
export default async function Home() {
  const me = await requireUser();
  const prefs = await getPrefs();
  redirect(calendarHref(prefs.view, todayIn(me.timezone)));
}
