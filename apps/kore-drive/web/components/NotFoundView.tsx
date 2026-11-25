import { Button } from "@qarasky/kore-ui";
import Link from "next/link";
import { t } from "@/lib/i18n";

/** "Not found" body shared by the in-shell and root 404 pages. */
export function NotFoundView() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <section className="w-full max-w-[380px] text-center">
        <p aria-hidden="true" className="mb-2 font-mono text-meta text-muted">
          404
        </p>
        <h1 className="text-title font-semibold tracking-[-0.01em]">{t("notFound.title")}</h1>
        <p className="mt-1.5 mb-5 text-muted">{t("notFound.description")}</p>
        <Button variant="primary" asChild>
          <Link href="/files">{t("notFound.back")}</Link>
        </Button>
      </section>
    </div>
  );
}
