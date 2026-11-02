"use client";

import { useRouter } from "next/navigation";
import { signOut } from "@/lib/mutations";
import { t } from "@/lib/i18n";
import { KeyboardIcon, LogOutIcon, SettingsIcon } from "./icons";
import { Menu } from "./Menu";
import { useShell } from "./ShellContext";

export const OPEN_SHORTCUTS_EVENT = "korecal:open-shortcuts";

/** The round account button: who you are, Settings, shortcuts, Sign out. */
export function AccountMenu() {
  const router = useRouter();
  const { me } = useShell();
  const initial = (me.email.trim()[0] ?? "?").toUpperCase();
  return (
    <Menu
      label={t("account.menu")}
      triggerClassName="grid size-control-sm place-items-center rounded-full bg-accent text-sub font-semibold text-white hover:bg-accent-hover"
      trigger={<span aria-hidden="true">{initial}</span>}
      items={[
        { type: "text", label: t("account.signedInAs", { email: me.email }) },
        { type: "link", label: t("nav.settings"), href: "/settings", icon: <SettingsIcon size={16} /> },
        {
          type: "item",
          label: t("account.shortcuts"),
          icon: <KeyboardIcon size={16} />,
          onSelect: () => window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT)),
        },
        {
          type: "item",
          label: t("account.signOut"),
          icon: <LogOutIcon size={16} />,
          onSelect: async () => {
            try {
              await signOut();
            } finally {
              router.replace("/login");
              router.refresh();
            }
          },
        },
      ]}
    />
  );
}
