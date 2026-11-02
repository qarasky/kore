import type { ReactNode } from "react";
import { Wordmark } from "./wordmark";

/** The centred panel the sign-in and first-run pages share. */
export function AuthCard({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <main className="grid min-h-full place-items-center p-6">
      <div className="w-full max-w-sm">
        <Wordmark className="mb-6 text-brand" />
        <div className="rounded-ui border border-border bg-surface p-6">
          <h1 className="text-title font-semibold">{title}</h1>
          {intro ? <p className="mt-1 text-sub text-muted">{intro}</p> : null}
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </main>
  );
}
