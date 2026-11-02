/** Browser notifications (Web Push): what the browser can do, and the conversions the API needs. Pure. */

export type PushSupport = "ok" | "insecure" | "unsupported" | "denied";

export type PushEnv = {
  isSecureContext: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  permission: NotificationPermission | "unsupported";
};

/**
 * Whether this browser can receive reminders. Plain http (other than
 * localhost) hides the push APIs, so "insecure" is checked first: it is the
 * reason, not "unsupported".
 */
export function pushSupport(env: PushEnv): PushSupport {
  if (!env.isSecureContext) return "insecure";
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return "unsupported";
  if (env.permission === "denied") return "denied";
  return "ok";
}

/** The VAPID public key (base64url) as the bytes `pushManager.subscribe` wants. */
export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** A browser PushSubscription as the body of `POST /api/push/subscriptions`. */
export function subscriptionToJSON(sub: { toJSON: () => { endpoint?: string; keys?: Record<string, string> } }): {
  endpoint: string;
  keys: { p256dh: string; auth: string };
} {
  const j = sub.toJSON();
  if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) throw new Error("incomplete push subscription");
  return { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } };
}
