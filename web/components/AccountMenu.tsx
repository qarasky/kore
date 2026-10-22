"use client";

import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { KeyIcon, SignOutIcon } from "./icons";
import { Dropdown } from "./Menu";
import { useToast } from "./Toast";

/** Avatar button in the top bar: who is signed in, password, sign out. */
export function AccountMenu({ email }: { email: string }) {
  const router = useRouter();
  const toast = useToast();

  async function signOut() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      toast.show({ message: t("account.signOutFailed"), tone: "error" });
      return;
    }
    // A full navigation on purpose: it drops all client state and cached RSC
    // payloads of the signed-out user, which a router.push would keep.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }

  return (
    <Dropdown
      label={t("account.menu")}
      buttonLabel={t("account.menu")}
      align="right"
      header={
        <div className="mb-1 max-w-[280px] truncate border-b border-border px-3 pt-1.5 pb-2 text-muted" title={email}>
          {t("account.signedInAs", { email })}
        </div>
      }
      items={[
        {
          id: "password",
          label: t("account.changePassword"),
          icon: <KeyIcon />,
          onSelect: () => router.push("/account"),
        },
        { id: "signout", label: t("account.signOut"), icon: <SignOutIcon />, onSelect: signOut },
      ]}
      buttonClassName="flex min-h-control items-center gap-2 rounded-ui pr-2.5 pl-1 text-muted transition-colors hover:bg-white/5 hover:text-text"
    >
      <span
        aria-hidden="true"
        className="flex size-8 items-center justify-center rounded-full bg-accent text-meta font-semibold text-white uppercase"
      >
        {email.slice(0, 1)}
      </span>
      <span data-testid="current-user" className="hidden max-w-[220px] truncate sm:inline">
        {email}
      </span>
    </Dropdown>
  );
}
