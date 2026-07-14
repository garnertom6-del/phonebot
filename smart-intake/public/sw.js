// Minimal service worker: enables "Install app" on phones and desktops.
// Deliberately NETWORK-ONLY - this app handles protected health information,
// so we do NOT cache pages, answers, or PDFs on the device. The worker exists
// only to satisfy installability and to let the app open full-screen.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  // no-op: let the network handle every request (no offline PHI cache)
});
