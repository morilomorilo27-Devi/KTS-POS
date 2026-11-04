const CACHE = "kts-pos-shell-v15";
const FILES = [
  "/",
  "/index.html",
  "/customer-display.html",
  "/css/customer-display.css",
  "/css/customer-display-admin.css",
  "/js/customer-display-bridge.js",
  "/js/customer-display-admin.js",
  "/js/customer-display/locale.ku.js",
  "/js/customer-display/state.js",
  "/js/customer-display/objects.js",
  "/js/customer-display/experience.js",
  "/manifest.webmanifest",
  "/images/logo.png",
  "/images/pwa/icon-192.png",
  "/images/pwa/icon-512.png",
  "/images/pwa/icon-maskable-512.png",
  "/images/pwa/apple-touch-icon.png",
  "/css/style.css",
  "/css/admin.css",
  "/css/pos.css",
  "/js/pos-design.js",
  "/js/pos-enhancements.js",
  "/js/admin-design.js",
  "/js/operations.js",
  "/js/printing.js",
  "/js/labels.js",
  "/js/user-permissions.js",
  "/css/permissions.css",
  "/css/printing.css",
  "/js/api.js",
  "/js/pwa.js",
  "/js/auth.js",
  "/js/offlineDb.js",
  "/js/pos.js",
  "/js/admin.js",
];
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(FILES))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  if (
    e.request.method !== "GET" ||
    new URL(e.request.url).pathname.startsWith("/api/")
  )
    return;
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        if (
          response.ok &&
          new URL(e.request.url).origin === self.location.origin
        ) {
          const clone = response.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(e.request);
        if (cached) return cached;
        if (e.request.mode === "navigate") return caches.match("/index.html");
        return Response.error();
      }),
  );
});
