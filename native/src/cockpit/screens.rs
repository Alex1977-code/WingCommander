//! The cockpit's instrument screens, drawn on the CPU and uploaded as textures at 10-20 Hz:
//! own-ship schematic (left MFD), 3D radar scope (centre), target scan (right), annunciator panel,
//! seven-segment readouts, LED bars and the two scrolling log screens. Ported from src/cockpit.js.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::sync::Arc;

use bevy::mesh::Mesh;
use bevy::prelude::*;

use super::canvas::{hex, mix, with_a, Align, Canvas, Rgba, Rng};
use super::{tex, CockpitState, Fail, LampCol, LAMP_LABELS};
use crate::common::*;
use crate::ships::ShipLibrary;
use crate::weapons::PlayerAim;

const G: Rgba = hex(0x6dffb0, 1.0);
const A: Rgba = hex(0xffc857, 1.0);
const R: Rgba = hex(0xff4d6d, 1.0);
const CYAN: Rgba = hex(0x7fd6ff, 1.0);
const NEUTRAL: Rgba = hex(0x9fe8ff, 1.0);
const BG: Rgba = hex(0x04110b, 1.0);
/// screens are unlit: brightness so phosphor green blooms a little
const SCREEN_GAIN: f32 = 1.35;

/// Everything on the console that can fail (displays and push-button banks).
#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash)]
pub enum Elem {
    Mfd0,
    Mfd1,
    Mfd2,
    Log0,
    Log1,
    Annun,
    Seg,
    Bar,
    Bank0,
    Bank1,
    Bank2,
    Bank3,
    Bank4,
}

impl Elem {
    pub const COUNT: usize = 13;
    pub const ALL: [Elem; Elem::COUNT] = [
        Elem::Mfd0,
        Elem::Mfd1,
        Elem::Mfd2,
        Elem::Log0,
        Elem::Log1,
        Elem::Annun,
        Elem::Seg,
        Elem::Bar,
        Elem::Bank0,
        Elem::Bank1,
        Elem::Bank2,
        Elem::Bank3,
        Elem::Bank4,
    ];
    /// screens with a canvas
    const SCREENS: [Elem; 8] = [Elem::Mfd0, Elem::Mfd1, Elem::Mfd2, Elem::Log0, Elem::Log1, Elem::Annun, Elem::Seg, Elem::Bar];
    pub fn label(self) -> &'static str {
        match self {
            Elem::Mfd0 => "SCHIFFSDISPLAY",
            Elem::Mfd1 => "RADAR",
            Elem::Mfd2 => "ZIELDISPLAY",
            Elem::Log0 => "LOG-SCHIRM",
            Elem::Log1 => "KOM-SCHIRM",
            Elem::Annun => "WARNTAFEL",
            Elem::Seg => "NAV-RECHNER",
            Elem::Bar => "ENERGIEANZEIGE",
            _ => "SCHALTKREIS",
        }
    }
    fn size(self) -> (usize, usize) {
        match self {
            Elem::Mfd0 | Elem::Mfd1 | Elem::Mfd2 => (400, 300),
            Elem::Log0 | Elem::Log1 => (256, 320),
            Elem::Annun => (640, 128),
            Elem::Seg => (512, 224),
            _ => (256, 224),
        }
    }
    /// redraw interval (s)
    fn period(self) -> f32 {
        match self {
            Elem::Log0 | Elem::Log1 | Elem::Annun => 0.05,
            _ => 0.1,
        }
    }
}

struct Screen {
    elem: Elem,
    canvas: Canvas,
    image: Handle<Image>,
    mat: Handle<StandardMaterial>,
    next: f32,
}

struct LogLine {
    text: String,
    chars: usize,
    color: Rgba,
    t: f32,
}

struct Log {
    lines: Vec<LogLine>,
    /// index of the oldest line in the ring
    head: usize,
    len: usize,
    next: f32,
}

impl Log {
    const CAP: usize = 14;
    fn new() -> Self {
        Self { lines: (0..Self::CAP).map(|_| LogLine { text: String::with_capacity(48), chars: 0, color: G, t: -100.0 }).collect(), head: 0, len: 0, next: 0.0 }
    }
    /// the slot for a new line (oldest one is recycled)
    fn push(&mut self, t: f32, color: Rgba) -> &mut LogLine {
        let i = if self.len < Self::CAP {
            self.len += 1;
            (self.head + self.len - 1) % Self::CAP
        } else {
            let i = self.head;
            self.head = (self.head + 1) % Self::CAP;
            i
        };
        let l = &mut self.lines[i];
        l.text.clear();
        l.color = color;
        l.t = t;
        l
    }
    fn get(&self, k: usize) -> &LogLine {
        &self.lines[(self.head + k) % Self::CAP]
    }
}

/// Top-down schematic traced from a ship model: alpha mask (fill 16 %, panel lines 45 %, outline 100 %).
struct Outline {
    n: usize,
    alpha: Vec<f32>,
    mid: Vec2,
    k: f32,
    half_w: f32,
    half_l: f32,
}

impl Outline {
    /// ship space (x, z) -> mask pixels: nose up, port (+x) on the left
    fn map(&self, x: f32, z: f32) -> Vec2 {
        Vec2::new(self.n as f32 / 2.0 - (x - self.mid.x) * self.k, self.n as f32 / 2.0 - (z - self.mid.y) * self.k)
    }
}

/// Radar contact (reused between redraws).
#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Foe,
    Friend,
    Neutral,
    Mine,
    Nav,
}

#[derive(Clone)]
struct Contact {
    kind: Kind,
    x: f32,
    y: f32,
    hgt: f32,
    edge: bool,
    d: f32,
    capital: bool,
    target: bool,
    label: String,
}

#[derive(Resource)]
pub struct Screens {
    screens: Vec<Screen>,
    logs: [Log; 2],
    pub crack_mat: Handle<StandardMaterial>,
    crack: Canvas,
    crack_img: Handle<Image>,
    prints: Vec<f32>,
    outlines: HashMap<String, Arc<Outline>>,
    wires: HashMap<String, Arc<Vec<[Vec3; 2]>>>,
    scan_for: Option<Entity>,
    scan_t0: f32,
    radar_ang: f32,
    contacts: Vec<Contact>,
    n_contacts: usize,
    order: Vec<usize>,
    txt: String,
    tmp: Vec<[f32; 3]>,
    rng: Rng,
}

