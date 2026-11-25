/* KoreCalendar service worker: shows reminders pushed by the server. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Reminder";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      // One notification per occurrence: a repeated push replaces it.
      tag: (data.eventId || "") + "|" + (data.key || ""),
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { key: data.key || "", eventId: data.eventId || "" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const day = String((event.notification.data && event.notification.data.key) || "").slice(0, 10);
  const url = /^\d{4}-\d{2}-\d{2}$/.test(day) ? "/calendar/day?date=" + day : "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if ("focus" in w) {
          if ("navigate" in w) w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
