import type { ComponentProps } from "react";

export type RelativeTimeOptions = {
  /** The moment to compare with. Default: now. Pass it in tests and for a stable server render. */
  now?: Date;
  /** BCP 47 language tag for the words and the date order. Default: the runtime's. */
  locale?: string;
  /** For the middle of a sentence ("Last active today 07:43"): lower-case the leading word. */
  inline?: boolean;
  /** Use a 12-hour clock. Default false (07:43, 19:05). */
  hour12?: boolean;
  /** The words Intl can't give. Defaults are English. */
  labels?: { justNow?: string; never?: string; invalid?: string };
};

function toDate(input: Date | string | number): Date {
  return input instanceof Date ? input : new Date(input);
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * A moment in words, as DESIGN.md §5 asks: "Just now" for the last minute, "Today 07:43", "Yesterday 07:43", then
 * "Jan 3" (and "Jan 3, 2025" for another year). "Today" and "Yesterday" come from `Intl.RelativeTimeFormat`, so they
 * follow `locale`. A missing value reads "Never", an unparseable one "—".
 */
export function formatRelativeTime(input: Date | string | number | null | undefined, options: RelativeTimeOptions = {}): string {
  const { now = new Date(), locale, inline = false, hour12 = false, labels } = options;
  const justNow = labels?.justNow ?? "Just now";
  const never = labels?.never ?? "Never";
  const invalid = labels?.invalid ?? "—";
  if (input === null || input === undefined || input === "") return inline ? never.toLowerCase() : never;
  const d = toDate(input);
  if (Number.isNaN(d.getTime())) return invalid;

  const seconds = (now.getTime() - d.getTime()) / 1000;
  if (seconds >= 0 && seconds < 60) return inline ? justNow.toLowerCase() : justNow;

  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  const clock = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", ...(hour12 ? { hour12: true } : { hourCycle: "h23" }) }).format(d);
  const word = (n: number) => {
    const w = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(n, "day");
    return inline ? w : w.charAt(0).toUpperCase() + w.slice(1);
  };
  if (days === 0) return `${word(0)} ${clock}`;
  if (days === 1) return `${word(-1)} ${clock}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }).format(d);
}

export type TimeProps = Omit<ComponentProps<"time">, "children" | "dateTime"> &
  RelativeTimeOptions & {
    /** The moment. */
    value: Date | string | number | null | undefined;
  };

/**
 * A `<time>` showing `formatRelativeTime`, with the full date and time as its tooltip (`title`) and the ISO
 * string as `dateTime`, so the exact moment is always one hover away. Renders on the server.
 */
export function Time({ value, now, locale, inline, hour12, labels, title, ...props }: TimeProps) {
  const text = formatRelativeTime(value, { now, locale, inline, hour12, labels });
  if (value === null || value === undefined || value === "" || Number.isNaN(toDate(value).getTime())) {
    return <span {...(props as ComponentProps<"span">)}>{text}</span>;
  }
  const d = toDate(value);
  return (
    <time dateTime={d.toISOString()} title={title ?? d.toLocaleString(locale)} {...props}>
      {text}
    </time>
  );
}
