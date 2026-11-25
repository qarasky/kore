import { KORE_THEME_COLOR, themeInitScript } from "@qarasky/kore-ui";
import type { Metadata, Viewport } from "next";
import { activeLocale, t } from "@/lib/i18n";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: { default: t("app.name"), template: t("app.titleTemplate") },
  description: t("app.description"),
  robots: { index: false, follow: false },
};

// The browser chrome follows the page background; kore-ui's ThemeProvider keeps this tag in step with the theme.
export const viewport: Viewport = { themeColor: KORE_THEME_COLOR };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the init script sets data-theme before React hydrates.
    <html lang={activeLocale()} className="h-full" suppressHydrationWarning>
      <head>
        {/* Sets data-theme from the stored choice before the first paint (no flash). A static string from kore-ui. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript() }} />
      </head>
      <body className="min-h-full bg-bg text-text">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
