"use client";

import { ErrorView } from "@/components/error-view";
import { activeLocale, t } from "@/lib/i18n";
import "./globals.css";

// Replaces the root layout when it fails, so it brings its own <html>, styles
// and title.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang={activeLocale()} className="h-full">
      <body className="min-h-full bg-bg text-text">
        <title>{t("app.name")}</title>
        <ErrorView error={error} retry={retry} />
      </body>
    </html>
  );
}
