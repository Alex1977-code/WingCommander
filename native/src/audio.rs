//! Sound (owner: audio agent): everything is synthesized, no sound files.
//!
//! - Sound effects are rendered once at Startup into in-memory clips (`SynthClip`, a custom Bevy audio
//!   source, so no decoder feature is needed): lasers, neutron cannon, explosions, hits, lock, beeps,
//!   warp, radio blip, UI. `SfxMsg` plays them with `Settings.master_volume` and some pitch variation,
//!   with a voice limit and per-sound rate limits.
//! - The engine hum is a live synthesizer voice (`EngineVoice`) whose parameters follow the player's
//!   speed, boost and impulse drive through lock-free atomics.
//! - The music is an original orchestral score in the 90s TV sci-fi style (strings, horns, trumpets and a
//!   flute, low brass, choir, harp, timpani, cymbals) with the seven moods of src/audio.js: menu theme,
//!   briefing, travel, combat, tension, lament (sad) and victory fanfare. A background thread renders them
//!   one by one into seamless loops (the most needed first); the mood follows the game state like the web
//!   app (menu / briefing / travel vs combat in flight / victory, lament or briefing in the debrief; a
//!   mission's `music` key overrides travel), switching with a short fade-out and fade-in, each mood from
//!   its start. Until a mood is rendered a related one stands in. `Settings.music` toggles it.
//! - Without an audio device (headless, CI) Bevy's audio systems do not run: this module notices that the
//!   probe voice never gets a sink, then stops spawning anything and renders no music.
//!
//! Test hook: `SF_AUDIO_DUMP=<dir>` writes every clip and all music loops as WAV files into `<dir>`
//! (the music is rendered even without an audio device) and logs their levels.

use crate::common::*;
use crate::mission::MissionResult;
use bevy::audio::{AddAudioSource, AudioSink, AudioSinkPlayback, ChannelCount, Decodable, PlaybackMode, Sample, SampleRate, Source, Volume};
use bevy::prelude::*;
use std::f32::consts::{PI, TAU};
use std::num::NonZero;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub struct SfxPlugin;

impl Plugin for SfxPlugin {
    fn build(&self, app: &mut App) {
        app.add_audio_source::<SynthClip>()
            .add_audio_source::<EngineVoice>()
            .init_resource::<AudioState>()
            .add_systems(Startup, setup_audio)
            .add_systems(Update, (probe_audio, play_sfx, engine_hum, music).chain())
            .add_systems(PostUpdate, reap_voices);
    }
}

/// Output sample rate of everything synthesized here.
const SR: u32 = 44_100;
const SRF: f32 = SR as f32;
/// overall effects level (several loud sounds may overlap)
const SFX_GAIN: f32 = 0.75;
/// music level relative to the effects (the loops are normalized)
const MUSIC_GAIN: f32 = 0.24;
const MAX_VOICES: usize = 26;

// ---------- audio sources ----------

/// A synthesized clip (mono or interleaved stereo f32 samples).
#[derive(Asset, TypePath, Clone)]
pub struct SynthClip {
    samples: Arc<[f32]>,
    channels: u16,
    /// plays forever (music loops)
    looping: bool,
}

impl SynthClip {
    fn seconds(&self) -> f32 {
        self.samples.len() as f32 / self.channels as f32 / SRF
    }
}

pub struct ClipDecoder {
    data: Arc<[f32]>,
    pos: usize,
    channels: u16,
    looping: bool,
}

impl Iterator for ClipDecoder {
    type Item = Sample;
    fn next(&mut self) -> Option<Sample> {
        if self.pos >= self.data.len() {
            if !self.looping || self.data.is_empty() {
                return None;
            }
            self.pos = 0;
        }
        let v = self.data[self.pos];
        self.pos += 1;
        Some(v as Sample)
    }
}

impl Source for ClipDecoder {
    fn current_span_len(&self) -> Option<usize> {
        (!self.looping && self.pos >= self.data.len()).then_some(0)
    }
    fn channels(&self) -> ChannelCount {
        NonZero::new(self.channels).unwrap_or(NonZero::<u16>::MIN)
    }
    fn sample_rate(&self) -> SampleRate {
        NonZero::new(SR).unwrap_or(NonZero::<u32>::MIN)
    }
    fn total_duration(&self) -> Option<Duration> {
        (!self.looping).then(|| Duration::from_secs_f32(self.data.len() as f32 / self.channels as f32 / SRF))
    }
}

impl Decodable for SynthClip {
    type Decoder = ClipDecoder;
    fn decoder(&self) -> ClipDecoder {
        ClipDecoder { data: self.samples.clone(), pos: 0, channels: self.channels, looping: self.looping }
    }
}

/// Live engine parameters, written by the game, read by the audio thread.
#[derive(Default)]
pub struct EngineParams {
    throttle: AtomicU32,
    boost: AtomicU32,
    impulse: AtomicU32,
    volume: AtomicU32,
}

impl EngineParams {
    fn set(a: &AtomicU32, v: f32) {
        a.store(v.to_bits(), Ordering::Relaxed);
    }
    fn get(a: &AtomicU32) -> f32 {
        f32::from_bits(a.load(Ordering::Relaxed))
    }
}

/// The engine hum: an endless synthesizer voice (filtered noise rumble plus a low saw drone and an
/// impulse-drive whine), driven by `EngineParams`.
#[derive(Asset, TypePath, Clone)]
pub struct EngineVoice {
    params: Arc<EngineParams>,
}

impl Decodable for EngineVoice {
    type Decoder = EngineDecoder;
    fn decoder(&self) -> EngineDecoder {
        EngineDecoder::new(self.params.clone())
    }
}

pub struct EngineDecoder {
    p: Arc<EngineParams>,
    noise: Noise,
    rumble: Svf,
    drone_lp: Svf,
    whine_bp: Svf,
    saw: f32,
    sub: f32,
    whine: f32,
    /// smoothed throttle, boost, impulse, volume
    cur: [f32; 4],
    goal: [f32; 4],
    n: u32,
}

impl EngineDecoder {
    fn new(p: Arc<EngineParams>) -> Self {
        Self { p, noise: Noise(0x2545_f491), rumble: Svf::default(), drone_lp: Svf::default(), whine_bp: Svf::default(), saw: 0.0, sub: 0.0, whine: 0.0, cur: [0.0; 4], goal: [0.0; 4], n: 0 }
    }
}

impl Iterator for EngineDecoder {
    type Item = Sample;
    fn next(&mut self) -> Option<Sample> {
        if self.n % 64 == 0 {
            self.goal = [EngineParams::get(&self.p.throttle), EngineParams::get(&self.p.boost), EngineParams::get(&self.p.impulse), EngineParams::get(&self.p.volume)];
            // ~0.15 s glide, updated every 64 samples
            let k = 1.0 - (-64.0 / (0.15 * SRF)).exp();
            for i in 0..4 {
                self.cur[i] += (self.goal[i] - self.cur[i]) * k;
            }
            let [thr, boost, imp, _] = self.cur;
            self.rumble.set(150.0 + thr * 420.0 + boost * 1100.0 + imp * 1800.0, 3.0);
            self.drone_lp.set(300.0 + imp * 300.0, 0.7);
            self.whine_bp.set(900.0 + imp * 1500.0, 6.0);
        }
        self.n = self.n.wrapping_add(1);
        let [thr, boost, imp, vol] = self.cur;
        if vol < 1e-4 {
            return Some(0.0);
        }
        let f = 40.0 + thr * 34.0 + boost * 34.0 + imp * 30.0;
        self.saw = (self.saw + f / SRF).fract();
        self.sub = (self.sub + f * 0.5 / SRF).fract();
        self.whine = (self.whine + (220.0 + imp * 140.0) / SRF).fract();
        let w = self.noise.next();
        let rumble = self.rumble.lp(w) * (0.04 + thr * 0.06 + boost * 0.16 + imp * 0.12);
        let drone = self.drone_lp.lp((self.saw * 2.0 - 1.0) + (self.sub * TAU).sin()) * (0.03 + thr * 0.03);
        let hiss = self.whine_bp.bp(w) * imp * 0.05 + (self.whine * TAU).sin() * imp * 0.018;
        Some(((rumble + drone + hiss) * vol) as Sample)
    }
}

impl Source for EngineDecoder {
    fn current_span_len(&self) -> Option<usize> {
        None
    }
    fn channels(&self) -> ChannelCount {
        NonZero::<u16>::MIN
    }
    fn sample_rate(&self) -> SampleRate {
        NonZero::new(SR).unwrap_or(NonZero::<u32>::MIN)
    }
    fn total_duration(&self) -> Option<Duration> {
        None
    }
}

// ---------- DSP building blocks ----------

/// xorshift white noise in -1..1
#[derive(Clone, Copy)]
struct Noise(u32);

impl Noise {
    fn next(&mut self) -> f32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 17;
        self.0 ^= self.0 << 5;
        (self.0 as f32 / u32::MAX as f32) * 2.0 - 1.0
    }
    fn f(&mut self) -> f32 {
        self.next() * 0.5 + 0.5
    }
}

/// Topology-preserving state-variable filter (stable under fast cutoff changes).
#[derive(Clone, Copy, Default)]
struct Svf {
    g: f32,
    k: f32,
    a1: f32,
    a2: f32,
    a3: f32,
    ic1: f32,
    ic2: f32,
}