impl Screens {
    pub fn new(images: &mut Assets<Image>, mats: &mut Assets<StandardMaterial>) -> Self {
        let screens = Elem::SCREENS
            .iter()
            .enumerate()
            .map(|(i, &elem)| {
                let (w, h) = elem.size();
                let canvas = Canvas::new(w, h, BG);
                let image = images.add(canvas.live_image());
                let mat = mats.add(StandardMaterial {
                    base_color: Color::linear_rgb(SCREEN_GAIN, SCREEN_GAIN, SCREEN_GAIN),
                    base_color_texture: Some(image.clone()),
                    unlit: true,
                    ..default()
                });
                Screen { elem, canvas, image, mat, next: i as f32 * 0.013 }
            })
            .collect();
        let crack = Canvas::new(1024, 640, [1.0, 1.0, 1.0, 0.0]);
        let crack_img = images.add(crack.live_image());
        let crack_mat = mats.add(StandardMaterial { base_color_texture: Some(crack_img.clone()), unlit: true, alpha_mode: AlphaMode::Blend, ..default() });
        Self {
            screens,
            logs: [Log::new(), Log::new()],
            crack_mat,
            crack,
            crack_img,
            prints: tex::fingerprints(400, 300, 77),
            outlines: HashMap::new(),
            wires: HashMap::new(),
            scan_for: None,
            scan_t0: 0.0,
            radar_ang: 0.0,
            contacts: Vec::with_capacity(64),
            n_contacts: 0,
            order: Vec::with_capacity(64),
            txt: String::with_capacity(64),
            tmp: Vec::new(),
            rng: Rng::new(0xc0c),
        }
    }

    pub fn mat(&self, elem: Elem) -> Handle<StandardMaterial> {
        self.screens.iter().find(|s| s.elem == elem).map(|s| s.mat.clone()).unwrap_or_default()
    }

    /// fresh ship: no cracks, empty logs
    pub fn repair(&mut self, images: &mut Assets<Image>) {
        self.crack.clear([1.0, 1.0, 1.0, 0.0]);
        upload(images, &self.crack_img, &self.crack);
        self.logs = [Log::new(), Log::new()];
        self.scan_for = None;
    }

    pub fn add_crack(&mut self, images: &mut Assets<Image>, rng: &mut Rng) {
        tex::add_crack(&mut self.crack, rng);
        upload(images, &self.crack_img, &self.crack);
    }

    /// a formatted line on log screen 0 (LOG) or 1 (KOM)
    pub fn log_fmt(&mut self, screen: usize, t: f32, color: u32, args: std::fmt::Arguments) {
        let l = self.logs[screen].push(t, hex(color, 1.0));
        let _ = l.text.write_fmt(args);
        upper_trim(&mut l.text, 34);
        l.chars = l.text.chars().count();
    }

    /// a radio call on the KOM screen, wrapped onto a few lines
    pub fn comm(&mut self, t: f32, who: &str, text: &str) {
        let mut line = std::mem::take(&mut self.txt);
        line.clear();
        let _ = write!(line, "{who}:");
        let mut lines = 0;
        for word in text.split_whitespace() {
            if line.chars().count() + word.chars().count() + 1 > 24 && !line.is_empty() {
                self.log_fmt(1, t + lines as f32 * 0.25, if lines == 0 { 0x9fe8ff } else { 0x6dc7e0 }, format_args!("{line}"));
                lines += 1;
                line.clear();
                if lines >= 4 {
                    break;
                }
            }
            if !line.is_empty() {
                line.push(' ');
            }
            line.push_str(word);
        }
        if !line.is_empty() && lines < 4 {
            self.log_fmt(1, t + lines as f32 * 0.25, if lines == 0 { 0x9fe8ff } else { 0x6dc7e0 }, format_args!("{line}"));
        }
        self.txt = line;
    }

    fn outline(&mut self, lib: &ShipLibrary, meshes: &Assets<Mesh>, kind: &str) -> Option<Arc<Outline>> {
        if let Some(o) = self.outlines.get(kind) {
            return Some(o.clone());
        }
        let o = Arc::new(build_outline(lib, meshes, kind, 224)?);
        self.outlines.insert(kind.to_string(), o.clone());
        Some(o)
    }

    fn wire(&mut self, lib: &ShipLibrary, meshes: &Assets<Mesh>, kind: &str) -> Option<Arc<Vec<[Vec3; 2]>>> {
        if let Some(w) = self.wires.get(kind) {
            return Some(w.clone());
        }
        let w = Arc::new(build_wire(lib, meshes, kind)?);
        self.wires.insert(kind.to_string(), w.clone());
        Some(w)
    }
}

/// upper case, cut to `max` characters
fn upper_trim(s: &mut String, max: usize) {
    if s.chars().any(|c| c.is_lowercase()) {
        let up: String = s.chars().flat_map(|c| if c == 'ß' { vec!['S', 'S'] } else { c.to_uppercase().collect() }).collect();
        *s = up;
    }
    if let Some((i, _)) = s.char_indices().nth(max) {
        s.truncate(i);
    }
}

fn upload(images: &mut Assets<Image>, h: &Handle<Image>, c: &Canvas) {
    if let Some(mut img) = images.get_mut(h)
        && let Some(data) = img.data.as_mut()
    {
        c.write_rgba8(data);
    }
}

// ---------- model tracing ----------

fn model_triangles(lib: &ShipLibrary, meshes: &Assets<Mesh>, kind: &str, mut f: impl FnMut(Vec3, Vec3, Vec3)) -> bool {
    let Some(model) = lib.model(kind) else { return false };
    let mut any = false;
    for part in &model.parts {
        let Some(mesh) = meshes.get(&part.mesh) else { continue };
        let (Ok(pos), Ok(idx)) = (mesh.try_attribute(Mesh::ATTRIBUTE_POSITION), mesh.try_indices()) else { continue };
        let Some(pos) = pos.as_float3() else { continue };
        let m = part.transform.to_matrix();
        let mut it = idx.iter();
        while let (Some(a), Some(b), Some(c)) = (it.next(), it.next(), it.next()) {
            let p = |i: usize| m.transform_point3(Vec3::from(pos[i]));
            f(p(a), p(b), p(c));
            any = true;
        }
    }
    any
}

/// sharp edges of a model (dihedral angle above `deg`, or open), as segments
fn sharp_edges(lib: &ShipLibrary, meshes: &Assets<Mesh>, kind: &str) -> Vec<([i32; 3], [i32; 3], Vec3, Vec3, f32)> {
    let q = |p: Vec3| [(p.x * 1000.0).round() as i32, (p.y * 1000.0).round() as i32, (p.z * 1000.0).round() as i32];
    let mut edges: HashMap<([i32; 3], [i32; 3]), (Vec3, Vec3, Vec3, f32, u32)> = HashMap::new();
    model_triangles(lib, meshes, kind, |a, b, c| {
        let n = (b - a).cross(c - a);
        if n.length_squared() < 1e-12 {
            return;
        }
        let n = n.normalize();
        for (p, r) in [(a, b), (b, c), (c, a)] {
            let (kp, kr) = (q(p), q(r));
            let key = if kp < kr { (kp, kr) } else { (kr, kp) };
            edges
                .entry(key)
                .and_modify(|e| {
                    e.3 = e.3.min(e.2.dot(n));
                    e.4 += 1;
                })
                .or_insert((p, r, n, 1.0, 1));
        }
    });
    edges.into_iter().map(|((ka, kb), (p, r, _, min_dot, count))| (ka, kb, p, r, if count == 1 { -1.0 } else { min_dot })).collect()
}

