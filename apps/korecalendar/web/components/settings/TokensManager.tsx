"use client";

import { AnimatePresence, m } from "motion/react";
import { duration, ease } from "@/lib/motion";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { useMutate } from "@/hooks/useMutate";
import { t } from "@/lib/i18n";
import { createToken, revokeToken } from "@/lib/mutations";
import type { Token } from "@/lib/types";
import { Button } from "../Button";
import { ConfirmDialog } from "../ConfirmDialog";
import { CopyButton } from "../CopyButton";
import { Field, inputClass } from "../Field";
import { KeyRoundIcon } from "../icons";
import { useShell } from "../ShellContext";
import { SettingsSection } from "./Section";

const date = (unix: number) => new Date(unix * 1000).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" });

/** Personal access tokens for agents and scripts: the secret is shown once, on creation. */
export function TokensManager({ initial }: { initial: Token[] }) {
  const { me } = useShell();
  // The address this page was opened from (empty on the server and until hydrated).
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
  const { run, pending } = useMutate();
  const [name, setName] = useState("");
  const [revealed, setRevealed] = useState<{ name: string; token: string } | null>(null);
  const [revoking, setRevoking] = useState<Token | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (name.trim() === "") return;
    const made = await run(() => createToken(name.trim()));
    if (made) {
      setRevealed({ name: made.name, token: made.token });
      setName("");
    }
  }

  return (
    <SettingsSection title={t("tokens.heading")} description={t("tokens.intro")}>
      {revealed ? (
        <div role="status" data-testid="token-reveal" className="mb-5 rounded-ui border border-accent/50 bg-accent/10 p-4">
          <h3 className="text-sub font-semibold">{t("tokens.revealTitle")}</h3>
          <p className="mt-1 text-sub text-muted">{t("tokens.revealBody")}</p>
          <div className="mt-3 flex items-center gap-2">
            <code data-testid="token-secret" className="min-w-0 flex-1 rounded-ui border border-border bg-bg/60 px-3 py-2 font-mono text-meta break-all select-all">
              {revealed.token}
            </code>
            <CopyButton value={revealed.token} />
          </div>
          <p className="mt-2 text-meta text-muted">{t("tokens.usage")}</p>
          <Button small className="mt-3" onClick={() => setRevealed(null)}>
            {t("tokens.done")}
          </Button>
        </div>
      ) : null}

      <form onSubmit={create} className="flex items-end gap-2">
        <Field label={t("tokens.name")} htmlFor="token-name" className="flex-1">
          <input id="token-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("tokens.namePlaceholder")} maxLength={100} className={`${inputClass} w-full`} />
        </Field>
        <Button type="submit" variant="primary" disabled={pending || name.trim() === ""}>
          {t("tokens.create")}
        </Button>
      </form>

      <ul className="mt-5 flex flex-col gap-2" data-testid="token-list">
        {initial.length === 0 ? <li className="text-sub text-muted">{t("tokens.none")}</li> : null}
        <AnimatePresence initial={false}>
        {initial.map((tok) => (
          <m.li key={tok.id} layout="position"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0, transition: { duration: duration.enter, ease: ease.standard } }}
            exit={{ opacity: 0, transition: { duration: duration.exit, ease: ease.exit } }}
            data-testid="token-row" className="flex items-center gap-3 rounded-ui border border-border px-3 py-2">
            <KeyRoundIcon size={16} className="shrink-0 text-muted" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{tok.name}</div>
              <div className="text-meta text-muted">
                {t("tokens.created", { date: date(tok.created_at) })} · {tok.last_used_at ? t("tokens.lastUsed", { date: date(tok.last_used_at) }) : t("tokens.neverUsed")}
              </div>
            </div>
            <Button small variant="danger" aria-label={t("tokens.revokeLabel", { name: tok.name })} onClick={() => setRevoking(tok)}>
              {t("tokens.revoke")}
            </Button>
          </m.li>
        ))}
        </AnimatePresence>
      </ul>

      <AnimatePresence>
      {revoking ? (
        <ConfirmDialog
          danger
          title={t("tokens.revokeTitle")}
          message={t("tokens.revokeBody", { name: revoking.name })}
          confirmLabel={t("tokens.revoke")}
          onConfirm={async () => {
            const target = revoking;
            await run(() => revokeToken(target.id), { message: t("tokens.revoked") });
            setRevoking(null);
          }}
          onCancel={() => setRevoking(null)}
        />
      ) : null}
      </AnimatePresence>

      <div data-testid="caldav" className="mt-8 border-t border-border pt-5">
        <h3 className="text-sub font-semibold">{t("caldav.title")}</h3>
        <p className="mt-1 text-sub text-muted">{t("caldav.intro")}</p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sub">
          <dt className="text-muted">{t("caldav.address")}</dt>
          <dd className="flex items-center gap-2">
            <code className="min-w-0 rounded-ui border border-border bg-bg/60 px-3 py-1.5 font-mono text-meta break-all select-all">{origin}/dav/</code>
            <CopyButton value={`${origin}/dav/`} />
          </dd>
          <dt className="text-muted">{t("caldav.user")}</dt>
          <dd className="flex items-center gap-2">
            <code className="min-w-0 rounded-ui border border-border bg-bg/60 px-3 py-1.5 font-mono text-meta break-all select-all">{me.email}</code>
            <CopyButton value={me.email} />
          </dd>
        </dl>
        <p className="mt-3 text-meta text-muted">{t("caldav.passwordNote")}</p>
        <p className="mt-1 text-meta text-muted">{t("caldav.docs")}</p>
      </div>
    </SettingsSection>
  );
}
