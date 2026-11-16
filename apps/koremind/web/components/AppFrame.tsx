"use client";
import type { ChatSummary } from "@koremind/shared";
import { AccountMenu, AppShell, AppSwitcher, Button, ConfirmDialog, IconButton, MenuItem, Sidebar, SidebarNav, TopBar, Wordmark, cn, useAppShell, type AppUrls } from "@qarasky/kore-ui";
import { Plus, Settings, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
  const { chats, remove } = useChats();
  const path = usePathname();
  const router = useRouter();
  const [deleting, setDeleting] = useState<ChatSummary | null>(null);
  const deleteChat = async () => {
    const c = deleting;
    if (!c) return;
    await remove(c.id);
    setDeleting(null);
    if (path === `/c/${c.id}`) router.push("/");
  };
  // KoreMind's own address is wherever this page is served from.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(location.origin), []);
  const apps: AppUrls = { ...server?.apps, ...(origin ? { koremind: origin } : {}) };
  const hasOtherApps = Object.keys(apps).some((k) => k !== "koremind");

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
                  accountUrl={server?.sso ? server.koreId?.accountUrl : undefined}
                  apps={hasOtherApps ? { urls: apps, current: "koremind" } : undefined}
                  onSignOut={signOut}
                  labels={{ menu: t.account, account: t.koreIdAccount, switchApp: t.switchApp, signOut: t.signOut }}
                >
                  <MenuItem asChild icon={<Settings />}>
                    <Link href="/settings">{t.settings}</Link>
                  </MenuItem>
                </AccountMenu>
              )}
            </>
          }
        />
      }
      sidebar={
        <Sidebar header={<Button asChild variant="primary"><Link href="/"><Plus aria-hidden />{t.newChat}</Link></Button>}>
          <SidebarNav label={t.chats} title={t.chats} empty={t.noChats}>
            {chats.map((c) => <ChatItem key={c.id} chat={c} active={path === `/c/${c.id}`} onDelete={() => setDeleting(c)} />)}
          </SidebarNav>
        </Sidebar>
      }
    >
      {children}
      <ConfirmDialog
        open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }} danger
        title={t.deleteChatTitle(deleting?.title ?? "")} description={t.deleteChatBody}
        confirmLabel={t.delete} cancelLabel={t.cancel} pendingLabel={t.deleting} onConfirm={deleteChat}
      />
    </AppShell>
  );
}

/** A chat in the sidebar, like a SidebarItem, with a delete button that shows on hover (always on touch screens). */
function ChatItem({ chat, active, onDelete }: { chat: ChatSummary; active: boolean; onDelete(): void }) {
  const shell = useAppShell();
  const collapsed = !!shell?.collapsed;
  return (
    <li className="group relative">
      <Link
        href={`/c/${chat.id}`} aria-current={active ? "page" : undefined}
        onClick={() => { if (shell?.inDrawer) shell.setDrawerOpen(false); }}
        className={cn(
          "flex min-h-control w-full items-center rounded-ui px-3 pr-10 text-left transition-colors",
          collapsed && "sr-only",
          active ? "bg-raised font-medium text-text" : "text-muted hover:bg-hover-subtle hover:text-text",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{chat.title}</span>
      </Link>
      {!collapsed && (
        <span className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
          <IconButton label={t.deleteChat} icon={<Trash2 />} tooltip={false} variant="danger" className="size-8" onClick={onDelete} />
        </span>
      )}
    </li>
  );
}