fn build_outline(lib: &ShipLibrary, meshes: &Assets<Mesh>, kind: &str, n: usize) -> Option<Outline> {
    let (mut lo, mut hi) = (Vec2::splat(f32::MAX), Vec2::splat(f32::MIN));
    let any = model_triangles(lib, meshes, kind, |a, b, c| {
        for p in [a, b, c] {
            lo = lo.min(Vec2::new(p.x, p.z));
            hi = hi.max(Vec2::new(p.x, p.z));
        }
    });
    if !any {
        return None;
    }
    let mid = (lo + hi) * 0.5;
    let k = n as f32 * 0.9 / (hi - lo).max_element().max(1e-3);
    let mut o = Outline { n, alpha: Vec::new(), mid, k, half_w: (hi.x - lo.x) * 0.5 * k, half_l: (hi.y - lo.y) * 0.5 * k };
    let mut mask = Canvas::new(n, n, [0.0; 4]);
    let white = [1.0, 1.0, 1.0, 1.0];
    model_triangles(lib, meshes, kind, |a, b, c| {
        let (pa, pb, pc) = (o.map(a.x, a.z), o.map(b.x, b.z), o.map(c.x, c.z));
        mask.tri((pa.x, pa.y), (pb.x, pb.y), (pc.x, pc.y), white);
    });
    let m: Vec<f32> = mask.px.iter().map(|p| p[3]).collect();
    // outline ring = mask dilated by 2 px minus the mask
    let mut ring = vec![0.0f32; n * n];
    for y in 0..n as i32 {
        for x in 0..n as i32 {
            let mut v = 0.0f32;
            for a in 0..8 {
                let ang = a as f32 * std::f32::consts::FRAC_PI_4;
                let (sx, sy) = (x - (ang.cos() * 2.0).round() as i32, y - (ang.sin() * 2.0).round() as i32);
                if sx >= 0 && sy >= 0 && sx < n as i32 && sy < n as i32 {
                    v = v.max(m[(sy * n as i32 + sx) as usize]);
                }
            }
            ring[(y * n as i32 + x) as usize] = (v - m[(y * n as i32 + x) as usize]).max(0.0);
        }
    }
    // panel lines from the model's sharp edges, clipped to the silhouette
    let mut det = Canvas::new(n, n, [0.0; 4]);
    for (_, _, p, r, dot) in sharp_edges(lib, meshes, kind) {
        if dot < 0.85 {
            let (a, b) = (o.map(p.x, p.z), o.map(r.x, r.z));
            det.line(a.x, a.y, b.x, b.y, 0.7, white);
        }
    }
    o.alpha = (0..n * n).map(|i| (m[i] * 0.16 + det.px[i][3] * m[i] * 0.45 + ring[i]).min(1.0)).collect();
    Some(o)
}

/// edge segments of a model normalised to unit size, few enough to redraw at 10 Hz
fn build_wire(lib: &ShipLibrary, meshes: &Assets<Mesh>, kind: &str) -> Option<Vec<[Vec3; 2]>> {
    let edges = sharp_edges(lib, meshes, kind);
    if edges.is_empty() {
        return None;
    }
    let mut segs: Vec<[Vec3; 2]> = Vec::new();
    for thr in [28.0f32, 40.0, 55.0, 70.0] {
        let c = thr.to_radians().cos();
        segs.clear();
        segs.extend(edges.iter().filter(|e| e.4 < c).map(|e| [e.2, e.3]));
        if segs.len() < 1600 {
            break;
        }
    }
    let max_r = segs.iter().flat_map(|s| [s[0].length(), s[1].length()]).fold(1e-3f32, f32::max);
    let step = segs.len().div_ceil(1600).max(1);
    Some(segs.iter().step_by(step).map(|s| [s[0] / max_r, s[1] / max_r]).collect())
}

// ---------- the update system ----------

type PlayerItem<'a> = (Entity, &'a Transform, &'a Ship, &'a Player, Option<&'a PlayerAim>, Option<&'a Trigger>);
type ShipItem<'a> = (Entity, &'a Transform, &'a Ship, Has<Dying>);

