"use client";
import { Button, SettingsSection } from "@qarasky/kore-ui";
import { AnimatePresence, motion } from "motion/react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { InlineError } from "@/components/InlineError";
import { secondsLeft } from "@/lib/pair-timer";
import { collapse } from "@/lib/motion";
import { useSession } from "@/lib/session";
import { t } from "@/lib/strings";

type Code = { svg: string; expiresAt: number };

/** Shows a QR code that signs a phone in as this account. The code lives two minutes and works once. */
export function ConnectPhone() {
  const { api } = useSession();
  const [code, setCode] = useState<Code | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!code) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [code]);

  async function create() {
    if (!api) return;
    setBusy(true);
    setError("");
    try {
      const p = await api.startPair();
      // Dark modules on a light tile: scanners read that more reliably than light-on-dark.
      const svg = await QRCode.toString(p.link, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#16181d", light: "#ffffff" } });
      setCode({ svg, expiresAt: p.expiresAt });
      setNow(Date.now());
    } catch { setError(t.pairError); } finally { setBusy(false); }
  }

  const left = code ? secondsLeft(code.expiresAt, now) : 0;
  const expired = !!code && left === 0;

  return (
    <SettingsSection
      title={t.connectPhone} description={t.connectPhoneHint}
      actions={<Button variant={code && !expired ? "secondary" : "primary"} loading={busy} onClick={() => void create()}>{code ? t.newCode : t.showQr}</Button>}
    >
      <AnimatePresence initial={false}>
        {code && (
          <motion.div variants={collapse} initial="hidden" animate="show" exit="exit" className="overflow-hidden">
            <div className="flex flex-col items-center gap-3 py-2">
              <div className={`rounded-overlay bg-white p-2 transition-opacity [&>svg]:size-full ${expired ? "opacity-20" : ""}`} role="img" aria-label={t.qrLabel} style={{ width: 208, height: 208 }} dangerouslySetInnerHTML={{ __html: code.svg }} />
              <p className="text-meta text-muted" role="status">{expired ? t.codeExpired : t.codeExpiresIn(Math.floor(left / 60), left % 60)}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <InlineError>{error}</InlineError>
    </SettingsSection>
  );
}
