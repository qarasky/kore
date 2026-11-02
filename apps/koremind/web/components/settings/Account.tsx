"use client";
import Link from "next/link";
import { Card, SectionHeader } from "./parts";
import { Button } from "@/components/ui";
import { useSession } from "@/lib/session";
import { t } from "@/lib/strings";

export function AccountSection() {
  const { baseUrl, user, signOut } = useSession();
  return (
    <section>
      <SectionHeader title={t.account} hint={t.accountHint} />
      <Card>
        <div className="flex min-h-row items-center justify-between gap-3 border-b border-border px-4">
          <span className="text-sub text-muted">{t.signedInAs}</span>
          <span className="truncate text-sub">{user?.email}</span>
        </div>
        <div className="flex min-h-row items-center justify-between gap-3 px-4 py-2">
          <div className="min-w-0">
            <p className="text-sub text-muted">{t.server}</p>
            <p className="break-all text-meta">{baseUrl}</p>
          </div>
          <Link href="/connect" className="shrink-0 text-meta text-accent underline underline-offset-2">{t.changeServer}</Link>
        </div>
      </Card>
      <div className="mt-4"><Button variant="danger" onClick={() => void signOut()}>{t.signOut}</Button></div>
    </section>
  );
}
