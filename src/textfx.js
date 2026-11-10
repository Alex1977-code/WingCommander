/** Sci-fi text effects: decode/scramble reveal, glitch titles, hologram portraits, signal waveforms. */

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&@$<>/\\|=+*ΣΔΞΨΩ';
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
  if (!el._lockW) { const r = el.getBoundingClientRect(); if (r.width) { el._lockW = true; el.style.width = r.width + 'px'; } }
  const h = el._scr = decode(el, text, { cps: Math.max(12, text.length / (ms / 1000)), window: 4, pad: true });
  h.done.then(() => { if (el._scr === h && el._lockW) { el._lockW = false; el.style.width = ''; } });
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
  brandt: { head: 0.9, hair: 'bun', cap: true },
  rook: { head: 1.05, hair: 'short', jaw: 1.1 },
  kolibri: { head: 0.92, hair: 'long' },
  veyl: { head: 1.0, hair: 'mask' },
  flug: { head: 0.95, hair: 'headset' },
  samariter: { head: 0.95, hair: 'headset' },
  erz: { head: 1, hair: 'emblem' },
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
    this.talk = 0; this.glitchT = 0; this.alive = true; this.on = false;
    this.t0 = performance.now();
    const loop = (now) => { if (!this.alive) return; if (this.on) this.draw(now); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
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

    if (look.hair === 'emblem') {
      // narrator: rotating wireframe sigil
      g.rotate(t * 0.4);
      for (let i = 0; i < 3; i++) {
        g.beginPath(); g.ellipse(0, 0, 30 * s, 12 * s, i * Math.PI / 3, 0, 6.283); g.stroke();
      }
      g.beginPath(); g.arc(0, 0, 6 * s, 0, 6.283); g.fill();
    } else {
      // shoulders
      g.beginPath();
      g.moveTo(-46 * s, 52 * s); g.quadraticCurveTo(-44 * s, 22 * s, -18 * s, 18 * s);
      g.lineTo(18 * s, 18 * s); g.quadraticCurveTo(44 * s, 22 * s, 46 * s, 52 * s); g.closePath(); g.fill();
      // collar / rank lines
      g.strokeStyle = hexA('#ffffff', 0.5);
      g.beginPath(); g.moveTo(-14 * s, 20 * s); g.lineTo(0, 34 * s); g.lineTo(14 * s, 20 * s); g.stroke();
      // neck
      g.fillStyle = hexA(col, 0.6); g.fillRect(-7 * s, 6 * s, 14 * s, 14 * s);
      // head
      const hw = 17 * s * look.head, hh = 22 * s;
      g.fillStyle = body;
      g.beginPath(); g.ellipse(0, -8 * s, hw, hh, 0, 0, 6.283); g.fill();
      if (look.jaw) { g.fillRect(-hw * 0.8, -4 * s, hw * 1.6, 12 * s * look.jaw); }
      g.fillStyle = hexA(col, 1);
      if (look.hair === 'short') { g.beginPath(); g.ellipse(0, -22 * s, hw * 1.02, 11 * s, 0, Math.PI, 0); g.fill(); }
      if (look.hair === 'long') {
        g.beginPath(); g.ellipse(0, -18 * s, hw * 1.12, 15 * s, 0, Math.PI, 0); g.fill();
        g.fillRect(-hw * 1.12, -18 * s, 7 * s, 34 * s); g.fillRect(hw * 1.12 - 7 * s, -18 * s, 7 * s, 34 * s);
      }
      if (look.hair === 'bun') { g.beginPath(); g.ellipse(0, -22 * s, hw * 1.02, 10 * s, 0, Math.PI, 0); g.fill(); g.beginPath(); g.arc(0, -33 * s, 6 * s, 0, 6.283); g.fill(); }
      if (look.cap) { g.fillRect(-hw * 1.1, -27 * s, hw * 2.2, 4 * s); }
      if (look.hair === 'headset') {
        g.lineWidth = 2.4 * s; g.strokeStyle = hexA(col, 1);
        g.beginPath(); g.arc(0, -10 * s, hw * 1.15, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
        g.beginPath(); g.moveTo(-hw * 1.1, -4 * s); g.quadraticCurveTo(-hw * 0.9, 12 * s, -4 * s, 8 * s); g.stroke();
      }
      if (look.hair === 'mask') {
        g.fillStyle = hexA('#000000', 0.55);
        g.beginPath(); g.moveTo(-hw, -14 * s); g.lineTo(hw, -14 * s); g.lineTo(hw * 0.6, 8 * s); g.lineTo(0, 14 * s); g.lineTo(-hw * 0.6, 8 * s); g.closePath(); g.fill();
        g.fillStyle = '#fff'; g.shadowColor = col; g.shadowBlur = 10 * s;
        g.fillRect(-hw * 0.7, -9 * s, hw * 1.4, 2.4 * s);
        g.shadowBlur = 0;
        // horns / crest
        g.fillStyle = hexA(col, 1);
        g.beginPath(); g.moveTo(-hw * 0.3, -28 * s); g.lineTo(0, -42 * s); g.lineTo(hw * 0.3, -28 * s); g.fill();
      } else {
        // eyes + mouth
        const blink = (t % 4.2) < 0.12 ? 0.2 : 1;
        g.fillStyle = '#ffffff'; g.shadowColor = col; g.shadowBlur = 6 * s;
        g.fillRect(-9 * s, -10 * s, 5.5 * s, 1.8 * s * blink); g.fillRect(3.5 * s, -10 * s, 5.5 * s, 1.8 * s * blink);
        const m = this.talk > 0 ? (0.6 + Math.abs(Math.sin(t * 19)) * 3.2) * s : 0.8 * s;
        g.fillRect(-5 * s, 4 * s, 10 * s, m);
        g.shadowBlur = 0;
      }
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
    for (let i = 0; i < 30; i++) g.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5);
    // glitch slices
    this.glitchT -= 1 / 60;
    if (this.glitchT > 0 || Math.random() < 0.012) {
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
    this.c = canvas; this.g = canvas.getContext('2d'); this.level = 0; this.color = '#7fd6ff'; this.on = false;
    this.vals = new Float32Array(32);
    const loop = () => { if (this.on) this.draw(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
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
