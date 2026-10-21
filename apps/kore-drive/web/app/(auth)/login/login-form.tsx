"use client";

import { useState, type FormEvent } from "react";
import { api, isApiError } from "@/lib/api";
import { t, type MessageKey } from "@/lib/i18n";

function errorKey(e: unknown): MessageKey {
  if (isApiError(e, 401)) return "login.error.invalid";
  if (isApiError(e, 429)) return "login.error.rateLimited";
  if (isApiError(e, 503) && e.code === "busy") return "login.error.busy";
  // 503 from api() itself; 502/504 from Caddy or the dev rewrite when the API is down.
  if (isApiError(e) && [502, 503, 504].includes(e.status)) return "login.error.unreachable";
  return "login.error.generic";
}

const inputClass =
  "block w-full rounded-ui border border-border bg-raised px-3 py-2 text-text " +
  "placeholder:text-muted outline-none transition-colors " +
  "hover:border-border-strong focus:border-accent focus:ring-2 focus:ring-accent/25 " +
  "aria-invalid:border-danger/70";

export function LoginForm({ next, expired }: { next: string; expired: boolean }) {
  const [error, setError] = useState<MessageKey | null>(expired ? "login.expired" : null);
  const [pending, setPending] = useState(false);
  const failed = error !== null && error !== "login.expired";

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: data.get("email"), password: data.get("password") }),
      });
      // Full navigation so the destination renders on the server with the new cookie.
      window.location.assign(next);
    } catch (err) {
      setError(errorKey(err));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-[12px] font-medium text-muted">
          {t("login.email")}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          autoFocus
          required
          aria-invalid={failed || undefined}
          className={inputClass}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-[12px] font-medium text-muted">
          {t("login.password")}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={failed || undefined}
          className={inputClass}
        />
      </div>

      <p
        role="alert"
        data-testid="login-error"
        aria-live="polite"
        className={`min-h-[1.45em] text-[12px] ${failed ? "text-danger" : "text-muted"}`}
      >
        {error ? t(error) : null}
      </p>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-ui bg-accent px-3 py-2 font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? t("login.submitting") : t("login.submit")}
      </button>
    </form>
  );
}
