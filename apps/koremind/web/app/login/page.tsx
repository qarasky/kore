"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Wordmark } from "@/components/Mark";
import { Button, ErrorText, Field } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { t } from "@/lib/strings";

export default function LoginPage() {
  const { api, user, signedIn, ready } = useSession();
  const router = useRouter();
  const [setup, setSetup] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (ready && user) router.replace("/"); }, [ready, user, router]);
  useEffect(() => {
    api?.health().then((h) => setSetup(h.setupRequired)).catch((e) => setError(e instanceof Error ? e.message : t.genericError));
  }, [api]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!api) return;
    setError("");
    setBusy(true);
    try {
      const r = setup ? await api.register({ email, password }) : await api.login({ email, password });
      signedIn(r);
      router.replace("/");
    } catch (err) {
      if (err instanceof ApiError && err.code === "rate_limited") setError(t.tooManyAttempts(err.retryAfterSec ?? 60));
      else setError(err instanceof Error ? err.message : t.genericError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <Wordmark />
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <h1 className="text-display font-semibold tracking-[-0.02em]">{setup ? t.createAccountTitle : t.loginTitle}</h1>
          {setup && <p className="mt-1 text-meta text-muted">{t.createAccountHint}</p>}
        </div>
        <Field label={t.email} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus />
        <Field label={t.password} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={setup ? "new-password" : "current-password"} hint={setup ? t.passwordHint : undefined} required minLength={8} />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={busy || setup === null}>{setup ? t.createAccount : t.signIn}</Button>
      </form>
      <Link href="/connect" className="text-meta text-muted hover:text-text">{t.changeServer}</Link>
    </main>
  );
}
