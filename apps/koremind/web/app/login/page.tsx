"use client";
import { AuthScreen, minLengthRule, Spinner } from "@qarasky/kore-ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { beginSso, parseSsoHash, ssoErrorMessage, takeVerifier } from "@/lib/sso";
import { t } from "@/lib/strings";

/** Sign-in (and first-account setup): kore-ui's AuthScreen, "Continue with Kore ID" first when the server has it. */
export default function LoginPage() {
  const { api, user, signedIn, ready, server } = useSession();
  const router = useRouter();
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [exchanging, setExchanging] = useState(false);

  useEffect(() => { if (ready && user) router.replace("/"); }, [ready, user, router]);
  // The session loads /health; this only surfaces why it failed.
  useEffect(() => { api?.health().catch((e) => setError(e instanceof Error ? e.message : t.genericError)); }, [api]);

  // Back from Kore ID: the backend put a one-time ticket (or an error) after the #.
  useEffect(() => {
    if (!api) return;
    const back = parseSsoHash(location.hash);
    if (!back) return;
    history.replaceState(null, "", location.pathname);
    if (back.error) { setError(ssoErrorMessage(back.error)); return; }
    const verifier = takeVerifier();
    if (!back.ticket || !verifier) { setError(ssoErrorMessage("invalid_state")); return; }
    setExchanging(true);
    api.ssoExchange(back.ticket, verifier).then((r) => { signedIn(r); router.replace("/"); }).catch((err) => { setError(err instanceof Error ? err.message : t.genericError); setExchanging(false); });
  }, [api, signedIn, router]);

  const setup = !!server?.setupRequired;
  const passwordLogin = server?.passwordLogin !== false;

  async function startSso() {
    if (!api) return;
    setError("");
    try { await beginSso(api, "/login"); await new Promise(() => {}); /* stay pending while the browser leaves */ }
    catch (err) { setError(err instanceof Error ? err.message : t.genericError); }
  }

  async function submit({ email, password }: { email: string; password: string }) {
    if (!api) return;
    setError("");
    setInvalid(false);
    try {
      const r = setup ? await api.register({ email, password }) : await api.login({ email, password });
      signedIn(r);
      router.replace("/");
    } catch (err) {
      if (err instanceof ApiError && err.code === "rate_limited") setError(t.tooManyAttempts(err.retryAfterSec ?? 60));
      else if (err instanceof ApiError && err.code === "bad_credentials") { setError(t.wrongPassword); setInvalid(true); }
      else setError(err instanceof Error ? err.message : t.genericError);
      throw err;
    }
  }

  return (
    <AuthScreen
      app="koremind"
      mode={setup ? "set-password" : "sign-in"}
      title={setup ? t.createAccountTitle : t.loginTitle}
      description={setup ? t.createAccountHint : server?.sso && !passwordLogin ? t.koreIdOnly : undefined}
      error={error}
      sso={server?.sso ? { onClick: startSso, pending: exchanging, label: t.continueKoreId } : undefined}
      password={server && passwordLogin ? {
        onSubmit: submit, invalid,
        rules: setup ? [minLengthRule(8, t.passwordHint)] : undefined,
        labels: setup
          ? { email: t.email, password: t.newPassword, submit: t.setPassword, pending: t.autoSaving }
          : { email: t.email, password: t.password, submit: t.signIn, pending: t.signingIn },
      } : undefined}
      dividerLabel={t.or}
      footer={<Link href="/connect" className="rounded-ui hover:text-text">{t.changeServer}</Link>}
    >
      {!server && !error ? <div className="flex justify-center py-2 text-muted"><Spinner label={t.loading} /></div> : null}
    </AuthScreen>
  );
}
