"use client";

import Link from "next/link";
import { formatDayTitle } from "@/lib/format";
import { t } from "@/lib/i18n";
import { calendarHref, navigate } from "@/lib/range";
import { AccountMenu } from "./AccountMenu";
import { buttonClass, iconButtonClass } from "./Button";
import { useEditor } from "./EditorContext";
import { ChevronLeftIcon, ChevronRightIcon, MenuIcon_, PlusIcon } from "./icons";
import { SearchBox } from "./SearchBox";
import { useShell } from "./ShellContext";
import { ViewSwitcher } from "./ViewSwitcher";
import { Wordmark } from "./wordmark";

export function TopBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { view, day, today, prefs } = useShell();
  const { openNew } = useEditor();

  return (
    <header className="flex h-topbar shrink-0 items-center gap-2 px-3">
      <button type="button" aria-label={t("nav.menu")} className={`${iconButtonClass()} md:hidden`} onClick={onOpenMenu}>
        <MenuIcon_ />
      </button>
      <Link href="/" className="mr-1 text-brand md:w-[calc(var(--spacing-sidebar)-1.25rem)]">
        <Wordmark />
      </Link>
      {view ? (
        <div className="flex min-w-0 items-center gap-1.5">
          <Link href={calendarHref(view, today)} className={`${buttonClass("secondary", true)} hidden sm:inline-flex`}>
            {t("nav.today")}
          </Link>
          <Link href={calendarHref(view, navigate(view, day, -1))} aria-label={t("nav.previous")} className={iconButtonClass()}>
            <ChevronLeftIcon />
          </Link>
          <Link href={calendarHref(view, navigate(view, day, 1))} aria-label={t("nav.next")} className={iconButtonClass()}>
            <ChevronRightIcon />
          </Link>
          <h1 className="ml-1 truncate text-heading font-semibold tracking-[-0.01em]" aria-live="polite">
            {formatDayTitle(day, view, prefs.weekStart)}
          </h1>
        </div>
      ) : (
        <Link href={calendarHref(prefs.view, today)} className={buttonClass("ghost", true)}>
          <ChevronLeftIcon size={16} />
          {t("nav.backToCalendar")}
        </Link>
      )}
      <div className="flex-1" />
      <SearchBox />
      <div className="hidden md:block">
        <ViewSwitcher />
      </div>
      <button type="button" onClick={() => openNew()} className={`${buttonClass("primary", true)} hidden sm:inline-flex`}>
        <PlusIcon size={16} />
        {t("nav.newEvent")}
      </button>
      <AccountMenu />
    </header>
  );
}
