import { t } from "@/lib/i18n";

/** The "Kore" wordmark: a small accent tile grid plus the name. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 select-none ${className}`}>
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-[1.1em]">
        <rect x="0" y="0" width="7" height="7" rx="1.5" className="fill-accent" />
        <rect x="9" y="0" width="7" height="7" rx="1.5" className="fill-accent opacity-60" />
        <rect x="0" y="9" width="7" height="7" rx="1.5" className="fill-accent opacity-60" />
        <rect x="9" y="9" width="7" height="7" rx="1.5" className="fill-accent opacity-30" />
      </svg>
      <span className="font-semibold tracking-[-0.03em]">{t("app.name")}</span>
    </span>
  );
}
