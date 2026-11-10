// Entry: a phone opened via QR code becomes a controller, everything else runs the game.
// Fonts are bundled locally (no requests to third-party font servers).
import '@fontsource-variable/orbitron/wght.css';
import '@fontsource/rajdhani/latin-500.css';
import '@fontsource/rajdhani/latin-600.css';
import '@fontsource/rajdhani/latin-700.css';
const q = new URLSearchParams(location.search);
if (q.has('pad')) {
  import('./pad.js').then((m) => m.startPadPage(q.get('pad')));
} else {
  import('./app.js');
}

// installable app: cache files for offline play (not in the single-file build)
if (import.meta.env.PROD && !import.meta.env.VITE_ARTIFACT && 'serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
