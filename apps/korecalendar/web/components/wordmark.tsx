import { t } from "@/lib/i18n";
import { Logo } from "./Logo";

/** The mark plus the app name, in the same weight and tracking as Kore's. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 select-none ${className}`}>
      <Logo />
      <span className="font-semibold tracking-[-0.03em]">{t("app.name")}</span>
    </span>
  );
}
