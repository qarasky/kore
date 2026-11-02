import Link from "next/link";
import { t } from "@/lib/i18n";

export default function NotFound() {
  return (
    <div className="grid h-full place-items-center p-6 text-center">
      <div>
        <h1 className="text-title font-semibold">{t("notFound.title")}</h1>
        <p className="mt-2 text-sub text-muted">{t("notFound.body")}</p>
        <Link href="/" className="mt-4 inline-flex min-h-control items-center rounded-ui bg-accent px-4 font-medium text-white hover:bg-accent-hover">
          {t("notFound.home")}
        </Link>
      </div>
    </div>
  );
}
