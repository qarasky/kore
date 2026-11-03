"use client";

import { useMutate } from "@/hooks/useMutate";
import { t } from "@/lib/i18n";
import { updateUserRole } from "@/lib/mutations";
import type { AdminUser, Role } from "@/lib/types";
import { Select, SettingsSection } from "@qarasky/kore-ui";
import { useShell } from "../ShellContext";

/**
 * Admin only: who has an account here, their role, and whether their Kore ID
 * identity is linked yet. People sign in with Kore ID, so there is no password
 * to create, show or reset.
 */
export function UsersManager({ initial }: { initial: AdminUser[] }) {
  const { run, pending } = useMutate();
  const { me } = useShell();

  return (
    <SettingsSection title={t("users.heading")} description={t("users.intro")}>
      <ul className="flex flex-col divide-y divide-border rounded-overlay border border-border" data-testid="user-list">
        {initial.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" data-testid="user-row">
            <div className="min-w-0 flex-1">
              <p className="truncate" data-testid="user-email">
                {u.email}
                {u.id === me.id ? <span className="ms-2 text-meta text-muted">{t("users.you")}</span> : null}
              </p>
              <p className={`mt-1 text-meta ${u.kore_id_linked ? "text-muted" : "text-warning"}`} data-testid="user-status">
                {u.kore_id_linked ? t("users.linked") : t("users.notLinked")}
              </p>
            </div>
            <Select
              aria-label={`${t("users.role")}: ${u.email}`}
              value={u.role}
              disabled={pending || u.id === me.id}
              options={[
                { value: "user", label: t("users.user") },
                { value: "admin", label: t("users.admin") },
              ]}
              onValueChange={(role) => run(() => updateUserRole(u.id, role as Role), { message: t("users.changed") })}
            />
          </li>
        ))}
      </ul>
    </SettingsSection>
  );
}
