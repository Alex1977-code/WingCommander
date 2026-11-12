// Offline support for the installed app: network first (always fresh), cache as fallback.
const CACHE = 'sternenfront-v2';
const MAX_ENTRIES = 60; // old hashed builds are evicted oldest-first instead of piling up
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest', './icon-192.png'])).catch(() => {}));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
async function remember(req, res) {
  try {
    const c = await caches.open(CACHE);
    // pages are stored once, without their query (?pad=…, ?debug), so they don't multiply
    await c.put(req.mode === 'navigate' ? './index.html' : req, res);
    const keys = await c.keys();
    for (let i = 0; i < keys.length - MAX_ENTRIES; i++) await c.delete(keys[i]);
  } catch { /* storage full: just don't cache */ }
}
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) e.waitUntil(remember(req, res.clone()));
        return res;
      })
      .catch(async () => {
        if (req.mode === 'navigate') return (await caches.match('./index.html')) || Response.error();
        // never answer a script, style or font request with the HTML page
        return (await caches.match(req)) || Response.error();
      }),
  );
});