impl Svf {
    fn set(&mut self, f: f32, q: f32) {
        let f = f.clamp(10.0, SRF * 0.45);
        self.g = (PI * f / SRF).tan();
        self.k = 1.0 / q.max(0.05);
        self.a1 = 1.0 / (1.0 + self.g * (self.g + self.k));
        self.a2 = self.g * self.a1;
        self.a3 = self.g * self.a2;
    }
    /// (low, band, high)
    fn tick(&mut self, x: f32) -> (f32, f32, f32) {
        let v3 = x - self.ic2;
        let v1 = self.a1 * self.ic1 + self.a2 * v3;
        let v2 = self.ic2 + self.a2 * self.ic1 + self.a3 * v3;
        self.ic1 = 2.0 * v1 - self.ic1;
        self.ic2 = 2.0 * v2 - self.ic2;
        (v2, v1, x - self.k * v1 - v2)
    }
    fn lp(&mut self, x: f32) -> f32 {
        self.tick(x).0
    }
    fn bp(&mut self, x: f32) -> f32 {
        // unity gain at the centre
        let k = self.k;
        self.tick(x).1 * k
    }
    fn hp(&mut self, x: f32) -> f32 {
        self.tick(x).2
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Wave {
    Sine,
    Saw,
    Square,
    Tri,
}

fn poly_blep(t: f32, dt: f32) -> f32 {
    if t < dt {
        let t = t / dt;
        t + t - t * t - 1.0
    } else if t > 1.0 - dt {
        let t = (t - 1.0) / dt;
        t * t + t + t + 1.0
    } else {
        0.0
    }
}

/// band-limited oscillator sample at phase `ph` (0..1) with phase increment `dt`
fn wave(w: Wave, ph: f32, dt: f32) -> f32 {
    match w {
        Wave::Sine => (ph * TAU).sin(),
        Wave::Saw => 2.0 * ph - 1.0 - poly_blep(ph, dt),
        Wave::Square => {
            let s = if ph < 0.5 { 1.0 } else { -1.0 };
            s + poly_blep(ph, dt) - poly_blep((ph + 0.5).fract(), dt)
        }
        Wave::Tri => 1.0 - 4.0 * (ph - 0.5).abs(),
    }
}

#[derive(Clone, Copy)]
enum Filter {
    Low,
    High,
    Band,
}

/// Schroeder/Freeverb-style reverb (8 combs, 4 allpasses per channel).
struct Reverb {
    combs: Vec<(Vec<f32>, usize, f32)>,
    alls: Vec<(Vec<f32>, usize)>,
    feedback: f32,
    damp: f32,
}

impl Reverb {
    fn new(size: f32, damp: f32, spread: usize) -> Self {
        const COMBS: [usize; 8] = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
        const ALLS: [usize; 4] = [556, 441, 341, 225];
        let scale = SRF / 44_100.0;
        Self {
            combs: COMBS.iter().map(|&n| (vec![0.0; ((n + spread) as f32 * scale) as usize], 0, 0.0)).collect(),
            alls: ALLS.iter().map(|&n| (vec![0.0; ((n + spread) as f32 * scale) as usize], 0)).collect(),
            feedback: size,
            damp,
        }
    }
    fn tick(&mut self, x: f32) -> f32 {
        let mut out = 0.0;
        for (buf, i, store) in &mut self.combs {
            let y = buf[*i];
            *store = y * (1.0 - self.damp) + *store * self.damp;
            buf[*i] = x + *store * self.feedback;
            *i = (*i + 1) % buf.len();
            out += y;
        }
        for (buf, i) in &mut self.alls {
            let b = buf[*i];
            buf[*i] = out + b * 0.5;
            out = b - out;
            *i = (*i + 1) % buf.len();
        }
        out * 0.12
    }
}

// ---------- sound effect clips ----------

/// Mono clip under construction: a dry bus and a send into a small hall.
struct Clip {
    dry: Vec<f32>,
    wet: Vec<f32>,
    noise: Noise,
}

impl Clip {
    fn new(seconds: f32, seed: u32) -> Self {
        let n = (seconds * SRF) as usize;
        Self { dry: vec![0.0; n], wet: vec![0.0; n], noise: Noise(seed | 1) }
    }

    fn span(&self, at: f32, dur: f32) -> (usize, usize) {
        let a = (at * SRF) as usize;
        let b = (((at + dur) * SRF) as usize + 1).min(self.dry.len());
        (a.min(b), b)
    }

    /// web tone(): oscillator with an exponential pitch sweep and an exponential fade to silence
    #[allow(clippy::too_many_arguments)]
    fn tone(&mut self, at: f32, w: Wave, f0: f32, f1: f32, dur: f32, vol: f32, wet: f32) {
        let (a, b) = self.span(at, dur);
        let mut ph = 0.0f32;
        let ratio = f1.max(20.0) / f0;
        let fall = 0.0005f32 / vol.max(1e-4);
        for i in a..b {
            let t = (i - a) as f32 / SRF / dur;
            let f = f0 * ratio.powf(t);
            let dt = f / SRF;
            let g = vol * fall.powf(t);
            let s = wave(w, ph, dt) * g;
            ph = (ph + dt).fract();
            self.dry[i] += s;
            self.wet[i] += s * wet;
        }
    }

    /// web noise(): white noise through a swept filter with an exponential fade
    #[allow(clippy::too_many_arguments)]
    fn noise(&mut self, at: f32, dur: f32, vol: f32, kind: Filter, f0: f32, f1: f32, q: f32, wet: f32) {
        let (a, b) = self.span(at, dur);
        let mut svf = Svf::default();
        let ratio = f1.max(30.0) / f0;
        let fall = 0.0005f32 / vol.max(1e-4);
        for i in a..b {
            let t = (i - a) as f32 / SRF / dur;
            if (i - a) % 16 == 0 {
                svf.set(f0 * ratio.powf(t), q);
            }
            let x = self.noise.next();
            let y = match kind {
                Filter::Low => svf.lp(x),
                Filter::High => svf.hp(x),
                Filter::Band => svf.bp(x),
            };
            let s = y * vol * fall.powf(t);
            self.dry[i] += s;
            self.wet[i] += s * wet;
        }
    }

    /// dry + hall, trailing silence trimmed, a short fade at the very end
    fn finish(self, room: f32) -> SynthClip {
        let mut rv = Reverb::new(room, 0.3, 0);
        let mut out: Vec<f32> = self.dry.iter().zip(&self.wet).map(|(d, w)| d + rv.tick(*w) * 0.6).collect();
        let last = out.iter().rposition(|v| v.abs() > 2e-4).unwrap_or(0);
        out.truncate((last + 64).min(out.len()));
        let n = out.len();
        let fade = n.min(256);
        for (k, v) in out[n - fade..].iter_mut().enumerate() {
            *v *= 1.0 - k as f32 / fade as f32;
        }
        let peak = out.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        if peak > 0.98 {
            for v in &mut out {
                *v *= 0.98 / peak;
            }
        }
        SynthClip { samples: out.into(), channels: 1, looping: false }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Sfx {
    LaserAlly,
    LaserEnemy,
    LanceCharge,
    Lance,
    ExplosionSmall,
    ExplosionLarge,
    ShieldHit,
    HullHit,
    Lock,
    Beep,
    Warp,
    Comm,
    UiMove,
    UiOk,
}

const SFX_ALL: [Sfx; 14] = [
    Sfx::LaserAlly,
    Sfx::LaserEnemy,
    Sfx::LanceCharge,
    Sfx::Lance,
    Sfx::ExplosionSmall,
    Sfx::ExplosionLarge,
    Sfx::ShieldHit,
    Sfx::HullHit,
    Sfx::Lock,
    Sfx::Beep,
    Sfx::Warp,
    Sfx::Comm,
    Sfx::UiMove,
    Sfx::UiOk,
];

impl Sfx {
    fn name(self) -> &'static str {
        match self {
            Sfx::LaserAlly => "laser_ally",
            Sfx::LaserEnemy => "laser_enemy",
            Sfx::LanceCharge => "neutron_charge",
            Sfx::Lance => "neutron_beam",
            Sfx::ExplosionSmall => "explosion_small",
            Sfx::ExplosionLarge => "explosion_large",
            Sfx::ShieldHit => "shield_hit",
            Sfx::HullHit => "hull_hit",
            Sfx::Lock => "lock",
            Sfx::Beep => "beep",
            Sfx::Warp => "warp",
            Sfx::Comm => "comm",
            Sfx::UiMove => "ui_move",
            Sfx::UiOk => "ui_ok",
        }
    }

    /// minimum seconds between two starts of this sound (rapid fire, many hits at once)
    fn min_gap(self) -> f32 {
        match self {
            Sfx::LaserAlly | Sfx::LaserEnemy => 0.045,
            Sfx::ShieldHit | Sfx::HullHit => 0.06,
            Sfx::ExplosionSmall => 0.05,
            Sfx::ExplosionLarge => 0.12,
            Sfx::Comm => 0.3,
            _ => 0.02,
        }
    }

    /// the recipes of the web game's synth (src/audio.js)
    fn render(self) -> SynthClip {
        use Filter::*;
        use Wave::*;
        let seed = self as u32 * 7919 + 17;
        match self {
            Sfx::LaserAlly => {
                // bright zap + body + click
                let v = 0.25;
                let mut c = Clip::new(0.6, seed);
                c.tone(0.0, Saw, 1500.0, 210.0, 0.13, v * 0.8, 0.12);
                c.tone(0.0, Sine, 820.0, 300.0, 0.09, v * 0.5, 0.0);
                c.noise(0.0, 0.03, v * 0.5, High, 6000.0, 2000.0, 0.7, 0.0);
                c.finish(0.7)
            }
            Sfx::LaserEnemy => {
                let mut c = Clip::new(0.6, seed);
                c.tone(0.0, Square, 620.0, 140.0, 0.16, 0.25 * 0.45, 0.1);
                c.finish(0.7)
            }
            Sfx::LanceCharge => {
                // capacitors charging: a fast rising whine
                let mut c = Clip::new(0.8, seed);
                c.tone(0.0, Sine, 380.0, 2600.0, 0.32, 0.07, 0.1);
                c.tone(0.0, Square, 190.0, 1300.0, 0.32, 0.025, 0.0);
                c.finish(0.75)
            }
            Sfx::Lance => {
                // hard electric crack, falling sizzle, low body thump
                let mut c = Clip::new(1.8, seed);
                c.noise(0.0, 0.06, 0.32, High, 9000.0, 4000.0, 0.8, 0.2);
                c.tone(0.0, Saw, 2600.0, 160.0, 0.42, 0.14, 0.4);
                c.noise(0.0, 0.45, 0.2, Band, 7000.0, 900.0, 1.6, 0.5);
                c.tone(0.0, Sine, 120.0, 38.0, 0.35, 0.36, 0.3);
                c.finish(0.8)
            }
            Sfx::ExplosionSmall => {
                // crack, rumble
                let v = 0.6;
                let mut c = Clip::new(2.6, seed);
                c.noise(0.0, 0.08, v * 0.9, Low, 5000.0, 900.0, 0.7, 0.2);
                c.noise(0.0, 1.2, v, Low, 1300.0, 35.0, 0.8, 0.5);
                c.tone(0.0, Sine, 95.0, 26.0, 0.7, v * 0.9, 0.3);
                c.finish(0.82)
            }
            Sfx::ExplosionLarge => {
                // crack, long rumble, low boom, debris crackle tail
                let v = 0.8;
                let mut c = Clip::new(4.5, seed);
                c.noise(0.0, 0.08, v * 0.9, Low, 5000.0, 900.0, 0.7, 0.2);
                c.noise(0.0, 2.6, v, Low, 700.0, 35.0, 0.8, 0.5);
                c.tone(0.0, Sine, 65.0, 26.0, 1.6, v * 0.9, 0.3);
                c.noise(0.18, 1.4, v * 0.35, Band, 3000.0, 400.0, 2.0, 0.6);
                c.finish(0.86)
            }
            Sfx::ShieldHit => {
                let mut c = Clip::new(0.9, seed);
                c.tone(0.0, Sine, 1100.0, 260.0, 0.22, 0.28, 0.3);
                c.tone(0.0, Tri, 2200.0, 900.0, 0.12, 0.1, 0.2);
                c.finish(0.75)
            }
            Sfx::HullHit => {
                let mut c = Clip::new(0.9, seed);
                c.noise(0.0, 0.25, 0.5, Low, 2400.0, 160.0, 0.8, 0.3);
                c.tone(0.0, Square, 150.0, 45.0, 0.18, 0.25, 0.1);
                c.finish(0.75)
            }
            Sfx::Lock => {
                let mut c = Clip::new(0.3, seed);
                c.tone(0.0, Square, 1500.0, 1500.0, 0.05, 0.07, 0.0);
                c.tone(0.07, Square, 1900.0, 1900.0, 0.05, 0.07, 0.0);
                c.finish(0.5)
            }
            Sfx::Beep => {
                let mut c = Clip::new(0.3, seed);
                c.tone(0.0, Sine, 880.0, 880.0, 0.08, 0.14, 0.05);
                c.finish(0.5)
            }
            Sfx::Warp => {
                let mut c = Clip::new(2.6, seed);
                c.noise(0.0, 1.2, 0.42, Band, 180.0, 6000.0, 3.0, 0.5);
                c.tone(0.0, Sine, 90.0, 1100.0, 1.0, 0.2, 0.4);
                c.finish(0.82)
            }
            Sfx::Comm => {
                // short radio static before a transmission
                let mut c = Clip::new(0.4, seed);
                c.noise(0.0, 0.12, 0.12, Band, 3200.0, 1800.0, 1.5, 0.0);
                c.tone(0.0, Sine, 1250.0, 1250.0, 0.05, 0.06, 0.0);
                c.finish(0.5)
            }
            Sfx::UiMove => {
                let mut c = Clip::new(0.2, seed);
                c.tone(0.0, Sine, 1500.0, 1500.0, 0.03, 0.035, 0.0);
                c.finish(0.5)
            }
            Sfx::UiOk => {
                let mut c = Clip::new(0.6, seed);
                c.tone(0.0, Tri, 660.0, 990.0, 0.09, 0.09, 0.2);
                c.finish(0.7)
            }
        }
    }
}

// ---------- state ----------

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
enum Device {
    /// waiting for the probe voice to get a sink
    #[default]
    Unknown,
    Present,
    /// no audio output: spawn nothing
    Missing,
}

/// Rendered music loops, filled by the background thread one mood at a time.
type MusicSlot = Arc<Mutex<Vec<(Mood, SynthClip)>>>;

/// A playing music loop (fading in, playing, or fading out before it is removed).
struct MusicPlayer {
    e: Entity,
    mood: Mood,
    vol: f32,
    out: bool,
}

#[derive(Resource, Default)]
pub struct AudioState {
    device: Device,
    probe_t: f32,
    clips: Vec<Handle<SynthClip>>,
    durations: Vec<f32>,
    last_start: Vec<f32>,
    engine: Option<(Entity, Arc<EngineParams>)>,
    music_slot: Option<MusicSlot>,
    /// rendered loops
    music_clips: Vec<(Mood, Handle<SynthClip>)>,
    /// the current loop and the ones fading out
    players: Vec<MusicPlayer>,
    /// time since the current loop started fading out (the next one starts after a short gap)
    music_gap: f32,
    rng: u32,
}

/// A playing sound effect (despawned by Bevy when it ends, or by `reap_voices` at `until`).
#[derive(Component)]
struct SfxVoice {
    until: f32,
}

fn sfx_clip(sfx: Sfx) -> usize {
    SFX_ALL.iter().position(|s| *s == sfx).unwrap_or(0)
}

fn setup_audio(mut commands: Commands, mut state: ResMut<AudioState>, mut clips: ResMut<Assets<SynthClip>>, mut voices: ResMut<Assets<EngineVoice>>) {
    let t0 = std::time::Instant::now();
    for s in SFX_ALL {
        let clip = s.render();
        state.durations.push(clip.seconds());
        state.clips.push(clips.add(clip));
    }
    state.last_start = vec![-1.0; SFX_ALL.len()];
    state.rng = 0x1234_5678;
    info!("audio: {} sound effects synthesized in {:.2} s", SFX_ALL.len(), t0.elapsed().as_secs_f32());
    // the engine voice doubles as the probe for an audio device
    let params = Arc::new(EngineParams::default());
    let e = commands
        .spawn((AudioPlayer(voices.add(EngineVoice { params: params.clone() })), PlaybackSettings { mode: PlaybackMode::Once, volume: Volume::Linear(1.0), ..default() }, Name::new("Triebwerksklang")))
        .id();
    state.engine = Some((e, params));
    if let Ok(dir) = std::env::var("SF_AUDIO_DUMP") {
        dump(&dir, &clips, &state.clips);
    }
}

/// Is there an audio device? Bevy's audio systems give the probe voice a sink only if there is one.
fn probe_audio(time: Res<Time>, mut commands: Commands, mut state: ResMut<AudioState>, sinks: Query<(), With<AudioSink>>) {
    if state.device != Device::Unknown {
        return;
    }
    let Some((e, _)) = state.engine.clone() else { return };
    state.probe_t += time.delta_secs();
    if sinks.get(e).is_ok() {
        state.device = Device::Present;
        start_music_render(&mut state);
    } else if state.probe_t > 1.5 {
        state.device = Device::Missing;
        commands.entity(e).despawn();
        state.engine = None;
        info!("audio: kein Audiogerät, Ton aus");
    }
}

impl AudioState {
    fn rand(&mut self) -> f32 {
        self.rng ^= self.rng << 13;
        self.rng ^= self.rng >> 17;
        self.rng ^= self.rng << 5;
        self.rng as f32 / u32::MAX as f32
    }
}

/// SfxMsg -> sound effect voices (the radio blip comes from hud.rs when a line is shown, as on the web).
#[allow(clippy::too_many_arguments)]
fn play_sfx(
    mut commands: Commands,
    time: Res<Time>,
    settings: Res<Settings>,
    mut state: ResMut<AudioState>,
    mut msgs: MessageReader<SfxMsg>,
    voices: Query<(), With<SfxVoice>>,
) {
    if state.device != Device::Present {
        msgs.clear();
        return;
    }
    let now = time.elapsed_secs();
    let mut active = voices.iter().count();
    let mut play = |state: &mut AudioState, sfx: Sfx, vol: f32, pitch: f32| {
        let i = sfx_clip(sfx);
        if active >= MAX_VOICES || now - state.last_start[i] < sfx.min_gap() || settings.master_volume <= 0.0 {
            return;
        }
        state.last_start[i] = now;
        active += 1;
        let speed = pitch.clamp(0.5, 2.0);
        commands.spawn((
            AudioPlayer(state.clips[i].clone()),
            PlaybackSettings { mode: PlaybackMode::Despawn, volume: Volume::Linear(vol * settings.master_volume * SFX_GAIN), speed, ..default() },
            SfxVoice { until: now + state.durations[i] / speed + 0.5 },
        ));
    };
    for m in msgs.read() {
        let r = state.rand();
        let (sfx, vol, pitch) = match *m {
            SfxMsg::Laser { enemy: false } => (Sfx::LaserAlly, 1.0, 0.94 + r * 0.12),
            SfxMsg::Laser { enemy: true } => (Sfx::LaserEnemy, 0.9, 0.92 + r * 0.16),
            SfxMsg::Lance => (Sfx::Lance, 1.0, 0.97 + r * 0.06),
            SfxMsg::LanceCharge => (Sfx::LanceCharge, 1.0, 1.0),
            SfxMsg::Explosion { size } if size >= 2.5 => (Sfx::ExplosionLarge, (0.8 + size * 0.05).min(1.15), 0.86 + r * 0.14 - (size - 3.0).max(0.0) * 0.02),
            SfxMsg::Explosion { size } => (Sfx::ExplosionSmall, 0.75 + size * 0.15, (0.9 + r * 0.2) / (0.9 + size * 0.1)),
            SfxMsg::ShieldHit => (Sfx::ShieldHit, 1.0, 0.95 + r * 0.1),
            SfxMsg::HullHit => (Sfx::HullHit, 1.0, 0.9 + r * 0.2),
            SfxMsg::Lock => (Sfx::Lock, 1.0, 1.0),
            SfxMsg::Beep => (Sfx::Beep, 1.0, 1.0),
            SfxMsg::Warp => (Sfx::Warp, 1.0, 0.97 + r * 0.06),
            SfxMsg::Comm => (Sfx::Comm, 1.0, 1.0),
            SfxMsg::UiMove => (Sfx::UiMove, 1.0, 1.0),
            SfxMsg::UiOk => (Sfx::UiOk, 1.0, 1.0),
        };
        play(&mut state, sfx, vol, pitch);
    }
}

/// Engine hum follows the player's drive; silent outside a mission, while paused or dead.
fn engine_hum(state: Res<AudioState>, settings: Res<Settings>, paused: Res<Paused>, app_state: Res<State<AppState>>, players: Query<(&Ship, &Player), Without<Dying>>) {
    let Some((_, params)) = state.engine.as_ref() else { return };
    let flying = *app_state.get() == AppState::Flight && !paused.0;
    let (thr, boost, imp, on) = match players.iter().next() {
        Some((ship, p)) if flying => {
            let thr = (ship.speed / ship.def.speed.max(1.0)).clamp(0.0, 1.0);
            let imp = if p.impulse { 0.4 + 0.6 * p.impulse_prog } else { 0.0 };
            (thr, if p.boosting || p.impulse { 1.0 } else { 0.0 }, imp, 1.0)
        }
        _ => (0.0, 0.0, 0.0, 0.0),
    };
    EngineParams::set(&params.throttle, thr);
    EngineParams::set(&params.boost, boost);
    EngineParams::set(&params.impulse, imp);
    EngineParams::set(&params.volume, on * settings.master_volume * SFX_GAIN * 1.1);
}

/// Which mood the game wants (web app.js): None keeps the current one (paused, mission over).
fn wanted_mood(st: AppState, status: &MissionStatus, result: &MissionResult, data: &GameData, paused: bool) -> Option<Mood> {
    match st {
        AppState::Menu => Some(Mood::Menu),
        AppState::Briefing => Some(Mood::Briefing),
        AppState::Flight if paused || status.ended.is_some() => None,
        AppState::Flight if status.hostiles > 0 => Some(Mood::Combat),
        AppState::Flight => {
            let own = data.mission(status.mission).extra.get("music").and_then(|v| v.as_str()).and_then(Mood::from_name);
            Some(own.unwrap_or(Mood::Travel))
        }
        AppState::Debrief => {
            let win = status.ended.as_ref().map_or(result.win, |e| e.win);
            // an objective lost without dying: the story branches (lament); a death or a plain failure: retry
            let branch = !win && !result.death && data.mission(result.mission).extra.get("lose").is_some_and(|l| !l.is_null());
            Some(if win {
                Mood::Victory
            } else if branch {
                Mood::Sad
            } else {
                Mood::Briefing
            })
        }
        #[allow(unreachable_patterns)]
        _ => None,
    }
}

/// Collect rendered loops, pick the mood for the game state, fade the old loop out and start the new one
/// from its beginning (web Music.setMood); Settings.music.
#[allow(clippy::too_many_arguments)]
fn music(
    mut commands: Commands,
    time: Res<Time>,
    settings: Res<Settings>,
    paused: Res<Paused>,
    app_state: Res<State<AppState>>,
    status: Res<MissionStatus>,
    result: Res<MissionResult>,
    data: Res<GameData>,
    mut state: ResMut<AudioState>,
    mut clips: ResMut<Assets<SynthClip>>,
    mut sinks: Query<&mut AudioSink>,
) {
    if state.device != Device::Present {
        return;
    }
    let done = state.music_slot.as_ref().map(|s| s.lock().map(|mut g| std::mem::take(&mut *g)).unwrap_or_default()).unwrap_or_default();
    for (mood, clip) in done {
        let h = clips.add(clip);
        state.music_clips.push((mood, h));
    }
    let dt = time.delta_secs().min(0.1);
    let current = state.players.iter().find(|p| !p.out).map(|p| p.mood);
    let ready = |m: Mood| state.music_clips.iter().find(|c| c.0 == m).map(|c| c.1.clone());
    // the wanted mood, else a related one that is already rendered
    let mut goal = wanted_mood(*app_state.get(), &status, &result, &data, paused.0).or(current);
    let mut clip = None;
    while let Some(m) = goal {
        if let Some(c) = ready(m) {
            clip = Some(c);
            break;
        }
        goal = m.fallback();
    }
    if let (Some(goal), Some(clip)) = (goal, clip)
        && current != Some(goal)
    {
        for p in &mut state.players {
            p.out = true;
        }
        state.music_gap += dt;
        // web: fade out (0.35 s), switch after 1.1 s; straight away when nothing is audible
        if state.music_gap >= 0.9 || state.players.iter().all(|p| p.vol < 0.01) {
            state.music_gap = 0.0;
            let e = commands
                .spawn((AudioPlayer(clip), PlaybackSettings { mode: PlaybackMode::Once, volume: Volume::Linear(0.0), ..default() }, Name::new(format!("Musik {}", goal.name()))))
                .id();
            state.players.push(MusicPlayer { e, mood: goal, vol: 0.0, out: false });
        }
    } else {
        state.music_gap = 0.0;
    }
    let on = if settings.music { settings.master_volume * MUSIC_GAIN } else { 0.0 };
    for p in &mut state.players {
        let (target, tau) = if p.out { (0.0, 0.35) } else { (on, 0.6) };
        let v = p.vol + (target - p.vol) * (1.0 - (-dt / tau).exp());
        p.vol = if (v - target).abs() < 1e-4 { target } else { v };
        if let Ok(mut sink) = sinks.get_mut(p.e) {
            let want = Volume::Linear(p.vol);
            if sink.volume() != want {
                sink.set_volume(want);
            }
        }
    }
    state.players.retain(|p| {
        let gone = p.out && p.vol < 1e-3;
        if gone {
            commands.entity(p.e).try_despawn();
        }
        !gone
    });
}

/// Safety net: voices whose sink never reported the end (or never started) are removed in time.
fn reap_voices(mut commands: Commands, time: Res<Time>, voices: Query<(Entity, &SfxVoice)>) {
    let now = time.elapsed_secs();
    for (e, v) in &voices {
        if now > v.until {
            commands.entity(e).try_despawn();
        }
    }
}

// ---------- music ----------

fn start_music_render(state: &mut AudioState) {
    let slot: MusicSlot = Arc::new(Mutex::new(Vec::new()));
    state.music_slot = Some(slot.clone());
    let spawned = std::thread::Builder::new().name("musik".into()).spawn(move || {
        let t0 = std::time::Instant::now();
        // the most needed first: each loop is handed over as soon as it is done
        for mood in Mood::RENDER_ORDER {
            let clip = render_score(&mood.score());
            if let Ok(mut g) = slot.lock() {
                g.push((mood, clip));
            }
        }
        info!("audio: Musik ({} Stimmungen) in {:.1} s gerendert", Mood::RENDER_ORDER.len(), t0.elapsed().as_secs_f32());
    });
    if spawned.is_err() {
        state.music_slot = None;
    }
}

fn midi(n: i32) -> f32 {
    440.0 * 2f32.powf((n - 69) as f32 / 12.0)
}

/// 'D5', 'Bb4', 'C#5' -> midi note number
const fn note(name: &str) -> i32 {
    let b = name.as_bytes();
    let base = match b[0] {
        b'C' => 0,
        b'D' => 2,
        b'E' => 4,
        b'F' => 5,
        b'G' => 7,
        b'A' => 9,
        _ => 11,
    };
    let (acc, oct) = match b[1] {
        b'#' => (1, b[2]),
        b'b' => (-1, b[2]),
        o => (0, o),
    };
    base + acc + ((oct - b'0') as i32 + 1) * 12
}

macro_rules! chord {
    ($($n:literal),*) => { [$(note($n)),*] };
}

/// one bar of melody: (step of 16, note, length in steps)
type Bar = &'static [(u32, i32, u32)];

macro_rules! bar {
    ($(($s:literal, $n:literal, $l:literal)),*) => { &[$(($s, note($n), $l)),*] };
}

// Heroic main theme in D major with a Lydian lift (G#) and the flat-seven turn (C) of the genre
const HERO: [Bar; 8] = [
    bar![(0, "A4", 3), (3, "D5", 1), (4, "E5", 8), (12, "F#5", 4)],
    bar![(0, "G#5", 6), (6, "F#5", 2), (8, "E5", 4), (12, "B4", 4)],
    bar![(0, "D5", 3), (3, "E5", 1), (4, "F#5", 4), (8, "A5", 6), (14, "G5", 2)],
    bar![(0, "F#5", 12), (12, "E5", 4)],
    bar![(0, "A4", 3), (3, "D5", 1), (4, "E5", 8), (12, "A5", 4)],
    bar![(0, "C6", 6), (6, "B5", 2), (8, "A5", 4), (12, "G5", 4)],
    bar![(0, "F#5", 4), (4, "G5", 2), (6, "A5", 2), (8, "B5", 4), (12, "E5", 4)],
    bar![(0, "D5", 16)],
];
const HERO_CHORDS: [[i32; 4]; 8] = [
    chord!("D3", "A3", "D4", "F#4"),
    chord!("D3", "B3", "E4", "G#4"),
    chord!("G2", "D3", "F#3", "B3"),
    chord!("A2", "E3", "A3", "C#4"),
    chord!("D3", "A3", "D4", "F#4"),
    chord!("C3", "G3", "C4", "E4"),
    chord!("A2", "E3", "G3", "C#4"),
    chord!("D3", "A3", "D4", "F#4"),
];
// Battle theme in D minor (the squadron's motif), carried by the horns over the ostinato
const BATTLE: [Bar; 8] = [
    bar![(0, "D5", 4), (6, "A4", 2), (8, "D5", 2), (10, "F5", 4), (14, "E5", 2)],
    bar![(0, "C5", 4), (4, "Bb4", 4), (8, "A4", 4), (12, "F4", 2), (14, "G4", 2)],
    bar![(0, "A4", 4), (4, "C5", 2), (6, "F5", 2), (8, "E5", 4), (12, "D5", 2), (14, "C5", 2)],
    bar![(0, "D5", 8), (8, "E5", 4), (12, "G5", 4)],
    bar![(0, "F5", 4), (4, "E5", 2), (6, "D5", 2), (8, "A5", 4), (12, "G5", 2), (14, "F5", 2)],
    bar![(0, "G5", 4), (4, "F5", 2), (6, "D5", 2), (8, "F5", 4), (12, "E5", 2), (14, "D5", 2)],
    bar![(0, "C5", 4), (4, "D5", 2), (6, "E5", 2), (8, "F5", 4), (12, "A5", 4)],
    bar![(0, "A5", 8), (8, "E5", 4), (12, "C#5", 4)],
];
const BATTLE_CHORDS: [[i32; 4]; 8] = [
    chord!("D3", "A3", "D4", "F4"),
    chord!("Bb2", "F3", "Bb3", "D4"),
    chord!("F2", "C3", "F3", "A3"),
    chord!("C3", "G3", "C4", "E4"),
    chord!("D3", "A3", "D4", "F4"),
    chord!("Bb2", "F3", "Bb3", "D4"),
    chord!("G2", "D3", "G3", "Bb3"),
    chord!("A2", "E3", "A3", "C#4"),
];

// Briefing: the theme's opening, quietly, over a pulsing low-string figure
const BRIEF: [Bar; 4] = [
    bar![(0, "A4", 3), (3, "D5", 1), (4, "E5", 12)],
    bar![(0, "G#5", 8), (8, "F#5", 8)],
    bar![(0, "D5", 4), (4, "F#5", 4), (8, "E5", 8)],
    bar![(0, "B4", 16)],
];
const BRIEF_CHORDS: [[i32; 4]; 4] = [chord!("D3", "A3", "D4", "F#4"), chord!("D3", "B3", "E4", "G#4"), chord!("B2", "F#3", "B3", "D4"), chord!("G2", "D3", "G3", "B3")];
// Lament for the fallen: solo horn over strings
const LAMENT: [Bar; 4] = [
    bar![(0, "A4", 6), (6, "G4", 2), (8, "F4", 4), (12, "E4", 4)],
    bar![(0, "D4", 8), (8, "F4", 4), (12, "A4", 4)],
    bar![(0, "Bb4", 6), (6, "A4", 2), (8, "G4", 4), (12, "F4", 4)],
    bar![(0, "E4", 12), (12, "C#4", 4)],
];
const LAMENT_CHORDS: [[i32; 4]; 4] = [chord!("D3", "A3", "D4", "F4"), chord!("Bb2", "F3", "Bb3", "D4"), chord!("G2", "D3", "G3", "Bb3"), chord!("A2", "E3", "A3", "C#4")];
// Victory fanfare in D major
const FANFARE: [Bar; 4] = [
    bar![(0, "A4", 2), (2, "D5", 1), (3, "D5", 1), (4, "A5", 6), (10, "F#5", 2), (12, "G5", 2), (14, "A5", 2)],
    bar![(0, "C6", 4), (4, "B5", 2), (6, "G5", 2), (8, "A5", 8)],
    bar![(0, "D5", 2), (2, "E5", 2), (4, "F#5", 4), (8, "G#5", 2), (10, "A5", 2), (12, "B5", 4)],
    bar![(0, "D6", 12)],
];
const FANFARE_CHORDS: [[i32; 4]; 4] = [chord!("D3", "A3", "D4", "F#4"), chord!("C3", "G3", "C4", "E4"), chord!("D3", "B3", "E4", "G#4"), chord!("D3", "A3", "D4", "F#4")];
// Tension: dark, unresolved harmony over a timpani rumble (no tune)
const TENSION_CHORDS: [[i32; 4]; 4] = [chord!("D2", "A2", "Eb3", "A3"), chord!("D2", "G2", "C#3", "G3"), chord!("D2", "A2", "Eb3", "Bb3"), chord!("Bb1", "F2", "B2", "E3")];

/// The music moods of src/audio.js.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Mood {
    Menu,
    Briefing,
    Travel,
    Combat,
    Tension,
    Sad,
    Victory,
}

impl Mood {
    /// render order: what the game needs first comes first
    const RENDER_ORDER: [Mood; 7] = [Mood::Menu, Mood::Briefing, Mood::Combat, Mood::Travel, Mood::Victory, Mood::Sad, Mood::Tension];

    fn name(self) -> &'static str {
        match self {
            Mood::Menu => "menu",
            Mood::Briefing => "briefing",
            Mood::Travel => "travel",
            Mood::Combat => "combat",
            Mood::Tension => "tension",
            Mood::Sad => "sad",
            Mood::Victory => "victory",
        }
    }

    fn from_name(s: &str) -> Option<Self> {
        Self::RENDER_ORDER.into_iter().find(|m| m.name() == s)
    }

    /// what plays while this mood is not rendered yet
    fn fallback(self) -> Option<Self> {
        match self {
            Mood::Menu => None,
            Mood::Combat | Mood::Tension | Mood::Sad => Some(Mood::Briefing),
            Mood::Briefing | Mood::Travel | Mood::Victory => Some(Mood::Menu),
        }
    }

    fn score(self) -> Score {
        match self {
            Mood::Menu => Score::theme(),
            Mood::Combat => Score::battle(),
            Mood::Briefing => Score::briefing(),
            Mood::Travel => Score::travel(),
            Mood::Tension => Score::tension(),
            Mood::Sad => Score::sad(),
            Mood::Victory => Score::victory(),
        }
    }
}

/// Melody instrument of a mood (the tutti passes always take trumpets with the horns below).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Lead {
    Horns,
    Horn,
    Trumpets,
    Flute,
}

