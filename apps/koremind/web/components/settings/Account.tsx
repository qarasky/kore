"use client";
import { Button, Card, SettingsSection, StatusDot } from "@qarasky/kore-ui";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ConnectPhone } from "./ConnectPhone";
import { useSession } from "@/lib/session";
import { beginSso, parseSsoHash, ssoErrorMessage } from "@/lib/sso";
import { t } from "@/lib/strings";

export function AccountSection() {
  const { api, baseUrl, user, server, signOut } = useSession();
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const [linkedNow, setLinkedNow] = useState(false);
  // Back from linking a Kore ID: the backend put the result after the #.
  useEffect(() => {
    const back = parseSsoHash(location.hash);
    if (!back) return;
    history.replaceState(null, "", location.pathname + "#account");
    setNote(back.error ? { text: ssoErrorMessage(back.error), error: true } : { text: t.koreIdLinkedDone, error: false });
    if (back.linked) setLinkedNow(true);
  }, [api]);
  const link = async () => { if (!api) return; try { await beginSso(api, "/settings"); } catch (e) { setNote({ text: e instanceof Error ? e.message : t.genericError, error: true }); } };
  const linked = !!user?.ssoLinked || linkedNow;
  return (
    <>
      <SettingsSection title={t.account} description={t.accountHint}>
        <Card>
          <div className="flex min-h-row items-center justify-between gap-3 border-b border-border px-4">
            <span className="text-muted">{t.signedInAs}</span>
            <span className="truncate">{user?.email}</span>
          </div>
          {server?.sso && (
            <div className="flex min-h-row items-center justify-between gap-3 border-b border-border px-4 py-2">
              <span className="text-muted">{t.koreId}</span>
              {linked ? <StatusDot status="up" label={t.koreIdLinked} tintLabel={false} /> : <Button size="sm" onClick={() => void link()}>{t.linkKoreId}</Button>}
            </div>
          )}
          <div className="flex min-h-row items-center justify-between gap-3 px-4 py-2">
            <div className="min-w-0">
              <p className="text-muted">{t.server}</p>
              <p className="break-all text-meta">{baseUrl}</p>
            </div>
            <Button asChild size="sm"><Link href="/connect">{t.changeServer}</Link></Button>
          </div>
        </Card>
        {note && <p className={note.error ? "text-meta text-danger" : "text-meta text-muted"} role={note.error ? "alert" : "status"}>{note.text}</p>}
      </SettingsSection>
      <ConnectPhone />
      <SettingsSection title={t.signOut} description={t.signOutHint} actions={<Button variant="danger-outline" onClick={() => void signOut()}>{t.signOut}</Button>} />
    </>
  );
}
