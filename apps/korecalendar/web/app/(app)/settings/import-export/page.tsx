import { ImportExport } from "@/components/settings/ImportExport";
import { t } from "@/lib/i18n";

export const metadata = { title: t("settings.importExport") };

export default function ImportExportPage() {
  return <ImportExport />;
}
