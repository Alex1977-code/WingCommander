/**
 * Fully synthesized audio (WebAudio) – no asset files.
 *  - Sound effects with layered synthesis, a shared reverb and a voice limit.
 *  - Adaptive music: an original orchestral score in the style of 90s TV science fiction
 *    (horns, strings, harp, timpani; a heroic D-major theme and the squadron's D-minor battle
 *    motif) with moods menu · briefing · travel · combat · tension · sad · victory, cross-faded.
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
// Score: an original orchestral TV-sci-fi score in the 90s style – horns carry a broad heroic
// theme over lush strings, harp and celesta add the wonder, timpani and cymbal swells mark the
// phrases; battles get driving low-string ostinati, brass stabs and military snare.
// ---------------------------------------------------------------------------
// 16 steps per bar; each entry: [step, note, lengthInSteps]
// Heroic main theme in D major with a Lydian lift (G#) and the flat-seven turn (C) of the genre
const HERO = [
  [[0, 'A4', 3], [3, 'D5', 1], [4, 'E5', 8], [12, 'F#5', 4]],
  [[0, 'G#5', 6], [6, 'F#5', 2], [8, 'E5', 4], [12, 'B4', 4]],
  [[0, 'D5', 3], [3, 'E5', 1], [4, 'F#5', 4], [8, 'A5', 6], [14, 'G5', 2]],
  [[0, 'F#5', 12], [12, 'E5', 4]],
  [[0, 'A4', 3], [3, 'D5', 1], [4, 'E5', 8], [12, 'A5', 4]],
  [[0, 'C6', 6], [6, 'B5', 2], [8, 'A5', 4], [12, 'G5', 4]],
  [[0, 'F#5', 4], [4, 'G5', 2], [6, 'A5', 2], [8, 'B5', 4], [12, 'E5', 4]],
  [[0, 'D5', 16]],
];
const HERO_CHORDS = [
  chord('D3', 'A3', 'D4', 'F#4'), chord('D3', 'B3', 'E4', 'G#4'), chord('G2', 'D3', 'F#3', 'B3'), chord('A2', 'E3', 'A3', 'C#4'),
  chord('D3', 'A3', 'D4', 'F#4'), chord('C3', 'G3', 'C4', 'E4'), chord('A2', 'E3', 'G3', 'C#4'), chord('D3', 'A3', 'D4', 'F#4'),
];
// Battle theme in D minor (the squadron's motif), carried by trumpets over the ostinato
const BATTLE = [
  [[0, 'D5', 4], [6, 'A4', 2], [8, 'D5', 2], [10, 'F5', 4], [14, 'E5', 2]],
  [[0, 'C5', 4], [4, 'Bb4', 4], [8, 'A4', 4], [12, 'F4', 2], [14, 'G4', 2]],
  [[0, 'A4', 4], [4, 'C5', 2], [6, 'F5', 2], [8, 'E5', 4], [12, 'D5', 2], [14, 'C5', 2]],
  [[0, 'D5', 8], [8, 'E5', 4], [12, 'G5', 4]],
  [[0, 'F5', 4], [4, 'E5', 2], [6, 'D5', 2], [8, 'A5', 4], [12, 'G5', 2], [14, 'F5', 2]],
  [[0, 'G5', 4], [4, 'F5', 2], [6, 'D5', 2], [8, 'F5', 4], [12, 'E5', 2], [14, 'D5', 2]],
  [[0, 'C5', 4], [4, 'D5', 2], [6, 'E5', 2], [8, 'F5', 4], [12, 'A5', 4]],
  [[0, 'A5', 8], [8, 'E5', 4], [12, 'C#5', 4]],
];
const BATTLE_CHORDS = [
  chord('D3', 'A3', 'D4', 'F4'), chord('Bb2', 'F3', 'Bb3', 'D4'), chord('F2', 'C3', 'F3', 'A3'), chord('C3', 'G3', 'C4', 'E4'),
  chord('D3', 'A3', 'D4', 'F4'), chord('Bb2', 'F3', 'Bb3', 'D4'), chord('G2', 'D3', 'G3', 'Bb3'), chord('A2', 'E3', 'A3', 'C#4'),
];
// Briefing: the theme's opening, quietly, over a pulsing low-string figure
const BRIEF = [
  [[0, 'A4', 3], [3, 'D5', 1], [4, 'E5', 12]],
  [[0, 'G#5', 8], [8, 'F#5', 8]],
  [[0, 'D5', 4], [4, 'F#5', 4], [8, 'E5', 8]],
  [[0, 'B4', 16]],
];
const BRIEF_CHORDS = [chord('D3', 'A3', 'D4', 'F#4'), chord('D3', 'B3', 'E4', 'G#4'), chord('B2', 'F#3', 'B3', 'D4'), chord('G2', 'D3', 'G3', 'B3')];
// Lament for the fallen: solo horn over strings
const LAMENT = [
  [[0, 'A4', 6], [6, 'G4', 2], [8, 'F4', 4], [12, 'E4', 4]],
  [[0, 'D4', 8], [8, 'F4', 4], [12, 'A4', 4]],
  [[0, 'Bb4', 6], [6, 'A4', 2], [8, 'G4', 4], [12, 'F4', 4]],
  [[0, 'E4', 12], [12, 'C#4', 4]],
];
const LAMENT_CHORDS = [chord('D3', 'A3', 'D4', 'F4'), chord('Bb2', 'F3', 'Bb3', 'D4'), chord('G2', 'D3', 'G3', 'Bb3'), chord('A2', 'E3', 'A3', 'C#4')];
// Victory fanfare in D major
const FANFARE = [
  [[0, 'A4', 2], [2, 'D5', 1], [3, 'D5', 1], [4, 'A5', 6], [10, 'F#5', 2], [12, 'G5', 2], [14, 'A5', 2]],
  [[0, 'C6', 4], [4, 'B5', 2], [6, 'G5', 2], [8, 'A5', 8]],
  [[0, 'D5', 2], [2, 'E5', 2], [4, 'F#5', 4], [8, 'G#5', 2], [10, 'A5', 2], [12, 'B5', 4]],
  [[0, 'D6', 12]],
];
const FANFARE_CHORDS = [chord('D3', 'A3', 'D4', 'F#4'), chord('C3', 'G3', 'C4', 'E4'), chord('D3', 'B3', 'E4', 'G#4'), chord('D3', 'A3', 'D4', 'F#4')];

/*
 * Mood recipes. Volumes per layer (0 = off):
 *  strings – sustained ensemble chord · basses – low strings on the root · harp / celesta – arpeggios
 *  ostinato – driving low-string figure · lead/leadVol – melody instrument · timp – timpani
 *  stabs – brass chord hits · snare – military snare · swell – cymbal swell into each phrase
 */