/// Mood recipe (web MOODS): volumes per orchestra layer, 0 = off.
struct Score {
    bpm: f32,
    bars: usize,
    chords: &'static [[i32; 4]],
    melody: &'static [Bar],
    lead: Lead,
    lead_vol: f32,
    /// the tune plays every n-th pass of the phrase (and in every tutti pass)
    melody_every: u32,
    tutti_every: u32,
    /// tremolo string chords (tension)
    tremolo: f32,
    /// low brass and choir swell every bar, bass drum on the phrase marks (tension)
    brass_swell: bool,
    /// timpani rumble every second bar instead of phrase marks (tension)
    timp_rumble: bool,
    /// loudness relative to the combat cue (the web moods differ in level; all loops are normalised)
    level: f32,
    strings: f32,
    basses: f32,
    harp: f32,
    celesta: f32,
    ostinato: f32,
    brass: f32,
    low_brass: f32,
    riff: bool,
    stabs: f32,
    choir: f32,
    drum: f32,
    timp: f32,
    snare: f32,
    swell: f32,
    crash: f32,
    seed: u32,
}

impl Score {
    /// every layer off: the recipes below switch on what they use
    const SILENT: Score = Score {
        bpm: 70.0,
        bars: 8,
        chords: &HERO_CHORDS,
        melody: &[],
        lead: Lead::Horns,
        lead_vol: 0.0,
        melody_every: 1,
        tutti_every: 0,
        tremolo: 0.0,
        brass_swell: false,
        timp_rumble: false,
        level: 1.0,
        strings: 0.0,
        basses: 0.0,
        harp: 0.0,
        celesta: 0.0,
        ostinato: 0.0,
        brass: 0.0,
        low_brass: 0.0,
        riff: false,
        stabs: 0.0,
        choir: 0.0,
        drum: 0.0,
        timp: 0.0,
        snare: 0.0,
        swell: 0.0,
        crash: 0.0,
        seed: 1,
    };

