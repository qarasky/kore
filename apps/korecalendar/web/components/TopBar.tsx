"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { formatDayTitle } from "@/lib/format";
import { t } from "@/lib/i18n";
import { calendarHref, navigate } from "@/lib/range";
import { AccountMenu } from "./AccountMenu";
import { buttonClass, iconButtonClass } from "./Button";
import { COMPACT_QUERY, useMediaQuery } from "@/hooks/useMediaQuery";
import { useEditor } from "./EditorContext";
import { ChevronLeftIcon, ChevronRightIcon, MenuIcon_, PlusIcon } from "./icons";
import { SearchBox } from "./SearchBox";
import { useShell } from "./ShellContext";
import { ViewSwitcher } from "./ViewSwitcher";
import { Wordmark } from "./wordmark";

export function TopBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { view, day, today, prefs } = useShell();
  const { openNew } = useEditor();
  const pathname = usePathname();
  const search = useSearchParams();
  const query = pathname === "/search" ? (search.get("q") ?? "") : "";
  const compact = useMediaQuery(COMPACT_QUERY);

  return (
    <header className="flex h-topbar shrink-0 items-center gap-2 px-3">
      <button type="button" aria-label={t("nav.menu")} className={`${iconButtonClass()} md:hidden`} onClick={onOpenMenu}>
        <MenuIcon_ />
      </button>
      <Link href="/" className="mr-1 text-brand max-sm:hidden md:w-[calc(var(--spacing-sidebar)-1.25rem)]">
        <Wordmark />
      </Link>
      {view ? (
        <div className="flex min-w-0 items-center gap-1.5">
          <Link href={calendarHref(view, today)} className={buttonClass("secondary", true)}>
            {t("nav.today")}
          </Link>
          <Link href={calendarHref(view, navigate(view, day, -1, compact))} aria-label={t("nav.previous")} className={iconButtonClass()}>
            <ChevronLeftIcon />
          </Link>
          <Link href={calendarHref(view, navigate(view, day, 1, compact))} aria-label={t("nav.next")} className={iconButtonClass()}>
            <ChevronRightIcon />
          </Link>
          <h1 className="ml-1 truncate text-heading font-semibold tracking-[-0.01em] max-sm:text-sub" aria-live="polite">
            {formatDayTitle(day, view, prefs.weekStart, compact)}
          </h1>
        </div>
      ) : (
        <Link href={calendarHref(prefs.view, today)} className={buttonClass("ghost", true)}>
          <ChevronLeftIcon size={16} />
          {t("nav.backToCalendar")}
        </Link>
      )}
      <div className="flex-1" />
      <SearchBox key={query} initial={query} />
      <div className="hidden md:block">
        <ViewSwitcher />
      </div>
      <button type="button" onClick={() => openNew()} className={`${buttonClass("primary", true)} max-sm:hidden`}>
        <PlusIcon size={16} />
        {t("nav.newEvent")}
      </button>
      <button type="button" aria-label={t("nav.newEvent")} onClick={() => openNew()} className="grid size-control-sm place-items-center rounded-ui bg-accent text-white hover:bg-accent-hover sm:hidden">
        <PlusIcon size={18} />
      </button>
      <AccountMenu />
    </header>
  );
}
