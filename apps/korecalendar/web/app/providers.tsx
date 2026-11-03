"use client";

import { KoreProvider } from "@qarasky/kore-ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";

/** kore-ui's setup: Next's Link for internal links, tooltips and the toast region. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <KoreProvider linkComponent={Link} toast={{ dismissLabel: t("toast.dismiss") }}>
      {children}
    </KoreProvider>
  );
}