/// Redraws whichever screens are due (at most two per frame) and uploads them.
#[allow(clippy::too_many_arguments)]
pub fn update_screens(
    time: Res<Time>,
    status: Res<MissionStatus>,
    progress: Res<Progress>,
    lib: Res<ShipLibrary>,
    meshes: Res<Assets<Mesh>>,
    mut state: ResMut<CockpitState>,
    screens: Option<ResMut<Screens>>,
    mut images: ResMut<Assets<Image>>,
    players: Query<PlayerItem, Without<Dying>>,
    ships: Query<ShipItem>,
    mines: Query<(&Name, &Transform), (With<InMission>, Without<Ship>)>,
) {
    let Some(mut screens) = screens else { return };
    let Ok((pe, ptf, ship, player, aim, trigger)) = players.single() else { return };
    let t = time.elapsed_secs();
    let dt = time.delta_secs().min(0.1);
    screens.radar_ang += dt * 2.2;
    let sc = &mut *screens;

    // idle chatter on the log screens
    for (i, log) in sc.logs.iter_mut().enumerate() {
        if t > log.next {
            log.next = t + sc.rng.range(0.6, 1.8);
            let pick = sc.rng.u() as usize;
            if i == 0 {
                let l = log.push(t, hex(0x5fc79a, 1.0));
                l.text.push_str(IDLE_LINES[pick % IDLE_LINES.len()]);
                l.chars = l.text.chars().count();
            } else {
                let mhz = 120.0 + sc.rng.f() * 40.0;
                let l = log.push(t, hex(0x5fa8c7, 1.0));
                let _ = write!(l.text, "CH {:02} · {}", pick % 99, fmt_comma(mhz, 2));
                l.text.push_str(" MHZ");
                l.chars = l.text.chars().count();
            }
        }
    }

    let mut drawn = 0;
    for si in 0..sc.screens.len() {
        if drawn >= 2 || t < sc.screens[si].next {
            continue;
        }
        drawn += 1;
        let elem = sc.screens[si].elem;
        sc.screens[si].next = t + elem.period();
        let f = state.fail[elem as usize];
        let mut canvas = std::mem::replace(&mut sc.screens[si].canvas, Canvas::new(1, 1, BG));
        if f == Fail::Dead || (f == Fail::Flicker && state.rng.chance(0.35)) {
            canvas.static_noise(&mut sc.rng, t, f == Fail::Dead);
        } else {
            match elem {
                Elem::Mfd0 => {
                    mfd_frame(&mut canvas, "SCHIFF");
                    let outline = sc.outline(&lib, &meshes, &ship.kind);
                    draw_ship(&mut canvas, t, ship, player, trigger, outline.as_deref(), &state, &progress.callsign);
                }
                Elem::Mfd1 => {
                    mfd_frame(&mut canvas, "RAD");
                    gather_contacts(sc, pe, ptf, player, &ships, &mines, status.nav_pos);
                    draw_radar(&mut canvas, sc, t);
                }
                Elem::Mfd2 => {
                    mfd_frame(&mut canvas, "TGT");
                    let tgt = player.target.and_then(|e| ships.get(e).ok()).filter(|s| !s.3);
                    match tgt {
                        Some((te, ttf, tship, _)) => {
                            if sc.scan_for != Some(te) {
                                sc.scan_for = Some(te);
                                sc.scan_t0 = t;
                            }
                            let wire = sc.wire(&lib, &meshes, &tship.kind);
                            let hostile = ship.team.hostile_to(tship.team);
                            let d = ttf.translation.distance(ptf.translation);
                            let scan = ((t - sc.scan_t0) / 1.3).min(1.0);
                            draw_scan(&mut canvas, t, scan, tship, hostile, d, wire.as_deref(), player, aim, &mut sc.txt);
                        }
                        None => {
                            sc.scan_for = None;
                            let w = canvas.w as f32;
                            let h = canvas.h as f32;
                            canvas.text(
                                "KEIN ZIEL",
                                w / 2.0,
                                h / 2.0 - 10.0,
                                20.0,
                                with_a(G, 0.5 + (t * 3.3).sin() * 0.3),
                                Align::Center,
                            );
                        }
                    }
                }
                Elem::Log0 | Elem::Log1 => {
                    let i = if elem == Elem::Log0 { 0 } else { 1 };
                    draw_log(&mut canvas, &sc.logs[i], if i == 0 { "LOG" } else { "KOM" }, t, &mut sc.rng);
                    canvas.mask(&sc.prints, 400, 300, -40.0, -20.0, 400.0, 300.0, [1.0, 1.0, 1.0, 1.0]);
                }
                Elem::Annun => draw_annunciator(&mut canvas, &state, t, f),
                Elem::Seg => draw_seg(&mut canvas, ptf, ship, &status, state.mission_t, &mut sc.txt),
                Elem::Bar => draw_bars(&mut canvas, ship, player, t),
                _ => {}
            }
            if matches!(elem, Elem::Mfd0 | Elem::Mfd1 | Elem::Mfd2) {
                canvas.phosphor(0.55, &mut sc.tmp);
                if f == Fail::Flicker {
                    tear(&mut canvas, &mut sc.rng);
                }
                canvas.additive = true;
                canvas.mask(&sc.prints, 400, 300, 0.0, 0.0, 400.0, 300.0, [1.0, 1.0, 1.0, 1.0]);
                canvas.additive = false;
            }
        }
        upload(&mut images, &sc.screens[si].image, &canvas);
        sc.screens[si].canvas = canvas;
    }
}

const IDLE_LINES: [&str; 18] = [
    "SCHILDGENERATOR · PHASE NOMINAL",
    "KÜHLMITTELDRUCK 2,4 BAR",
    "TRÄGHEITSDÄMPFER AKTIV",
    "NAV-SYNC MIT TUS AURORA",
    "REAKTOR 1 · 98,2 %",
    "REAKTOR 2 · 97,9 %",
    "IFF-TRANSPONDER: NACHTFALKE",
    "LEBENSERHALTUNG OK · O2 21 %",
    "KALIBRIERE ZIELRECHNER…",
    "SENSORPAKET 3 · RAUSCHEN 0,4",
    "KABINENDRUCK STABIL",
    "PULSLASER 1–4 · LADUNG 100 %",
    "DATENBUS 4 · 1 PAKETVERLUST",
    "TELEMETRIE → AURORA",
    "TRIEBWERKSTEMPERATUR 1180 K",
    "FREQUENZSPRUNG KANAL 07",
    "SELBSTTEST BESTANDEN",
    "KOMPENSATOR DRIFT 0,02°",
];

/// German decimal comma, fixed digits (no allocation beyond the returned small string on the stack)
fn fmt_comma(v: f32, digits: usize) -> impl std::fmt::Display {
    struct C(f32, usize);
    impl std::fmt::Display for C {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            let p = 10f32.powi(self.1 as i32);
            let n = (self.0.abs() * p).round() as u64;
            let (int, frac) = (n / p as u64, n % p as u64);
            if self.0 < 0.0 {
                f.write_str("-")?;
            }
            write!(f, "{int},{frac:0w$}", w = self.1)
        }
    }
    C(v, digits)
}

/// a flickering display: horizontal tearing and colour loss
fn tear(c: &mut Canvas, rng: &mut Rng) {
    let (w, h) = (c.w, c.h);
    for _ in 0..3 {
        let y0 = (rng.f() * h as f32) as usize;
        let rows = rng.range(4.0, 22.0) as usize;
        let dx = rng.range(-30.0, 30.0) as i32;
        for y in y0..(y0 + rows).min(h) {
            let row = &mut c.px[y * w..(y + 1) * w];
            if dx > 0 {
                row.rotate_right(dx as usize);
            } else {
                row.rotate_left((-dx) as usize);
            }
        }
    }
    let k = 1.0 - rng.f() * 0.45;
    for p in &mut c.px {
        p[0] *= k;
        p[1] *= k;
        p[2] *= k;
    }
}

fn mfd_frame(c: &mut Canvas, title: &str) {
    c.clear(BG);
    let w = c.w as f32;
    for y in (0..c.h).step_by(4) {
        c.rect(0.0, y as f32, w, 1.0, with_a(G, 0.07));
    }
    c.text_ex(title, 12.0, 11.0, 15.0, 1.4, G, Align::Left, 1.0);
}

// ---------- left MFD: own ship ----------

