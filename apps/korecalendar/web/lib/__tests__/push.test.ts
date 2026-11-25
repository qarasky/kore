import { describe, expect, it } from "vitest";
import { pushSupport, subscriptionToJSON, urlBase64ToUint8Array } from "@/lib/push";

const full = { isSecureContext: true, hasServiceWorker: true, hasPushManager: true, hasNotification: true, permission: "default" as const };

describe("pushSupport", () => {
  it("is ok when everything is there and nothing is blocked", () => {
    expect(pushSupport(full)).toBe("ok");
    expect(pushSupport({ ...full, permission: "granted" })).toBe("ok");
  });

  it("needs HTTPS (or localhost) before anything else", () => {
    expect(pushSupport({ ...full, isSecureContext: false })).toBe("insecure");
    // insecure explains more than "unsupported", because browsers hide the APIs on plain http
    expect(pushSupport({ ...full, isSecureContext: false, hasServiceWorker: false, hasPushManager: false })).toBe("insecure");
  });

  it("reports a browser without the APIs as unsupported", () => {
    expect(pushSupport({ ...full, hasServiceWorker: false })).toBe("unsupported");
    expect(pushSupport({ ...full, hasPushManager: false })).toBe("unsupported");
    expect(pushSupport({ ...full, hasNotification: false })).toBe("unsupported");
  });

  it("reports denied permission even though the browser is capable", () => {
    expect(pushSupport({ ...full, permission: "denied" })).toBe("denied");
  });
});

describe("urlBase64ToUint8Array", () => {
  it("decodes base64url with and without padding", () => {
    expect([...urlBase64ToUint8Array("AQID")]).toEqual([1, 2, 3]);
    expect([...urlBase64ToUint8Array("AQIDBA")]).toEqual([1, 2, 3, 4]); // unpadded
    expect([...urlBase64ToUint8Array("AQIDBA==")]).toEqual([1, 2, 3, 4]);
  });

  it("handles the URL-safe alphabet", () => {
    // 0xfb 0xff 0xfe is "-__-" in base64url ("+//+" in plain base64)
    expect([...urlBase64ToUint8Array("-__-")]).toEqual([0xfb, 0xff, 0xfe]);
  });

  it("decodes a VAPID-sized key to 65 bytes", () => {
    const bytes = new Uint8Array(65).fill(7);
    bytes[0] = 4;
    const b64 = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    expect(urlBase64ToUint8Array(b64)).toEqual(bytes);
  });
});

describe("subscriptionToJSON", () => {
  it("has the shape POST /api/push/subscriptions expects", () => {
    const sub = { toJSON: () => ({ endpoint: "https://push.example.com/abc", expirationTime: null, keys: { p256dh: "P", auth: "A" } }) };
    expect(subscriptionToJSON(sub)).toEqual({ endpoint: "https://push.example.com/abc", keys: { p256dh: "P", auth: "A" } });
  });

  it("refuses a subscription without keys", () => {
    expect(() => subscriptionToJSON({ toJSON: () => ({ endpoint: "https://x" }) })).toThrow();
    expect(() => subscriptionToJSON({ toJSON: () => ({}) })).toThrow();
  });
});
