"use client";

import { useId, useRef, useState } from "react";
import { adminErrorKey, type AdminUser, type UserHasFiles } from "@/lib/admin";
import { api, isApiError } from "@/lib/api";
import { t, type MessageKey } from "@/lib/i18n";
import { Modal } from "../Modal";
import { dangerButton, fieldIds, inputClass, secondaryButton } from "./fields";

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
 * own account) are shown in the dialog.
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
  const titleId = useId();
  const messageId = useId();
  const inputId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [files, setFiles] = useState<UserHasFiles | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<MessageKey | null>(null);
  const [pending, setPending] = useState(false);
  const matches = typed.trim().toLowerCase() === user.email.toLowerCase();

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
        setFiles({ personal_count: personal, shared_count: count(d.shared_count) });
      } else {
        setError(adminErrorKey(e));
      }
      setPending(false);
    }
  }

  const errorBox = error && (
    <p role="alert" data-testid="dialog-error" className="text-[12px] text-danger">
      {t(error)}
    </p>
  );

  const buttons = (confirm: React.ReactNode) => (
    <div className="flex justify-end gap-2 pt-1">
      <button ref={cancelRef} type="button" onClick={onClose} disabled={pending} className={secondaryButton}>
        {t("dialog.cancel")}
      </button>
      {confirm}
    </div>
  );

  if (!files) {
    return (
      <Modal
        role="alertdialog"
        labelledBy={titleId}
        describedBy={messageId}
        onClose={() => !pending && onClose()}
        initialFocus={cancelRef}
        className="w-[min(440px,calc(100vw-32px))]"
      >
        <div className="space-y-4 p-5">
          <h2 id={titleId} className="truncate text-[15px] font-semibold tracking-[-0.01em]">
            {t("admin.delete.title", { email: user.email })}
          </h2>
          <p id={messageId} className="text-muted">
            {t("admin.delete.message", { email: user.email })}
          </p>
          {errorBox}
          {buttons(
            <button
              type="button"
              onClick={() => remove(false)}
              disabled={pending}
              aria-busy={pending || undefined}
              className={dangerButton}
            >
              {pending ? t("list.working") : t("admin.delete.confirm")}
            </button>,
          )}
        </div>
      </Modal>
    );
  }

  const { personal_count: personal, shared_count: shared } = files;
  const ids = fieldIds(inputId, false, typed !== "" && !matches);
  return (
    <Modal
      role="alertdialog"
      labelledBy={titleId}
      describedBy={messageId}
      onClose={() => !pending && onClose()}
      className="w-[min(500px,calc(100vw-32px))]"
    >
      <form
        className="space-y-3 p-5"
        data-testid="user-has-files"
        onSubmit={(e) => {
          e.preventDefault();
          void remove(true);
        }}
      >
        <h2 id={titleId} className="truncate text-[15px] font-semibold tracking-[-0.01em]">
          {t("admin.delete.hasFilesTitle", { email: user.email })}
        </h2>
        <div id={messageId} className="space-y-2 text-muted">
          <p>
            {personal > 0
              ? personal === 1
                ? t("admin.delete.hasFilesOne")
                : t("admin.delete.hasFilesMany", { count: personal })
              : shared === 1
                ? t("admin.delete.hasSharedOne")
                : t("admin.delete.hasSharedMany", { count: shared })}
          </p>
          <p>{t("admin.delete.privacy")}</p>
          <p className="rounded-ui border border-danger/40 bg-danger/[0.06] px-3 py-2 text-text">
            {personal === 0
              ? t("admin.delete.transferOnly")
              : personal === 1
                ? t("admin.delete.purgeOne")
                : t("admin.delete.purgeMany", { count: personal })}
            {shared > 0 && (
              <>
                {" "}
                {shared === 1 ? t("admin.delete.sharedOne") : t("admin.delete.sharedMany", { count: shared })}
              </>
            )}
          </p>
        </div>
        <div className="space-y-1.5 pt-1">
          <label htmlFor={inputId} className="block text-[12px] font-medium text-muted">
            {t("admin.delete.typeEmail", { email: user.email })}
          </label>
          <input
            id={inputId}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-invalid={(typed !== "" && !matches) || undefined}
            aria-describedby={ids.describedBy}
            className={inputClass}
          />
          {typed !== "" && !matches && (
            <p id={ids.errorId} className="text-[12px] text-muted">
              {t("admin.delete.emailMismatch")}
            </p>
          )}
        </div>
        {errorBox}
        {buttons(
          <button type="submit" disabled={pending || !matches} aria-busy={pending || undefined} className={dangerButton}>
            {pending ? t("list.working") : t("admin.delete.purgeConfirm")}
          </button>,
        )}
      </form>
    </Modal>
  );
}