    /// briefings (and a failed mission's debrief): the theme's opening on the flute over a soft pulse (~46 s)
    fn briefing() -> Self {
        Self {
            bpm: 84.0,
            bars: 16,
            chords: &BRIEF_CHORDS,
            melody: &BRIEF,
            lead: Lead::Flute,
            lead_vol: 0.06,
            melody_every: 2,
            strings: 0.035,
            basses: 0.04,
            ostinato: 0.03,
            celesta: 0.02,
            brass: 0.02,
            timp: 0.15,
            level: 0.75,
            seed: 0xb41e,
            ..Self::SILENT
        }
    }
    /// quiet flight between the fights: the theme, lighter and faster, tutti every fourth pass (~83 s)
    fn travel() -> Self {
        Self {
            bpm: 92.0,
            bars: 32,
            chords: &HERO_CHORDS,
            melody: &HERO,
            lead: Lead::Horns,
            lead_vol: 0.085,
            melody_every: 2,
            tutti_every: 4,
            strings: 0.04,
            basses: 0.045,
            harp: 0.032,
            celesta: 0.01,
            brass: 0.03,
            low_brass: 0.04,
            choir: 0.02,
            drum: 0.35,
            timp: 0.25,
            swell: 0.04,
            crash: 0.06,
            level: 0.85,
            seed: 0x7a1e,
            ..Self::SILENT
        }
    }
    /// dark suspense, no tune (~27 s)
    fn tension() -> Self {
        Self {
            bpm: 70.0,
            bars: 8,
            chords: &TENSION_CHORDS,
            tremolo: 0.045,
            basses: 0.06,
            low_brass: 0.05,
            brass_swell: true,
            choir: 0.018,
            timp: 0.4,
            timp_rumble: true,
            drum: 0.3,
            swell: 0.03,
            level: 0.8,
            seed: 0x7e45,
            ..Self::SILENT
        }
    }
    /// lament for the fallen: solo horn over strings (~33 s)
    fn sad() -> Self {
        Self {
            bpm: 58.0,
            bars: 8,
            chords: &LAMENT_CHORDS,
            melody: &LAMENT,
            lead: Lead::Horn,
            lead_vol: 0.1,
            strings: 0.05,
            basses: 0.04,
            harp: 0.012,
            brass: 0.018,
            choir: 0.015,
            level: 0.75,
            seed: 0x5ad0,
            ..Self::SILENT
        }
    }
    /// victory fanfare, every pass tutti (~19 s)
    fn victory() -> Self {
        Self {
            bpm: 100.0,
            bars: 8,
            chords: &FANFARE_CHORDS,
            melody: &FANFARE,
            lead: Lead::Trumpets,
            lead_vol: 0.1,
            tutti_every: 1,
            strings: 0.05,
            basses: 0.05,
            harp: 0.03,
            brass: 0.045,
            low_brass: 0.06,
            choir: 0.03,
            drum: 0.5,
            timp: 0.5,
            swell: 0.05,
            crash: 0.09,
            seed: 0xf4f4,
            ..Self::SILENT
        }
    }
    /// menus: the heroic theme, every second pass tutti (~55 s)
    fn theme() -> Self {
        Self {
            bpm: 70.0,
            bars: 16,
            chords: &HERO_CHORDS,
            melody: &HERO,
            lead: Lead::Horns,
            melody_every: 1,
            tremolo: 0.0,
            brass_swell: false,
            timp_rumble: false,
            level: 1.0,
            lead_vol: 0.1,
            tutti_every: 2,
            strings: 0.045,
            basses: 0.05,
            harp: 0.026,
            celesta: 0.014,
            ostinato: 0.0,
            brass: 0.04,
            low_brass: 0.055,
            riff: false,
            stabs: 0.0,
            choir: 0.03,
            drum: 0.5,
            timp: 0.4,
            snare: 0.0,
            swell: 0.055,
            crash: 0.08,
            seed: 0x51f1,
        }
    }
    /// combat: the squadron's motif over a driving ostinato (~58 s)
    fn battle() -> Self {
        Self {
            bpm: 132.0,
            bars: 32,
            chords: &BATTLE_CHORDS,
            melody: &BATTLE,
            lead: Lead::Horns,
            melody_every: 1,
            tremolo: 0.0,
            brass_swell: false,
            timp_rumble: false,
            level: 1.0,
            lead_vol: 0.085,
            tutti_every: 2,
            strings: 0.03,
            basses: 0.0,
            harp: 0.0,
            celesta: 0.0,
            ostinato: 0.055,
            brass: 0.03,
            low_brass: 0.045,
            riff: true,
            stabs: 0.045,
            choir: 0.022,
            drum: 0.38,
            timp: 0.45,
            snare: 0.14,
            swell: 0.045,
            crash: 0.07,
            seed: 0xba77,
        }
    }
}

