import { redirect } from "next/navigation";
import { AuthCard } from "@/components/AuthCard";
import { AuthForm } from "@/components/AuthForm";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { safeNext } from "@/lib/safe-next";

export const metadata = { title: t("auth.signIn") };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  // A brand-new install has no account yet: send people to create one.
  const status = await api<{ setup_required: boolean }>("/api/setup");
  if (status.setup_required) {
    redirect(`/setup?next=${encodeURIComponent(next)}`);
  }
  return (
    <AuthCard title={t("auth.signIn")}>
      <AuthForm mode="login" next={next} expired={"expired" in sp} />
    </AuthCard>
  );
}
