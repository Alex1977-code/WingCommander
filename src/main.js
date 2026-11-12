// Entry: a phone opened via QR code becomes a controller, everything else runs the game.
// Fonts are bundled locally (no requests to third-party font servers).
import '@fontsource-variable/orbitron/wght.css';
import '@fontsource/rajdhani/latin-500.css';
import '@fontsource/rajdhani/latin-600.css';
import '@fontsource/rajdhani/latin-700.css';
const q = new URLSearchParams(location.search);
// if a chunk can't be loaded (offline, weak connection, new deploy) show a message instead of a black page
const failed = () => {
  document.body.innerHTML = '<div style="position:fixed;inset:0;display:grid;place-content:center;gap:14px;text-align:center;background:#05070d;color:#cfe8ff;font:600 16px system-ui,sans-serif"><p>Laden fehlgeschlagen. Bitte Verbindung prüfen.</p><button onclick="location.reload()" style="font:inherit;padding:10px 18px;background:#0e2236;color:#cfe8ff;border:1px solid #7fd6ff">Neu laden</button></div>';
};
if (q.has('pad')) {
  document.body.classList.add('pad-mode'); // no "rotate your device" overlay while the controller page loads
  import('./pad.js').then((m) => m.startPadPage(q.get('pad'))).catch(failed);
} else {
  // ship decals are painted into cached canvas textures: wait (briefly) for the bundled font first
  const fontReady = document.fonts?.load ? Promise.race([document.fonts.load('700 44px Rajdhani'), new Promise((r) => setTimeout(r, 1500))]).catch(() => {}) : Promise.resolve();
  fontReady.then(() => import('./app.js')).catch(failed);
}

// installable app: cache files for offline play (not in the single-file build)
if (import.meta.env.PROD && !import.meta.env.VITE_ARTIFACT && 'serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
