"use client";

import { ChevronDown, LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { isExternalHref, useLinkComponent, type LinkComponent } from "../lib/link";
import { Avatar } from "../components/Avatar";
import { Menu, MenuContent, MenuGroup, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "../components/Menu";
import { KORE_APP_IDS, productName, type AppId, type AppNames, type AppUrls } from "./apps";
import { AppMark } from "./AppMark";

export type AccountUser = { email: string; name?: string | null; avatarUrl?: string | null };

export type AccountMenuProps = {
  user: AccountUser;
  /** The Kore ID account page (profile, password, sessions). */
  accountUrl: string;
  /** Called by "Sign out". Do the app's logout (and Kore ID's), then navigate. */
  onSignOut: () => void | Promise<void>;
  /** App switcher section: where each app lives (apps without a URL are hidden) and which one this is. */
  apps?: { urls: AppUrls; current?: AppId; names?: AppNames };
  /** Extra items (MenuItem…) between the account link and the app list, e.g. Settings, Keyboard shortcuts. */
  children?: ReactNode;
  /** Show the name/email next to the avatar from `sm` up. Default true. */
  showName?: boolean;
  /** Which way the menu opens. Default "bottom" (top bar); "top" for a sidebar footer. */
  side?: "bottom" | "top";
  align?: "start" | "end";
  labels?: Partial<{ menu: string; account: string; switchApp: string; signOut: string }>;
  LinkComponent?: LinkComponent;
  className?: string;
};

/**
 * The signed-in user's menu: who you are, "Kore ID account", other apps, sign out.
 * The trigger is the avatar (plus name on wider screens).
 */
export function AccountMenu({
  user,
  accountUrl,
  onSignOut,
  apps,
  children,
  showName = true,
  side = "bottom",
  align = "end",
  labels,
  LinkComponent,
  className,
}: AccountMenuProps) {
  const Link = useLinkComponent(LinkComponent);
  const l = { menu: "Account", account: "Kore ID account", switchApp: "Switch app", signOut: "Sign out", ...labels };
  const display = user.name?.trim() || user.email;
  const appIds = apps ? KORE_APP_IDS.filter((id) => apps.urls[id] && id !== apps.current) : [];
  const accountExternal = isExternalHref(accountUrl);

  return (
    <Menu>
      <MenuTrigger
        aria-label={`${l.menu}: ${display}`}
        className={cn(
          "flex min-h-control max-w-[280px] items-center gap-2 rounded-ui pr-2 pl-1 text-muted transition-colors hover:bg-white/5 hover:text-text",
          "data-[state=open]:bg-white/5 data-[state=open]:text-text",
          !showName && "pr-1",
          className,
        )}
      >
        <Avatar name={user.name} email={user.email} src={user.avatarUrl} />
        {showName ? (
          <>
            <span className="hidden min-w-0 truncate sm:inline">{display}</span>
            <ChevronDown aria-hidden className="hidden size-3.5 shrink-0 sm:block" />
          </>
        ) : null}
      </MenuTrigger>
      <MenuContent side={side} align={align} className="w-[280px]">
        <MenuLabel className="flex items-center gap-3 px-3.5 pt-2 pb-2.5">
          <Avatar name={user.name} email={user.email} src={user.avatarUrl} size="lg" />
          <span className="min-w-0">
            {user.name ? <span className="block truncate text-sub font-medium text-text">{user.name}</span> : null}
            <span className="block truncate text-meta font-normal text-muted" title={user.email}>
              {user.email}
            </span>
          </span>
        </MenuLabel>
        <MenuSeparator />
        <MenuItem asChild>
          {accountExternal ? (
            <a href={accountUrl}>
              <AccountItemInner label={l.account} />
            </a>
          ) : (
            <Link href={accountUrl}>
              <AccountItemInner label={l.account} />
            </Link>
          )}
        </MenuItem>
        {children}
        {appIds.length > 0 ? (
          <>
            <MenuSeparator />
            <MenuGroup>
              <MenuLabel>{l.switchApp}</MenuLabel>
              {appIds.map((id) => (
                <MenuItem key={id} asChild>
                  <a href={apps!.urls[id]}>
                    <span aria-hidden="true" className="flex w-4 justify-center">
                      <AppMark app={id} size={16} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{productName(id, apps!.names)}</span>
                  </a>
                </MenuItem>
              ))}
            </MenuGroup>
          </>
        ) : null}
        <MenuSeparator />
        <MenuItem icon={<LogOut />} onSelect={() => void onSignOut()}>
          {l.signOut}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function AccountItemInner({ label }: { label: string }) {
  return (
    <>
      <span aria-hidden="true" className="flex w-4 justify-center">
        <AppMark app="kore-id" size={16} />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </>
  );
}
