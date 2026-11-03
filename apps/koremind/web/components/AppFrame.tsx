"use client";
import { AccountMenu, AppShell, AppSwitcher, Button, MenuItem, Sidebar, SidebarItem, SidebarNav, TopBar, Wordmark, type AppUrls } from "@qarasky/kore-ui";
import { Plus, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useChats } from "@/lib/contexts";
import { useSession } from "@/lib/session";
import { t } from "@/lib/strings";

/**
 * The signed-in frame, the same as every Kore app: top bar (wordmark, app switcher, account menu), the chat list as the sidebar
 * (a drawer below 768px), and the page in the rounded main panel.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const { user, server, signOut } = useSession();
  const { chats } = useChats();
  const path = usePathname();
  // KoreMind's own address is wherever this page is served from.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(location.origin), []);
  const apps: AppUrls = { ...server?.apps, ...(origin ? { koremind: origin } : {}) };
  const hasOtherApps = Object.keys(apps).some((k) => k !== "koremind");
  // Without Kore ID there is no Kore ID account page: the menu's account item opens KoreMind's own account settings.
  const accountUrl = server?.koreId?.accountUrl ?? "/settings#account";

  return (
    <AppShell
      brand={<Wordmark app="koremind" />}
      brandHref="/"
      labels={{ menu: t.openNavigation, drawer: t.navigation, close: t.closeNavigation }}
      topBar={
        <TopBar
          actions={
            <>
              {hasOtherApps && <AppSwitcher urls={apps} current="koremind" triggerLabel={t.apps} accountUrl={server?.koreId?.accountUrl} accountLabel={t.koreIdAccount} />}
              {user && (
                <AccountMenu
                  user={{ email: user.email }}
                  accountUrl={accountUrl}
                  apps={hasOtherApps ? { urls: apps, current: "koremind" } : undefined}
                  onSignOut={signOut}
                  labels={{ menu: t.account, account: server?.koreId ? t.koreIdAccount : t.account, switchApp: t.switchApp, signOut: t.signOut }}
                >
                  <MenuItem asChild>
                    <Link href="/settings">
                      <span aria-hidden="true" className="flex w-4 justify-center text-muted"><Settings /></span>
                      <span className="min-w-0 flex-1 truncate">{t.settings}</span>
                    </Link>
                  </MenuItem>
                </AccountMenu>
              )}
            </>
          }
        />
      }
      sidebar={
        <Sidebar header={<Button asChild variant="primary"><Link href="/"><Plus aria-hidden />{t.newChat}</Link></Button>}>
          <SidebarNav label={t.chats} title={t.chats}>
            {chats.length === 0 && <li className="px-3 py-2 text-meta text-muted">{t.noChats}</li>}
            {chats.map((c) => <SidebarItem key={c.id} href={`/c/${c.id}`} active={path === `/c/${c.id}`}>{c.title}</SidebarItem>)}
          </SidebarNav>
        </Sidebar>
      }
    >
      {children}
    </AppShell>
  );
}
