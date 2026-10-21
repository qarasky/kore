import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import { FilesPlaceholder } from "./placeholder";

export const metadata: Metadata = { title: t("files.title") };

export default async function FilesPage() {
  const user = await requireUser();
  return <FilesPlaceholder user={user} />;
}
