"use client";

import Link from "next/link";
import { KoreProvider } from "@qarasky/kore-ui";
import { t } from "@/lib/i18n";

/** kore-ui setup: Next's Link for internal links, the tooltip group and the toast region. */
export function Providers({ children }: { children: React.ReactNode }) {
  return <KoreProvider linkComponent={Link} toast={{ dismissLabel: t("toast.dismiss") }}>{children}</KoreProvider>;
}
