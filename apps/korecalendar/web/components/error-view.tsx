"use client";

import { AuthScreen, Button } from "@qarasky/kore-ui";
import { API_UNREACHABLE_DIGEST } from "@/lib/api";
import { t } from "@/lib/i18n";

/** Full-page error on kore-ui's centred card: "can't reach the server" when the API is down, else generic. */
export function ErrorView({ error, retry }: { error: unknown; retry: () => void }) {
  const unreachable = (error as { digest?: string } | null)?.digest === API_UNREACHABLE_DIGEST;
  return (
    <AuthScreen
      app="korecalendar"
      title={t(unreachable ? "errorPage.unreachableTitle" : "errorPage.genericTitle")}
      description={t(unreachable ? "errorPage.unreachableBody" : "errorPage.genericBody")}
    >
      <Button variant="primary" fullWidth onClick={retry}>
        {t("common.retry")}
      </Button>
    </AuthScreen>
  );
}
