// Entry: a phone opened via QR code becomes a controller, everything else runs the game.
const q = new URLSearchParams(location.search);
if (q.has('pad')) {
  import('./pad.js').then((m) => m.startPadPage(q.get('pad')));
} else {
  import('./app.js');
}