#[allow(clippy::too_many_arguments)]
fn draw_ship(c: &mut Canvas, t: f32, ship: &Ship, player: &Player, trigger: Option<&Trigger>, ol: Option<&Outline>, state: &CockpitState, callsign: &str) {
    let (w, h) = (c.w as f32, c.h as f32);
    let (cx, cy, sc) = (w * 0.5, h * 0.54, h * 0.33);
    let sk = if ship.max_shield > 0.0 { ship.shield / ship.max_shield } else { 0.0 };
    let hk = ship.hp / ship.max_hp.max(1.0);
    // shield: four sectors that flash on the side that was hit
    let q = std::f32::consts::PI;
    let sectors = [(0usize, -q * 0.75, -q * 0.25), (1, -q * 0.25, q * 0.25), (2, q * 0.25, q * 0.75), (3, q * 0.75, q * 1.25)];
    for (side, a0, a1) in sectors {
        let flash = t - state.hit_side[side] < 0.6;
        let col = if flash {
            if (t * 25.0).sin() > 0.0 { [1.0; 4] } else { R }
        } else if sk > 0.5 {
            G
        } else if sk > 0.15 {
            A
        } else {
            R
        };
        let alpha = if sk <= 0.01 && !flash { 0.15 } else { 0.4 + sk * 0.6 };
        c.arc(cx, cy, sc * 0.95, sc * 1.25, a0 + 0.06, a1 - 0.06, if flash { 7.0 } else { 4.5 }, with_a(col, alpha));
    }
    let hull_col = if hk > 0.65 { G } else if hk > 0.3 { A } else { R };
    let d = h * 0.74;
    if let Some(ol) = ol {
        let ok = d / ol.n as f32;
        c.mask(&ol.alpha, ol.n, ol.n, cx - d / 2.0, cy - d / 2.0, d, d, hull_col);
        // damage: the hull outline flickers
        if hk < 0.3 && (t * 8.3).sin() > 0.0 {
            c.mask(&ol.alpha, ol.n, ol.n, cx - d / 2.0, cy - d / 2.0, d, d, [1.0, 1.0, 1.0, 0.5]);
        }
        let to_s = |x: f32, z: f32| {
            let p = ol.map(x, z);
            Vec2::new(cx + (p.x - ol.n as f32 / 2.0) * ok, cy + (p.y - ol.n as f32 / 2.0) * ok)
        };
        // engine glow
        let boost = ship.def.boost.unwrap_or(ship.def.speed * 1.5).max(1.0);
        let eg = (ship.speed / boost).min(1.0);
        let ec = if player.boosting { CYAN } else { with_a(CYAN, 0.3 + eg * 0.5) };
        c.rect(cx - 7.0, cy + ol.half_l * ok + 3.0, 14.0, 5.0 + eg * 12.0, ec);
        // guns: hardpoints flash when firing
        let firing = trigger.is_some_and(|t| t.guns) && ship.cool > ship.def.rof * 0.5;
        for g in &ship.def.guns {
            let p = to_s(g[0], g[2]);
            c.rect(p.x - 3.5, p.y - 7.0, 7.0, 12.0, if firing { [1.0; 4] } else { G });
        }
        // missile pylons
        let max_m = ship.def.missiles as usize;
        for i in 0..max_m.min(12) {
            let side = if i % 2 == 1 { 1.0 } else { -1.0 };
            let row = (i / 2) as f32;
            let (x, y) = (cx + side * ol.half_w * ok * (0.38 + row * 0.1), cy + sc * 0.1 + row * 6.0);
            let col = if i < ship.missiles as usize { A } else { with_a(A, 0.15) };
            c.tri((x, y - 7.0), (x + 3.5, y + 5.0), (x - 3.5, y + 5.0), col);
        }
        // persistent hull hit marks
        for (m, mt) in &state.marks {
            let p = to_s(m.x, m.y);
            let fresh = t - mt < 0.8;
            c.ellipse(p.x, p.y, if fresh { 12.0 } else { 7.0 }, if fresh { 12.0 } else { 7.0 }, with_a(R, 0.25));
            let col = if fresh { [1.0; 4] } else { R };
            c.line(p.x - 6.0, p.y - 6.0, p.x + 6.0, p.y + 6.0, 2.4, col);
            c.line(p.x + 6.0, p.y - 6.0, p.x - 6.0, p.y + 6.0, 2.4, col);
        }
    } else {
        // no model data: a simple arrow
        c.tri((cx, cy - 40.0), (cx + 28.0, cy + 30.0), (cx - 28.0, cy + 30.0), with_a(hull_col, 0.5));
    }
    let mut buf = String::new();
    let _ = write!(buf, "SCHILD {}%", (sk * 100.0).round() as i32);
    c.text_ex(&buf, 12.0, h - 26.0, 14.0, 1.3, if sk > 0.15 { G } else { R }, Align::Left, 1.0);
    buf.clear();
    let _ = write!(buf, "HÜLLE {}%", (hk * 100.0).round() as i32);
    c.text_ex(&buf, w - 12.0, h - 26.0, 14.0, 1.3, if hk > 0.3 { G } else { R }, Align::Right, 1.0);
    buf.clear();
    let _ = write!(buf, "{callsign} · {}", ship.def.name);
    upper_trim(&mut buf, 28);
    c.text_fit(&buf, w - 12.0, 11.0, 13.0, w * 0.62, A, Align::Right);
}

// ---------- centre MFD: radar ----------

#[allow(clippy::too_many_arguments)]
fn gather_contacts(
    sc: &mut Screens,
    pe: Entity,
    ptf: &Transform,
    player: &Player,
    ships: &Query<ShipItem>,
    mines: &Query<(&Name, &Transform), (With<InMission>, Without<Ship>)>,
    nav: Option<Vec3>,
) {
    let inv = ptf.rotation.inverse();
    let own_team = ships.get(pe).map(|s| s.2.team).unwrap_or(Team::Union);
    let mut n = 0;
    let mut push = |sc: &mut Screens, pos: Vec3, kind: Kind, capital: bool, target: bool, label: Option<&str>| {
        if n >= sc.contacts.len() {
            sc.contacts.push(Contact { kind, x: 0.0, y: 0.0, hgt: 0.0, edge: false, d: 0.0, capital, target, label: String::with_capacity(16) });
        }
        let c = &mut sc.contacts[n];
        let local = inv * (pos - ptf.translation);
        c.kind = kind;
        c.capital = capital;
        c.target = target;
        c.d = local.length();
        // store ship-local position for now; mapped to the scope in draw_radar
        c.x = local.x;
        c.y = local.z;
        c.hgt = local.y;
        c.label.clear();
        if let Some(l) = label {
            c.label.push_str(l);
            upper_trim(&mut c.label, 10);
        }
        n += 1;
    };
    for (e, tf, s, dying) in ships.iter() {
        if e == pe || dying {
            continue;
        }
        let kind = if own_team.hostile_to(s.team) {
            Kind::Foe
        } else if s.team == Team::Neutral {
            Kind::Neutral
        } else {
            Kind::Friend
        };
        push(sc, tf.translation, kind, s.capital(), player.target == Some(e), if s.capital() { Some(s.name.as_str()) } else { None });
    }
    for (name, tf) in mines.iter() {
        if name.as_str() == "Mine" && tf.translation.distance_squared(ptf.translation) < 6000.0 * 6000.0 {
            push(sc, tf.translation, Kind::Mine, false, false, None);
        }
    }
    if let Some(nav) = nav {
        push(sc, nav, Kind::Nav, false, false, None);
    }
    sc.n_contacts = n;
}

