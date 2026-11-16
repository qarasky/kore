"use client";

import {
    AccountMenu,
    AppShell,
    AppSwitcher,
    MenuItem,
    SearchButton,
    Sidebar,
    SidebarItem,
    SidebarNav,
    TopBar,
    Wordmark,
} from "@qarasky/kore-ui";
import { Palette } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { AppearanceDialog } from "@/components/appearance-dialog";
import { useAttentionCount } from "@/components/attention/attention-list";
import { openCommandPalette } from "@/components/command-palette";
import { KORE_APP, SIDEBAR_COOKIE } from "@/lib/kore";
import { type Me, displayName } from "@/lib/me";
import { NAV_SECTIONS, activeSection } from "@/lib/nav";
import { SIGN_IN_PATH } from "@/lib/session";
import { type SignInMethods, endSession } from "@/lib/sso";

/** The attention section's icon, with a red dot while something needs attention and the sidebar shows icons only. */
function AttentionIcon({ icon, count, collapsed }: { icon: React.ReactNode; count: number; collapsed: boolean }) {
    return (
        <span className="relative flex">
            {icon}
            {collapsed && count > 0 ? (
                <span className="absolute -top-1 -right-1 size-2 rounded-full bg-status-down ring-2 ring-bg" />
            ) : null}
        </span>
    );
}

/**
 * The signed-in frame: kore-ui's AppShell with the KoreMonitor sections in a
 * collapsible sidebar, search in the top bar, then the Kore app switcher and
 * the account menu. The collapsed state lives in the `sidebar_state` cookie
 * (read by the layout, so the first render is right); kore-ui binds ⌘B to the
 * same setter.
 */
export function AdminShell({
    me,
    methods,
    defaultCollapsed,
    children,
}: {
    me: Me;
    methods: SignInMethods;
    defaultCollapsed: boolean;
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const router = useRouter();
    const active = activeSection(pathname);
    const attention = useAttentionCount();
    const [collapsed, setCollapsedState] = useState(defaultCollapsed);
    const [appearanceOpen, setAppearanceOpen] = useState(false);

    const setCollapsed = useCallback((next: boolean) => {
        setCollapsedState(next);
        document.cookie = `${SIDEBAR_COOKIE}=${next ? "false" : "true"}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    }, []);

    async function signOut() {
        const providerLogout = await endSession();
        if (providerLogout) {
            window.location.assign(providerLogout);
            return;
        }
        router.replace(SIGN_IN_PATH);
        router.refresh();
    }

    const name = displayName(me);
    const user = me.principal === "account" ? { name, email: me.account.email } : { name, email: "Operator API token" };
    const hasApps = Object.keys(methods.apps).length > 0;

    return (
        <AppShell
            collapsible
            collapseShortcut="b"
            sidebarCollapsed={collapsed}
            onSidebarCollapsedChange={setCollapsed}
            brand={<Wordmark app={KORE_APP} />}
            brandHref="/monitors"
            topBar={
                <TopBar
                    actions={
                        <>
                            {hasApps ? (
                                <AppSwitcher
                                    urls={methods.apps}
                                    current={KORE_APP}

                                    accountUrl={methods.accountUrl ?? undefined}
                                />
                            ) : null}
                            <AccountMenu
                                user={user}
                                accountUrl={methods.accountUrl ?? undefined}
                                apps={{ urls: methods.apps, current: KORE_APP }}
                                onSignOut={signOut}
                            >
                                <MenuItem icon={<Palette />} onSelect={() => setAppearanceOpen(true)}>
                                    Appearance
                                </MenuItem>
                            </AccountMenu>
                        </>
                    }
                >
                    <SearchButton label="Search monitors, servers and sections" onClick={openCommandPalette} />
                </TopBar>
            }
            sidebar={
                <Sidebar>
                    <SidebarNav label="Sections">
                        {NAV_SECTIONS.map((section) => {
                            const Icon = section.icon;
                            const isAttention = section.id === "attention";
                            const count = isAttention ? attention : 0;
                            return (
                                <SidebarItem
                                    key={section.id}
                                    // The Superboard is a full page load: it has no app shell.
                                    LinkComponent={section.external ? PlainLink : undefined}
                                    href={section.href}
                                    active={section.id === active}
                                    icon={
                                        isAttention ? (
                                            <AttentionIcon icon={<Icon />} count={count} collapsed={collapsed} />
                                        ) : (
                                            <Icon />
                                        )
                                    }
                                    trailing={
                                        count > 0 ? (
                                            <span
                                                className="font-medium text-status-down tabular-nums"
                                                aria-label={`${count} need attention`}
                                            >
                                                {count}
                                            </span>
                                        ) : undefined
                                    }
                                    tooltip={count > 0 ? `${section.label} · ${count}` : section.label}
                                >
                                    {section.label}
                                </SidebarItem>
                            );
                        })}
                    </SidebarNav>
                </Sidebar>
            }
        >
            {children}
            <AppearanceDialog open={appearanceOpen} onOpenChange={setAppearanceOpen} />
        </AppShell>
    );
}

/** A plain anchor, for links that must load a whole page. */
function PlainLink({ href, ...props }: React.ComponentProps<"a"> & { href: string }) {
    return <a href={href} {...props} />;
}
