"use client";

import {
  Badge,
  Button,
  SectionHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowHeader,
  useToast,
} from "@qarasky/kore-ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AdminUser } from "@/lib/admin";
import { t } from "@/lib/i18n";
import { RelativeTime } from "../RelativeTime";
import { DeleteUserDialog } from "./DeleteUserDialog";
import { UsageBar } from "./UsageBar";
import { UserDialog } from "./UserDialog";

type Dialog =
  | { kind: "edit"; user: AdminUser }
  | { kind: "delete"; user: AdminUser }
  | null;

/** `/admin/users`: the accounts table with Edit and Delete. Accounts are
 *  created by Kore ID on first sign-in; there is no add form and no password
 *  to set. */
export function UsersTable({ users, meId }: { users: AdminUser[]; meId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = () => setDialog(null);
  const saved = (message: string) => {
    toast.show({ message });
    router.refresh();
  };

  return (
    <div className="mx-auto max-w-content p-4 md:p-6">
      <SectionHeader
        title={t("admin.users.title")}
        description={users.length === 1 ? t("admin.users.countOne") : t("admin.users.countMany", { count: users.length })}
      />

      <p className="mb-4 max-w-content text-meta text-muted" data-testid="admin-users-sso-note">
        {t("admin.users.ssoNote")}
      </p>

      <Table caption={t("admin.users.table")} className="min-w-[760px]">
        <TableHeader>
          <tr>
            <TableHead>{t("admin.users.email")}</TableHead>
            <TableHead>{t("admin.users.role")}</TableHead>
            <TableHead className="w-[220px]">{t("admin.users.storage")}</TableHead>
            <TableHead>{t("admin.users.created")}</TableHead>
            <TableHead align="right">{t("admin.users.actions")}</TableHead>
          </tr>
        </TableHeader>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.id} data-testid="user-row" data-email={u.email}>
              <TableRowHeader className="max-w-[280px]">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate" title={u.email}>
                    {u.email}
                  </span>
                  {u.id === meId && <Badge tone="accent">{t("admin.users.you")}</Badge>}
                </span>
              </TableRowHeader>
              <TableCell muted>
                <Badge tone="outline">{u.role === "admin" ? t("admin.role.admin") : t("admin.role.user")}</Badge>
              </TableCell>
              <TableCell>
                <UsageBar used={u.used_bytes} quota={u.quota_bytes} label={t("admin.usage.bar", { email: u.email })} />
              </TableCell>
              <TableCell muted className="whitespace-nowrap">
                <RelativeTime unixSeconds={u.created_at} />
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-1.5">
                  <Button
                    size="sm"
                    aria-label={t("admin.users.editUser", { email: u.email })}
                    onClick={() => setDialog({ kind: "edit", user: u })}
                  >
                    {t("admin.users.edit")}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger-outline"
                    aria-label={t("admin.users.deleteUser", { email: u.email })}
                    onClick={() => setDialog({ kind: "delete", user: u })}
                  >
                    {t("admin.users.delete")}
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {dialog?.kind === "edit" && (
        <UserDialog
          user={dialog.user}
          isSelf={dialog.user.id === meId}
          onClose={close}
          onSaved={saved}
        />
      )}
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
