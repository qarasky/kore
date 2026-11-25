import { AuthScreen, Button } from "@qarasky/kore-ui";
import Link from "next/link";
import { t } from "@/lib/i18n";

export default function NotFound() {
  return (
    <AuthScreen app="korecalendar" title={t("notFound.title")} description={t("notFound.body")}>
      <Button asChild variant="primary" fullWidth>
        <Link href="/">{t("notFound.home")}</Link>
      </Button>
    </AuthScreen>
  );
}
