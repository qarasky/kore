import { NotificationsPanel } from "@/components/settings/NotificationsPanel";
import { t } from "@/lib/i18n";

export const metadata = { title: t("settings.notifications") };

export default function NotificationsPage() {
  return <NotificationsPanel />;
}
