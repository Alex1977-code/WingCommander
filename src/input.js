/** Unified touch + keyboard input. y > 0 means "nose up". */
export class Input {
  constructor() {
    this.x = 0; this.y = 0;
    this.fire = false; this.boost = false;
    this.throttle = 0.75;
    this.invert = true;
    this.events = [];
    this.keys = {};
    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.kx = 0; this.ky = 0;

    const $ = (id) => document.getElementById(id);
    const zone = $('stick-zone'), base = $('stick-base'), knob = $('stick-knob');
    const R = 56;
    const setKnob = () => {
      knob.style.transform = `translate(${this.stick.x * R}px, ${this.stick.y * R}px)`;
    };
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
      const on = (e) => { this[prop] = true; el.classList.add('down'); el.setPointerCapture(e.pointerId); e.preventDefault(); };
      const off = () => { this[prop] = false; el.classList.remove('down'); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
    };
    hold('btn-fire', 'fire');
    hold('btn-boost', 'boost');
    const tap = (id, ev) => $(id).addEventListener('pointerdown', (e) => { this.events.push(ev); e.preventDefault(); });
    tap('btn-msl', 'missile'); tap('btn-tgt', 'target'); tap('btn-auto', 'auto'); tap('btn-pause', 'pause');

    const thr = $('throttle');
    const setThr = (e) => {
      const r = thr.getBoundingClientRect();
      this.throttle = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    };
    thr.addEventListener('pointerdown', (e) => { thr.setPointerCapture(e.pointerId); setThr(e); e.preventDefault(); });
    thr.addEventListener('pointermove', (e) => { if (thr.hasPointerCapture(e.pointerId)) setThr(e); });
    this.thrFill = $('throttle-fill');

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys[e.code] = true;
      if (e.code === 'KeyM' || e.code === 'Enter') this.events.push('missile');
      if (e.code === 'KeyT') this.events.push('target');
      if (e.code === 'KeyJ') this.events.push('auto');
      if (e.code === 'Escape' || e.code === 'KeyP') this.events.push('pause');
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; this.fire = this.boost = false; });
  }

  update(dt) {
    const k = this.keys;
    const tx = (k.ArrowRight || k.KeyD ? 1 : 0) - (k.ArrowLeft || k.KeyA ? 1 : 0);
    const ty = (k.ArrowDown || k.KeyS ? 1 : 0) - (k.ArrowUp || k.KeyW ? 1 : 0);
    const a = Math.min(1, dt * 8);
    this.kx += (tx - this.kx) * a; this.ky += (ty - this.ky) * a;
    const sx = this.stick.x + this.kx, sy = this.stick.y + this.ky;
    this.x = Math.max(-1, Math.min(1, sx));
    this.y = Math.max(-1, Math.min(1, sy)) * (this.invert ? 1 : -1);
    if (k.KeyE || k.Equal) this.throttle = Math.min(1, this.throttle + dt * 0.8);
    if (k.KeyQ || k.Minus) this.throttle = Math.max(0, this.throttle - dt * 0.8);
    this.thrFill.style.height = (this.throttle * 100) + '%';
  }

  get firing() { return this.fire || !!this.keys.Space; }
  get boosting() { return this.boost || !!this.keys.ShiftLeft || !!this.keys.ShiftRight; }
  take() { const e = this.events; this.events = []; return e; }
  reset() { this.events = []; this.fire = this.boost = false; this.keys = {}; this.throttle = 0.75; }
}
