/**
 * Input layer. Every controller exposes the same interface:
 *   x, y          stick in [-1, 1]; y > 0 = stick pulled down (screen convention)
 *   firing, boosting
 *   throttleSet   absolute throttle (0..1) or null, consumed by the pilot
 *   throttleRate  -1..1 continuous change
 *   take()        flight events: 'missile' | 'target' | 'auto' | 'pause'
 *   buzz(ms)      optional haptic feedback
 * Menu events ('up','down','left','right','ok','back','start') go to the hub's menu queue.
 */

const clamp = (v) => Math.max(-1, Math.min(1, v));

export class TouchKeys {
  constructor(hub) {
    this.hub = hub;
    this.kind = 'local'; this.name = 'Touch / Tastatur';
    this.x = 0; this.y = 0; this.kx = 0; this.ky = 0;
    this.fireBtn = false; this.boostBtn = false;
    this.throttleSet = null; this.throttleRate = 0;
    this.events = [];
    this.keys = {};
    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };

    const $ = (id) => document.getElementById(id);
    const zone = $('stick-zone'), base = $('stick-base'), knob = $('stick-knob');
    const R = 56;
    const setKnob = () => { knob.style.transform = `translate(${this.stick.x * R}px, ${this.stick.y * R}px)`; };
    zone.addEventListener('pointerdown', (e) => {
      if (this.stick.id !== null) return;
      this.stick.id = e.pointerId;
      this.stick.ox = e.clientX; this.stick.oy = e.clientY;
      base.style.left = e.clientX + 'px'; base.style.top = e.clientY + 'px';
      base.classList.add('on');
      zone.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stick.id) return;
      let dx = (e.clientX - this.stick.ox) / R, dy = (e.clientY - this.stick.oy) / R;
      const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      this.stick.x = dx; this.stick.y = dy;
      setKnob();
    });
    const end = (e) => {
      if (e.pointerId !== this.stick.id) return;
      this.stick.id = null; this.stick.x = this.stick.y = 0;
      base.classList.remove('on');
      setKnob();
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    const hold = (id, prop) => {
      const el = $(id);
      // track every finger on the button: lifting one of two fingers must not release it
      const ids = new Set(); (this.holdIds ||= []).push(ids);
      const on = (e) => { ids.add(e.pointerId); this[prop] = true; el.classList.add('down'); el.setPointerCapture(e.pointerId); e.preventDefault(); };
      const off = (e) => { ids.delete(e.pointerId); if (ids.size) return; this[prop] = false; el.classList.remove('down'); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('lostpointercapture', off);
    };
    hold('btn-fire', 'fireBtn');
    hold('btn-boost', 'boostBtn');
    const tap = (id, ev) => $(id).addEventListener('pointerdown', (e) => { this.events.push(ev); e.preventDefault(); });
    // missiles fire on a deliberate tap: finger lifted on the button within 0.8 s, so a thumb that
    // brushes the button while reaching for FEUER does not launch anything
    {
      const el = $('btn-msl'); let id = null, t0 = 0, last = 0;
      el.addEventListener('pointerdown', (e) => { id = e.pointerId; t0 = performance.now(); el.classList.add('down'); el.setPointerCapture(e.pointerId); e.preventDefault(); });
      const done = (e, ok) => {
        if (e.pointerId !== id) return;
        id = null; el.classList.remove('down');
        const r = el.getBoundingClientRect(), now = performance.now();
        const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (ok && inside && now - t0 < 800 && now - last > 500) { last = now; this.events.push('missile'); }
      };
      el.addEventListener('pointerup', (e) => done(e, true));
      el.addEventListener('pointercancel', (e) => done(e, false));
    }
    tap('btn-tgt', 'target'); tap('btn-auto', 'auto'); tap('btn-pause', 'pause'); tap('btn-view', 'view');

    const thr = $('throttle');
    const setThr = (e) => {
      const r = thr.getBoundingClientRect();
      this.throttleSet = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    };
    thr.addEventListener('pointerdown', (e) => { thr.setPointerCapture(e.pointerId); setThr(e); e.preventDefault(); });
    thr.addEventListener('pointermove', (e) => { if (thr.hasPointerCapture(e.pointerId)) setThr(e); });

    const MENU = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'ok', Space: 'ok', Escape: 'back', Backspace: 'back' };
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (MENU[e.code]) {
        if (!e.repeat || e.code.startsWith('Arrow')) hub.menu(MENU[e.code]);
        if (e.target instanceof HTMLButtonElement || e.target === document.body) e.preventDefault();
      }
      if (e.repeat) return;
      this.keys[e.code] = true;
      if (e.code === 'KeyM' || e.code === 'Enter') this.events.push('missile');
      if (e.code === 'KeyT') this.events.push('target');
      if (e.code === 'KeyJ') this.events.push('auto');
      if (e.code === 'KeyV' || e.code === 'KeyC') this.events.push('view');
      if (e.code === 'Escape' || e.code === 'KeyP') this.events.push('pause');
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; this.fireBtn = this.boostBtn = false; });
    // safety net: when no finger is on the screen any more, nothing can still be held
    const allUp = () => {
      this.fireBtn = this.boostBtn = false; for (const ids of this.holdIds || []) ids.clear();
      $('btn-fire').classList.remove('down'); $('btn-boost').classList.remove('down');
      if (this.stick.id !== null) { this.stick.id = null; this.stick.x = this.stick.y = 0; base.classList.remove('on'); setKnob(); }
    };
    window.addEventListener('touchend', (e) => { if (!e.touches.length) allUp(); }, true);
    window.addEventListener('touchcancel', (e) => { if (!e.touches.length) allUp(); }, true);
    document.addEventListener('visibilitychange', () => { if (document.hidden) allUp(); });
  }

  update(dt) {
    const k = this.keys;
    const tx = (k.ArrowRight || k.KeyD ? 1 : 0) - (k.ArrowLeft || k.KeyA ? 1 : 0);
    const ty = (k.ArrowDown || k.KeyS ? 1 : 0) - (k.ArrowUp || k.KeyW ? 1 : 0);
    const a = Math.min(1, dt * 8);
    this.kx += (tx - this.kx) * a; this.ky += (ty - this.ky) * a;
    this.x = clamp(this.stick.x + this.kx);
    this.y = clamp(this.stick.y + this.ky);
    this.throttleRate = (k.KeyE || k.Equal ? 1 : 0) - (k.KeyQ || k.Minus ? 1 : 0);
  }
  get firing() { return this.fireBtn || !!this.keys.Space; }
  get boosting() { return this.boostBtn || !!this.keys.ShiftLeft || !!this.keys.ShiftRight; }
  take() { const e = this.events; this.events = []; return e; }
  reset() { this.events = []; this.fireBtn = this.boostBtn = false; this.keys = {}; this.throttleSet = null; }
  buzz(ms) { if (navigator.vibrate) try { navigator.vibrate(ms); } catch { /* ignore */ } }
}

