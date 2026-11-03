"use client";

import { Button, Wordmark } from "@qarasky/kore-ui";
import { API_UNREACHABLE_DIGEST } from "@/lib/api";
import { t } from "@/lib/i18n";

/** True if a Server Component failed because the Go API was unreachable. In
 *  production only `digest` survives the trip to the client (see lib/api.ts). */
export function isUnreachable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    error.digest === API_UNREACHABLE_DIGEST
  );
}

/** Styled error page shared by app/error.tsx and app/global-error.tsx. */
export function ErrorView({ error, retry }: { error: unknown; retry: () => void }) {
  const unreachable = isUnreachable(error);
  return (
    <main
      data-testid="error-page"
      data-error-kind={unreachable ? "unreachable" : "generic"}
      className="flex min-h-dvh items-center justify-center px-4 py-12"
    >
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex justify-center text-display">
          <Wordmark app="kore" />
        </div>
        <section
          role="alert"
          className="rounded-ui border border-border bg-surface p-6 text-center shadow-card"
        >
          <h1 className="text-title font-semibold tracking-[-0.01em]">
            {unreachable ? t("error.unreachableTitle") : t("error.title")}
          </h1>
          <p className="mt-1.5 mb-5 text-muted">
            {unreachable ? t("error.unreachable") : t("error.description")}
          </p>
          <Button variant="primary" onClick={() => retry()}>
            {t("error.retry")}
          </Button>
        </section>
      </div>
    </main>
  );
}
