"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Wordmark } from "@/components/Mark";
import { Appear, Button, ErrorText, Field } from "@/components/ui";
import { createApi } from "@/lib/api";
import { normalizeBackendUrl } from "@/lib/backend-url";
import { useSession } from "@/lib/session";
import { t } from "@/lib/strings";

export default function ConnectPage() {
  const { setBaseUrl, baseUrl } = useSession();
  const router = useRouter();
  const [value, setValue] = useState(baseUrl ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const url = normalizeBackendUrl(value);
    if (!url) return setError("That doesn't look like an address. Try something like 192.168.1.20:8787.");
    setBusy(true);
    try {
      await createApi(url, () => null).health();
      setBaseUrl(url);
      router.replace("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : t.genericError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <Appear><Wordmark /></Appear>
      <Appear delay={0.06}><form onSubmit={submit} className="flex flex-col gap-4">
        <h1 className="text-display font-semibold tracking-[-0.02em]">{t.connectTitle}</h1>
        <Field label={t.backendUrl} hint={t.connectHint} value={value} onChange={(e) => setValue(e.target.value)} autoFocus inputMode="url" autoCapitalize="none" autoCorrect="off" />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={busy}>{busy ? t.checking : t.connectAction}</Button>
      </form></Appear>
    </main>
  );
}
