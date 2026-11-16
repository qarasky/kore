import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { activeLocale, t } from "@/lib/i18n";
import { KORE_THEME_COLOR } from "@qarasky/kore-ui";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: t("app.name"), template: t("app.titleTemplate") },
  description: t("app.description"),
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: t("app.name"), statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { themeColor: KORE_THEME_COLOR, colorScheme: "dark" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={activeLocale()} className="h-full">
      <body className="h-full bg-bg text-text">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
