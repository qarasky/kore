"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n";
import { pushSupport, subscriptionToJSON, urlBase64ToUint8Array, type PushSupport } from "@/lib/push";
import { Button, SettingsSection, useToast } from "@qarasky/kore-ui";

const STORE_KEY = "korecal.push.subscription";

type State = { kind: "checking" } | { kind: "unavailable"; why: Exclude<PushSupport, "ok"> } | { kind: "off" } | { kind: "on" };

function environment() {
  return pushSupport({
    isSecureContext: window.isSecureContext,
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
    permission: "Notification" in window ? Notification.permission : "unsupported",
  });
}

/** Turn this browser's reminder notifications on or off (Web Push through the service worker). */
export function NotificationsPanel() {
  const toast = useToast();
  const [state, setState] = useState<State>({ kind: "checking" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const support = environment();
      if (support !== "ok") return !cancelled && setState({ kind: "unavailable", why: support });
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (!cancelled) setState({ kind: sub ? "on" : "off" });
    })().catch(() => !cancelled && setState({ kind: "off" }));
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState({ kind: "unavailable", why: "denied" });
        return;
      }
      const { publicKey } = await api<{ publicKey: string }>("/api/push/key");
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      const { id } = await api<{ id: string }>("/api/push/subscriptions", { method: "POST", body: JSON.stringify(subscriptionToJSON(sub)) });
      localStorage.setItem(STORE_KEY, id);
      setState({ kind: "on" });
      toast.show({ message: t("notify.enabled") });
    } catch (e) {
      toast.show({ message: errorMessage(e), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      const id = localStorage.getItem(STORE_KEY);
      if (id) await api(`/api/push/subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined);
      await sub?.unsubscribe();
      localStorage.removeItem(STORE_KEY);
      setState({ kind: "off" });
      toast.show({ message: t("notify.disabled") });
    } catch (e) {
      toast.show({ message: errorMessage(e), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    const reg = await navigator.serviceWorker.getRegistration("/");
    await reg?.showNotification(t("notify.testTitle"), { body: t("notify.testBody"), icon: "/icon-192.png" });
  }

  return (
    <SettingsSection title={t("notify.heading")} description={t("notify.intro")}>
      <div data-testid="notify-state" data-state={state.kind === "unavailable" ? state.why : state.kind}>
        {state.kind === "checking" ? <p className="text-sub text-muted">{t("notify.checking")}</p> : null}
        {state.kind === "unavailable" ? (
          <p role="status" className="rounded-ui border border-warning/40 bg-warning/10 px-3 py-2.5 text-sub text-warning">
            {t(`notify.${state.why}`)}
          </p>
        ) : null}
        {state.kind === "off" ? (
          <>
            <p className="text-sub text-muted">{t("notify.off")}</p>
            <Button className="mt-3" variant="primary" onClick={enable} disabled={busy}>
              {busy ? t("notify.enabling") : t("notify.enable")}
            </Button>
          </>
        ) : null}
        {state.kind === "on" ? (
          <>
            <p className="text-sub">{t("notify.on")}</p>
            <div className="mt-3 flex gap-2">
              <Button onClick={test}>{t("notify.test")}</Button>
              <Button variant="danger-outline" onClick={disable} disabled={busy}>
                {t("notify.disable")}
              </Button>
            </div>
            <p className="mt-2 text-meta text-muted">{t("notify.testNote")}</p>
          </>
        ) : null}
      </div>
      <p className="text-meta text-muted">{t("notify.phone")}</p>
    </SettingsSection>
  );
}
