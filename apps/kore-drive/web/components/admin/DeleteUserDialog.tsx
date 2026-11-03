"use client";

import { Button, Dialog, DialogBody, DialogContent, DialogFooter, Field, Input } from "@qarasky/kore-ui";
import { useId, useRef, useState } from "react";
import { adminErrorKey, type AdminUser, type UserHasFiles } from "@/lib/admin";
import { api, isApiError } from "@/lib/api";
import { t, type MessageKey } from "@/lib/i18n";

function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}

/**
 * Deleting a user, in two steps. First a plain confirmation; the API refuses
 * (409 `user_has_files`) if the account still has files. Admins can't open
 * personal files to move them, so the second step offers the one way out:
 * delete the account together with its personal files (`?files=purge`),
 * keeping their shared-space uploads (transferred to the acting admin).
 * That step requires typing the user's email. Server refusals (last admin,
 * own account) are shown in the dialog. Mounted while open.
 */
export function DeleteUserDialog({
  user,
  onClose,
  onDeleted,
}: {
  user: AdminUser;
  onClose: () => void;
  onDeleted: (message: string) => void;
}) {
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [files, setFiles] = useState<UserHasFiles | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<MessageKey | null>(null);
  const [pending, setPending] = useState(false);
  const matches = typed.trim().toLowerCase() === user.email.toLowerCase();
  const mismatch = typed !== "" && !matches;

  async function remove(purge: boolean) {
    if (pending || (purge && !matches)) return;
    setPending(true);
    setError(null);
    try {
      const q = purge ? "?files=purge" : "";
      await api(`/api/admin/users/${encodeURIComponent(user.id)}${q}`, { method: "DELETE" });
      onDeleted(purge ? t("admin.delete.doneWithFiles", { email: user.email }) : t("admin.delete.done", { email: user.email }));
    } catch (e) {
      if (!purge && isApiError(e, 409) && e.code === "user_has_files") {
        const d = e.details ?? {};
        // Older servers only send file_count (the personal-space count).
        const personal = "personal_count" in d ? count(d.personal_count) : count(d.file_count);
        setFiles({ personal_count: personal, shared_count: count(d.shared_count), other_count: count(d.other_count) });
      } else {
        setError(adminErrorKey(e));
      }
      setPending(false);
    }
  }

  const errorBox = error && (
    <p role="alert" data-testid="dialog-error" className="text-meta text-danger">
      {t(error)}
    </p>
  );

  const cancel = (
    <Button ref={cancelRef} onClick={onClose} disabled={pending}>
      {t("dialog.cancel")}
    </Button>
  );

  let content: React.ReactNode;
  if (!files) {
    content = (
      <DialogContent
        role="alertdialog"
        size="sm"
        title={t("admin.delete.title", { email: user.email })}
        description={t("admin.delete.message", { email: user.email })}
        closeLabel={t("dialog.close")}
        // Cancel first, so Enter never deletes by accident.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          cancelRef.current?.focus();
        }}
      >
        {errorBox && <DialogBody>{errorBox}</DialogBody>}
        <DialogFooter className={errorBox ? undefined : "pt-4"}>
          {cancel}
          <Button variant="danger" onClick={() => remove(false)} loading={pending}>
            {pending ? t("list.working") : t("admin.delete.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    );
  } else {
    const { personal_count: personal, shared_count: shared, other_count: other } = files;
    const plural = (n: number, one: MessageKey, many: MessageKey) => (n === 1 ? t(one) : t(many, { count: n }));
    content = (
      <DialogContent
        role="alertdialog"
        title={t("admin.delete.hasFilesTitle", { email: user.email })}
        aria-describedby={messageId}
        closeLabel={t("dialog.close")}
      >
        <form
          className="flex min-h-0 flex-1 flex-col"
          data-testid="user-has-files"
          onSubmit={(e) => {
            e.preventDefault();
            void remove(true);
          }}
        >
          <DialogBody className="flex flex-col gap-4">
            <div id={messageId} className="flex flex-col gap-2 text-muted">
              <p>{t("admin.delete.refused")}</p>
              <ul data-testid="has-files-counts" className="list-disc space-y-0.5 pl-5">
                {personal > 0 && <li>{plural(personal, "admin.delete.personalOne", "admin.delete.personalMany")}</li>}
                {shared > 0 && <li>{plural(shared, "admin.delete.sharedOne", "admin.delete.sharedMany")}</li>}
                {other > 0 && <li>{plural(other, "admin.delete.otherOne", "admin.delete.otherMany")}</li>}
              </ul>
              <p>{t("admin.delete.privacy")}</p>
              <p className="rounded-ui border border-danger/40 bg-danger/10 px-3 py-2 text-text">
                {personal === 0 ? t("admin.delete.transferOnly") : plural(personal, "admin.delete.purgeOne", "admin.delete.purgeMany")}
                {shared > 0 && <> {plural(shared, "admin.delete.toYouOne", "admin.delete.toYouMany")}</>}
                {other > 0 && <> {plural(other, "admin.delete.toHoldersOne", "admin.delete.toHoldersMany")}</>}
              </p>
            </div>
            <Field
              label={t("admin.delete.typeEmail", { email: user.email })}
              hint={mismatch ? t("admin.delete.emailMismatch") : undefined}
            >
              <Input
                autoFocus
                autoComplete="off"
                spellCheck={false}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                aria-invalid={mismatch || undefined}
              />
            </Field>
            {errorBox}
          </DialogBody>
          <DialogFooter>
            {cancel}
            <Button type="submit" variant="danger" disabled={!matches} loading={pending}>
              {pending ? t("list.working") : t("admin.delete.purgeConfirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      {content}
    </Dialog>
  );
}
