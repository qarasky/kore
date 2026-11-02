"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n";

const inputClass =
  "min-h-control w-full rounded-ui border border-border bg-bg/60 px-3 text-text outline-none transition-colors " +
  "placeholder:text-muted hover:border-border-strong focus:border-accent focus:ring-2 focus:ring-accent/25";

/** Email + password form for sign-in (`POST /api/login`) and first-run
 *  account creation (`POST /api/setup`). On success the API has set the
 *  session cookie; we go to `next`. */
export function AuthForm({ mode, next, expired = false }: { mode: "login" | "setup"; next: string; expired?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(mode === "login" ? "/api/login" : "/api/setup", { method: "POST", body: JSON.stringify({ email, password }) });
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {expired && !error ? (
        <p role="status" className="rounded-ui border border-warning/40 bg-warning/10 px-3 py-2 text-sub text-warning">
          {t("auth.expired")}
        </p>
      ) : null}
      <label className="flex flex-col gap-1.5 text-sub">
        <span className="text-muted">{t("auth.email")}</span>
        <input
          type="email"
          name="email"
          autoComplete="username"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sub">
        <span className="text-muted">{t("auth.password")}</span>
        <input
          type="password"
          name="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          required
          minLength={mode === "setup" ? 8 : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
        {mode === "setup" ? <span className="text-meta text-muted">{t("auth.passwordHint")}</span> : null}
      </label>
      {error ? (
        <p role="alert" className="text-sub text-danger">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy || !email || !password}
        className="min-h-control rounded-ui bg-accent px-4 font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60 disabled:hover:bg-accent"
      >
        {busy ? t(mode === "login" ? "auth.signingIn" : "auth.creating") : t(mode === "login" ? "auth.signIn" : "auth.createAccount")}
      </button>
    </form>
  );
}
