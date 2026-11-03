"use client";

import { AppShell, AppSwitcher, Sidebar, TopBar, Wordmark, type AppUrls } from "@qarasky/kore-ui";
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";
import type { Usage } from "@/lib/nodes";
import type { User } from "@/lib/session";
import { AccountMenu } from "./AccountMenu";
import { NewMenu } from "./NewMenu";
import { SearchBox } from "./SearchBox";
import { SidebarNav } from "./SidebarNav";
import { StorageMeter } from "./StorageMeter";

export type KoreIdLinks = {
  /** Kore ID's account page (`<issuer>/account`), when Kore ID is on. */
  accountUrl?: string;
  /** The Kore apps for the switcher (Kore itself included). */
  apps?: AppUrls;
};

/**
 * The signed-in frame (kore-ui AppShell): top bar with search, the app switcher
 * and the account menu; sidebar with + New, the sections and the storage meter;
 * the page in the main panel. Below 768px the sidebar is a drawer.
 */
export function AppFrame({
  user,
  usage,
  koreId,
  children,
}: {
  user: Pick<User, "email" | "role">;
  usage: Usage;
  koreId: KoreIdLinks;
  children: ReactNode;
}) {
  const apps = koreId.apps && Object.keys(koreId.apps).length > 1 ? koreId.apps : undefined;
  return (
    <AppShell
      brand={<Wordmark app="kore" />}
      brandHref="/files"
      labels={{ menu: t("shell.openNav"), drawer: t("shell.nav"), close: t("shell.closeNav") }}
      topBar={
        <TopBar
          actions={
            <>
              {apps ? (
                <AppSwitcher
                  urls={apps}
                  current="kore"
                  triggerLabel={t("shell.apps")}
                  label={t("shell.appsList")}
                  accountUrl={koreId.accountUrl}
                  accountLabel={t("account.koreId")}
                />
              ) : null}
              <AccountMenu email={user.email} koreId={koreId} apps={apps} />
            </>
          }
        >
          <SearchBox />
        </TopBar>
      }
      sidebar={
        <Sidebar header={<NewMenu />} footer={<StorageMeter usage={usage} />}>
          <SidebarNav isAdmin={user.role === "admin"} />
        </Sidebar>
      }
    >
      {children}
    </AppShell>
  );
}
