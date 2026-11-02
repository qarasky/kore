import Link from "next/link";
import { t } from "@/lib/i18n";
import { Wordmark } from "@/components/wordmark";

export default function NotFound() {
  return (
    <main className="grid min-h-full place-items-center p-6">
      <div className="w-full max-w-sm rounded-ui border border-border bg-surface p-6 text-center">
        <Wordmark className="mb-5 text-brand" />
        <h1 className="text-title font-semibold">{t("notFound.title")}</h1>
        <p className="mt-2 text-sub text-muted">{t("notFound.body")}</p>
        <Link href="/" className="mt-5 inline-flex min-h-control items-center rounded-ui bg-accent px-4 font-medium text-white hover:bg-accent-hover">
          {t("notFound.home")}
        </Link>
      </div>
    </main>
  );
}
