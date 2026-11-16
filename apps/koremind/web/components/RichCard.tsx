import type { Card, CardSection } from "@koremind/shared";
import { isNumericColumn } from "@koremind/shared";
import { cn, Skeleton, Stat } from "@qarasky/kore-ui";
import { barTone, STAT_TONE, TONE_FILL, TONE_PILL } from "@/lib/rich-ui";
import { t } from "@/lib/strings";

/** A card the assistant asked for (docs/rich-messages.md). Android draws the same card from the same spec. */
export function RichCard({ card }: { card: Card }) {
  const pill = card.badge && <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-meta font-medium", TONE_PILL[card.badge.tone])}>{card.badge.text}</span>;
  // A badge on its own is just the pill, not an empty box.
  if (!card.title && !card.subtitle && card.sections.length === 0) return <div className="not-prose flex">{pill}</div>;
  return (
    <div className="rounded-overlay border border-border bg-surface p-4" data-card>
      {(card.title || card.badge) && (
        <div className="flex items-start justify-between gap-3">
          <p className="font-semibold">{card.title}</p>
          {pill}
        </div>
      )}
      {card.subtitle && <p className="mt-0.5 text-meta text-muted">{card.subtitle}</p>}
      {card.sections.map((s, i) => (
        <div key={i} className={cn((i > 0 || card.title || card.subtitle || card.badge) && "mt-3 border-t border-border pt-3", i === 0 && !card.title && !card.subtitle && !card.badge && "")}>
          <Section s={s} />
        </div>
      ))}
    </div>
  );
}

function Section({ s }: { s: CardSection }) {
  switch (s.type) {
    case "stats":
      return (
        <div className={cn("grid gap-3", s.items.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
          {s.items.map((it, i) => <Stat key={i} label={it.label} value={it.value} tone={STAT_TONE[it.tone ?? "neutral"]} />)}
        </div>
      );
    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>{s.columns.map((c, i) => <th key={i} scope="col" className={cn("py-2 pr-3 text-left font-semibold last:pr-0", isNumericColumn(s.rows, i) && "text-right tabular-nums")}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {s.rows.map((r, ri) => (
                <tr key={ri} className={cn("border-t border-border", s.totalRow && ri === s.rows.length - 1 && "font-semibold")}>
                  {r.map((c, ci) => <td key={ci} className={cn("py-2 pr-3 last:pr-0", isNumericColumn(s.rows, ci) && "text-right tabular-nums")}>{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "bars":
      return (
        <div className="flex flex-col gap-3">
          {s.items.map((it, i) => (
            <div key={i}>
              <div className="flex items-baseline justify-between gap-3"><span>{it.label}</span><span className="tabular-nums">{it.value}</span></div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-track" role="img" aria-label={`${Math.round(it.share * 100)}%`}>
                <div className={cn("h-full rounded-full", TONE_FILL[barTone(it.tone, i)])} style={{ width: `${it.share * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      );
    case "note":
      return <p className="text-meta text-muted">{s.text}</p>;
  }
}

/** Shown while a card is still being written (the JSON is not complete yet). */
export function CardPlaceholder() {
  return (
    <div className="rounded-overlay border border-border bg-surface p-4" role="status" aria-label={t.cardBuilding}>
      <Skeleton className="h-3 w-1/3 rounded-full" />
      <Skeleton className="mt-3 h-3 w-2/3 rounded-full" />
      <Skeleton className="mt-2 h-3 w-1/2 rounded-full" />
    </div>
  );
}