/// Stereo render target with a dry bus and a hall send.
struct Band {
    dry: [Vec<f32>; 2],
    wet: [Vec<f32>; 2],
    noise: Noise,
}

/// vibrato in cents: rate (Hz), depth, fade-in time
#[derive(Clone, Copy)]
struct Vib(f32, f32, f32);

impl Band {
    fn new(seconds: f32, seed: u32) -> Self {
        let n = (seconds * SRF) as usize;
        Self { dry: [vec![0.0; n], vec![0.0; n]], wet: [vec![0.0; n], vec![0.0; n]], noise: Noise(seed | 1) }
    }

    fn len(&self) -> usize {
        self.dry[0].len()
    }

    /// mix a mono signal (generated per sample by `f(sample index from start, seconds)`) at `pan` (-1..1)
    fn put(&mut self, at: f32, dur: f32, pan: f32, wet: f32, mut f: impl FnMut(&mut Noise, f32) -> f32) {
        let a = (at.max(0.0) * SRF) as usize;
        let n = (dur * SRF) as usize;
        let (gl, gr) = (((1.0 - pan) * 0.25 * PI).cos(), ((1.0 + pan) * 0.25 * PI).cos());
        let len = self.len();
        for i in 0..n {
            let t = i as f32 / SRF;
            let s = f(&mut self.noise, t);
            // past the end: wrap around (the loop is seamless)
            let j = (a + i) % len;
            self.dry[0][j] += s * gl;
            self.dry[1][j] += s * gr;
            self.wet[0][j] += s * gl * wet;
            self.wet[1][j] += s * gr * wet;
        }
    }

