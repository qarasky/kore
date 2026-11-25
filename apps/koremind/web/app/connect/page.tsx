"use client";
import { AuthScreen, Button, Field, Input } from "@qarasky/kore-ui";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createApi } from "@/lib/api";
import { normalizeBackendUrl } from "@/lib/backend-url";
import { useSession } from "@/lib/session";
import { t } from "@/lib/strings";

/** Which KoreMind server this web UI talks to. Shown before sign-in; one image fits every setup. */
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
    if (!url) return setError(t.badAddress);
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
    <AuthScreen app="koremind" title={t.connectTitle}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t.backendUrl} hint={t.connectHint} error={error}>
          <Input value={value} onChange={(e) => setValue(e.target.value)} autoFocus inputMode="url" autoCapitalize="none" autoCorrect="off" placeholder="192.168.1.20:8787" />
        </Field>
        <Button type="submit" variant="primary" fullWidth loading={busy}>{busy ? t.checking : t.connectAction}</Button>
      </form>
    </AuthScreen>
  );
}
