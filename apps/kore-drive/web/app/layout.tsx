import type { Metadata } from "next";
import { activeLocale, t } from "@/lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: t("app.name"), template: t("app.titleTemplate") },
  description: t("app.description"),
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang={activeLocale()} className="h-full">
      <body className="min-h-full bg-bg text-text">{children}</body>
    </html>
  );
}