    /// oscillators (wave, frequency ratio, cents detune, level) through a filter with a cutoff curve,
    /// under a gain curve; frequencies glide with an optional vibrato
    #[allow(clippy::too_many_arguments)]
    fn voice(
        &mut self,
        at: f32,
        len: f32,
        f0: f32,
        oscs: &[(Wave, f32, f32, f32)],
        vib: Option<Vib>,
        filter: Option<(Filter, f32)>,
        cutoff: impl Fn(f32) -> f32,
        gain: impl Fn(f32) -> f32,
        pan: f32,
        wet: f32,
    ) {
        let mut ph = [0.0f32; 6];
        let n = oscs.len().min(6);
        let mut svf = Svf::default();
        let mut j = 0u32;
        let jit: [f32; 6] = core::array::from_fn(|i| ((i as f32 * 12.9898 + f0).sin() * 43758.547).fract());
        self.put(at, len, pan, wet, |_, t| {
            if let Some((_, q)) = filter {
                if j % 32 == 0 {
                    svf.set(cutoff(t), q);
                }
            }
            j += 1;
            let cents = vib.map_or(0.0, |Vib(rate, depth, fade)| (t * rate * TAU).sin() * depth * (t / fade).min(1.0));
            let mut s = 0.0;
            for k in 0..n {
                let (w, ratio, det, lvl) = oscs[k];
                let f = f0 * ratio * 2f32.powf((det + cents + jit[k] * 2.0) / 1200.0);
                let dt = f / SRF;
                s += wave(w, ph[k], dt) * lvl;
                ph[k] = (ph[k] + dt).fract();
            }
            let y = match filter {
                Some((Filter::Low, _)) => svf.lp(s),
                Some((Filter::High, _)) => svf.hp(s),
                Some((Filter::Band, _)) => svf.bp(s),
                None => s,
            };
            y * gain(t)
        });
    }

    /// string ensemble: detuned saws per note, soft attack, warm filter, section vibrato
    fn strings(&mut self, notes: &[i32], at: f32, dur: f32, vol: f32, attack: f32, tremolo: bool) {
        let low = notes[0] < 45;
        let cut = if low { 900.0 } else { 2600.0 };
        for (i, &n) in notes.iter().enumerate() {
            let pan = if notes.len() > 1 { -0.5 + i as f32 / (notes.len() - 1) as f32 } else { -0.2 };
            let release = dur.max(attack + 0.2);
            let gain = move |t: f32| {
                let env = if t < attack {
                    t / attack
                } else if t < release - 0.2 {
                    1.0
                } else {
                    (1.0 - (t - (release - 0.2)) / 1.2).max(0.0)
                };
                let trem = if tremolo { 0.6 + 0.4 * (t * 11.0 * TAU).sin() } else { 1.0 };
                env * vol * trem
            };
            self.voice(at, dur + 1.2, midi(n), &[(Wave::Saw, 1.0, -10.0, 0.5), (Wave::Saw, 1.0, 11.0, 0.5)], Some(Vib(5.4, 7.0, 0.6)), Some((Filter::Low, 0.5)), |_| cut, gain, pan, 1.0);
        }
    }

    /// short, accented low strings (spiccato)
    fn staccato(&mut self, f0: f32, at: f32, dur: f32, vol: f32) {
        let gain = move |t: f32| {
            let a = (t / 0.012).min(1.0);
            let rel = if t > dur * 0.5 { (-(t - dur * 0.5) / (dur * 0.3)).exp() } else { 1.0 };
            a * rel * vol
        };
        self.voice(at, dur + 0.4, f0, &[(Wave::Saw, 1.0, -9.0, 0.5), (Wave::Saw, 1.0, 9.0, 0.5)], None, Some((Filter::Low, 1.0)), move |t| 1600.0 * (500.0f32 / 1600.0).powf((t / dur).min(1.0)), gain, -0.35, 1.0);
    }

    /// French horn: round, darker brass that blooms after the attack
    fn horn(&mut self, f0: f32, at: f32, dur: f32, vol: f32, swell: bool, pan: f32) {
        let a = if swell { dur * 0.6 } else { 0.09 };
        let tail = if swell { 2.6 } else { 1.0 };
        let rel_tau = if swell { 0.5 } else { 0.18 };
        let peak = if swell { 1300.0 } else { 1500.0 };
        let cutoff = move |t: f32| {
            if t < a + 0.08 {
                380.0 + (peak - 380.0) * (t / (a + 0.08))
            } else {
                1050.0 + (peak - 1050.0) * (-(t - a - 0.1).max(0.0) / 0.4).exp()
            }
        };
        let gain = move |t: f32| {
            let hold = dur.max(a);
            if t < a {
                vol * t / a
            } else if t < hold {
                vol * (1.0 - 0.1 * ((t - a) / (hold - a).max(1e-3)))
            } else {
                vol * 0.9 * (-(t - hold) / rel_tau).exp()
            }
        };
        self.voice(at, dur + tail, f0, &[(Wave::Saw, 1.0, -4.0, 0.4), (Wave::Saw, 1.0, 5.0, 0.4), (Wave::Tri, 1.0, 0.0, 0.5)], Some(Vib(4.8, 6.0, 0.45)), Some((Filter::Low, 0.8)), cutoff, gain, pan, 1.0);
    }

    /// trumpet: bright, fast-speaking brass
    fn trumpet(&mut self, f0: f32, at: f32, dur: f32, vol: f32, pan: f32) {
        let cutoff = |t: f32| if t < 0.05 { 700.0 + 2700.0 * t / 0.05 } else { 2300.0 + 1100.0 * (-(t - 0.08).max(0.0) / 0.2).exp() };
        let gain = move |t: f32| {
            let off = (dur - 0.02).max(0.08);
            if t < 0.03 {
                vol * t / 0.03
            } else if t < off {
                vol * (0.8 + 0.2 * (-(t - 0.06).max(0.0) / 0.1).exp())
            } else {
                vol * 0.8 * (-(t - off) / 0.09).exp()
            }
        };
        self.voice(at, dur + 0.6, f0, &[(Wave::Saw, 1.0, -6.0, 0.5), (Wave::Saw, 1.0, 6.0, 0.5)], Some(Vib(5.5, 8.0, 0.35)), Some((Filter::Low, 1.1)), cutoff, gain, pan, 1.0);
    }

