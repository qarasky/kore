"use client";
import { Button, CardList, InlineMessage, ListRow, SettingsSection, StatusDot } from "@qarasky/kore-ui";
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
        <CardList>
          <ListRow label={t.signedInAs} value={user?.email} />
          {server?.sso && (
            <ListRow
              label={t.koreId}
              actions={linked ? <StatusDot status="up" label={t.koreIdLinked} tintLabel={false} /> : <Button size="sm" onClick={() => void link()}>{t.linkKoreId}</Button>}
            />
          )}
          <ListRow label={t.server} description={baseUrl} actions={<Button asChild size="sm"><Link href="/connect">{t.changeServer}</Link></Button>} />
        </CardList>
        {note && <InlineMessage tone={note.error ? "danger" : "muted"}>{note.text}</InlineMessage>}
      </SettingsSection>
      <ConnectPhone />
      <SettingsSection title={t.signOut} description={t.signOutHint} actions={<Button variant="danger-outline" onClick={() => void signOut()}>{t.signOut}</Button>} />
    </>
  );
}