const MOODS = {
  menu: { bpm: 72, bars: HERO_CHORDS, melody: HERO, lead: 'horn', leadVol: 0.11, strings: 0.05, basses: 0.05, harp: 0.03, celesta: 0.018, timp: 0.35, swell: 0.05 },
  briefing: { bpm: 84, bars: BRIEF_CHORDS, melody: BRIEF, lead: 'flute', leadVol: 0.06, melodyEvery: 2, strings: 0.035, basses: 0.04, ostinato: 0.03, celesta: 0.02, timp: 0.15 },
  travel: { bpm: 96, bars: HERO_CHORDS, melody: HERO, lead: 'horn', leadVol: 0.085, melodyEvery: 2, strings: 0.04, basses: 0.045, harp: 0.035, celesta: 0.012, timp: 0.2, swell: 0.035 },
  combat: { bpm: 132, bars: BATTLE_CHORDS, melody: BATTLE, lead: 'trumpet', leadVol: 0.08, melodyEvery: 2, strings: 0.03, ostinato: 0.06, stabs: 0.05, timp: 0.5, snare: 0.16, swell: 0.04 },
  tension: { bpm: 70, bars: [chord('D2', 'A2', 'Eb3', 'A3'), chord('D2', 'G2', 'C#3', 'G3'), chord('D2', 'A2', 'Eb3', 'Bb3'), chord('Bb1', 'F2', 'B2', 'E3')], tremolo: 0.045, basses: 0.06, timp: 0.4, timpRumble: true, swell: 0.03, hornSwell: 0.05 },
  sad: { bpm: 58, bars: LAMENT_CHORDS, melody: LAMENT, lead: 'horn', leadVol: 0.1, strings: 0.05, basses: 0.04, harp: 0.012 },
  victory: { bpm: 104, bars: FANFARE_CHORDS, melody: FANFARE, lead: 'trumpet', leadVol: 0.1, strings: 0.05, basses: 0.05, harp: 0.03, timp: 0.45, swell: 0.05, crash: 0.09, hornHarmony: 0.06 },
};

