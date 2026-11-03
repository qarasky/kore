"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { Button } from "../components/Button";
import { Field } from "../components/Field";
import { Input } from "../components/Input";
import { PasswordInput, type PasswordRule } from "../components/PasswordInput";
import { type AppNames, type ProductId } from "./apps";
import { AppMark, Wordmark } from "./AppMark";

export type PasswordSignIn = {
  /** Called with the form values. Throw or reject to stay on the form; show why via `error`. */
  onSubmit: (values: { email: string; password: string }) => Promise<void> | void;
  /** Mark both fields invalid (wrong email or password). */
  invalid?: boolean;
  defaultEmail?: string;
  /** Show the email but don't let it be edited (a setup link for a known account). */
  emailReadOnly?: boolean;
  /** Requirements, shown as a live checklist under the password in `set-password` mode. */
  rules?: PasswordRule[];
  /** Under the password field, e.g. "Forgot it? Ask your admin for a reset link." */
  hint?: ReactNode;
  labels?: Partial<{ email: string; password: string; submit: string; pending: string; show: string; hide: string }>;
};

export type KoreIdSignIn = {
  /** A plain link to the app's "start Kore ID login" route (preferred: the redirect dance stays server-side). */
  href?: string;
  /** Or a handler (e.g. a PKCE start in the browser). */
  onClick?: () => void | Promise<void>;
  /** Default "Continue with Kore ID". */
  label?: string;
  /** Show progress (e.g. while returning from Kore ID). */
  pending?: boolean;
};

export type AuthScreenProps = {
  /** Whose wordmark sits above the card. Default "kore-id". */
  app?: ProductId;
  names?: AppNames;
  /** Card title. Default "Sign in". */
  title?: ReactNode;
  /** One line under the title. */
  description?: ReactNode;
  /** The "Continue with Kore ID" button. */
  sso?: KoreIdSignIn;
  /** The optional email + password form. */
  password?: PasswordSignIn;
  /**
   * `sign-in` (default): the password is the current one (`autoComplete="current-password"`).
   * `set-password`: first account, setup link or reset: a new password (`new-password`, so browsers
   * offer to generate and save it), "Set password" defaults and the `rules` checklist.
   */
  mode?: "sign-in" | "set-password";
  /** Error slot: what went wrong and what to do (announced). */
  error?: ReactNode;
  /** Neutral notice slot, e.g. "Your session expired. Sign in again." */
  notice?: ReactNode;
  /** Divider text between Kore ID and the password form. Default "or". */
  dividerLabel?: string;
  /** Custom card content (set-password form, "no access" message, logout confirmation), after the built-in parts. */
  children?: ReactNode;
  /** Under the card (links like "Change server"). */
  footer?: ReactNode;
  /** Decorative right half from 900px up (art or a picture). */
  aside?: ReactNode;
  className?: string;
};

/**
 * The sign-in card every Kore app shares: wordmark, title, "Continue with Kore ID",
 * an optional password form, and an error slot. Also hosts other auth screens via `children`.
 */
