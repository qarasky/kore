import { redirect } from "next/navigation";
import { AuthCard } from "@/components/AuthCard";
import { AuthForm } from "@/components/AuthForm";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { safeNext } from "@/lib/safe-next";
import type { AuthConfig } from "@/lib/types";

export const metadata = { title: t("auth.createAccount") };

export default async function SetupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  // Setup is a one-time door: once an account exists it leads to sign-in.
  const config = await api<AuthConfig>("/api/auth/config");
  if (!config.password_login) {
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  const status = await api<{ setup_required: boolean }>("/api/setup");
  if (!status.setup_required) {
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  return (
    <AuthCard title={t("auth.createAccount")} intro={t("auth.setupIntro")}>
      <AuthForm mode="setup" next={next} />
    </AuthCard>
  );
}
