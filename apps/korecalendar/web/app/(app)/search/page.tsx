import { ResultsList } from "@/components/ResultsList";
import { api } from "@/lib/api";
import { addDays } from "@/lib/dates";
import { formatFullDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import { localToUTC, todayIn } from "@/lib/tz";
import type { Occurrence } from "@/lib/types";

export const metadata = { title: t("search.title") };

/** Search looks 90 days back and 300 days ahead (the API allows 400 days per request). */
const DAYS_BACK = 90;
const DAYS_AHEAD = 300;

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  const q = (raw ?? "").trim().slice(0, 200);
  const me = await requireUser();

  if (!q) {
    return <p className="grid h-full place-items-center p-6 text-sub text-muted">{t("search.prompt")}</p>;
  }

  const today = todayIn(me.timezone);
  const first = addDays(today, -DAYS_BACK);
  const last = addDays(today, DAYS_AHEAD);
  const params = new URLSearchParams({
    from: localToUTC(first, 0, me.timezone).toISOString(),
    to: localToUTC(addDays(last, 1), 0, me.timezone).toISOString(),
    q,
  });
  const occurrences = await api<Occurrence[]>(`/api/occurrences?${params}`);

  return (
    <div className="h-full overflow-y-auto">
      <header className="border-b border-border px-4 py-3">
        <h1 className="text-heading font-semibold">{t("search.resultsFor", { q })}</h1>
        <p className="text-meta text-muted">
          {t("search.count", { count: occurrences.length })} · {t("search.range", { from: formatFullDate(first), to: formatFullDate(last) })}
        </p>
      </header>
      {occurrences.length === 0 ? (
        <p className="p-6 text-sub text-muted" data-testid="search-none">
          {t("search.none", { q })}
        </p>
      ) : (
        <ResultsList occurrences={occurrences} />
      )}
    </div>
  );
}