/** Standard-mapping gamepad (Xbox / PlayStation / Switch Pro / most Bluetooth pads). */
export class GamepadDevice {
  constructor(hub, index, id) {
    this.hub = hub; this.index = index; this.kind = 'gamepad';
    this.name = id.replace(/\(.*?\)/g, '').trim().slice(0, 32) || `Gamepad ${index + 1}`;
    this.x = 0; this.y = 0; this.firing = false; this.boosting = false;
    this.throttleSet = null; this.throttleRate = 0;
    this.events = []; this.prev = []; this.navT = 0; this.pad = null;
  }
  poll(dt, pads) {
    const p = pads[this.index];
    if (!p) return;
    this.pad = p;
    // Phones expose built-in sensors (fingerprint reader etc.) as "gamepads" whose buttons read as held
    // and whose axes sit at the end stop. A button only counts once it has been seen released,
    // an axis only once it has been seen near its centre - otherwise they would fire / steer forever.
    const raw = (i) => !!(p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.5));
    this.up ||= []; this.centred ||= [];
    for (let i = 0; i < p.buttons.length; i++) if (!raw(i)) this.up[i] = true;
    for (let i = 0; i < p.axes.length; i++) if (Math.abs(p.axes[i] || 0) < 0.2) this.centred[i] = true;
    const b = (i) => !!this.up[i] && raw(i);
    if (!this.inited) { this.inited = true; for (let i = 0; i < p.buttons.length; i++) this.prev[i] = b(i); return; }
    const dz = (v) => (Math.abs(v) < 0.14 ? 0 : (v - Math.sign(v) * 0.14) / 0.86);
    const axis = (i) => (this.centred[i] ? dz(p.axes[i] || 0) : 0);
    const ax = axis(0), ay = axis(1);
    this.x = ax; this.y = ay;
    this.firing = b(7) || b(0);
    this.boosting = b(6) || b(4);
    const ry = axis(3);
    this.throttleRate = clamp(-ry + (b(12) ? 1 : 0) - (b(13) ? 1 : 0));
    const edge = (i) => b(i) && !this.prev[i];
    if (edge(2) || edge(5)) this.events.push('missile');
    if (edge(3)) this.events.push('target');
    if (edge(8)) this.events.push('auto');
    if (edge(10) || edge(11)) this.events.push('view');
    if (edge(9)) this.events.push('pause');
    // menu navigation (with stick auto-repeat)
    if (edge(0)) this.hub.menu('ok');
    if (edge(1)) this.hub.menu('back');
    if (edge(9)) this.hub.menu('start');
    const dir = b(12) || ay < -0.6 ? 'up' : b(13) || ay > 0.6 ? 'down' : b(14) || ax < -0.6 ? 'left' : b(15) || ax > 0.6 ? 'right' : null;
    this.navT -= dt;
    if (dir && (dir !== this.navDir || this.navT <= 0)) { this.hub.menu(dir); this.navT = dir === this.navDir ? 0.14 : 0.38; }
    this.navDir = dir;
    for (let i = 0; i < p.buttons.length; i++) this.prev[i] = b(i);
  }
  take() { const e = this.events; this.events = []; return e; }
  reset() { this.events = []; }
  release() { this.x = this.y = 0; this.firing = this.boosting = false; this.throttleRate = 0; this.throttleSet = null; this.events = []; }
  buzz(ms) {
    try { this.pad?.vibrationActuator?.playEffect('dual-rumble', { duration: ms, strongMagnitude: 0.6, weakMagnitude: 0.4 }); } catch { /* ignore */ }
  }
}

