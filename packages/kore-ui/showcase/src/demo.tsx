import { AccountMenu, AppSwitcher, MenuItem, type AppUrls } from "@qarasky/kore-ui";
import { Keyboard, Settings } from "lucide-react";

export const APP_URLS: AppUrls = {
  kore: "#/app",
  koremind: "#/components",
  korecalendar: "#/components",
  flatline: "#/components",
};

export const ACCOUNT_URL = "#/settings";

export const ME = { name: "Anna Berg", email: "anna@northwind.example" };

/** Top-bar right side shared by the example pages. */
export function TopBarActions({ current }: { current: "kore" | "korecalendar" }) {
  return (
    <>
      <AppSwitcher urls={APP_URLS} current={current} accountUrl={ACCOUNT_URL} />
      <AccountMenu
        user={ME}
        accountUrl={ACCOUNT_URL}
        apps={{ urls: APP_URLS, current }}
        onSignOut={() => {
          window.location.hash = "#/auth";
        }}
      >
        <MenuItem icon={<Settings />} onSelect={() => (window.location.hash = "#/settings")}>
          Settings
        </MenuItem>
        <MenuItem icon={<Keyboard />} shortcut="?">
          Keyboard shortcuts
        </MenuItem>
      </AccountMenu>
    </>
  );
}

export const PAGES = [
  { href: "#/components", label: "Components" },
  { href: "#/app", label: "App shell" },
  { href: "#/users", label: "Data table" },
  { href: "#/settings", label: "Settings" },
  { href: "#/auth", label: "Sign in" },
];