export function AuthScreen({
  app = "kore-id",
  names,
  mode = "sign-in",
  title = mode === "set-password" ? "Set your password" : "Sign in",
  description,
  sso,
  password,
  error,
  notice,
  dividerLabel = "or",
  children,
  footer,
  aside,
  className,
}: AuthScreenProps) {
  const messageId = useId();
  const hasError = error != null && error !== false && error !== "";
  const hasNotice = !hasError && notice != null && notice !== false && notice !== "";

  return (
    <div className={cn("flex min-h-dvh bg-bg", className)}>
      <main className="flex min-w-0 flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-[380px]">
          <div className="mb-6 flex justify-center text-display">
            <Wordmark app={app} names={names} />
          </div>
          <section
            aria-labelledby={`${messageId}-title`}
            className="rounded-ui border border-border bg-surface p-6 shadow-card"
          >
            <h1 id={`${messageId}-title`} className="text-title font-semibold tracking-[-0.01em]">
              {title}
            </h1>
            {description ? <p className="mt-1 text-muted">{description}</p> : null}

            <div className="mt-5 flex flex-col gap-4">
              {hasNotice ? <p className="text-meta text-muted">{notice}</p> : null}
              <p id={messageId} role="alert" className="text-meta text-danger empty:hidden">
                {hasError ? error : null}
              </p>

              {sso ? <SsoButton sso={sso} primary /> : null}

              {sso && password ? (
                <div className="flex items-center gap-3 text-meta text-muted" aria-hidden="true">
                  <span className="h-px flex-1 bg-border" />
                  {dividerLabel}
                  <span className="h-px flex-1 bg-border" />
                </div>
              ) : null}

              {password ? (
                <PasswordForm
                  password={password}
                  mode={mode}
                  primary={!sso}
                  describedBy={hasError ? messageId : undefined}
                />
              ) : null}

              {children}
            </div>
          </section>
          {footer ? <div className="mt-4 text-center text-meta text-muted">{footer}</div> : null}
        </div>
      </main>
      {aside ? (
        <div aria-hidden="true" className="relative hidden w-1/2 shrink-0 overflow-hidden border-l border-border min-[900px]:block">
          {aside}
        </div>
      ) : null}
    </div>
  );
}

function SsoButton({ sso, primary }: { sso: KoreIdSignIn; primary: boolean }) {
  const [busy, setBusy] = useState(false);
  const label = sso.label ?? "Continue with Kore ID";
  const pending = sso.pending || busy;
  const content = (
    <>
      <AppMark app="kore-id" size={16} className={primary ? "text-white" : undefined} />
      {label}
    </>
  );
  if (sso.href && !sso.onClick) {
    return (
      <Button asChild variant={primary ? "primary" : "secondary"} fullWidth loading={pending}>
        <a href={sso.href} aria-disabled={pending || undefined}>
          {content}
        </a>
      </Button>
    );
  }
  return (
    <Button
      variant={primary ? "primary" : "secondary"}
      fullWidth
      loading={pending}
      onClick={async () => {
        setBusy(true);
        try {
          await sso.onClick?.();
        } finally {
          setBusy(false);
        }
      }}
    >
      {pending ? label : content}
    </Button>
  );
}

function PasswordForm({
  password,
  mode,
  primary,
  describedBy,
}: {
  password: PasswordSignIn;
  mode: "sign-in" | "set-password";
  primary: boolean;
  describedBy?: string;
}) {
  const [pending, setPending] = useState(false);
  const setting = mode === "set-password";
  const l = {
    email: "Email",
    password: setting ? "New password" : "Password",
    submit: setting ? "Set password" : "Sign in",
    pending: setting ? "Saving…" : "Signing in…",
    show: "Show password",
    hide: "Hide password",
    ...password.labels,
  };

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    setPending(true);
    try {
      await password.onSubmit({ email: String(data.get("email") ?? ""), password: String(data.get("password") ?? "") });
    } catch {
      // The app shows why through `error`.
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate={false}>
      <Field label={l.email}>
        <Input
          name="email"
          type="email"
          autoComplete="username"
          defaultValue={password.defaultEmail}
          readOnly={password.emailReadOnly}
          required
          aria-invalid={password.invalid || undefined}
          aria-describedby={describedBy}
        />
      </Field>
      <Field label={l.password} hint={password.hint}>
        <PasswordInput
          name="password"
          newPassword={setting}
          rules={setting ? password.rules : undefined}
          showLabel={l.show}
          hideLabel={l.hide}
          required
          aria-invalid={password.invalid || undefined}
          aria-describedby={describedBy}
        />
      </Field>
      <Button type="submit" variant={primary ? "primary" : "secondary"} fullWidth loading={pending}>
        {pending ? l.pending : l.submit}
      </Button>
    </form>
  );
}
