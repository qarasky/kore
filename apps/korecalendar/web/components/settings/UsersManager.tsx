"use client";

import { useState, type FormEvent } from "react";
import { useMutate } from "@/hooks/useMutate";
import { t } from "@/lib/i18n";
import { createUser } from "@/lib/mutations";
import { generatePassword } from "@/lib/password";
import { Button, CopyButton, Field, Input, Select, SettingsSection } from "@qarasky/kore-ui";

/** Admin only: add a person with a generated password, shown once. */
export function UsersManager() {
  const { run, pending } = useMutate();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [made, setMade] = useState<{ email: string; password: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const password = generatePassword();
    const user = await run(() => createUser(email.trim(), password, role), { message: t("users.created") });
    if (user) {
      setMade({ email: user.email, password });
      setEmail("");
    }
  }

  return (
    <SettingsSection title={t("users.heading")} description={t("users.intro")}>
      {made ? (
        <div role="status" data-testid="user-reveal" className="rounded-ui border border-accent/50 bg-accent/10 p-4">
          <h3 className="text-sub font-semibold">{t("users.revealTitle")}</h3>
          <p className="mt-1 text-sub text-muted">{t("users.revealBody")}</p>
          <dl className="mt-3 grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2 text-sub">
            <dt className="text-muted">{t("users.email")}</dt>
            <dd className="font-mono break-all" data-testid="user-email">
              {made.email}
            </dd>
            <CopyButton value={made.email} iconOnly label={t("tokens.copy")} copiedLabel={t("tokens.copied")} failedLabel={t("tokens.copyFailed")} />
            <dt className="text-muted">{t("users.password")}</dt>
            <dd className="font-mono break-all select-all" data-testid="user-password">
              {made.password}
            </dd>
            <CopyButton value={made.password} iconOnly label={t("tokens.copy")} copiedLabel={t("tokens.copied")} failedLabel={t("tokens.copyFailed")} />
          </dl>
          <Button size="sm" className="mt-3" onClick={() => setMade(null)}>
            {t("tokens.done")}
          </Button>
        </div>
      ) : null}
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t("users.email")} id="user-email">
          <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t("users.role")}>
          <Select
            aria-label={t("users.role")}
            value={role}
            options={[
              { value: "user", label: t("users.user") },
              { value: "admin", label: t("users.admin") },
            ]}
            onValueChange={setRole}
          />
        </Field>
        <div>
          <Button type="submit" variant="primary" disabled={pending || email.trim() === ""}>
            {t("users.create")}
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
}
