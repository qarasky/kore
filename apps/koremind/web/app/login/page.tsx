"use client";
import { AuthScreen, Spinner } from "@qarasky/kore-ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { beginSso, parseSsoHash, ssoErrorMessage, takeVerifier } from "@/lib/sso";
import { t } from "@/lib/strings";

/** Sign-in: Kore ID is the only way in. No password form, no first-account setup. */
export default function LoginPage() {
  const { api, user, ready, server, signedIn } = useSession();
  const router = useRouter();
  const [error, setError] = useState("");
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

  async function startSso() {
    if (!api || !server) return;
    setError("");
    if (!server.sso) { setError(t.koreIdUnavailable); return; }
    try { await beginSso(api, "/login"); await new Promise(() => {}); /* stay pending while the browser leaves */ }
    catch (err) { setError(err instanceof Error ? err.message : t.genericError); }
  }

  return (
    <AuthScreen
      app="koremind"
      title={t.loginTitle}
      description={server ? (server.sso ? t.koreIdOnly : t.koreIdUnavailable) : undefined}
      error={error}
      sso={{ onClick: startSso, pending: exchanging, label: t.continueKoreId }}
      footer={<Link href="/connect" className="rounded-ui hover:text-text">{t.changeServer}</Link>}
    >
      {!server && !error ? <div className="flex justify-center py-2 text-muted"><Spinner label={t.loading} /></div> : null}
    </AuthScreen>
  );
}
