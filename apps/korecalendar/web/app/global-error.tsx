"use client";

import { ErrorView } from "@/components/error-view";
import "./globals.css";

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full bg-bg text-text">
        <ErrorView error={error} retry={retry} />
      </body>
    </html>
  );
}