    /// trombones (root and fifth) over a tuba an octave down
    fn low_brass(&mut self, f0: f32, at: f32, dur: f32, vol: f32, swell: bool, short: bool) {
        let a = if swell {
            dur * 0.55
        } else if short {
            0.02
        } else {
            0.12
        };
        let tail = if swell { 3.2 } else { 1.3 };
        let peak = if short { 1700.0 } else { 1300.0 };
        let tau_f = if short { 0.08 } else { 0.5 };
        let cutoff = move |t: f32| if t < a + 0.05 { 220.0 + (peak - 220.0) * t / (a + 0.05) } else { 800.0 + (peak - 800.0) * (-(t - a - 0.1).max(0.0) / tau_f).exp() };
        let rel = if swell { 0.6 } else { 0.25 };
        let gain = move |t: f32| {
            if t < a {
                vol * t / a
            } else if short {
                if t < a + dur * 0.5 { vol } else { vol * (-(t - a - dur * 0.5) / (dur * 0.25)).exp() }
            } else {
                let hold = dur.max(a);
                if t < hold { vol * (1.0 - 0.1 * (t - a) / (hold - a).max(1e-3)) } else { vol * 0.9 * (-(t - hold) / rel).exp() }
            }
        };
        let oscs = [(Wave::Saw, 1.0, -6.0, 0.3), (Wave::Saw, 1.0, 6.0, 0.3), (Wave::Saw, 1.5, 0.0, 0.3), (Wave::Saw, 0.5, 0.0, 0.3)];
        self.voice(at, dur + tail, f0, &oscs, None, Some((Filter::Low, 0.9)), cutoff, gain, 0.25, 1.0);
    }

    /// wordless choir: detuned saws through an "ah" vowel formant
    fn choir(&mut self, freqs: &[f32], at: f32, dur: f32, vol: f32) {
        for (i, &f) in freqs.iter().enumerate() {
            let pan = -0.3 + 0.6 * i as f32 / freqs.len().max(2) as f32;
            let gain = move |t: f32| {
                let env = if t < 0.9 {
                    t / 0.9
                } else if t < (dur - 0.3).max(0.9) {
                    1.0
                } else {
                    (1.0 - (t - (dur - 0.3).max(0.9)) / 1.5).max(0.0)
                };
                env * vol * 1.6
            };
            // two formants: the band-pass sweeps a little with the vibrato
            self.voice(at, dur + 1.4, f, &[(Wave::Saw, 1.0, -14.0, 0.33), (Wave::Saw, 1.0, 0.0, 0.33), (Wave::Saw, 1.0, 13.0, 0.33)], Some(Vib(5.0, 12.0, 0.8)), Some((Filter::Band, 3.0)), |_| 900.0, gain, pan, 1.0);
        }
    }

    /// concert harp: plucked, ringing
    fn harp(&mut self, f0: f32, at: f32, vol: f32) {
        let gain = move |t: f32| (t / 0.004).min(1.0) * vol * (-(t - 0.01).max(0.0) / 0.45).exp();
        self.voice(at, 2.2, f0, &[(Wave::Tri, 1.0, 0.0, 1.0), (Wave::Sine, 2.0, 0.0, 0.35)], None, Some((Filter::Low, 0.7)), |t| 4200.0 * (900.0f32 / 4200.0).powf((t / 0.6).min(1.0)), gain, 0.45, 1.0);
    }

    /// celesta: bell-like sparkle
    fn celesta(&mut self, f0: f32, at: f32, vol: f32) {
        let gain = move |t: f32| (t / 0.003).min(1.0) * vol * (-(t - 0.01).max(0.0) / 0.32).exp();
        self.voice(at, 1.8, f0, &[(Wave::Sine, 1.0, 0.0, 1.0), (Wave::Sine, 4.01, 0.0, 0.22)], None, None, |_| 0.0, gain, -0.45, 1.3);
    }

    /// timpani: tuned membrane (pitch settles after the stroke) with a short skin noise
    fn timpani(&mut self, f0: f32, at: f32, vol: f32, quiet: bool) {
        let mut ph = [0.0f32; 2];
        self.put(at, 2.2, 0.0, 0.8, |_, t| {
            let f = f0 * (1.02f32).powf(1.0 - (t / 0.25).min(1.0));
            ph[0] = (ph[0] + f / SRF).fract();
            ph[1] = (ph[1] + f * 1.51 / SRF).fract();
            let env = (t / 0.004).min(1.0) * (-(t - 0.02).max(0.0) / 0.38).exp();
            ((ph[0] * TAU).sin() + 0.3 * (ph[1] * TAU).sin()) * env * vol
        });
        if !quiet {
            self.noise_hit(at, 0.12, vol * 0.35, Filter::Low, 700.0, 200.0, 0.7, 0.0, 0.0);
        }
    }

    fn roll(&mut self, f0: f32, at: f32, dur: f32, vol: f32) {
        let n = ((dur / 0.07) as usize).clamp(4, 12);
        for i in 0..n {
            self.timpani(f0, at + i as f32 * (dur / n as f32), vol * (0.35 + 0.65 * (i as f32 / n as f32)) * 0.6, i > 0);
        }
    }

    /// filtered noise burst with an exponential fade (cymbals, snare, skins)
    #[allow(clippy::too_many_arguments)]
    fn noise_hit(&mut self, at: f32, dur: f32, vol: f32, kind: Filter, f0: f32, f1: f32, q: f32, wet: f32, pan: f32) {
        let mut svf = Svf::default();
        let mut j = 0u32;
        let ratio = f1.max(30.0) / f0;
        let fall = 0.0005f32 / vol.max(1e-4);
        self.put(at, dur, pan, wet, |nz, t| {
            let x = (t / dur).min(1.0);
            if j % 16 == 0 {
                svf.set(f0 * ratio.powf(x), q);
            }
            j += 1;
            let w = nz.next();
            let y = match kind {
                Filter::Low => svf.lp(w),
                Filter::High => svf.hp(w),
                Filter::Band => svf.bp(w),
            };
            y * vol * fall.powf(x)
        });
    }

    /// suspended cymbal swelling into the downbeat
    fn swell(&mut self, at: f32, dur: f32, vol: f32) {
        let mut svf = Svf::default();
        svf.set(4200.0, 0.7);
        self.put(at, dur + 1.6, 0.1, 1.0, |nz, t| {
            let g = if t < dur { 0.0001 * (vol / 0.0001f32).powf(t / dur) } else { vol * (-(t - dur) / 0.35).exp() };
            svf.hp(nz.next()) * g
        });
    }

    fn crash(&mut self, at: f32, vol: f32) {
        self.noise_hit(at, 2.4, vol, Filter::High, 5200.0, 3000.0, 0.7, 1.0, 0.15);
    }

    fn snare(&mut self, at: f32, vol: f32) {
        self.noise_hit(at, 0.16, vol, Filter::Band, 2400.0, 1700.0, 1.2, 1.0, -0.1);
        let mut ph = 0.0f32;
        self.put(at, 0.2, -0.1, 0.0, |_, t| {
            ph = (ph + 200.0 / SRF).fract();
            wave(Wave::Tri, ph, 0.0) * vol * 0.5 * (t / 0.002).min(1.0) * (-(t - 0.01).max(0.0) / 0.035).exp()
        });
    }

    /// concert bass drum: a deep, booming hit
    fn bass_drum(&mut self, at: f32, vol: f32) {
        let mut ph = 0.0f32;
        self.put(at, 2.5, 0.0, 0.7, |_, t| {
            let f = 68.0 * (38.0f32 / 68.0).powf((t / 0.5).min(1.0));
            ph = (ph + f / SRF).fract();
            (ph * TAU).sin() * vol * (t / 0.008).min(1.0) * (-(t - 0.05).max(0.0) / 0.45).exp()
        });
        self.noise_hit(at, 0.3, vol * 0.25, Filter::Low, 300.0, 80.0, 0.7, 0.0, 0.0);
    }

    /// flute: breathy sine with a soft second partial and a chiff of breath noise
    fn flute(&mut self, f0: f32, at: f32, dur: f32, vol: f32) {
        let hold = dur.max(0.09);
        let gain = move |t: f32| {
            if t < 0.09 {
                vol * t / 0.09
            } else if t < hold {
                vol
            } else {
                vol * (-(t - hold) / 0.15).exp()
            }
        };
        self.voice(at, dur + 0.6, f0, &[(Wave::Sine, 1.0, 0.0, 1.0), (Wave::Tri, 2.0, 0.0, 0.18)], Some(Vib(5.6, 11.0, 0.4)), None, |_| 0.0, gain, -0.15, 1.2);
        self.noise_hit(at, dur.min(0.25), vol * 0.25, Filter::Band, f0 * 2.0, f0 * 2.0, 1.0, 1.0, -0.15);
    }

    fn horns(&mut self, f0: f32, at: f32, dur: f32, vol: f32) {
        for (d, dt) in [(-7.0f32, 0.0f32), (8.0, 0.015)] {
            self.horn(f0 * 2f32.powf(d / 1200.0), at + dt, dur, vol * 0.62, false, -0.25);
        }
    }

    fn trumpets(&mut self, f0: f32, at: f32, dur: f32, vol: f32) {
        for (d, dt) in [(-5.0f32, 0.0f32), (6.0, 0.01)] {
            self.trumpet(f0 * 2f32.powf(d / 1200.0), at + dt, dur, vol * 0.62, 0.2);
        }
    }
}

