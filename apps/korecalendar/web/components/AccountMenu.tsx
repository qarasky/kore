"use client";

import { AccountMenu as KoreAccountMenu, AppSwitcher, MenuItem, type AppUrls } from "@qarasky/kore-ui";
import { Keyboard, Settings } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/mutations";
import { t } from "@/lib/i18n";
import { useShell } from "./ShellContext";

export const OPEN_SHORTCUTS_EVENT = "korecal:open-shortcuts";

/** The Kore apps this server knows about (from the API's Kore ID settings), or null when there is nowhere to switch to. */
function useAppUrls(): AppUrls | null {
  const { kore } = useShell();
  const urls: AppUrls = { ...kore?.apps };
  const others = Object.entries(urls).filter(([id, url]) => id !== "korecalendar" && url);
  return others.length > 0 ? urls : null;
}

/** kore-ui's app switcher, when other Kore apps are configured (from `sm` up). */
export function KoreAppSwitcher() {
  const { kore } = useShell();
  const urls = useAppUrls();
  if (!urls) return null;
  // On phones the period title needs the room; the account menu's "Switch app" covers it there.
  return (
    <div className="flex max-sm:hidden">
      <AppSwitcher
        urls={urls}
        current="korecalendar"
        triggerLabel={t("account.apps")}
        accountUrl={kore?.account_url}
        accountLabel={t("account.koreId")}
      />
    </div>
  );
}

/**
 * kore-ui's AccountMenu: who you are, the Kore ID account page (when Kore ID sign-in is on),
 * Settings, keyboard shortcuts, other apps, and Sign out (which also ends the Kore ID session).
 */
export function AccountMenu() {
  const router = useRouter();
  const { me, kore } = useShell();
  const urls = useAppUrls();
  // Without Kore ID there is no account page; the menu's account entry leads to Settings instead.
  const accountUrl = kore?.account_url ?? (kore ? `${kore.issuer.replace(/\/+$/, "")}/account` : null);

  async function onSignOut() {
    let endSession: string | null = null;
    try {
      endSession = await signOut();
    } finally {
      if (endSession) {
        window.location.assign(endSession);
      } else {
        router.replace("/login");
        router.refresh();
      }
    }
  }

  return (
    <KoreAccountMenu
      user={{ email: me.email }}
      accountUrl={accountUrl ?? "/settings"}
      onSignOut={onSignOut}
      apps={urls ? { urls, current: "korecalendar" } : undefined}
      labels={{
        menu: t("account.menu"),
        account: accountUrl ? t("account.koreId") : t("nav.settings"),
        switchApp: t("account.switchApp"),
        signOut: t("account.signOut"),
      }}
    >
      {accountUrl ? (
        <MenuItem asChild>
          <Link href="/settings">
            <span aria-hidden="true" className="flex w-4 justify-center text-muted">
              <Settings />
            </span>
            <span className="min-w-0 flex-1 truncate">{t("nav.settings")}</span>
          </Link>
        </MenuItem>
      ) : null}
      <MenuItem icon={<Keyboard />} onSelect={() => window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT))}>
        {t("account.shortcuts")}
      </MenuItem>
    </KoreAccountMenu>
  );
}
