"use client";

import { API_UNREACHABLE_DIGEST } from "@/lib/api";
import { t } from "@/lib/i18n";
import { Wordmark } from "./wordmark";

/** Full-page error: "can't reach the server" when the API is down, else generic. */
export function ErrorView({ error, retry }: { error: unknown; retry: () => void }) {
  const unreachable = (error as { digest?: string } | null)?.digest === API_UNREACHABLE_DIGEST;
  return (
    <main className="grid min-h-full place-items-center p-6">
      <div className="w-full max-w-sm rounded-ui border border-border bg-surface p-6 text-center">
        <Wordmark className="mb-5 text-brand" />
        <h1 className="text-title font-semibold">{t(unreachable ? "errorPage.unreachableTitle" : "errorPage.genericTitle")}</h1>
        <p className="mt-2 text-sub text-muted">{t(unreachable ? "errorPage.unreachableBody" : "errorPage.genericBody")}</p>
        <button
          type="button"
          onClick={retry}
          className="mt-5 min-h-control rounded-ui bg-accent px-4 font-medium text-white hover:bg-accent-hover"
        >
          {t("common.retry")}
        </button>
      </div>
    </main>
  );
}
