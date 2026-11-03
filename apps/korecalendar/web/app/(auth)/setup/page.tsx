import { redirect } from "next/navigation";
import { t } from "@/lib/i18n";
import { safeNext } from "@/lib/safe-next";

export const metadata = { title: t("auth.signIn") };

/**
 * Kept only for old links and bookmarks: there is no first-run form any more.
 * A fresh install's first administrator signs in with Kore ID (the owner email
 * configured on the server).
 */
export default async function SetupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  redirect(`/login?next=${encodeURIComponent(safeNext(sp.next))}`);
}
