/** Sci-fi text effects: decode/scramble reveal, glitch titles, hologram portraits, signal waveforms. */

const GLYPHS = 'ABCDEFGHKLNOPRSTUVXYZ0123456789#%&$<>/+=*';
export const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const glyph = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];

/**
 * Reveal text with a scrambling cursor front. Returns a handle with finish()/cancel() and a `done` promise.
 * opts: cps (chars per second), window (scramble front width), onTick(progress), cursor
 */
export function decode(el, text, opts = {}) {
  const cps = reduced ? 4000 : opts.cps || 60;
  const win = opts.window ?? 6;
  const cursor = opts.cursor ?? false;
  const start = performance.now() + (opts.delay || 0);
  let raf = 0, last = -1, resolve;
  const done = new Promise((r) => (resolve = r));
  const h = { done, running: true };
  // one running decode per element: a newer one replaces the older
  el._dec?.cancel();
  el._dec = h;
  const render = (now) => {
    const n = Math.max(0, (now - start) / 1000 * cps);
    const shown = Math.floor(n);
    if (shown >= text.length + win) { h.finish(); return; }
    const frame = Math.floor(now / 45);
    if (frame !== last) {
      last = frame;
      let s = text.slice(0, Math.min(shown, text.length));
      const end = opts.pad ? text.length : Math.min(text.length, shown + win);
      for (let i = shown; i < end; i++) s += text[i] === ' ' ? ' ' : glyph();
      if (cursor && shown < text.length) s += '▌';
      el.textContent = s;
      opts.onTick?.(Math.min(1, shown / text.length));
    }
    raf = requestAnimationFrame(render);
  };
  raf = requestAnimationFrame(render);
  // safety net: background tabs pause rAF, so make sure the final text always lands
  const safety = setTimeout(() => h.running && h.finish(), (opts.delay || 0) + ((text.length + win) / cps) * 1000 + 400);
  h.finish = () => { cancelAnimationFrame(raf); clearTimeout(safety); el.textContent = text; h.running = false; resolve(); };
  h.cancel = () => { cancelAnimationFrame(raf); clearTimeout(safety); h.running = false; resolve(); };
  return h;
}

/** Short scramble of a label that keeps its length (menus, headings). */
export function scramble(el, text = el.dataset.label || el.textContent, ms = 380) {
  if (!el.dataset.label) el.dataset.label = text;
  if (el._scr) el._scr.cancel();
  // keep the element's size fixed while glyphs of varying width cycle through it
  if (!el._lockW) { const r = el.getBoundingClientRect(); if (r.width) { el._lockW = true; el.style.width = r.width + 'px'; el.style.height = r.height + 'px'; } }
  const h = el._scr = decode(el, text, { cps: Math.max(12, text.length / (ms / 1000)), window: 4, pad: true });
  h.done.then(() => { if (el._scr === h && el._lockW) { el._lockW = false; el.style.width = ''; el.style.height = ''; } });
  return h;
}

/** Stamp a glitch title: sets data-text for the CSS RGB split layers and decodes the visible text. */
export function glitchTitle(el, text, opts = {}) {
  el.dataset.text = text;
  el.classList.remove('glitch-on'); void el.offsetWidth; el.classList.add('glitch', 'glitch-on');
  return decode(el, text, { cps: opts.cps || 40, window: 5 });
}

/** Number roll-up for stats. */
export function countUp(el, to, suffix = '', ms = 900) {
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    el.textContent = Math.round(to * e) + suffix;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------------------------------------------------------------------------
// Hologram portraits (procedural busts, animated scanlines/glitch)
// ---------------------------------------------------------------------------

const LOOKS = {
  brandt: { kind: 'officer', hair: 'short', headset: true, rank: 3 },
  holt: { kind: 'officer', hair: 'receding', earpiece: true, rank: 2 },
  flug: { kind: 'crew', hair: 'short', headset: true },
  samariter: { kind: 'crew', hair: 'short', headset: true, medic: true },
  rook: { kind: 'pilot', visor: 'up', stripe: true, mask: true, jaw: 1.12 },
  kolibri: { kind: 'pilot', visor: 'up', ponytail: true },
  juno: { kind: 'pilot', visor: 'down', stripe: true },
  veyl: { kind: 'cyborg' },
  erz: { kind: 'emblem' },
};

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}