fn draw_radar(c: &mut Canvas, sc: &mut Screens, t: f32) {
    let (w, h) = (c.w as f32, c.h as f32);
    let n = sc.n_contacts;
    let nearest = sc.contacts[..n].iter().filter(|k| k.kind == Kind::Foe).fold(f32::MAX, |m, k| m.min(k.d));
    let range = if nearest < 1200.0 {
        1500.0
    } else if nearest < 2600.0 {
        3000.0
    } else {
        6000.0
    };
    let (cx, cy, rx) = (w / 2.0, h * 0.57, w * 0.47);
    let ry = rx * 0.5;
    c.ellipse(cx, cy, rx, ry, [0.08, 0.43, 0.27, 0.18]);
    for k in [1.0, 0.5] {
        c.arc(cx, cy, rx * k, ry * k, 0.0, std::f32::consts::TAU, 1.8, with_a(G, 0.6));
    }
    let faint = with_a(G, 0.28);
    c.line(cx - rx, cy, cx + rx, cy, 1.2, faint);
    c.line(cx, cy - ry, cx, cy + ry, 1.2, faint);
    c.line(cx, cy, cx - rx * 0.62, cy - ry * 0.78, 1.2, faint);
    c.line(cx, cy, cx + rx * 0.62, cy - ry * 0.78, 1.2, faint);
    let sw = sc.radar_ang % std::f32::consts::TAU;
    for i in 0..10 {
        let a0 = sw - i as f32 * 0.06;
        c.line(cx, cy, cx + a0.cos() * rx, cy + a0.sin() * ry, 2.4, with_a(G, 0.3 * (1.0 - i as f32 / 10.0)));
    }
    // own ship
    c.tri((cx, cy - 9.0), (cx + 7.0, cy + 7.0), (cx - 7.0, cy + 7.0), [1.0; 4]);
    // map contacts onto the scope
    let (mut friends, mut foes) = (0, 0);
    for k in &mut sc.contacts[..n] {
        match k.kind {
            Kind::Foe => foes += 1,
            Kind::Friend => friends += 1,
            _ => {}
        }
        let (lx, lz, ly) = (k.x, k.y, k.hgt);
        let (s, edge) = if k.d > range { (1.0 / k.d.max(1e-3), true) } else { (1.0 / range, false) };
        k.edge = edge;
        k.x = cx - lx * s * rx;
        k.y = cy - lz * s * ry;
        k.hgt = if edge { 0.0 } else { ly / range * ry * 1.1 };
    }
    // far to near (top to bottom); label the three nearest foes
    sc.order.clear();
    sc.order.extend(0..n);
    let contacts = &sc.contacts;
    sc.order.sort_unstable_by(|a, b| contacts[*a].y.total_cmp(&contacts[*b].y));
    let mut near3 = [usize::MAX; 3];
    let mut near_d = [f32::MAX; 3];
    for (i, k) in contacts[..n].iter().enumerate() {
        if k.kind != Kind::Foe || k.edge {
            continue;
        }
        for j in 0..3 {
            if k.d < near_d[j] {
                for m in (j + 1..3).rev() {
                    near_d[m] = near_d[m - 1];
                    near3[m] = near3[m - 1];
                }
                near_d[j] = k.d;
                near3[j] = i;
                break;
            }
        }
    }
    let mut buf = std::mem::take(&mut sc.txt);
    for oi in 0..n {
        let i = sc.order[oi];
        let k = &sc.contacts[i];
        let col = match k.kind {
            Kind::Foe => hex(0xff3d5e, 1.0),
            Kind::Friend => hex(0x5dff9c, 1.0),
            Kind::Mine => hex(0xff9a3a, 1.0),
            Kind::Nav => CYAN,
            Kind::Neutral => NEUTRAL,
        };
        let sz = if k.capital {
            11.0
        } else if k.kind == Kind::Mine {
            3.5
        } else {
            8.0
        } * 1.15;
        if k.edge {
            symbol(c, k.kind, k.x, k.y, sz * 0.55, with_a(col, 0.75));
            continue;
        }
        let (bx, by) = (k.x, k.y - k.hgt);
        c.line(k.x, k.y, bx, by, 2.0, with_a(col, 0.7));
        c.arc(k.x, k.y, 4.5, 2.2, 0.0, std::f32::consts::TAU, 1.5, with_a(col, 0.7));
        symbol(c, k.kind, bx, by, sz, col);
        if k.capital {
            c.rect_line(bx - sz - 4.0, by - sz - 4.0, (sz + 4.0) * 2.0, (sz + 4.0) * 2.0, 2.0, col);
        }
        let labelled = near3.contains(&i) || (k.capital && k.kind != Kind::Neutral);
        if labelled {
            buf.clear();
            if k.capital {
                buf.push_str(&k.label);
            } else {
                let _ = write!(buf, "{}", fmt_comma(k.d / 1000.0, 1));
            }
            let right = bx > w - 70.0;
            let tx = if right { bx - sz - 5.0 } else { bx + sz + 5.0 };
            let al = if right { Align::Right } else { Align::Left };
            c.text_ex(&buf, tx + 1.0, by - 6.0 + 1.0, 12.0, 1.8, [0.0, 0.0, 0.0, 0.85], al, 1.0);
            c.text_ex(&buf, tx, by - 6.0, 12.0, 1.3, col, al, 1.0);
        }
        if k.target {
            let r = sz + 6.0 + (t * 8.3).sin() * 1.5;
            for (sx, sy) in [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)] {
                c.polyline(&[(bx + sx * r, by + sy * (r - 5.0)), (bx + sx * r, by + sy * r), (bx + sx * (r - 5.0), by + sy * r)], 2.0, [1.0; 4]);
            }
        }
    }
    buf.clear();
    let _ = write!(buf, "{} KM", fmt_comma(range / 1000.0, 1));
    c.text_ex(&buf, w - 12.0, 11.0, 14.0, 1.3, G, Align::Right, 1.0);
    buf.clear();
    let _ = write!(buf, "▲ FREUND {friends}");
    c.text_ex(&buf, 12.0, h - 26.0, 14.0, 1.3, hex(0x5dff9c, 1.0), Align::Left, 1.0);
    buf.clear();
    let _ = write!(buf, "FEIND {foes} ◆");
    c.text_ex(&buf, w - 12.0, h - 26.0, 14.0, 1.3, hex(0xff3d5e, 1.0), Align::Right, 1.0);
    sc.txt = buf;
}

/// foes = diamonds, friends = triangles, nav = cross, mines = dots; dark outline for contrast
fn symbol(c: &mut Canvas, kind: Kind, x: f32, y: f32, sz: f32, col: Rgba) {
    let dark = [0.0, 0.0, 0.0, 0.85 * col[3]];
    match kind {
        Kind::Foe => {
            let pts = |s: f32| [(x, y - s), (x + s, y), (x, y + s), (x - s, y)];
            c.poly(&pts(sz + 1.6), dark);
            c.poly(&pts(sz), col);
        }
        Kind::Friend | Kind::Neutral => {
            let pts = |s: f32| [(x, y - s), (x + s, y + s * 0.8), (x - s, y + s * 0.8)];
            c.poly(&pts(sz + 1.8), dark);
            c.poly(&pts(sz), col);
        }
        Kind::Nav => {
            c.rect(x - 2.5, y - sz - 1.0, 5.0, sz * 2.0 + 2.0, dark);
            c.rect(x - sz - 1.0, y - 2.5, sz * 2.0 + 2.0, 5.0, dark);
            c.rect(x - 1.5, y - sz, 3.0, sz * 2.0, col);
            c.rect(x - sz, y - 1.5, sz * 2.0, 3.0, col);
        }
        Kind::Mine => {
            c.ellipse(x, y, sz + 1.5, sz + 1.5, dark);
            c.ellipse(x, y, sz, sz, col);
        }
    }
}

