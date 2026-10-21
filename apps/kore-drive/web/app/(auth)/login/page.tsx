import type { Metadata } from "next";
import { Wordmark } from "@/components/wordmark";
import { t } from "@/lib/i18n";
import { safeNext } from "@/lib/safe-next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: t("login.title") };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const expired = params.expired !== undefined;

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-[360px]">
        <div className="mb-6 flex justify-center text-[22px]">
          <Wordmark />
        </div>
        <section className="rounded-ui border border-border bg-surface p-6 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset,0_12px_32px_-12px_rgba(0,0,0,0.6)]">
          <h1 className="text-[15px] font-semibold tracking-[-0.01em]">{t("login.title")}</h1>
          <p className="mt-1 mb-5 text-muted">{t("login.subtitle")}</p>
          <LoginForm next={next} expired={expired} />
        </section>
      </div>
    </main>
  );
}
