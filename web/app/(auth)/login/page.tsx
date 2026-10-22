import type { Metadata } from "next";
import { LoginArt } from "@/components/LoginArt";
import { Wordmark } from "@/components/wordmark";
import { api } from "@/lib/api";
import { loginImageSrc, type Branding } from "@/lib/branding";
import { t } from "@/lib/i18n";
import { safeNext } from "@/lib/safe-next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: t("login.title") };

/** The login picture setting; any failure falls back to the built-in art
 *  (the form must work even when this lookup doesn't). */
async function branding(): Promise<Branding | null> {
  try {
    return await api<Branding>("/api/branding", { signal: AbortSignal.timeout(3000) });
  } catch {
    return null;
  }
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const expired = params.expired !== undefined;
  const custom = loginImageSrc(await branding());

  return (
    <div className="flex min-h-dvh">
      <main className="flex min-w-0 flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-[380px]">
          <div className="mb-6 flex justify-center text-display">
            <Wordmark />
          </div>
          <section className="rounded-ui border border-border bg-surface p-6 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset,0_12px_32px_-12px_rgba(0,0,0,0.6)]">
            <h1 className="text-title font-semibold tracking-[-0.01em]">{t("login.title")}</h1>
            <p className="mt-1 mb-5 text-muted">{t("login.subtitle")}</p>
            <LoginForm next={next} expired={expired} />
          </section>
        </div>
      </main>
      {/* Decorative: hidden below 900px, so small screens get just the form. */}
      <div
        data-testid="login-picture"
        className="relative hidden w-1/2 shrink-0 overflow-hidden border-l border-border bg-[#111522] min-[900px]:block"
      >
        {custom ? (
          // eslint-disable-next-line @next/next/no-img-element -- served by the API, not next/image
          <img
            src={custom}
            alt=""
            data-testid="login-picture-custom"
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <LoginArt className="absolute inset-0 size-full" />
        )}
      </div>
    </div>
  );
}