// ---------- right MFD: target scan ----------

#[allow(clippy::too_many_arguments)]
fn draw_scan(c: &mut Canvas, t: f32, scan: f32, tg: &Ship, foe: bool, d: f32, wire: Option<&Vec<[Vec3; 2]>>, player: &Player, aim: Option<&PlayerAim>, buf: &mut String) {
    let (w, h) = (c.w as f32, c.h as f32);
    let col = if foe {
        R
    } else if tg.team == Team::Neutral {
        NEUTRAL
    } else {
        G
    };
    // wireframe, slowly turning, seen from slightly above; "scanned in" line by line
    let top = 30.0;
    let y_scan = top + (h - top) * scan;
    if let Some(wire) = wire {
        let (yaw, pitch) = (t / 2.6, 0.42f32);
        let (cy0, sy0, cp, sp) = (yaw.cos(), yaw.sin(), pitch.cos(), pitch.sin());
        let (cx, cyy, s) = (w * 0.66, h * 0.52, h * 0.36);
        c.set_clip(w * 0.3, top, w * 0.7, y_scan - top);
        let lc = with_a(col, 0.85);
        let proj = |p: Vec3| {
            let x1 = p.x * cy0 + p.z * sy0;
            let z1 = -p.x * sy0 + p.z * cy0;
            let y2 = p.y * cp - z1 * sp;
            let z2 = p.y * sp + z1 * cp;
            let k = 1.0 / (1.0 + z2 * 0.25);
            (cx + x1 * s * k, cyy - y2 * s * k)
        };
        for seg in wire {
            let (a, b) = (proj(seg[0]), proj(seg[1]));
            c.line(a.0, a.1, b.0, b.1, 1.1, lc);
        }
        c.reset_clip();
    }
    if scan < 1.0 {
        c.vgrad(w * 0.3, y_scan - 20.0, w * 0.7, 22.0, with_a(G, 0.0), hex(0xa0ffd2, 0.55));
        c.rect(w * 0.3, y_scan, w * 0.7, 1.8, hex(0xd8ffe9, 1.0));
    }
    // corner brackets of the scan frame
    let (fx0, fx1, fy0, fy1) = (w * 0.32, w - 10.0, top + 4.0, h - 10.0);
    for (x, y, dx, dy) in [(fx0, fy0, 1.0, 1.0), (fx1, fy0, -1.0, 1.0), (fx0, fy1, 1.0, -1.0), (fx1, fy1, -1.0, -1.0)] {
        c.polyline(&[(x, y + dy * 16.0), (x, y), (x + dx * 16.0, y)], 2.2, with_a(G, 0.5));
    }
    // data column
    buf.clear();
    buf.push_str(&tg.name);
    upper_trim(buf, 12);
    c.text_fit(buf, 12.0, 38.0, 16.0, w * 0.3, col, Align::Left);
    let st = if scan < 1.0 {
        buf.clear();
        let _ = write!(buf, "SCAN {}%", (scan * 100.0).round() as i32);
        buf.as_str()
    } else if foe {
        "FEINDLICH"
    } else {
        "FREUNDLICH"
    };
    c.text_fit(st, 12.0, 66.0, 12.0, w * 0.28, G, Align::Left);
    let mut b2 = String::new();
    let _ = write!(b2, "{} M", d.round() as i32);
    c.text_ex(&b2, 12.0, 86.0, 12.0, 1.1, G, Align::Left, 1.0);
    let bar = |c: &mut Canvas, y: f32, label: &str, k: f32, cc: Rgba| {
        c.text_ex(label, 12.0, y, 11.0, 1.1, G, Align::Left, 1.0);
        c.rect_line(12.0, y + 18.0, w * 0.27, 12.0, 1.2, G);
        c.rect(14.5, y + 20.5, (w * 0.27 - 5.0) * k.clamp(0.0, 1.0), 7.0, cc);
    };
    if scan >= 0.5 {
        if tg.max_shield > 0.0 {
            bar(c, 112.0, "SCHILD", tg.shield / tg.max_shield, CYAN);
        }
        let hk = tg.hp / tg.max_hp.max(1.0);
        bar(c, 152.0, "HÜLLE", hk, if hk < 0.3 { R } else { A });
    }
    // lock state
    let blink = (t * 11.0).sin() > 0.0;
    if player.lock >= 1.0 {
        c.text_ex("NEUTRON LOCK", 12.0, h - 56.0, 13.0, 1.4, if blink { R } else { hex(0x3a0a12, 1.0) }, Align::Left, 1.0);
    } else if player.lock > 0.0 {
        b2.clear();
        let _ = write!(b2, "ERFASSUNG {}%", (player.lock * 100.0).round() as i32);
        c.text_ex(&b2, 12.0, h - 56.0, 13.0, 1.4, A, Align::Left, 1.0);
    }
    if aim.is_some_and(|a| a.locked) {
        c.text_ex("LASER LOCK", 12.0, h - 32.0, 13.0, 1.4, if blink { G } else { BG }, Align::Left, 1.0);
    }
}

// ---------- log screens ----------

fn draw_log(c: &mut Canvas, log: &Log, title: &str, t: f32, rng: &mut Rng) {
    let (w, h) = (c.w as f32, c.h as f32);
    c.clear(hex(0x030a07, 1.0));
    c.text_ex(title, 8.0, 8.0, 14.0, 1.4, with_a(G, 0.8), Align::Left, 1.0);
    let lh = 27.0;
    let n = log.len;
    let newest_t = if n > 0 { log.get(n - 1).t } else { -100.0 };
    let slide = (1.0 - (t - newest_t) / 0.22).max(0.0) * lh;
    for i in 0..n {
        let ln = log.get(i);
        let y = h - (n - i) as f32 * lh + slide - 4.0 + 6.0;
        if y < 30.0 || t < ln.t {
            continue;
        }
        let age = t - ln.t;
        // freshly arrived lines type in; everything flickers a little
        let shown = ln.chars.min((age * 60.0) as usize);
        let alpha = (0.55 + rng.f() * 0.45) * (1.0 - age / 14.0).max(0.35);
        let dx = if rng.chance(0.03) { rng.range(-6.0, 6.0) } else { 0.0 };
        let end = ln.text.char_indices().nth(shown).map_or(ln.text.len(), |(i, _)| i);
        let full_w = Canvas::text_width(&ln.text, 13.0, 1.1);
        let sx = ((w - 18.0) / full_w.max(1.0)).min(1.0);
        let x_end = c.text_ex(&ln.text[..end], 8.0 + dx, y, 13.0, 1.1, with_a(ln.color, alpha), Align::Left, sx);
        if shown < ln.chars {
            c.rect(x_end, y - 1.0, 7.0 * sx, 15.0, with_a(ln.color, alpha));
        }
    }
    c.scanlines(3, 0.65);
    let sy = (t * 70.0) % (h + 40.0) - 20.0;
    c.rect(0.0, sy, w, 18.0, hex(0x78ffbe, 0.07));
}