export class Hologram {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.who = 'erz'; this.color = '#7fd6ff';
    this.talk = 0; this.glitchT = 0; this._on = false;
    this.t0 = performance.now();
    this.loop = (now) => { if (!this._on) return; this.draw(now); requestAnimationFrame(this.loop); };
  }
  get on() { return this._on; }
  set on(v) { if (v && !this._on) { this._on = true; requestAnimationFrame(this.loop); } else if (!v) this._on = false; }
  set(who, color) {
    if (who !== this.who) this.glitchT = 0.35;
    this.who = who; this.color = color;
  }
  draw(now) {
    const { c, g } = this;
    const W = c.width, H = c.height, t = (now - this.t0) / 1000;
    const col = this.color, look = LOOKS[this.who] || LOOKS.erz;
    g.clearRect(0, 0, W, H);
    // backdrop glow
    const bg = g.createRadialGradient(W / 2, H * 0.55, 0, W / 2, H * 0.55, W * 0.7);
    bg.addColorStop(0, hexA(col, 0.28)); bg.addColorStop(1, hexA(col, 0.02));
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    // projector cone from below
    g.fillStyle = hexA(col, 0.06);
    g.beginPath(); g.moveTo(W * 0.1, 0); g.lineTo(W * 0.9, 0); g.lineTo(W * 0.62, H); g.lineTo(W * 0.38, H); g.fill();

    g.save();
    const bob = Math.sin(t * 1.3) * H * 0.008;
    g.translate(W / 2, H * 0.5 + bob);
    const s = W / 100;
    const body = g.createLinearGradient(0, -40 * s, 0, 50 * s);
    body.addColorStop(0, hexA(col, 0.95)); body.addColorStop(1, hexA(col, 0.15));
    g.fillStyle = body; g.strokeStyle = hexA(col, 1); g.lineWidth = 1.2 * s;

    const P = (x) => x * s;
    const dim = hexA(col, 0.35), solid = hexA(col, 1), mid = hexA(col, 0.6), white = (al) => `rgba(255,255,255,${al})`;
    const blink = (t % 4.2) < 0.12 ? 0.2 : 1;
    const face = (cx, cy, w) => {
      g.fillStyle = '#ffffff'; g.shadowColor = col; g.shadowBlur = P(6);
      g.fillRect(cx - P(8.5) * w, cy - P(2), P(5) * w, P(1.7) * blink); g.fillRect(cx + P(3.5) * w, cy - P(2), P(5) * w, P(1.7) * blink);
      const m = this.talk > 0 ? P(0.6 + Math.abs(Math.sin(t * 19)) * 3) : P(0.8);
      g.fillRect(cx - P(4.5), cy + P(11), P(9), m);
      g.shadowBlur = 0;
    };
    const torso = (pads) => {
      g.fillStyle = body;
      g.beginPath();
      g.moveTo(P(-48), P(54)); g.quadraticCurveTo(P(-47), P(26), P(-22), P(17));
      g.lineTo(P(22), P(17)); g.quadraticCurveTo(P(47), P(26), P(48), P(54)); g.closePath(); g.fill();
      if (pads) { g.fillStyle = mid; for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(P(33 * sx), P(26), P(13), P(7), sx * 0.35, 0, 6.283); g.fill(); } }
    };

    if (look.kind === 'emblem') {
      g.rotate(t * 0.4);
      for (let i = 0; i < 3; i++) { g.beginPath(); g.ellipse(0, 0, P(30), P(12), i * Math.PI / 3, 0, 6.283); g.stroke(); }
      g.beginPath(); g.arc(0, 0, P(6), 0, 6.283); g.fill();
    } else if (look.kind === 'pilot') {
      // flight suit with padded shoulders, harness, helmet neck seal, oxygen hose
      if (look.ponytail) { g.fillStyle = mid; g.beginPath(); g.ellipse(P(21), P(8), P(5), P(15), -0.25, 0, 6.283); g.fill(); }
      torso(true);
      g.strokeStyle = white(0.55); g.lineWidth = P(2.6);
      g.beginPath(); g.moveTo(P(-24), P(19)); g.lineTo(P(0), P(42)); g.lineTo(P(24), P(19)); g.moveTo(P(-30), P(38)); g.lineTo(P(30), P(38)); g.stroke();
      g.fillStyle = white(0.7); g.beginPath(); g.arc(0, P(41), P(4), 0, 6.283); g.fill();
      g.strokeStyle = solid; g.lineWidth = P(2);
      g.beginPath(); g.ellipse(0, P(15), P(17), P(4.5), 0, 0, 6.283); g.stroke();
      // oxygen hose (ribbed)
      g.strokeStyle = mid; g.lineWidth = P(4);
      g.beginPath(); g.moveTo(P(-7), P(6)); g.bezierCurveTo(P(-16), P(18), P(-10), P(30), P(-20), P(46)); g.stroke();
      g.strokeStyle = white(0.35); g.lineWidth = P(1); g.setLineDash([P(1.5), P(2)]);
      g.beginPath(); g.moveTo(P(-7), P(6)); g.bezierCurveTo(P(-16), P(18), P(-10), P(30), P(-20), P(46)); g.stroke(); g.setLineDash([]);
      // helmet shell + ear cups
      g.fillStyle = body;
      g.beginPath(); g.ellipse(0, P(-12), P(23), P(26), 0, 0, 6.283); g.fill();
      g.fillStyle = mid;
      for (const sx of [-1, 1]) { g.beginPath(); g.roundRect?.(P(sx > 0 ? 18 : -25), P(-14), P(7), P(16), P(3)); g.fill(); }
      if (look.stripe) { g.fillStyle = white(0.55); g.fillRect(P(-2.5), P(-38), P(5), P(16)); }
      if (look.visor === 'down') {
        const vg = g.createLinearGradient(P(-14), P(-24), P(14), P(6));
        vg.addColorStop(0, 'rgba(0,0,0,0.75)'); vg.addColorStop(0.55, 'rgba(0,0,0,0.55)'); vg.addColorStop(1, hexA(col, 0.4));
        g.fillStyle = vg; g.beginPath(); g.ellipse(0, P(-8), P(17), P(15), 0, 0, 6.283); g.fill();
        g.strokeStyle = white(0.6); g.lineWidth = P(1.6);
        g.beginPath(); g.moveTo(P(-10), P(-18)); g.lineTo(P(2), P(-3)); g.stroke();
        g.strokeStyle = solid; g.lineWidth = P(1.2); g.beginPath(); g.ellipse(0, P(-8), P(17), P(15), 0, 0, 6.283); g.stroke();
        if (this.talk > 0 && Math.sin(t * 20) > 0) { g.fillStyle = '#fff'; g.fillRect(P(-1.5), P(8), P(3), P(3)); }
      } else {
        // visor raised: face visible in the opening, dark visor band on the forehead
        g.fillStyle = hexA(col, 0.22); g.beginPath(); g.ellipse(0, P(-5), P(14) * (look.jaw || 1), P(16), 0, 0, 6.283); g.fill();
        g.fillStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); g.ellipse(0, P(-27), P(19), P(7), 0, Math.PI, 0); g.fill(); g.fillRect(P(-19), P(-27), P(38), P(3));
        g.strokeStyle = white(0.45); g.lineWidth = P(1); g.beginPath(); g.moveTo(P(-12), P(-29)); g.lineTo(P(8), P(-31)); g.stroke();
        face(0, P(-10), 1);
        if (look.mask) { g.fillStyle = mid; g.beginPath(); g.ellipse(P(-14), P(6), P(5), P(4), 0.4, 0, 6.283); g.fill(); }
      }
    } else if (look.kind === 'cyborg') {
      torso(true);
      g.strokeStyle = white(0.4); g.lineWidth = P(1.2);
      for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(P(-40 + i * 6), P(30 + i * 5)); g.lineTo(P(-20 + i * 4), P(22 + i * 5)); g.moveTo(P(40 - i * 6), P(30 + i * 5)); g.lineTo(P(20 - i * 4), P(22 + i * 5)); g.stroke(); }
      g.strokeStyle = mid; g.lineWidth = P(2.2);
      for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(P(10 * sx), P(4)); g.bezierCurveTo(P(16 * sx), P(14), P(22 * sx), P(14), P(26 * sx), P(24)); g.stroke(); }
      g.fillStyle = body;
      g.beginPath(); g.moveTo(P(-18), P(-30)); g.lineTo(P(18), P(-30)); g.lineTo(P(20), P(-6)); g.lineTo(P(10), P(10)); g.lineTo(P(-10), P(10)); g.lineTo(P(-20), P(-6)); g.closePath(); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.beginPath(); g.moveTo(P(-16), P(-16)); g.lineTo(P(16), P(-16)); g.lineTo(P(9), P(4)); g.lineTo(P(-9), P(4)); g.closePath(); g.fill();
      g.fillStyle = '#fff'; g.shadowColor = col; g.shadowBlur = P(10);
      g.fillRect(P(-12), P(-11), P(24), P(2.4)); g.shadowBlur = 0;
      g.fillStyle = solid; g.beginPath(); g.moveTo(P(-6), P(-30)); g.lineTo(0, P(-46)); g.lineTo(P(6), P(-30)); g.fill();
      if (this.talk > 0) { g.fillStyle = white(0.8); g.fillRect(P(-6), P(0), P(12), P(0.6 + Math.abs(Math.sin(t * 17)) * 2)); }
    } else {
      // officer / crew: uniform tunic with high collar
      torso(false);
      g.fillStyle = mid; g.fillRect(P(-11), P(9), P(22), P(11));
      g.strokeStyle = white(0.5); g.lineWidth = P(1);
      g.beginPath(); g.moveTo(P(-11), P(9)); g.lineTo(P(11), P(9)); g.moveTo(P(4), P(20)); g.lineTo(P(14), P(54)); g.stroke();
      if (look.kind === 'officer') {
        for (const sx of [-1, 1]) {
          g.fillStyle = mid; g.fillRect(P(sx > 0 ? 22 : -38), P(19), P(16), P(5));
          g.fillStyle = white(0.8); for (let r = 0; r < look.rank; r++) g.fillRect(P((sx > 0 ? 24 : -36) + r * 4.5), P(20), P(2.4), P(3));
        }
        g.fillStyle = white(0.7); for (let r = 0; r < look.rank; r++) g.fillRect(P(-9 + r * 3.2), P(12), P(2), P(2));
      }
      if (look.medic) { g.fillStyle = white(0.85); g.fillRect(P(-34), P(26), P(8), P(2.4)); g.fillRect(P(-31.2), P(23.2), P(2.4), P(8)); }
      g.fillStyle = hexA(col, 0.6); g.fillRect(P(-6), P(2), P(12), P(9));
      g.fillStyle = body; g.beginPath(); g.ellipse(0, P(-10), P(16), P(20), 0, 0, 6.283); g.fill();
      g.fillStyle = solid;
      if (look.hair === 'short') { g.beginPath(); g.ellipse(0, P(-20), P(16.5), P(11), 0, Math.PI, 0); g.fill(); g.fillRect(P(-16.5), P(-21), P(4), P(9)); g.fillRect(P(12.5), P(-21), P(4), P(9)); }
      if (look.hair === 'receding') { g.beginPath(); g.ellipse(0, P(-23), P(15), P(6), 0, Math.PI, 0); g.fill(); g.fillRect(P(-16), P(-22), P(3), P(10)); g.fillRect(P(13), P(-22), P(3), P(10)); }
      face(0, P(-10), 0.95);
      if (look.headset) {
        g.strokeStyle = solid; g.lineWidth = P(2.4);
        g.beginPath(); g.arc(0, P(-10), P(19), Math.PI * 1.08, Math.PI * 1.92); g.stroke();
        g.fillStyle = solid; g.beginPath(); g.roundRect?.(P(-21), P(-14), P(6), P(11), P(2)); g.fill();
        g.lineWidth = P(1.6); g.beginPath(); g.moveTo(P(-18), P(-4)); g.quadraticCurveTo(P(-15), P(6), P(-5), P(4)); g.stroke();
      }
      if (look.earpiece) { g.fillStyle = white(0.9); g.beginPath(); g.arc(P(16), P(-8), P(2), 0, 6.283); g.fill(); g.strokeStyle = white(0.5); g.lineWidth = P(0.8); g.beginPath(); g.moveTo(P(16), P(-6)); g.quadraticCurveTo(P(17), P(4), P(12), P(10)); g.stroke(); }
    }
    g.restore();

    // scanlines
    g.fillStyle = 'rgba(0,0,0,0.38)';
    for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
    // moving scan band
    const by = ((t * 0.45) % 1.3 - 0.15) * H;
    const band = g.createLinearGradient(0, by - H * 0.08, 0, by + H * 0.08);
    band.addColorStop(0, hexA(col, 0)); band.addColorStop(0.5, hexA(col, 0.35)); band.addColorStop(1, hexA(col, 0));
    g.fillStyle = band; g.fillRect(0, by - H * 0.08, W, H * 0.16);
    // noise
    g.fillStyle = hexA(col, 0.5);
    if (!reduced) for (let i = 0; i < 30; i++) g.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5);
    // glitch slices
    this.glitchT -= 1 / 60;
    if (!reduced && (this.glitchT > 0 || Math.random() < 0.012)) {
      for (let i = 0; i < 3; i++) {
        const y = Math.random() * H, h = 3 + Math.random() * H * 0.08, dx = (Math.random() - 0.5) * W * 0.18;
        g.drawImage(c, 0, y, W, h, dx, y, W, h);
      }
    }
    // frame
    g.strokeStyle = hexA(col, 0.8); g.lineWidth = 2;
    const k = W * 0.18;
    g.beginPath();
    g.moveTo(1, k); g.lineTo(1, 1); g.lineTo(k, 1);
    g.moveTo(W - k, 1); g.lineTo(W - 1, 1); g.lineTo(W - 1, k);
    g.moveTo(W - 1, H - k); g.lineTo(W - 1, H - 1); g.lineTo(W - k, H - 1);
    g.moveTo(k, H - 1); g.lineTo(1, H - 1); g.lineTo(1, H - k);
    g.stroke();
  }
}

