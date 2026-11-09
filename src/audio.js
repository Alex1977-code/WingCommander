/** Fully synthesized audio (WebAudio) – no asset files needed. */
export class Audio {
  constructor() { this.ctx = null; this.enabled = true; this.engine = null; this.music = null; }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.8 : 0;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp); comp.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startMusic();
  }

  setEnabled(v) {
    this.enabled = v;
    if (this.master) this.master.gain.setTargetAtTime(v ? 0.8 : 0, this.ctx.currentTime, 0.05);
  }

  tone(type, f0, f1, dur, vol) {
    if (!this.ctx || !this.enabled || vol < 0.01) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noise(dur, vol, f0, f1, q = 0.8) {
    if (!this.ctx || !this.enabled || vol < 0.01) return;
    const t = this.ctx.currentTime, s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    s.buffer = this.noiseBuf; s.loop = true;
    f.type = 'lowpass'; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }

  laser(vol = 0.25, enemy = false) { this.tone(enemy ? 'square' : 'sawtooth', enemy ? 520 : 1250, enemy ? 110 : 190, 0.14, vol * (enemy ? 0.5 : 1)); }
  explosion(vol = 0.6, big = false) { this.noise(big ? 2.2 : 1.1, vol, big ? 900 : 1500, 40); this.tone('sine', big ? 70 : 110, 28, big ? 1.2 : 0.6, vol * 0.8); }
  hit(shield) { if (shield) this.tone('sine', 900, 300, 0.18, 0.3); else { this.noise(0.22, 0.5, 2600, 200); this.tone('square', 160, 50, 0.16, 0.25); } }
  missile() { this.noise(0.9, 0.35, 500, 3200, 2); }
  beep(f = 880, vol = 0.14) { this.tone('sine', f, f, 0.08, vol); }
  lock() { this.tone('square', 1500, 1500, 0.06, 0.08); }
  warn() { this.tone('square', 700, 480, 0.2, 0.16); }
  warp() { this.noise(1.1, 0.4, 200, 5000, 3); this.tone('sine', 120, 900, 1.0, 0.2); }

  startEngine() {
    if (!this.ctx || this.engine) return;
    const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    s.buffer = this.noiseBuf; s.loop = true;
    f.type = 'lowpass'; f.frequency.value = 200; f.Q.value = 3;
    g.gain.value = 0;
    const o = this.ctx.createOscillator(), og = this.ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = 55; og.gain.value = 0;
    s.connect(f); f.connect(g); g.connect(this.master);
    o.connect(og); og.connect(this.master);
    s.start(); o.start();
    this.engine = { s, f, g, o, og };
  }
  setEngine(throttle, boost) {
    if (!this.engine) return;
    const t = this.ctx.currentTime, e = this.engine;
    e.f.frequency.setTargetAtTime(160 + throttle * 420 + (boost ? 900 : 0), t, 0.15);
    e.g.gain.setTargetAtTime(0.05 + throttle * 0.07 + (boost ? 0.16 : 0), t, 0.15);
    e.o.frequency.setTargetAtTime(42 + throttle * 34 + (boost ? 30 : 0), t, 0.2);
    e.og.gain.setTargetAtTime(0.02 + throttle * 0.02, t, 0.2);
  }
  stopEngine() {
    if (!this.engine) return;
    const e = this.engine; this.engine = null;
    try { e.s.stop(); e.o.stop(); } catch { /* already stopped */ }
  }

  /** Slow generative ambient pad. */
  startMusic() {
    if (!this.ctx || this.music) return;
    const out = this.ctx.createGain();
    out.gain.value = 0.05;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900;
    out.connect(lp); lp.connect(this.master);
    const chords = [[110, 164.8, 220, 261.6], [98, 146.8, 196, 246.9], [87.3, 130.8, 174.6, 220], [103.8, 155.6, 207.7, 246.9]];
    const voices = chords[0].map((f, i) => {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = i % 2 ? 'triangle' : 'sawtooth';
      o.frequency.value = f; o.detune.value = (i - 1.5) * 7;
      g.gain.value = 0.5;
      o.connect(g); g.connect(out); o.start();
      return o;
    });
    let idx = 0;
    const timer = setInterval(() => {
      if (!this.ctx) return;
      idx = (idx + 1) % chords.length;
      voices.forEach((o, i) => o.frequency.setTargetAtTime(chords[idx][i], this.ctx.currentTime, 1.5));
    }, 7000);
    this.music = { out, voices, timer };
  }
}
