/**
 * Fully synthesized audio (WebAudio) – no asset files.
 *  - Sound effects with layered synthesis, a shared reverb and a voice limit.
 *  - Adaptive music: an original score in D minor ("Nachtfalken-Thema") with moods
 *    menu · briefing · travel · combat · tension · sad · victory, cross-faded on change.
 */

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const N = (name) => {
  // 'D5', 'Bb4', 'C#5' → midi number
  const m = /^([A-G])(b|#)?(\d)$/.exec(name);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return base + (+m[3] + 1) * 12;
};
const chord = (...names) => names.map(N);

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------
// Main theme, 8 bars × 16 steps; null = hold/rest. Each entry: [step, note, lengthInSteps]
const THEME = [
  [[0, 'D5', 4], [6, 'A4', 2], [8, 'D5', 2], [10, 'F5', 4], [14, 'E5', 2]],
  [[0, 'C5', 4], [4, 'Bb4', 4], [8, 'A4', 4], [12, 'F4', 2], [14, 'G4', 2]],
  [[0, 'A4', 4], [4, 'C5', 2], [6, 'F5', 2], [8, 'E5', 4], [12, 'D5', 2], [14, 'C5', 2]],
  [[0, 'D5', 8], [8, 'E5', 4], [12, 'G5', 4]],
  [[0, 'F5', 4], [4, 'E5', 2], [6, 'D5', 2], [8, 'A5', 4], [12, 'G5', 2], [14, 'F5', 2]],
  [[0, 'G5', 4], [4, 'F5', 2], [6, 'D5', 2], [8, 'F5', 4], [12, 'E5', 2], [14, 'D5', 2]],
  [[0, 'C5', 4], [4, 'D5', 2], [6, 'E5', 2], [8, 'F5', 4], [12, 'A5', 4]],
  [[0, 'A5', 8], [8, 'E5', 4], [12, 'C#5', 4]],
];
const THEME_CHORDS = [
  chord('D3', 'A3', 'D4', 'F4'), chord('Bb2', 'F3', 'Bb3', 'D4'), chord('F2', 'C3', 'F3', 'A3'), chord('C3', 'G3', 'C4', 'E4'),
  chord('D3', 'A3', 'D4', 'F4'), chord('Bb2', 'F3', 'Bb3', 'D4'), chord('G2', 'D3', 'G3', 'Bb3'), chord('A2', 'E3', 'A3', 'C#4'),
];
// Lament for the fallen (Rook), slow, piano-like
const LAMENT = [
  [[0, 'A4', 6], [6, 'G4', 2], [8, 'F4', 4], [12, 'E4', 4]],
  [[0, 'D4', 8], [8, 'F4', 4], [12, 'A4', 4]],
  [[0, 'Bb4', 6], [6, 'A4', 2], [8, 'G4', 4], [12, 'F4', 4]],
  [[0, 'E4', 12], [12, 'C#4', 4]],
];
const LAMENT_CHORDS = [chord('D3', 'F3', 'A3'), chord('Bb2', 'D3', 'F3'), chord('G2', 'Bb2', 'D3'), chord('A2', 'C#3', 'E3')];
// Victory fanfare in D major
const FANFARE = [
  [[0, 'D5', 2], [2, 'D5', 1], [3, 'D5', 1], [4, 'A5', 6], [10, 'F#5', 2], [12, 'G5', 2], [14, 'A5', 2]],
  [[0, 'B5', 4], [4, 'A5', 2], [6, 'G5', 2], [8, 'F#5', 4], [12, 'E5', 4]],
  [[0, 'D5', 2], [2, 'E5', 2], [4, 'F#5', 4], [8, 'G5', 2], [10, 'A5', 2], [12, 'B5', 4]],
  [[0, 'A5', 12]],
];
const FANFARE_CHORDS = [chord('D3', 'A3', 'D4', 'F#4'), chord('G2', 'D3', 'G3', 'B3'), chord('E3', 'B3', 'E4', 'G4'), chord('A2', 'E3', 'A3', 'C#4')];

const MOODS = {
  menu: { bpm: 74, bars: THEME_CHORDS, melody: THEME, lead: 'lead', melodyVol: 0.09, pad: 0.06, arp: 0.025, bass: 0.05, drums: 0 },
  briefing: { bpm: 84, bars: THEME_CHORDS.slice(0, 4), melody: null, pad: 0.05, arp: 0.02, bass: 0.07, pulse: true, drums: 0 },
  travel: { bpm: 104, bars: THEME_CHORDS, melody: null, pad: 0.05, arp: 0.035, bass: 0.07, drums: 0.35 },
  combat: { bpm: 126, bars: THEME_CHORDS, melody: THEME, lead: 'lead', melodyVol: 0.08, pad: 0.045, arp: 0.04, bass: 0.11, drums: 1 },
  tension: { bpm: 70, bars: [chord('D2', 'A2', 'Eb3'), chord('D2', 'G2', 'C#3'), chord('D2', 'A2', 'Eb3'), chord('Bb1', 'F2', 'B2')], melody: null, pad: 0.07, arp: 0, bass: 0.09, drone: true, drums: 0, taiko: true },
  sad: { bpm: 60, bars: LAMENT_CHORDS, melody: LAMENT, lead: 'piano', melodyVol: 0.12, pad: 0.05, arp: 0, bass: 0.04, drums: 0 },
  victory: { bpm: 100, bars: FANFARE_CHORDS, melody: FANFARE, lead: 'brass', melodyVol: 0.1, pad: 0.06, arp: 0.03, bass: 0.08, drums: 0.6 },
};

function impulse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

class Music {
  constructor(audio) {
    const ctx = (this.ctx = audio.ctx);
    this.a = audio;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(audio.musicBus);
    this.dry = ctx.createGain(); this.dry.connect(this.out);
    this.wet = ctx.createGain(); this.wet.gain.value = 0.35; this.wet.connect(audio.reverb);
    this.delay = ctx.createDelay(1); this.delay.delayTime.value = 0.36;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    this.delay.connect(fb); fb.connect(this.delay);
    this.delay.connect(this.out);
    this.mood = null; this.next = null; this.step = 0; this.time = 0;
    this.timer = setInterval(() => this.tick(), 25);
  }

  setMood(name) {
    if (!MOODS[name]) return;
    if (name === this.moodName) {
      if (this.pending) { this.pending = null; this.out.gain.cancelScheduledValues(this.ctx.currentTime); this.out.gain.setTargetAtTime(1, this.ctx.currentTime, 0.3); }
      return;
    }
    if (name === this.pending) return;
    const ctx = this.ctx, t = ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0, t, 0.35);
    this.pending = name;
    this.switchAt = t + 1.1;
  }

  tick() {
    const ctx = this.ctx;
    if (ctx.state !== 'running') return;
    if (this.pending && ctx.currentTime >= this.switchAt) {
      this.moodName = this.pending; this.mood = MOODS[this.pending]; this.pending = null;
      this.step = 0; this.time = ctx.currentTime + 0.05;
      this.out.gain.cancelScheduledValues(ctx.currentTime);
      this.out.gain.setTargetAtTime(1, ctx.currentTime, 0.6);
    }
    // while fading out for a mood change, start no new notes: they would ring on into the next mood
    if (this.pending || !this.mood) return;
    // after a main-thread stall (scene load, GC) or while music is off, skip ahead instead of firing every missed note at once
    if (this.time < ctx.currentTime || !this.a.musicOn) { this.time = ctx.currentTime + 0.05; if (!this.a.musicOn) return; }
    const sd = 60 / this.mood.bpm / 4;
    while (this.time < ctx.currentTime + 0.15) {
      this.schedule(this.step, this.time, sd);
      this.step++; this.time += sd;
    }
  }

  schedule(step, t, sd) {
    const m = this.mood;
    const s = step % 16, bar = Math.floor(step / 16);
    const ch = m.bars[bar % m.bars.length];
    if (s === 0) {
      if (m.pad) this.pad(ch, t, sd * 16, m.pad);
      if (m.drone) this.drone(ch[0], t, sd * 16, m.bass);
    }
    // bass
    if (m.bass && !m.drone) {
      const root = ch[0] - 12;
      if (m.pulse) { if (s % 2 === 0) this.bass(midi(root), t, sd * 1.6, m.bass * (s % 8 === 0 ? 1 : 0.7)); }
      else if (m.drums >= 1) { if ([0, 2, 3, 6, 8, 10, 11, 14].includes(s)) this.bass(midi(root + (s === 6 || s === 14 ? 12 : 0)), t, sd * 1.4, m.bass); }
      else if (s === 0 || s === 8) this.bass(midi(root), t, sd * 7, m.bass);
    }
    // arpeggio
    if (m.arp) {
      const order = [0, 1, 2, 3, 2, 1, 2, 3];
      if (m.drums >= 1 || s % 2 === 0) this.pluck(midi(ch[order[(m.drums >= 1 ? s : s / 2) % order.length]] + 12), t, sd * 1.5, m.arp);
    }
    // melody (enters every second pass so it doesn't wear out)
    if (m.melody) {
      const pass = Math.floor(bar / m.melody.length);
      if (m === MOODS.combat && pass % 2 === 1) { /* rest */ } else {
        for (const [st, note, len] of m.melody[bar % m.melody.length]) {
          if (st === s) this.voice(m.lead, midi(N(note)), t, sd * len, m.melodyVol);
        }
      }
    }
    // drums
    if (m.drums) {
      const v = m.drums;
      if (s === 0 || s === 8 || (v >= 1 && s === 10 && bar % 2 === 1)) this.kick(t, 0.5 * v);
      if (v >= 1 && (s === 4 || s === 12)) this.snare(t, 0.22);
      if (s % 2 === 0) this.hat(t, (s % 4 === 2 ? 0.05 : 0.03) * v);
      if (v >= 1 && s === 15 && bar % 4 === 3) this.snare(t, 0.12);
    }
    if (m.taiko && (s === 0 || (s === 12 && bar % 2 === 1))) this.taiko(t, 0.5);
  }

  // ---- instruments ----
  env(g, t, a, d, peak, tail = 0.08) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setTargetAtTime(0.0001, t + Math.max(a, d), tail);
  }
  osc(type, f, t, end, dest, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
    o.connect(dest); o.start(t); o.stop(end);
    return o;
  }
  pad(notes, t, dur, vol) {
    const ctx = this.ctx, g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(500, t); f.frequency.linearRampToValueAtTime(1100, t + dur * 0.5); f.frequency.linearRampToValueAtTime(600, t + dur);
    f.connect(g); g.connect(this.dry); g.connect(this.wet);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.9); g.gain.setValueAtTime(vol, t + dur - 0.4); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.6);
    for (const n of notes) for (const d of [-8, 7]) this.osc('sawtooth', midi(n), t, t + dur + 0.7, f, d);
  }
  drone(n, t, dur, vol) {
    const ctx = this.ctx, g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 260; f.Q.value = 6;
    f.connect(g); g.connect(this.dry); g.connect(this.wet);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 1.5); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.5);
    this.osc('sawtooth', midi(n - 12), t, t + dur + 0.6, f);
    this.osc('sawtooth', midi(n - 12) * 1.006, t, t + dur + 0.6, f);
  }
  bass(f0, t, dur, vol) {
    const ctx = this.ctx, g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.Q.value = 4;
    f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(140, t + dur);
    f.connect(g); g.connect(this.dry);
    this.env(g, t, 0.005, dur * 0.6, vol, 0.05);
    this.osc('sawtooth', f0, t, t + dur + 0.3, f);
    this.osc('sine', f0 / 2, t, t + dur + 0.3, g);
  }
  pluck(f0, t, dur, vol) {
    const ctx = this.ctx, g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(400, t + 0.2);
    f.connect(g); g.connect(this.dry); g.connect(this.delay);
    this.env(g, t, 0.003, 0.03, vol, 0.07);
    this.osc('square', f0, t, t + dur + 0.4, f);
  }
  voice(kind, f0, t, dur, vol) {
    const ctx = this.ctx, g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.connect(g); g.connect(this.dry); g.connect(this.wet);
    if (kind === 'piano') {
      f.frequency.value = 2400;
      this.env(g, t, 0.004, 0.05, vol, dur * 0.35 + 0.2);
      this.osc('triangle', f0, t, t + dur + 2, f);
      this.osc('sine', f0 * 2, t, t + dur + 2, f).detune.value = 3;
      return;
    }
    if (kind === 'brass') {
      f.frequency.setValueAtTime(600, t); f.frequency.linearRampToValueAtTime(2600, t + 0.12);
      this.env(g, t, 0.06, dur, vol, 0.12);
      for (const d of [-6, 6]) this.osc('sawtooth', f0, t, t + dur + 0.6, f, d);
      return;
    }
    // lead: soft saw pair with vibrato into delay
    f.frequency.value = 2200;
    g.connect(this.delay);
    this.env(g, t, 0.04, dur, vol, 0.15);
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 5.2; lg.gain.value = 0; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(9, t + Math.min(0.5, dur));
    lfo.connect(lg); lfo.start(t); lfo.stop(t + dur + 0.8);
    for (const d of [-5, 5]) { const o = this.osc('sawtooth', f0, t, t + dur + 0.8, f, d); lg.connect(o.detune); }
  }
  kick(t, vol) {
    const ctx = this.ctx, g = ctx.createGain(), o = ctx.createOscillator();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    o.connect(g); g.connect(this.dry);
    this.env(g, t, 0.002, 0.02, vol, 0.09);
    o.start(t); o.stop(t + 0.5);
  }
  taiko(t, vol) {
    const ctx = this.ctx, g = ctx.createGain(), o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.4);
    o.connect(g); g.connect(this.dry); g.connect(this.wet);
    this.env(g, t, 0.003, 0.05, vol, 0.35);
    o.start(t); o.stop(t + 2);
    this.a.noiseAt(t, 0.25, vol * 0.3, 'lowpass', 400, 120, this.dry);
  }
  snare(t, vol) {
    this.a.noiseAt(t, 0.18, vol, 'bandpass', 1900, 1500, this.dry, this.wet);
    const g = this.ctx.createGain(); g.connect(this.dry);
    this.env(g, t, 0.002, 0.01, vol * 0.6, 0.04);
    this.osc('triangle', 190, t, t + 0.2, g);
  }
  hat(t, vol) { this.a.noiseAt(t, 0.05, vol, 'highpass', 7500, 7500, this.dry); }
}

