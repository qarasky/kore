import { Wordmark } from "@/components/wordmark";
import { t } from "@/lib/i18n";
import type { User } from "@/lib/session";

/** Temporary landing view until the file browser (Task 13) replaces it. */
export function FilesPlaceholder({ user, folder }: { user: User; folder?: string }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-12 items-center justify-between border-b border-border px-4">
        <Wordmark className="text-[15px]" />
        <span data-testid="current-user" className="text-muted">
          {t("files.signedInAs", { email: user.email })}
        </span>
      </header>
      <main className="flex-1 p-4">
        <div className="rounded-ui border border-border bg-surface p-4">
          <h1 className="text-[15px] font-semibold">{t("files.title")}</h1>
          {folder !== undefined && (
            <p data-testid="current-folder" className="mt-1">
              {t("files.folder", { name: folder })}
            </p>
          )}
          <p className="mt-1 text-muted">{t("files.placeholder")}</p>
        </div>
      </main>
    </div>
  );
}