/** A phone acting as controller (data arrives over WebRTC or the Presentation API). */
export class RemoteDevice {
  constructor(hub, transport, name) {
    this.hub = hub; this.transport = transport; this.kind = 'remote';
    this.name = (typeof name === 'string' && name.trim() ? name : 'Handy-Controller').slice(0, 24);
    this.x = 0; this.y = 0; this.firing = false; this.boosting = false;
    this.throttleSet = null; this.throttleRate = 0; this.events = [];
    transport.onMessage((m) => this.onMessage(m));
  }
  onMessage(m) {
    if (!m || typeof m !== 'object') return;
    this.lastMsg = performance.now();
    if (m.t === 's') {
      this.x = Number.isFinite(m.x) ? clamp(m.x) : 0; this.y = Number.isFinite(m.y) ? clamp(m.y) : 0;
      this.firing = !!m.f; this.boosting = !!m.b;
      if (Number.isFinite(m.th) && Math.abs(m.th - (this.lastTh ?? -1)) > 0.002) { this.lastTh = m.th; this.throttleSet = Math.max(0, Math.min(1, m.th)); }
    } else if (m.t === 'e') {
      if (['missile', 'target', 'auto', 'pause', 'view'].includes(m.e) && this.events.length < 16) this.events.push(m.e);
    } else if (m.t === 'm') {
      if (['up', 'down', 'left', 'right', 'ok', 'back', 'start'].includes(m.e)) this.hub.menu(m.e);
    } else if (m.t === 'hello' && typeof m.name === 'string') {
      const name = m.name.trim().slice(0, 24) || 'Handy-Controller';
      if (name !== this.name) { this.name = name; this.hub.changed(); }
    }
  }
  send(m) { try { this.transport.send(m); } catch { /* closed */ } }
  take() { const e = this.events; this.events = []; return e; }
  // forget the last throttle so the phone's slider position is applied again on the next keep-alive
  reset() { this.events = []; this.lastTh = undefined; }
  release() { this.x = this.y = 0; this.firing = this.boosting = false; this.throttleRate = 0; this.throttleSet = null; this.events = []; }
  buzz(ms) { this.send({ t: 'buzz', ms }); }
}

