"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Wordmark } from "@/components/Mark";
import { Appear, Button, ErrorText, Field } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { beginSso, parseSsoHash, ssoErrorMessage, takeVerifier } from "@/lib/sso";
import { t } from "@/lib/strings";

export default function LoginPage() {
  const { api, user, signedIn, ready } = useSession();
  const router = useRouter();
  const [setup, setSetup] = useState<boolean | null>(null);
  const [sso, setSso] = useState(false);
  const [passwordLogin, setPasswordLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (ready && user) router.replace("/"); }, [ready, user, router]);
  useEffect(() => {
    api?.health().then((h) => { setSetup(h.setupRequired); setSso(!!h.sso); setPasswordLogin(h.passwordLogin !== false); }).catch((e) => setError(e instanceof Error ? e.message : t.genericError));
  }, [api]);

  // Back from Kore ID: the backend put a one-time ticket (or an error) after the #.
  useEffect(() => {
    if (!api) return;
    const back = parseSsoHash(location.hash);
    if (!back) return;
    history.replaceState(null, "", location.pathname);
    if (back.error) { setError(ssoErrorMessage(back.error)); return; }
    const verifier = takeVerifier();
    if (!back.ticket || !verifier) { setError(ssoErrorMessage("invalid_state")); return; }
    setBusy(true);
    api.ssoExchange(back.ticket, verifier).then((r) => { signedIn(r); router.replace("/"); }).catch((err) => { setError(err instanceof Error ? err.message : t.genericError); setBusy(false); });
  }, [api, signedIn, router]);

  async function startSso() {
    if (!api) return;
    setError("");
    setBusy(true);
    try { await beginSso(api, "/login"); }
    catch (err) { setError(err instanceof Error ? err.message : t.genericError); setBusy(false); }
  }

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
      <Appear><Wordmark /></Appear>
      <Appear delay={0.06}><div className="flex flex-col gap-4">
        {passwordLogin ? (
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
        ) : (
          <div>
            <h1 className="text-display font-semibold tracking-[-0.02em]">{t.loginTitle}</h1>
            <p className="mt-1 text-meta text-muted">{t.koreIdOnly}</p>
            <ErrorText>{error}</ErrorText>
          </div>
        )}
        {sso && (
          <>
            {passwordLogin && <p className="text-center text-meta text-muted">{t.or}</p>}
            <Button type="button" variant={passwordLogin ? "ghost" : "primary"} onClick={() => void startSso()} disabled={busy}>{t.continueKoreId}</Button>
          </>
        )}
      </div></Appear>
      <Link href="/connect" className="text-meta text-muted hover:text-text">{t.changeServer}</Link>
    </main>
  );
}
