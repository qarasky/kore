import type { ReactNode } from "react";
import { t, type MessageKey } from "@/lib/i18n";
import type { PublicProblem } from "@/lib/shares";
import { Wordmark } from "../wordmark";

/** The public share page frame: wordmark on top, a centred card. */
export function PublicShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-10">
      <header className="mb-8 text-[18px]">
        <Wordmark />
      </header>
      <main
        className={
          "w-full rounded-[10px] border border-border bg-surface shadow-[0_8px_32px_rgba(0,0,0,0.25)] " +
          (wide ? "max-w-[960px]" : "max-w-[440px]")
        }
      >
        {children}
      </main>
      <p className="mt-6 text-[12px] text-muted">{t("publicShare.footer")}</p>
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
    <div data-testid="share-problem" data-problem={problem} className="flex flex-col items-center gap-2 px-8 py-12 text-center">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="mb-2 size-9 text-muted" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" strokeLinecap="round" />
        <path d="M4 4l16 16" strokeLinecap="round" />
      </svg>
      <h1 className="text-[16px] font-semibold">{t(title)}</h1>
      <p className="max-w-[340px] text-muted">{t(body)}</p>
    </div>
  );
}
