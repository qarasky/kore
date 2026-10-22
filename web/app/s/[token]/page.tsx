import type { Metadata } from "next";
import { PasswordGate } from "@/components/share/PasswordGate";
import { PublicShell, ShareProblem } from "@/components/share/PublicShell";
import { ShareFileView } from "@/components/share/ShareFileView";
import { ShareFolderView } from "@/components/share/ShareFolderView";
import { t } from "@/lib/i18n";
import { getPublicListing, getPublicMeta } from "@/lib/shareServer";
import { expiryText, nowSeconds, publicProblem, type PublicListing, type PublicMeta } from "@/lib/shares";

export const metadata: Metadata = {
  title: t("publicShare.title"),
  robots: { index: false, follow: false },
  // The token is in the URL: never send it to another site.
  referrer: "no-referrer",
};

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * `/s/<token>`: a public share link. Rendered without an account; the API is
 * called with only this share's unlock cookie (lib/shareServer.ts). Not
 * found, a malformed token and an unavailable item look the same.
 */
export default async function PublicSharePage({ params, searchParams }: PageProps<"/s/[token]">) {
  const { token } = await params;
  const sp = await searchParams;
  const folder = typeof sp.folder === "string" ? sp.folder : "";
  if (!TOKEN.test(token)) {
    return (
      <PublicShell>
        <ShareProblem problem="gone" />
      </PublicShell>
    );
  }

  let meta: PublicMeta;
  let listing: PublicListing | null = null;
  try {
    meta = await getPublicMeta(token);
    if (meta.unlocked && meta.is_dir) listing = await getPublicListing(token, folder);
  } catch (e) {
    return (
      <PublicShell>
        <ShareProblem problem={publicProblem(e)} />
      </PublicShell>
    );
  }

  const expiry = expiryText(meta.expires_at, nowSeconds());
  if (!meta.unlocked) {
    return (
      <PublicShell>
        <PasswordGate token={token} />
      </PublicShell>
    );
  }
  if (meta.is_dir && listing) {
    return (
      <PublicShell wide>
        <ShareFolderView token={token} name={meta.name ?? ""} size={meta.size ?? 0} expiry={expiry} listing={listing} />
      </PublicShell>
    );
  }
  return (
    <PublicShell wide>
      <ShareFileView token={token} name={meta.name ?? ""} size={meta.size ?? 0} mime={meta.mime ?? ""} expiry={expiry} />
    </PublicShell>
  );
}