// ---------------------------------------------------------------------------
// Audio front-end (same API the game uses)
// ---------------------------------------------------------------------------
export class Audio {
  constructor() { this.ctx = null; this.enabled = true; this.musicOn = true; this.engine = null; this.music = null; this.voices = 0; this.wantMood = 'menu'; }

  unlock() {
    if (this.ctx) { if (this.ctx.state !== 'running' && !document.hidden) this.ctx.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.85 : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.musicOn ? 0.34 : 0; this.musicBus.connect(this.master);
    this.reverb = ctx.createConvolver(); this.reverb.buffer = impulse(ctx, 2.8, 2.6);
    const rvOut = ctx.createGain(); rvOut.gain.value = 0.6; this.reverb.connect(rvOut); rvOut.connect(this.master);
    this.sfxWet = ctx.createGain(); this.sfxWet.gain.value = 0.25; this.sfxWet.connect(this.reverb);
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.music = new Music(this);
    this.music.setMood(this.wantMood);
    // iOS reports 'interrupted' after calls/Siri: any later touch or key brings the sound back, also mid-flight
    const kick = () => { if (ctx.state !== 'running' && !document.hidden) ctx.resume().catch(() => {}); };
    window.addEventListener('pointerdown', kick, true); window.addEventListener('keydown', kick, true);
  }

  setEnabled(v) {
    this.enabled = v;
    if (this.master) this.master.gain.setTargetAtTime(v ? 0.85 : 0, this.ctx.currentTime, 0.05);
  }
  setMusic(v) {
    this.musicOn = v;
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(v ? 0.34 : 0, this.ctx.currentTime, 0.2);
  }
  mood(name) { this.wantMood = name; this.music?.setMood(name); }

  // ---- low-level helpers ----
  get live() { return this.ctx && this.enabled && this.ctx.state === 'running'; }
  /** Voice limiter so big battles don't create hundreds of nodes per second. */
  grab(max = 24) { if (this.voices >= max) return false; this.voices++; return true; }
  release(ms) { setTimeout(() => this.voices--, ms); }

  tone(type, f0, f1, dur, vol, wet = 0.15) {
    if (!this.live || !(vol >= 0.005) || !Number.isFinite(f0 + f1 + dur) || !this.grab()) return;
    const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g); g.connect(this.sfx);
    if (wet) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(this.sfxWet); }
    o.start(t); o.stop(t + dur + 0.02);
    this.release(dur * 1000 + 50);
  }
  noiseAt(t, dur, vol, type, f0, f1, dest, wet) {
    const ctx = this.ctx, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.noiseBuf;
    f.type = type; f.Q.value = type === 'bandpass' ? 1.2 : 0.7;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || this.sfx);
    if (wet) g.connect(wet);
    s.loop = true; // the 2 s buffer is shorter than long rumbles; loop instead of cutting them off with a click
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.02);
  }
  noise(dur, vol, f0, f1, q = 0.8, type = 'lowpass', wet = 0.3) {
    if (!this.live || !(vol >= 0.005) || !Number.isFinite(f0 + f1 + dur) || !this.grab()) return;
    this.noiseAt(this.ctx.currentTime, dur, vol, type, f0, f1, this.sfx, wet ? this.sfxWet : null);
    this.release(dur * 1000 + 50);
  }

  // ---- game sound effects ----
  laser(vol = 0.25, enemy = false) {
    if (!this.live) return;
    if (enemy) { this.tone('square', 620, 140, 0.16, vol * 0.45, 0.1); return; }
    // player blaster: bright zap + body + click
    this.tone('sawtooth', 1500, 210, 0.13, vol * 0.8, 0.12);
    this.tone('sine', 820, 300, 0.09, vol * 0.5, 0);
    this.noise(0.03, vol * 0.5, 6000, 2000, 0.7, 'highpass', 0);
  }
  explosion(vol = 0.6, big = false) {
    if (!this.live) return;
    // crack, rumble, debris crackle tail
    this.noise(0.08, vol * 0.9, 5000, 900, 0.7, 'lowpass', 0.2);
    this.noise(big ? 2.6 : 1.2, vol, big ? 700 : 1300, 35, 0.8, 'lowpass', 0.5);
    this.tone('sine', big ? 65 : 95, 26, big ? 1.6 : 0.7, vol * 0.9, 0.3);
    if (big) setTimeout(() => this.noise(1.4, vol * 0.35, 3000, 400, 2, 'bandpass', 0.6), 180);
  }
  hit(shield) {
    if (shield) { this.tone('sine', 1100, 260, 0.22, 0.28, 0.3); this.tone('triangle', 2200, 900, 0.12, 0.1, 0.2); }
    else { this.noise(0.25, 0.5, 2400, 160); this.tone('square', 150, 45, 0.18, 0.25, 0.1); }
  }
  missile() { this.lance(1); }
  /** ion lance capacitors charging: a fast rising whine */
  lanceCharge(vol = 1) {
    this.tone('sine', 380, 2600, 0.32, 0.07 * vol, 0.1);
    this.tone('square', 190, 1300, 0.32, 0.025 * vol, 0);
  }
  /** ion lance discharge: a hard electric crack, a falling sizzle and a low body thump */
  lance(vol = 1) {
    this.noise(0.06, 0.32 * vol, 9000, 4000, 0.8, 'highpass', 0.2);
    this.tone('sawtooth', 2600, 160, 0.42, 0.14 * vol, 0.4);
    this.noise(0.45, 0.2 * vol, 7000, 900, 1.6, 'bandpass', 0.5);
    this.tone('sine', 120, 38, 0.35, 0.36 * vol, 0.3);
  }
  /** Aszendenz plasma seeker / fusion charge release: a magnetic thump and a rising electric whine */
  torpedo(heavy = false, vol = 1) {
    this.tone('sine', heavy ? 70 : 110, 40, 0.25, 0.32 * vol, 0.2);
    this.tone('sawtooth', heavy ? 160 : 260, heavy ? 900 : 1600, 0.35, 0.09 * vol, 0.35);
    this.noise(0.4, 0.14 * vol, 2400, 5200, 3, 'bandpass', 0.3);
  }
  /** plasma impact: crackling discharge over a soft thud */
  plasmaHit(vol = 0.6) {
    if (vol <= 0.01) return;
    this.tone('sine', 140, 45, 0.45, 0.4 * vol, 0.4);
    this.noise(0.5, 0.35 * vol, 6000, 900, 1.4, 'bandpass', 0.6);
    this.tone('square', 1800, 300, 0.18, 0.05 * vol, 0.3);
  }
  beep(f = 880, vol = 0.14) { this.tone('sine', f, f, 0.08, vol, 0.05); }
  lock() { this.tone('square', 1500, 1500, 0.05, 0.07, 0); setTimeout(() => this.tone('square', 1900, 1900, 0.05, 0.07, 0), 70); }
  warn() { this.tone('square', 720, 480, 0.18, 0.14, 0.1); }
  warp() { this.noise(1.2, 0.42, 180, 6000, 3, 'bandpass', 0.5); this.tone('sine', 90, 1100, 1.0, 0.2, 0.4); }
  /** short radio static before a transmission */
  radio() { this.noise(0.12, 0.12, 3200, 1800, 1.5, 'bandpass', 0); this.tone('sine', 1250, 1250, 0.05, 0.06, 0); }
  ui(kind = 'move') {
    if (kind === 'move') this.tone('sine', 1500, 1500, 0.03, 0.035, 0);
    else if (kind === 'ok') { this.tone('triangle', 660, 990, 0.09, 0.09, 0.2); }
    else if (kind === 'open') this.tone('sine', 300, 1200, 0.18, 0.05, 0.3);
  }

  startEngine() {
    if (!this.ctx || this.engine) return;
    const ctx = this.ctx;
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.noiseBuf; s.loop = true;
    f.type = 'lowpass'; f.frequency.value = 200; f.Q.value = 3;
    g.gain.value = 0;
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = 55; o2.type = 'sine'; o2.frequency.value = 27.5; og.gain.value = 0;
    const of = ctx.createBiquadFilter(); of.type = 'lowpass'; of.frequency.value = 300;
    s.connect(f); f.connect(g); g.connect(this.sfx);
    o.connect(of); o2.connect(of); of.connect(og); og.connect(this.sfx);
    s.start(); o.start(); o2.start();
    this.engine = { s, f, g, o, o2, og };
  }
  setEngine(throttle, boost) {
    if (!this.engine) return;
    const t = this.ctx.currentTime, e = this.engine;
    e.f.frequency.setTargetAtTime(150 + throttle * 420 + (boost ? 1100 : 0), t, 0.15);
    e.g.gain.setTargetAtTime(0.04 + throttle * 0.06 + (boost ? 0.16 : 0), t, 0.15);
    e.o.frequency.setTargetAtTime(40 + throttle * 34 + (boost ? 34 : 0), t, 0.2);
    e.o2.frequency.setTargetAtTime(20 + throttle * 17 + (boost ? 17 : 0), t, 0.2);
    e.og.gain.setTargetAtTime(0.03 + throttle * 0.03, t, 0.2);
  }
  stopEngine() {
    if (!this.engine) return;
    const e = this.engine; this.engine = null;
    try { e.s.stop(); e.o.stop(); e.o2.stop(); e.g.disconnect(); e.og.disconnect(); } catch { /* already stopped */ }
  }
}
