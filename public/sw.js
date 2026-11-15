// Offline support for the installed app: network first (always fresh), cache as fallback.
const CACHE = 'sternenfront-v4';
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
    // evict the oldest hashed files, but never the page itself
    const old = keys.filter((k) => !/\/(index\.html)?$/.test(new URL(k.url).pathname));
    for (let i = 0; i < keys.length - MAX_ENTRIES && i < old.length; i++) await c.delete(old[i]);
  } catch { /* storage full: just don't cache */ }
}
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.searchParams.has('v')) return; // the page's version check: straight to the network, never cached
  // pages always revalidate with the server (no stale copy from the HTTP cache), so a new build shows at once
  e.respondWith(
    fetch(req, req.mode === 'navigate' ? { cache: 'no-cache' } : undefined)
      .then((res) => {
        // only real HTML pages may become the offline index.html (not an icon or the manifest opened in a tab)
        const page = req.mode !== 'navigate' || (res.headers.get('content-type') || '').includes('text/html');
        if (res.ok && page) e.waitUntil(remember(req, res.clone()));
        // a hashed chunk deleted by a newer deploy may still be in the cache for an old open tab
        if (!res.ok && req.mode !== 'navigate') return caches.match(req).then((c) => c || res);
        return res;
      })
      .catch(async () => {
        if (req.mode === 'navigate') return (await caches.match('./index.html')) || Response.error();
        // never answer a script, style or font request with the HTML page
        return (await caches.match(req)) || Response.error();
      }),
  );
});
