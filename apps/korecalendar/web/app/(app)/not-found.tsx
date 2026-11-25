import { Button, EmptyState } from "@qarasky/kore-ui";
import Link from "next/link";
import { t } from "@/lib/i18n";

export default function NotFound() {
  return (
    <EmptyState
      className="h-full"
      title={<span role="heading" aria-level={1}>{t("notFound.title")}</span>}
      description={t("notFound.body")}
      action={
        <Button asChild variant="primary">
          <Link href="/">{t("notFound.home")}</Link>
        </Button>
      }
    />
  );
}