/** Combines several controllers into one (used when multiple devices steer the same ship). */
export class Merged {
  constructor(list) { this.src = typeof list === 'function' ? list : () => list; this.throttleSet = null; this.throttleRate = 0; }
  get list() { return this.src().filter(Boolean); }
  update() {
    let x = 0, y = 0;
    this.throttleSet = null; this.throttleRate = 0;
    for (const c of this.list) {
      x += c.x; y += c.y;
      if (c.throttleSet != null) { this.throttleSet = c.throttleSet; c.throttleSet = null; }
      this.throttleRate += c.throttleRate;
    }
    this.x = clamp(x); this.y = clamp(y); this.throttleRate = clamp(this.throttleRate);
  }
  get firing() { return this.list.some((c) => c.firing); }
  get boosting() { return this.list.some((c) => c.boosting); }
  take() { return this.list.flatMap((c) => c.take()); }
  reset() { this.list.forEach((c) => c.reset()); }
  buzz(ms) { this.list.forEach((c) => c.buzz?.(ms)); }
}

/** Owns all devices, assigns them to pilots, and collects menu navigation events. */
export class InputHub {
  constructor() {
    this.menuQ = [];
    this.devices = [];
    this.listeners = [];
    this.local = new TouchKeys(this);
    this.gamepadsOk = true;
    window.addEventListener('gamepadconnected', () => this.scanPads());
    window.addEventListener('gamepaddisconnected', () => this.scanPads());
  }
  menu(e) { this.menuQ.push(e); }
  takeMenu() { const q = this.menuQ; this.menuQ = []; return q; }
  onChange(cb) { this.listeners.push(cb); }
  changed() { this.listeners.forEach((cb) => cb()); }

  pads() {
    if (!this.gamepadsOk) return [];
    try { return navigator.getGamepads ? [...navigator.getGamepads()] : []; } catch { this.gamepadsOk = false; return []; }
  }
  scanPads() {
    const pads = this.pads();
    let dirty = false;
    for (const p of pads) {
      if (!p || p.mapping !== 'standard') continue; // non-standard 'pads' on phones are sensors, not controllers
      if (!this.devices.some((d) => d.kind === 'gamepad' && d.index === p.index)) {
        const d = new GamepadDevice(this, p.index, p.id);
        this.adopt(d); this.devices.push(d); dirty = true;
      }
    }
    const before = this.devices.length;
    this.devices = this.devices.filter((d) => { const keep = d.kind !== 'gamepad' || pads[d.index]; if (!keep) d.release(); return keep; });
    if (dirty || before !== this.devices.length) this.changed();
  }
  /** a device that joins while player 2's controller is gone takes over player 2 */
  adopt(d) { if (this.activeP2 && !this.devices.includes(this.activeP2)) this.activeP2 = d; }
  addRemote(transport, name) {
    const d = new RemoteDevice(this, transport, name);
    d.lastMsg = performance.now();
    this.adopt(d);
    this.devices.push(d);
    transport.onClose(() => { d.release(); this.devices = this.devices.filter((x) => x !== d); this.changed(); });
    this.changed();
    return d;
  }

  /** Poll gamepads each frame. */
  poll(dt) {
    const pads = this.pads();
    if (pads.some((p) => p && !this.devices.some((d) => d.kind === 'gamepad' && d.index === p.index))) this.scanPads();
    const now = performance.now();
    for (const d of this.devices) {
      if (d.kind === 'gamepad') d.poll(dt, pads);
      // a phone that went silent (screen locked, Wi-Fi lost) must not keep firing or steering
      else if (d.kind === 'remote' && now - (d.lastMsg || 0) > 1200) { d.x = d.y = 0; d.firing = d.boosting = false; }
    }
  }

  /** Returns one controller per pilot. In co-op the most recently joined device flies player 2. */
  assign(coop) {
    const devs = this.devices;
    if (coop && devs.length >= 1) {
      this.activeP2 = devs[devs.length - 1];
      // both pilots follow the live device list: a reconnecting player-2 controller is adopted by adopt()
      return [new Merged(() => [this.local, ...this.devices.filter((d) => d !== this.activeP2)]), new Merged(() => (this.devices.includes(this.activeP2) ? [this.activeP2] : []))];
    }
    this.activeP2 = null;
    return [new Merged(() => [this.local, ...this.devices])];
  }
  roleOf(dev, coop) {
    if (this.activeP2 !== undefined) return dev === this.activeP2 ? 2 : 1;
    if (coop && this.devices.length >= 1 && dev === this.devices[this.devices.length - 1]) return 2;
    return 1;
  }
}