// ---------- annunciator, readouts, bars ----------

fn draw_annunciator(c: &mut Canvas, state: &CockpitState, t: f32, fail: Fail) {
    let (w, h) = (c.w as f32, c.h as f32);
    c.clear(hex(0x0b0c0e, 1.0));
    let (cols, cw, ch) = (5, w / 5.0, h / 2.0);
    let mut rng = Rng::new((t * 1000.0) as u32);
    for (i, label) in LAMP_LABELS.iter().enumerate() {
        let lamp = state.lamps[i];
        let rate = match lamp.blink {
            2 => 12.0,
            1 => 4.5,
            _ => 0.0,
        };
        let mut on = lamp.col != LampCol::Off && (rate == 0.0 || (t * rate).sin() > -0.2);
        match fail {
            Fail::Dead => on = rng.chance(0.02),
            Fail::Flicker if rng.chance(0.3) => on = !on,
            _ => {}
        }
        let rgb: Rgba = match (on, lamp.col) {
            (true, LampCol::Green) => hex(0x46ff96, 1.0),
            (true, LampCol::Amber) => hex(0xffbe3c, 1.0),
            (true, LampCol::Red) => hex(0xff3c46, 1.0),
            _ => hex(0x28241e, 1.0),
        };
        let (x, y, bw, bh) = ((i % cols) as f32 * cw + 6.0, (i / cols) as f32 * ch + 6.0, cw - 12.0, ch - 12.0);
        c.rect(x, y, bw, bh, [rgb[0] * 0.22, rgb[1] * 0.22, rgb[2] * 0.22, 1.0]);
        if on {
            c.rect(x, y, bw, bh, with_a(rgb, 0.55));
            c.set_clip(x, y, bw, bh);
            c.glow(x + bw / 2.0, y + bh / 2.0, bw * 0.6, with_a(mix(rgb, [1.0; 4], 0.35), 0.9));
            c.reset_clip();
        }
        let tc = if on { [0.08, 0.04, 0.02, 0.85] } else { [0.69, 0.69, 0.65, 0.6] };
        c.text_fit(label, x + bw / 2.0, y + bh / 2.0 - bh * 0.2, bh * 0.4, bw - 10.0, tc, Align::Center);
        c.rect_line(x, y, bw, bh, 3.0, [0.0, 0.0, 0.0, 0.8]);
    }
}

fn draw_seg(c: &mut Canvas, ptf: &Transform, ship: &Ship, status: &MissionStatus, mission_t: f32, buf: &mut String) {
    let (w, h) = (c.w as f32, c.h as f32);
    c.clear(hex(0x0a0606, 1.0));
    let km = status.nav_pos.map(|n| (n.distance(ptf.translation) / 1000.0).min(999.9));
    let (mm, ss) = ((mission_t / 60.0) as u32 % 100, mission_t as u32 % 60);
    for i in 0..3 {
        buf.clear();
        let (label, on, tape) = match i {
            0 => {
                match km {
                    Some(k) => {
                        let _ = write!(buf, "{:>5.1}", k);
                    }
                    None => buf.push_str("---.-"),
                }
                ("NAV-DIST KM", hex(0xff3a2a, 1.0), hex(0x2a0c0a, 1.0))
            }
            1 => {
                let _ = write!(buf, "{:04}", ship.speed.round() as i32);
                ("GESCHW. M/S", hex(0x3aff6a, 1.0), hex(0x0c2412, 1.0))
            }
            _ => {
                let _ = write!(buf, "{mm:02}:{ss:02}");
                ("EINSATZZEIT", hex(0xffb42a, 1.0), hex(0x2a1d06, 1.0))
            }
        };
        let y = 8.0 + i as f32 * 72.0;
        c.rect(150.0, y, 350.0, 62.0, hex(0x140c0c, 1.0));
        c.rect_line(150.0, y, 350.0, 62.0, 2.0, [0.47, 0.47, 0.47, 0.5]);
        dymo_fit(c, label, 6.0, y + 17.0, 28.0, 138.0, tape);
        c.seg_text(buf, 170.0, y + 8.0, 34.0, 46.0, on, with_a(on, 0.09));
    }
    c.rect(0.0, 0.0, w, h * 0.35, [1.0, 1.0, 1.0, 0.04]);
}

/// label-maker tape squeezed into `max_w`
fn dymo_fit(c: &mut Canvas, txt: &str, x: f32, y: f32, h: f32, max_w: f32, tape: Rgba) {
    let th = h * 0.5;
    let tw = Canvas::text_width(txt, th, 1.3);
    let sx = ((max_w - h * 0.8) / tw).min(1.0);
    let w = tw * sx + h * 0.8;
    c.rect(x, y, w, h, tape);
    c.rect(x, y, w, h * 0.18, [1.0, 1.0, 1.0, 0.12]);
    c.text_ex(txt, x + h * 0.4, y + (h - th) * 0.5, th, 1.3, [0.94, 0.94, 0.94, 0.92], Align::Left, sx);
}

fn draw_bars(c: &mut Canvas, ship: &Ship, player: &Player, t: f32) {
    c.clear(hex(0x080808, 1.0));
    let sk = if ship.max_shield > 0.0 { ship.shield / ship.max_shield } else { 0.0 };
    let lockout = !player.boosting && player.energy < 0.05;
    for (ci, (label, k)) in [("SCHILD", sk), ("BST", player.energy)].into_iter().enumerate() {
        let x = 30.0 + ci as f32 * 112.0;
        let n = 12;
        for i in 0..n {
            let lit = i < (k * n as f32).round() as usize;
            let colr = if i >= 9 {
                hex(0xff463c, 1.0)
            } else if i >= 6 {
                hex(0xffbe3c, 1.0)
            } else {
                hex(0x46ff78, 1.0)
            };
            let blink = ci == 1 && lockout && (t * 12.0).sin() < 0.0;
            let yy = 168.0 - i as f32 * 13.5;
            if lit && !blink {
                c.additive = true;
                c.glow(x + 40.0, yy + 5.0, 30.0, with_a(colr, 0.12));
                c.additive = false;
                c.rect(x, yy, 80.0, 10.0, colr);
            } else {
                c.rect(x, yy, 80.0, 10.0, with_a(colr, 0.1));
            }
        }
        dymo_fit(c, label, x, 186.0, 26.0, 84.0, hex(0x151515, 1.0));
    }
}
