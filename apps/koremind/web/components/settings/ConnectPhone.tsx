"use client";
import { Smartphone } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Card } from "./parts";
import { Button, ErrorText } from "@/components/ui";
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
    <Card className="mt-4 p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-ui bg-raised text-muted" aria-hidden><Smartphone size={18} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sub font-medium">{t.connectPhone}</p>
          <p className="mt-0.5 text-meta text-muted">{t.connectPhoneHint}</p>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {code && (
          <motion.div variants={collapse} initial="hidden" animate="show" exit="exit" className="overflow-hidden">
            <div className="flex flex-col items-center gap-3 pt-4">
              <div className={`rounded-ui bg-white p-2 transition-opacity [&>svg]:size-full ${expired ? "opacity-20" : ""}`} role="img" aria-label={t.qrLabel} style={{ width: 208, height: 208 }} dangerouslySetInnerHTML={{ __html: code.svg }} />
              <p className="text-meta text-muted" role="status">{expired ? t.codeExpired : t.codeExpiresIn(Math.floor(left / 60), left % 60)}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="mt-4"><Button variant={code && !expired ? "ghost" : "primary"} onClick={() => void create()} disabled={busy}>{code ? t.newCode : t.showQr}</Button></div>
      <div className="mt-2"><ErrorText>{error}</ErrorText></div>
    </Card>
  );
}