/** Audio-style signal bars that react while text is "transmitting". */
export class Waveform {
  constructor(canvas) {
    this.c = canvas; this.g = canvas.getContext('2d'); this.level = 0; this.color = '#7fd6ff'; this._on = false;
    this.vals = new Float32Array(32);
    this.loop = () => { if (!this._on) return; this.draw(); requestAnimationFrame(this.loop); };
  }
  get on() { return this._on; }
  set on(v) { if (v && !this._on) { this._on = true; requestAnimationFrame(this.loop); } else if (!v) this._on = false;
  }
  draw() {
    const { c, g, vals } = this, W = c.width, H = c.height, n = vals.length;
    g.clearRect(0, 0, W, H);
    g.fillStyle = this.color;
    for (let i = 0; i < n; i++) {
      const target = this.level * (0.25 + Math.random() * 0.75) * (1 - Math.abs(i / n - 0.5) * 1.1);
      vals[i] += (target - vals[i]) * 0.35;
      const h = Math.max(1, vals[i] * H);
      g.globalAlpha = 0.45 + vals[i] * 0.55;
      g.fillRect(i * (W / n) + 1, (H - h) / 2, W / n - 2, h);
    }
    g.globalAlpha = 1;
  }
}

/** Adds sci-fi corner brackets + scan sweep layers to a panel element. */
export function decorate(el) {
  if (el._decor) return;
  el._decor = true;
  for (const k of ['tl', 'tr', 'bl', 'br']) {
    const i = document.createElement('i');
    i.className = `cn ${k}`;
    el.appendChild(i);
  }
  const sw = document.createElement('i');
  sw.className = 'sweep';
  el.appendChild(sw);
}

/** Set a label's text, stopping any running scramble so it cannot overwrite the new text. */
export function setLabel(el, text) {
  el._scr?.cancel(); el._dec?.cancel();
  el.textContent = text;
  el.dataset.label = text;
}
