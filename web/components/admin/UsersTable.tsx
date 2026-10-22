"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AdminUser } from "@/lib/admin";
import { t } from "@/lib/i18n";
import { PlusIcon } from "../icons";
import { RelativeTime } from "../RelativeTime";
import { useToast } from "../Toast";
import { DeleteUserDialog } from "./DeleteUserDialog";
import { primaryButton, smallButton } from "./fields";
import { ResetPasswordDialog } from "./ResetPasswordDialog";
import { UsageBar } from "./UsageBar";
import { UserDialog } from "./UserDialog";

type Dialog =
  | { kind: "add" }
  | { kind: "edit"; user: AdminUser }
  | { kind: "reset"; user: AdminUser }
  | { kind: "delete"; user: AdminUser }
  | null;

/** `/admin/users`: the accounts table with Add, Edit, Reset password and Delete. */
export function UsersTable({ users, meId, defaultQuota }: { users: AdminUser[]; meId: string; defaultQuota: number }) {
  const router = useRouter();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = () => setDialog(null);
  const saved = (message: string) => {
    toast.show({ message });
    router.refresh();
  };

  return (
    <div className="mx-auto max-w-[1040px] p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-title font-semibold tracking-[-0.01em]">{t("admin.users.title")}</h2>
          <p className="text-meta text-muted">
            {users.length === 1 ? t("admin.users.countOne") : t("admin.users.countMany", { count: users.length })}
          </p>
        </div>
        <button type="button" onClick={() => setDialog({ kind: "add" })} className={`${primaryButton} flex items-center gap-1.5`}>
          <PlusIcon />
          {t("admin.users.add")}
        </button>
      </div>

      <div className="overflow-x-auto rounded-[8px] border border-border">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <caption className="sr-only">{t("admin.users.table")}</caption>
          <thead className="text-meta text-muted">
            <tr className="border-b border-border">
              <th scope="col" className="px-4 py-2 font-medium">
                {t("admin.users.email")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("admin.users.role")}
              </th>
              <th scope="col" className="w-[220px] px-3 py-2 font-medium">
                {t("admin.users.storage")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("admin.users.created")}
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                {t("admin.users.actions")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((u) => (
              <tr key={u.id} className="h-row" data-testid="user-row" data-email={u.email}>
                <th scope="row" className="max-w-[280px] px-4 py-2.5 font-normal">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate" title={u.email}>
                      {u.email}
                    </span>
                    {u.id === meId && (
                      <span className="shrink-0 rounded-full bg-accent/15 px-1.5 py-px text-2xs font-medium text-accent">
                        {t("admin.users.you")}
                      </span>
                    )}
                  </span>
                </th>
                <td className="px-3 py-2.5 text-muted">
                  {u.role === "admin" ? t("admin.role.admin") : t("admin.role.user")}
                </td>
                <td className="px-3 py-2.5">
                  <UsageBar used={u.used_bytes} quota={u.quota_bytes} label={t("admin.usage.bar", { email: u.email })} />
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-muted">
                  <RelativeTime unixSeconds={u.created_at} />
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      aria-label={t("admin.users.editUser", { email: u.email })}
                      onClick={() => setDialog({ kind: "edit", user: u })}
                      className={smallButton}
                    >
                      {t("admin.users.edit")}
                    </button>
                    {u.id === meId ? (
                      // A reset would sign the admin out; their own password
                      // is changed on the account page (keeps this session).
                      <Link href="/account" className={smallButton}>
                        {t("account.passwordTitle")}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        aria-label={t("admin.users.resetPasswordFor", { email: u.email })}
                        onClick={() => setDialog({ kind: "reset", user: u })}
                        className={smallButton}
                      >
                        {t("admin.users.resetPassword")}
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={t("admin.users.deleteUser", { email: u.email })}
                      onClick={() => setDialog({ kind: "delete", user: u })}
                      className={`${smallButton} hover:border-danger/60 hover:text-danger`}
                    >
                      {t("admin.users.delete")}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dialog?.kind === "add" && (
        <UserDialog mode="add" defaultQuota={defaultQuota} onClose={close} onSaved={saved} />
      )}
      {dialog?.kind === "edit" && (
        <UserDialog
          mode="edit"
          user={dialog.user}
          isSelf={dialog.user.id === meId}
          defaultQuota={defaultQuota}
          onClose={close}
          onSaved={saved}
        />
      )}
      {dialog?.kind === "reset" && <ResetPasswordDialog user={dialog.user} onClose={close} onDone={saved} />}
      {dialog?.kind === "delete" && (
        <DeleteUserDialog
          user={dialog.user}
          onClose={close}
          onDeleted={(message) => {
            close();
            saved(message);
          }}
        />
      )}
    </div>
  );
}
