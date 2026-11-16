import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { activeLocale, t } from "@/lib/i18n";
import { KORE_THEME_COLOR, themeInitScript } from "@qarasky/kore-ui";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: t("app.name"), template: t("app.titleTemplate") },
  description: t("app.description"),
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: t("app.name"), statusBarStyle: "black-translucent" },
};

// theme-color is the Color theme's; kore-ui's provider keeps the meta tag in step with the chosen theme. No colorScheme here: theme.css sets it per theme.
export const viewport: Viewport = { themeColor: KORE_THEME_COLOR };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={activeLocale()} className="h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript() }} />
      </head>
      <body className="h-full bg-bg text-text">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
