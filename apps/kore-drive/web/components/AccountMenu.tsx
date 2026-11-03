"use client";

import { AccountMenu as KoreAccountMenu, MenuItem, useToast, type AppUrls } from "@qarasky/kore-ui";
import { KeyRound, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import type { KoreIdLinks } from "./AppFrame";

/**
 * The top bar's account menu (kore-ui AccountMenu): who is signed in, the Kore
 * ID account (when Kore ID is on), this app's account page and password, the
 * other Kore apps, sign out.
 */
export function AccountMenu({
  email,
  passwordLogin = true,
  koreId,
  apps,
}: {
  email: string;
  passwordLogin?: boolean;
  koreId: KoreIdLinks;
  apps?: AppUrls;
}) {
  const router = useRouter();
  const toast = useToast();

  async function signOut() {
    try {
      // 204, or 200 {redirect} for a Kore ID session: end the SSO session too.
      const res = await api<{ redirect?: string } | undefined>("/api/auth/logout", { method: "POST" });
      if (res?.redirect) {
        window.location.assign(res.redirect);
        return;
      }
    } catch {
      toast.show({ message: t("account.signOutFailed"), tone: "error" });
      return;
    }
    // A full navigation on purpose: it drops all client state and cached RSC
    // payloads of the signed-out user, which a router.push would keep.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }

  // Kore ID's account page only when SSO is on; this app's /account is a child
  // item either way (it holds storage, password and SSO linking).
  const accountUrl = koreId.accountUrl;
  return (
    <KoreAccountMenu
      user={{ email }}
      accountUrl={accountUrl}
      apps={apps ? { urls: apps, current: "kore" } : undefined}
      onSignOut={signOut}
      labels={{
        menu: t("account.menu"),
        account: t("account.koreId"),
        switchApp: t("account.switchApp"),
        signOut: t("account.signOut"),
      }}
    >
      <MenuItem icon={<UserRound />} onSelect={() => router.push("/account")}>
        {accountUrl ? t("account.storageAndSettings") : t("account.title")}
      </MenuItem>
      {passwordLogin ? (
        <MenuItem icon={<KeyRound />} onSelect={() => router.push("/account")}>
          {t("account.changePassword")}
        </MenuItem>
      ) : null}
    </KoreAccountMenu>
  );
}
