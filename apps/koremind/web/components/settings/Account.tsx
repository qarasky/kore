"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, SectionHeader } from "./parts";
import { ConnectPhone } from "./ConnectPhone";
import { Button } from "@/components/ui";
import { useSession } from "@/lib/session";
import { beginSso, parseSsoHash, ssoErrorMessage } from "@/lib/sso";
import { t } from "@/lib/strings";

export function AccountSection() {
  const { api, baseUrl, user, signOut } = useSession();
  const [sso, setSso] = useState(false);
  const [note, setNote] = useState("");
  const [linkedNow, setLinkedNow] = useState(false);
  useEffect(() => { api?.health().then((h) => setSso(!!h.sso)).catch(() => {}); }, [api]);
  // Back from linking a Kore ID: the backend put the result after the #.
  useEffect(() => {
    const back = parseSsoHash(location.hash);
    if (!back) return;
    history.replaceState(null, "", location.pathname);
    setNote(back.error ? ssoErrorMessage(back.error) : t.koreIdLinkedDone);
    if (back.linked) setLinkedNow(true);
  }, [api]);
  const link = async () => { if (!api) return; try { await beginSso(api, "/settings"); } catch (e) { setNote(e instanceof Error ? e.message : t.genericError); } };
  return (
    <section>
      <SectionHeader title={t.account} hint={t.accountHint} />
      <Card>
        <div className="flex min-h-row items-center justify-between gap-3 border-b border-border px-4">
          <span className="text-sub text-muted">{t.signedInAs}</span>
          <span className="truncate text-sub">{user?.email}</span>
        </div>
        {sso && (
          <div className="flex min-h-row items-center justify-between gap-3 border-b border-border px-4">
            <span className="text-sub text-muted">{t.koreId}</span>
            {user?.ssoLinked || linkedNow ? <span className="text-sub">{t.koreIdLinked}</span> : <Button variant="ghost" onClick={() => void link()}>{t.linkKoreId}</Button>}
          </div>
        )}
        <div className="flex min-h-row items-center justify-between gap-3 px-4 py-2">
          <div className="min-w-0">
            <p className="text-sub text-muted">{t.server}</p>
            <p className="break-all text-meta">{baseUrl}</p>
          </div>
          <Link href="/connect" className="shrink-0 text-meta text-accent underline underline-offset-2">{t.changeServer}</Link>
        </div>
      </Card>
      {note && <p className="mt-3 text-meta text-muted" role="status">{note}</p>}
      <ConnectPhone />
      <div className="mt-4"><Button variant="danger" onClick={() => void signOut()}>{t.signOut}</Button></div>
    </section>
  );
}
