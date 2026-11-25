import { EmptyState, Wordmark } from "@qarasky/kore-ui";
import { Link2Off } from "lucide-react";
import type { ReactNode } from "react";
import { t, type MessageKey } from "@/lib/i18n";
import type { PublicProblem } from "@/lib/shares";

/** The public share page frame: wordmark on top, a centred card. */
export function PublicShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-10">
      <header className="mb-8 text-brand">
        <Wordmark app="kore" />
      </header>
      <main
        className={
          "w-full overflow-hidden rounded-overlay border border-border bg-surface shadow-card " +
          (wide ? "max-w-[960px]" : "max-w-[440px]")
        }
      >
        {children}
      </main>
      <p className="mt-6 text-meta text-muted">{t("publicShare.footer")}</p>
    </div>
  );
}

const PROBLEMS: Record<PublicProblem, [MessageKey, MessageKey]> = {
  gone: ["publicShare.goneTitle", "publicShare.gone"],
  expired: ["publicShare.expiredTitle", "publicShare.expiredBody"],
  revoked: ["publicShare.revokedTitle", "publicShare.revokedBody"],
  disabled: ["publicShare.goneTitle", "publicShare.disabled"],
  rateLimited: ["publicShare.rateLimitedTitle", "publicShare.rateLimited"],
  error: ["publicShare.errorTitle", "publicShare.error"],
};

/** A friendly dead end that says nothing about the shared item. */
export function ShareProblem({ problem }: { problem: PublicProblem }) {
  const [title, body] = PROBLEMS[problem];
  return (
    <div data-testid="share-problem" data-problem={problem}>
      <EmptyState icon={<Link2Off />} title={<span role="heading" aria-level={1}>{t(title)}</span>} description={t(body)} />
    </div>
  );
}