/// The web scheduler (Music.schedule), run offline over the whole loop.
fn render_score(m: &Score) -> SynthClip {
    let sd = 60.0 / m.bpm / 4.0;
    let steps = m.bars * 16;
    let seconds = steps as f32 * sd;
    let mut b = Band::new(seconds, m.seed);
    let mut rng = Noise(m.seed.wrapping_mul(2_654_435_761) | 1);
    let phrase = m.chords.len();
    for step in 0..steps {
        let t = step as f32 * sd;
        let s = (step % 16) as u32;
        let bar = step / 16;
        let ch = m.chords[bar % phrase];
        let in_phrase = bar % phrase;
        let pass = (bar / phrase) as u32;
        let tutti = m.tutti_every > 0 && pass % m.tutti_every == m.tutti_every - 1;
        let big = if tutti { 1.0 } else { 0.55 };
        let fast = m.bpm > 120.0;
        if s == 0 {
            if m.strings > 0.0 {
                b.strings(&ch, t, sd * 16.0, m.strings * if tutti { 1.15 } else { 1.0 }, if fast { 0.25 } else { 0.7 }, false);
            }
            if m.tremolo > 0.0 {
                b.strings(&ch, t, sd * 16.0, m.tremolo, 1.2, true);
            }
            if m.basses > 0.0 {
                b.strings(&[ch[0] - 12], t, sd * 16.0, m.basses, 0.4, false);
            }
            // horn section holding the harmony; in quiet passes only on the phrase's main bars
            if m.brass > 0.0 && (tutti || in_phrase % 4 == 0 || fast) {
                let n = 3.0f32.sqrt();
                for &k in &ch[1..] {
                    b.horn(midi(k), t, sd * if fast { 8.0 } else { 15.0 }, m.brass * big / n, true, 0.3);
                }
            }
            if m.low_brass > 0.0 && !m.riff && (tutti || m.brass_swell || in_phrase % 2 == 0) {
                b.low_brass(midi(ch[0]), t, sd * 14.0, m.low_brass * big, m.brass_swell, false);
            }
            if m.choir > 0.0 && (tutti || m.brass_swell || m.tutti_every == 0) {
                let f: [f32; 3] = [midi(ch[1] + 12), midi(ch[2] + 12), midi(ch[3] + 12)];
                b.choir(&f, t, sd * 16.0, m.choir);
            }
            if m.crash > 0.0 && tutti && in_phrase == 0 {
                b.crash(t, m.crash);
            }
            if m.drum > 0.0 && !m.riff && (tutti || m.brass_swell) && in_phrase % 4 == 0 {
                b.bass_drum(t, m.drum);
            }
        }
        // battle: low brass riff driving with the ostinato, bass drum on the downbeats
        if m.riff {
            let hit = match s {
                0 | 8 => 1.0,
                3 | 11 => 0.7,
                6 | 14 => 0.85,
                _ => 0.0,
            };
            if hit > 0.0 {
                b.low_brass(midi(ch[0]), t, sd * if s == 0 || s == 8 { 2.2 } else { 1.4 }, m.low_brass * hit * if tutti { 1.0 } else { 0.8 }, false, true);
            }
            if m.drum > 0.0 && (s == 0 || (s == 8 && tutti)) {
                b.bass_drum(t, m.drum * if s == 0 { 1.0 } else { 0.7 });
            }
        }
        // cymbal swell rising into the next phrase
        if m.swell > 0.0 && in_phrase == phrase - 1 && s == 8 {
            b.swell(t, sd * 8.0, m.swell);
        }
        // harp: rolling eighth-note arpeggios over two octaves
        if m.harp > 0.0 && s % 2 == 0 {
            let k = (s / 2) as usize % 8;
            let n = ch[k % 4] + 12 * (1 + (k / 4) as i32);
            b.harp(midi(n), t, m.harp * if s == 0 { 1.2 } else { 1.0 });
        }
        // celesta sparkle (only in the quiet passes, where it can be heard)
        if m.celesta > 0.0 && !tutti && (s == 0 || s == 6 || s == 10) && rng.f() < 0.8 {
            b.celesta(midi(ch[(bar + s as usize) % 4] + 24), t, m.celesta);
        }
        // low-string ostinato: urgent sixteenths in battle, a soft pulse in briefings
        if m.ostinato > 0.0 {
            let root = ch[0] - 12;
            if fast {
                const PAT: [i32; 16] = [0, 0, 12, 0, 0, 0, 7, 0, 0, 0, 12, 0, 10, 0, 7, 0];
                b.staccato(midi(root + PAT[s as usize]), t, sd * 0.9, m.ostinato * if s % 4 == 0 { 1.25 } else { 0.85 });
            } else if s % 2 == 0 {
                b.staccato(midi(root), t, sd * 1.6, m.ostinato * if s % 8 == 0 { 1.2 } else { 0.8 });
            }
        }
        // melody: the mood's lead in the quiet passes, trumpets with the horns an octave below in the tutti
        if !m.melody.is_empty() && (pass % m.melody_every.max(1) == 0 || tutti) {
            for &(st, n, len) in m.melody[bar % m.melody.len()] {
                if st != s {
                    continue;
                }
                let (f, d) = (midi(n), sd * len as f32);
                if tutti {
                    b.trumpets(f, t, d, m.lead_vol);
                    b.horns(f / 2.0, t, d, m.lead_vol * 0.95);
                } else {
                    match m.lead {
                        Lead::Horns => b.horns(f, t, d, m.lead_vol),
                        Lead::Horn => b.horn(f, t, d, m.lead_vol, false, -0.2),
                        Lead::Trumpets => b.trumpets(f, t, d, m.lead_vol),
                        Lead::Flute => b.flute(f, t, d, m.lead_vol),
                    }
                }
            }
        }
        // brass hits answer the ostinato between the phrases of the tune
        if m.stabs > 0.0 && !tutti && (s == 6 || (s == 12 && bar % 2 == 1)) {
            let n = 3.0f32.sqrt();
            for &k in &ch[1..] {
                b.trumpet(midi(k + 12), t, sd * 1.5, m.stabs / n, 0.1);
            }
        }
        // timpani: phrase marks, battle hits and rolls into the climaxes
        if m.timp > 0.0 {
            let tp = midi(if ch[0] >= 48 { ch[0] - 12 } else { ch[0] });
            if m.timp_rumble {
                if s == 0 && bar % 2 == 0 {
                    b.roll(tp, t, sd * 12.0, m.timp * 0.5);
                }
            } else if fast {
                if s == 0 || s == 8 || (tutti && (s == 6 || s == 14)) {
                    b.timpani(tp, t, m.timp * if s == 0 { 1.0 } else { 0.7 }, false);
                }
                if bar % 4 == 3 && s == 12 {
                    b.roll(tp, t, sd * 4.0, m.timp * 0.7);
                }
            } else if s == 0 && (in_phrase == 0 || in_phrase == 4 || (tutti && in_phrase % 2 == 0)) {
                b.timpani(tp, t, m.timp * big * 1.4, false);
            } else if (in_phrase == phrase - 1 || (tutti && in_phrase == 3)) && s == 8 {
                b.roll(tp, t, sd * 8.0, m.timp * 0.55);
            }
        }
        if m.snare > 0.0 {
            if s == 4 || s == 12 {
                b.snare(t, m.snare);
            } else if s == 14 || s == 15 || (s == 10 && bar % 2 == 1) {
                b.snare(t, m.snare * 0.35);
            }
            if bar % 8 == 7 && s >= 8 {
                b.snare(t + sd * 0.5, m.snare * (0.25 + (s - 8) as f32 * 0.05));
            }
        }
    }
    // concert hall: run the reverb twice around the loop so its tail wraps seamlessly
    let n = b.len();
    let mut halls = [Reverb::new(0.86, 0.35, 0), Reverb::new(0.86, 0.35, 23)];
    let mut out = vec![0.0f32; n * 2];
    for pass in 0..2 {
        for i in 0..n {
            for c in 0..2 {
                let w = halls[c].tick(b.wet[c][i]) * 0.55;
                if pass == 1 {
                    out[i * 2 + c] = b.dry[c][i] + w;
                }
            }
        }
    }
    // gentle bus compression (the web version runs through a compressor), then the same loudness for both cues
    for v in &mut out {
        let x = *v * 2.0;
        *v = x / (1.0 + x.abs() * 0.3);
    }
    let peak = out.iter().fold(0.0f32, |m, v| m.max(v.abs())).max(1e-6);
    let rms = (out.iter().map(|v| v * v).sum::<f32>() / out.len().max(1) as f32).sqrt().max(1e-6);
    let gain = (0.9 / peak).min(0.17 * m.level / rms);
    for v in &mut out {
        *v *= gain;
    }
    SynthClip { samples: out.into(), channels: 2, looping: true }
}

// ---------- test hook ----------

fn write_wav(path: &std::path::Path, clip: &SynthClip) -> std::io::Result<()> {
    let data: Vec<u8> = clip.samples.iter().flat_map(|v| ((v.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes()).collect();
    let ch = clip.channels as u32;
    let mut out = Vec::with_capacity(44 + data.len());
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&(ch as u16).to_le_bytes());
    out.extend_from_slice(&SR.to_le_bytes());
    out.extend_from_slice(&(SR * ch * 2).to_le_bytes());
    out.extend_from_slice(&((ch * 2) as u16).to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(data.len() as u32).to_le_bytes());
    out.extend_from_slice(&data);
    std::fs::write(path, out)
}

fn levels(clip: &SynthClip) -> (f32, f32) {
    let peak = clip.samples.iter().fold(0.0f32, |m, v| m.max(v.abs()));
    let rms = (clip.samples.iter().map(|v| v * v).sum::<f32>() / clip.samples.len().max(1) as f32).sqrt();
    (peak, rms)
}

/// SF_AUDIO_DUMP: write all clips and the music loops as WAV files.
fn dump(dir: &str, clips: &Assets<SynthClip>, handles: &[Handle<SynthClip>]) {
    let dir = std::path::PathBuf::from(dir);
    let _ = std::fs::create_dir_all(&dir);
    for (s, h) in SFX_ALL.iter().zip(handles) {
        if let Some(c) = clips.get(h) {
            let (peak, rms) = levels(c);
            info!("audio dump: {} {:.2} s peak {peak:.3} rms {rms:.4}", s.name(), c.seconds());
            let _ = write_wav(&dir.join(format!("{}.wav", s.name())), c);
        }
    }
    let t0 = std::time::Instant::now();
    for mood in Mood::RENDER_ORDER {
        let name = format!("music_{}", mood.name());
        let c = render_score(&mood.score());
        let (peak, rms) = levels(&c);
        info!("audio dump: {name} {:.1} s peak {peak:.3} rms {rms:.4} (rendered in {:.1} s)", c.seconds(), t0.elapsed().as_secs_f32());
        let _ = write_wav(&dir.join(format!("{name}.wav")), &c);
    }
}