export { MOODS as MUSIC_MOODS }; // for offline rendering in tests

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
    // a concert-hall reverb of its own: the orchestra needs more room than the effects
    this.hall = ctx.createConvolver(); this.hall.buffer = impulse(ctx, 3.6, 3.2);
    const hallOut = ctx.createGain(); hallOut.gain.value = 0.55; this.hall.connect(hallOut); hallOut.connect(this.out);
    this.wet = ctx.createGain(); this.wet.gain.value = 0.6; this.wet.connect(this.hall);
    this.delay = ctx.createDelay(1); this.delay.delayTime.value = 0.36;
    const fb = ctx.createGain(); fb.gain.value = 0.28;
    this.delay.connect(fb); fb.connect(this.delay);
    this.delay.connect(this.wet);
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
    const phrase = m.bars.length, inPhrase = bar % phrase;
    if (s === 0) {
      if (m.strings) this.strings(ch, t, sd * 16, m.strings, m.bpm > 120 ? 0.25 : 0.7);
      if (m.tremolo) this.strings(ch, t, sd * 16, m.tremolo, 1.2, true);
      if (m.basses) this.strings([ch[0] - 12], t, sd * 16, m.basses, 0.4);
      if (m.hornSwell && bar % 2 === 1) this.horn(midi(ch[2]), t, sd * 14, m.hornSwell, true);
      if (m.crash && inPhrase === 0) this.crash(t, m.crash);
    }
    // cymbal swell rising into the next phrase
    if (m.swell && inPhrase === phrase - 1 && s === 8) this.swell(t, sd * 8, m.swell);
    // harp: rolling eighth-note arpeggios over two octaves
    if (m.harp && s % 2 === 0) {
      const up = [0, 1, 2, 3, 4, 5, 6, 7], k = up[(s / 2) % 8];
      const n = ch[k % 4] + 12 * (1 + Math.floor(k / 4));
      this.harp(midi(n), t, m.harp * (s === 0 ? 1.2 : 1));
    }
    // celesta sparkle
    if (m.celesta && (s === 0 || s === 6 || s === 10) && Math.random() < 0.8) this.celesta(midi(ch[(bar + s) % 4] + 24), t, m.celesta);
    // low-string ostinato: urgent sixteenths in battle, a soft pulse in briefings
    if (m.ostinato) {
      const root = ch[0] - 12;
      if (m.bpm > 120) {
        const pat = [0, 0, 12, 0, 0, 0, 7, 0, 0, 0, 12, 0, 10, 0, 7, 0];
        this.staccato(midi(root + pat[s]), t, sd * 0.9, m.ostinato * (s % 4 === 0 ? 1.25 : 0.85));
      } else if (s % 2 === 0) this.staccato(midi(root), t, sd * 1.6, m.ostinato * (s % 8 === 0 ? 1.2 : 0.8));
    }
    // melody, entering on every pass or every second pass so it doesn't wear out
    if (m.melody) {
      const pass = Math.floor(bar / m.melody.length);
      if (pass % (m.melodyEvery || 1) === 0) {
        for (const [st, note, len] of m.melody[bar % m.melody.length]) {
          if (st !== s) continue;
          const f = midi(N(note));
          this.voice(m.lead, f, t, sd * len, m.leadVol);
          if (m.hornHarmony) this.horn(f * Math.pow(2, -4 / 12), t, sd * len, m.hornHarmony); // a third below
        }
      } else if (m.stabs && (s === 0 || s === 6 || (s === 12 && bar % 2 === 1))) {
        // brass hits answer the ostinato when the trumpets rest
        this.stab(ch.slice(1).map((n) => midi(n + 12)), t, sd * 1.5, m.stabs);
      }
    }
    // timpani: phrase marks, battle hits and the odd roll
    if (m.timp) {
      const tp = midi(ch[0] >= 48 ? ch[0] - 12 : ch[0]);
      if (m.timpRumble) { if (s === 0 && bar % 2 === 0) this.roll(tp, t, sd * 12, m.timp * 0.5); }
      else if (m.bpm > 120) {
        if (s === 0 || s === 8) this.timpani(tp, t, m.timp * (s === 0 ? 1 : 0.7));
        if (bar % 4 === 3 && s === 12) this.roll(tp, t, sd * 4, m.timp * 0.6);
      } else if (s === 0 && (inPhrase === 0 || inPhrase === 4)) this.timpani(tp, t, m.timp);
      else if (inPhrase === phrase - 1 && s === 12) this.roll(tp, t, sd * 4, m.timp * 0.45);
    }
    if (m.snare) {
      if (s === 4 || s === 12) this.snare(t, m.snare);
      else if (s === 14 || s === 15 || (s === 10 && bar % 2 === 1)) this.snare(t, m.snare * 0.35);
      if (bar % 8 === 7 && s >= 8) this.snare(t + sd * 0.5, m.snare * (0.25 + (s - 8) * 0.05));
    }
  }

  // ---- orchestra ----
  osc(type, f, t, end, dest, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
    o.connect(dest); o.start(t); o.stop(end);
    return o;
  }
  vibrato(t, end, rate, cents, delay = 0.3) {
    const ctx = this.ctx, l = ctx.createOscillator(), g = ctx.createGain();
    l.frequency.value = rate * (0.95 + Math.random() * 0.1);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(cents, t + delay);
    l.connect(g); l.start(t); l.stop(end);
    return g;
  }
  /** string ensemble: several detuned saws per note, soft attack, warm filter, section vibrato */
  strings(notes, t, dur, vol, attack = 0.6, tremolo = false) {
    const ctx = this.ctx, g = ctx.createGain(), lp = ctx.createBiquadFilter(), hp = ctx.createBiquadFilter();
    const end = t + dur + 1.2;
    lp.type = 'lowpass'; lp.frequency.value = notes[0] < 45 ? 900 : 2600; lp.Q.value = 0.4;
    hp.type = 'highpass'; hp.frequency.value = notes[0] < 45 ? 35 : 110;
    lp.connect(hp); hp.connect(g); g.connect(this.dry); g.connect(this.wet);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + Math.max(attack, dur - 0.2)); g.gain.linearRampToValueAtTime(0.0001, t + dur + 1.0);
    let dest = lp;
    if (tremolo) { // bowed tremolo: fast amplitude flutter
      const tg = ctx.createGain(), l = ctx.createOscillator(), lg = ctx.createGain();
      tg.gain.value = 0.6; l.frequency.value = 11; lg.gain.value = 0.4; l.connect(lg); lg.connect(tg.gain); l.start(t); l.stop(end);
      tg.connect(lp); dest = tg;
    }
    const vib = this.vibrato(t, end, 5.4, 7, 0.6);
    for (const n of notes) for (const d of [-11, 1, 12]) { const o = this.osc('sawtooth', midi(n), t, end, dest, d + (Math.random() - 0.5) * 4); vib.connect(o.detune); }
  }
  /** short, accented low strings (spiccato) */
  staccato(f0, t, dur, vol) {
    const ctx = this.ctx, g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.Q.value = 1; f.frequency.setValueAtTime(1600, t); f.frequency.exponentialRampToValueAtTime(500, t + dur);
    f.connect(g); g.connect(this.dry); g.connect(this.wet);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.012); g.gain.setTargetAtTime(0.0001, t + dur * 0.5, dur * 0.3);
    for (const d of [-9, 9]) this.osc('sawtooth', f0, t, t + dur + 0.4, f, d);
  }
  /** French horn: round, darker brass that blooms after the attack */
  horn(f0, t, dur, vol, swell = false) {
    const ctx = this.ctx, g = ctx.createGain(), f = ctx.createBiquadFilter(), end = t + dur + 0.8;
    f.type = 'lowpass'; f.Q.value = 0.8;
    const a = swell ? dur * 0.6 : 0.09;
    f.frequency.setValueAtTime(380, t); f.frequency.linearRampToValueAtTime(swell ? 1300 : 1500, t + a + 0.08); f.frequency.setTargetAtTime(1050, t + a + 0.1, 0.4);
    f.connect(g); g.connect(this.dry); g.connect(this.wet);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + a);
    g.gain.setValueAtTime(vol * 0.9, t + Math.max(a, dur - 0.05)); g.gain.setTargetAtTime(0.0001, t + Math.max(a, dur), swell ? 0.5 : 0.18);
    const vib = this.vibrato(t, end, 4.8, 6, 0.45);
    for (const [type, d, k] of [['sawtooth', -4, 1], ['sawtooth', 5, 1], ['triangle', 0, 1]]) { const o = this.osc(type, f0 * k, t, end, f, d); vib.connect(o.detune); }
  }
  /** trumpet: bright, fast-speaking brass */
  trumpet(f0, t, dur, vol) {
    const ctx = this.ctx, g = ctx.createGain(), f = ctx.createBiquadFilter(), end = t + dur + 0.6;
    f.type = 'lowpass'; f.Q.value = 1.1;
    f.frequency.setValueAtTime(700, t); f.frequency.linearRampToValueAtTime(3400, t + 0.05); f.frequency.setTargetAtTime(2300, t + 0.08, 0.2);
    f.connect(g); g.connect(this.dry); g.connect(this.wet);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.03);
    g.gain.setTargetAtTime(vol * 0.8, t + 0.06, 0.1); g.gain.setTargetAtTime(0.0001, t + Math.max(0.08, dur - 0.02), 0.09);
    const vib = this.vibrato(t, end, 5.5, 8, 0.35);
    for (const d of [-6, 6]) { const o = this.osc('sawtooth', f0, t, end, f, d); vib.connect(o.detune); }
  }
  stab(freqs, t, dur, vol) { for (const f of freqs) this.trumpet(f, t, dur, vol / Math.sqrt(freqs.length)); }
  /** solo flute: soft sine-like tone with a breath of noise */
  flute(f0, t, dur, vol) {
    const ctx = this.ctx, g = ctx.createGain(), end = t + dur + 0.6;
    g.connect(this.dry); g.connect(this.wet); g.connect(this.delay);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.09);
    g.gain.setValueAtTime(vol, t + Math.max(0.09, dur - 0.05)); g.gain.setTargetAtTime(0.0001, t + Math.max(0.09, dur), 0.15);
    const vib = this.vibrato(t, end, 5.6, 11, 0.4);
    vib.connect(this.osc('sine', f0, t, end, g).detune);
    const h = this.ctx.createGain(); h.gain.value = 0.18; h.connect(g);
    vib.connect(this.osc('triangle', f0 * 2, t, end, h).detune);
    this.a.noiseAt(t, Math.min(0.25, dur), vol * 0.25, 'bandpass', f0 * 2, f0 * 2, g);
  }
  /** concert harp: plucked, ringing */
  harp(f0, t, vol) {
    const ctx = this.ctx, g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(4200, t); f.frequency.exponentialRampToValueAtTime(900, t + 0.6);
    f.connect(g); g.connect(this.dry); g.connect(this.wet);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.004); g.gain.setTargetAtTime(0.0001, t + 0.01, 0.45);
    this.osc('triangle', f0, t, t + 2.2, f);
    const h = ctx.createGain(); h.gain.value = 0.35; h.connect(f);
    this.osc('sine', f0 * 2, t, t + 2.2, h);
  }
  /** celesta: bell-like sparkle */
  celesta(f0, t, vol) {
    const ctx = this.ctx, g = ctx.createGain();
    g.connect(this.dry); g.connect(this.wet); g.connect(this.delay);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.003); g.gain.setTargetAtTime(0.0001, t + 0.01, 0.32);
    this.osc('sine', f0, t, t + 1.8, g);
    const h = ctx.createGain(); h.gain.value = 0.22; h.connect(g);
    this.osc('sine', f0 * 4.01, t, t + 0.6, h);
  }
  /** timpani: tuned membrane with a short skin noise */
  timpani(f0, t, vol) {
    const ctx = this.ctx, g = ctx.createGain();
    g.connect(this.dry); g.connect(this.wet);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.004); g.gain.setTargetAtTime(0.0001, t + 0.02, 0.38);
    const o = this.osc('sine', f0 * 1.02, t, t + 2.2, g); o.frequency.exponentialRampToValueAtTime(f0, t + 0.25);
    const h = ctx.createGain(); h.gain.value = 0.3; h.connect(g);
    this.osc('sine', f0 * 1.51, t, t + 1.2, h);
    this.a.noiseAt(t, 0.12, vol * 0.35, 'lowpass', 700, 200, this.dry);
  }
  roll(f0, t, dur, vol) {
    const n = Math.max(4, Math.floor(dur / 0.055));
    for (let i = 0; i < n; i++) this.timpani(f0, t + i * (dur / n), vol * (0.35 + 0.65 * (i / n)) * 0.6);
  }
  /** suspended cymbal swelling into the downbeat */
  swell(t, dur, vol) {
    const ctx = this.ctx, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.a.noiseBuf; s.loop = true;
    f.type = 'highpass'; f.frequency.value = 4200;
    s.connect(f); f.connect(g); g.connect(this.dry); g.connect(this.wet);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur); g.gain.setTargetAtTime(0.0001, t + dur, 0.35);
    s.start(t, Math.random()); s.stop(t + dur + 1.6);
  }
  crash(t, vol) { this.a.noiseAt(t, 2.4, vol, 'highpass', 5200, 3000, this.dry, this.wet); }
  snare(t, vol) {
    this.a.noiseAt(t, 0.16, vol, 'bandpass', 2400, 1700, this.dry, this.wet);
    const g = this.ctx.createGain(); g.connect(this.dry);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol * 0.5, t + 0.002); g.gain.setTargetAtTime(0.0001, t + 0.01, 0.035);
    this.osc('triangle', 200, t, t + 0.2, g);
  }
  voice(kind, f0, t, dur, vol) {
    if (kind === 'trumpet') return this.trumpet(f0, t, dur, vol);
    if (kind === 'flute') return this.flute(f0, t, dur, vol);
    return this.horn(f0, t, dur, vol);
  }
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
  /** neutron cannon capacitors charging: a fast rising whine */
  lanceCharge(vol = 1) {
    this.tone('sine', 380, 2600, 0.32, 0.07 * vol, 0.1);
    this.tone('square', 190, 1300, 0.32, 0.025 * vol, 0);
  }
  /** neutron cannon discharge: a hard electric crack, a falling sizzle and a low body thump */
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
