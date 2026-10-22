"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { t, type MessageKey } from "@/lib/i18n";
import { shareUrls, unlockErrorKey } from "@/lib/shares";
import { KeyIcon } from "../icons";
import { PasswordInput } from "./PasswordInput";

/**
 * Asks for a link's password. A correct one sets the unlock cookie (12 h,
 * this link only) and the page re-renders on the server with the content.
 */
export function PasswordGate({ token }: { token: string }) {
  const router = useRouter();
  const id = useId();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending || password === "") return;
    setPending(true);
    setError(null);
    try {
      await api(shareUrls(token).unlock, { method: "POST", body: JSON.stringify({ password }) });
      router.refresh();
    } catch (err) {
      setError(unlockErrorKey(err));
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 px-8 py-10" data-testid="password-gate">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex size-10 items-center justify-center rounded-full bg-accent/15 text-accent">
          <KeyIcon className="size-5" />
        </span>
        <h1 className="text-heading font-semibold">{t("publicShare.passwordTitle")}</h1>
        <p className="text-muted">{t("publicShare.passwordBody")}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-pw`} className="font-medium">
          {t("publicShare.passwordLabel")}
        </label>
        <PasswordInput
          id={`${id}-pw`}
          value={password}
          onChange={setPassword}
          autoFocus
          autoComplete="off"
          invalid={!!error}
          describedBy={error ? `${id}-err` : undefined}
        />
        {error && (
          <p id={`${id}-err`} role="alert" className="text-meta text-danger">
            {t(error)}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={pending || password === ""}
        aria-busy={pending || undefined}
        className="rounded-ui bg-accent px-3.5 py-2 font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? t("publicShare.unlocking") : t("publicShare.unlock")}
      </button>
    </form>
  );
}
