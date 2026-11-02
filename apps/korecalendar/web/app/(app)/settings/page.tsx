import { GeneralForm } from "@/components/settings/GeneralForm";
import { t } from "@/lib/i18n";

export const metadata = { title: t("settings.general") };

export default function GeneralSettingsPage() {
  return <GeneralForm />;
}
