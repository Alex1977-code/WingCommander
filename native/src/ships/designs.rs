//! The 21 ship designs, ported from the procedural three.js models in src/ships.js (same shapes,
//! proportions, positions and colours; +Z forward, metres). Every design is built into per-material
//! triangle buffers, plus the engine nozzles, gun pods, turret mounts and nav lights the game needs.

use super::mesh::*;
use super::tex::Rng;
use bevy::math::Affine3A;
use bevy::prelude::*;
use std::collections::HashMap;
use std::f32::consts::{FRAC_PI_2, PI, TAU};

/// Fighter palettes
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Pal {
    Union,
    Asz,
    Ace,
}

/// Capital-ship palettes
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Cp {
    Union,
    Asz,
    Wreck,
}

/// Every material a ship model uses (shared between all ships of the library).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum M {
    Hull(Pal),
    Dark(Pal),
    Accent(Pal),
    Canopy(Pal),
    Glow(Pal),
    Line(Pal),
    /// flank code / glyph decal: index into DECALS
    Decal(u8),
    Soot,
    /// the Schwinge's light sail
    Sail,
    CHull(Cp),
    /// hull metal without windows (tanks, nacelles)
    CTank(Cp),
    CDark(Cp),
    CGlow(Cp),
    CAccent(Cp),
    CStrip(Cp),
    Throat(Cp),
    Bridge,
    Ward,
    /// vertex-coloured window quads
    Windows,
    /// registry plate: index into REGISTRIES
    Registry(u8),
    BayGlow,
    BayBand,
    BayRed,
    BayAmber,
    BayGreen,
    BayField,
    Clamp,
    Coil,
    Intake,
    Cell,
    Burn,
    Ember,
    Hole,
    GateField,
    /// nav-light halo: index into LIGHT_COLORS
    Halo(u8),
}

/// flank decals: Union squadron codes per type, then the Aszendenz glyph band
pub const DECALS: [&str; 4] = ["NF·07", "NF·12", "NF·21", "*"];
pub const DECAL_GLYPH: u8 = 3;
/// registry plates (name, class line)
pub const REGISTRIES: [(&str, &str); 4] = [
    ("TUS AURORA", "CV-07 · TERRANISCHE UNION"),
    ("TUS VALKYRIE", "CV-03 · TERRANISCHE UNION"),
    ("SAMARITER", "MED-04 · LAZARETTSCHIFF"),
    ("VERSORGER", "DV-11 · DEUTERIUMTRANSPORT"),
];
/// nav light colours (HDR): port red, starboard green, white strobe, red mast beacon
pub const LIGHT_COLORS: [[f32; 3]; 4] = [[3.0, 0.25, 0.2], [0.2, 3.0, 0.6], [1.6, 1.6, 1.6], [3.0, 0.3, 0.25]];
const RED: u8 = 0;
const GREEN: u8 = 1;
const STROBE: u8 = 2;
const BEACON: u8 = 3;

/// a blinking nav light: position, colour index, blink rate (Hz), phase (0..1), halo size (m)
#[derive(Clone, Copy, Debug)]
pub struct Light {
    pub pos: Vec3,
    pub color: u8,
    pub rate: f32,
    pub phase: f32,
    pub size: f32,
}

/// One built design.
#[derive(Default)]
pub struct Built {
    pub geos: HashMap<M, Geo>,
    /// engine nozzle exits (position, radius)
    pub nozzles: Vec<(Vec3, f32)>,
    /// wing-gun pod muzzles
    pub pods: Vec<Vec3>,
    pub lights: Vec<Light>,
    /// turret mounts (position, outward normal)
    pub turrets: Vec<(Vec3, Vec3)>,
    /// material for the turret heads (capitals)
    pub turret_mat: Option<M>,
}

struct Eng {
    dark: M,
    throat: M,
    small: bool,
}

/// Builder with the web's helper vocabulary (mk, ell, tube, beam, slab, engine, ...).
pub struct B {
    pub out: Built,
    eng: Eng,
    rng: Rng,
}

fn v(x: f32, y: f32, z: f32) -> Vec3 {
    Vec3::new(x, y, z)
}

impl B {
    fn new(eng: Eng, seed: u32) -> Self {
        Self { out: Built::default(), eng, rng: Rng::new(seed) }
    }
    fn add(&mut self, m: M, g: &Geo, xf: Affine3A) {
        self.out.geos.entry(m).or_default().append(g, &xf);
    }
    fn ell(&mut self, m: M, x: f32, y: f32, z: f32, sx: f32, sy: f32, sz: f32, seg: u32) {
        self.add(m, &ell(sx, sy, sz, seg), at(x, y, z));
    }
    fn ell_r(&mut self, m: M, p: Vec3, s: Vec3, seg: u32, r: Quat) {
        self.add(m, &ell(s.x, s.y, s.z, seg), trs(p, r, Vec3::ONE));
    }
    /// tapered tube along z (front radius at +z), with caps
    fn tube(&mut self, m: M, x: f32, y: f32, z: f32, rf: f32, rb: f32, len: f32, seg: u32) {
        self.add(m, &tube(rf, rb, len, seg, true), at(x, y, z));
    }
    /// vertical cylinder (three's CylinderGeometry: top radius at +y)
    fn cyl_y(&mut self, m: M, x: f32, y: f32, z: f32, rt: f32, rb: f32, h: f32, seg: u32) {
        self.add(m, &tube(rt, rb, h, seg, true), at(x, y, z) * rx(-FRAC_PI_2));
    }
    fn bx(&mut self, m: M, w: f32, h: f32, d: f32, x: f32, y: f32, z: f32) {
        self.add(m, &cuboid(w, h, d), at(x, y, z));
    }
    fn bx_r(&mut self, m: M, w: f32, h: f32, d: f32, p: Vec3, r: Quat) {
        self.add(m, &cuboid(w, h, d), trs(p, r, Vec3::ONE));
    }
    /// box from a to b (length along a->b), w across, h along the up hint (three's lookAt basis)
    fn beam(&mut self, m: M, a: Vec3, b: Vec3, w: f32, h: f32, up: Vec3) {
        let z = (b - a).normalize_or(Vec3::Z);
        let mut x = up.cross(z);
        if x.length_squared() < 1e-6 {
            x = (up + Vec3::new(1e-3, 0.0, 1e-4)).cross(z);
        }
        let x = x.normalize();
        let y = z.cross(x);
        let r = Quat::from_mat3(&Mat3::from_cols(x, y, z));
        self.add(m, &cuboid(w, h, (b - a).length()), trs((a + b) * 0.5, r, Vec3::ONE));
    }
    fn beam_z(&mut self, m: M, a: Vec3, b: Vec3, w: f32, h: f32) {
        self.beam(m, a, b, w, h, Vec3::Z);
    }
    /// cone (apex along +y in three) at p with Euler rotation
    fn cone_y(&mut self, m: M, r: f32, h: f32, seg: u32, p: Vec3, rot: Quat) {
        self.add(m, &cone(r, h, seg), trs(p, rot, Vec3::ONE) * rx(-FRAC_PI_2));
    }
    /// cone centred at p, apex pointing at `toward`
    fn cone_to(&mut self, m: M, r: f32, h: f32, seg: u32, p: Vec3, toward: Vec3) {
        self.add(m, &cone(r, h, seg), trs(p, look_z(toward - p), Vec3::ONE));
    }
    /// cone along +z (three: ConeGeometry rotated +90 deg about X), centred at p
    fn cone_z(&mut self, m: M, r: f32, h: f32, seg: u32, p: Vec3) {
        self.add(m, &cone(r, h, seg), at(p.x, p.y, p.z));
    }
    fn torus(&mut self, m: M, big_r: f32, r: f32, rs: u32, ts: u32, arc: f32, xf: Affine3A) {
        self.add(m, &torus(big_r, r, rs, ts, arc), xf);
    }
    fn light(&mut self, x: f32, y: f32, z: f32, color: u8, rate: f32, phase: f32, size: f32) {
        self.out.lights.push(Light { pos: v(x, y, z), color, rate, phase, size });
    }
    /// sub-assembly marker: vertex counts per material
    fn checkpoint(&self) -> Vec<(M, usize)> {
        self.out.geos.iter().map(|(m, g)| (*m, g.vcount())).collect()
    }
    fn move_since(&mut self, cp: &[(M, usize)], xf: &Affine3A) {
        for (m, g) in self.out.geos.iter_mut() {
            let first = cp.iter().find(|c| c.0 == *m).map_or(0, |c| c.1);
            g.transform_from(first, xf);
        }
    }

    /// Drive: sooty band, nozzle, glowing throat, lip and vanes; registers the nozzle exit.
    fn engine(&mut self, x: f32, y: f32, z: f32, r: f32) {
        let (dark, throat, small) = (self.eng.dark, self.eng.throat, self.eng.small);
        self.add(M::Soot, &tube(r * 1.06, r, r * 0.7, 14, false), at(x, y, z - r * 0.75));
        self.add(dark, &tube(r, r * 0.8, r * 2.2, 14, false), at(x, y, z));
        let dr = if small { r * 0.6 } else { r * 0.85 };
        self.add(throat, &disc(dr, 14), at(x, y, z - r * 0.9) * ry(PI));
        if small {
            self.add(M::Soot, &ring(dr, r * 0.85, 14), at(x, y, z - r * 0.9) * ry(PI));
        }
        // backing plate: the open nozzle is never see-through from the front
        self.add(dark, &disc(r * 0.86, 14), at(x, y, z - r * 0.8));
        self.torus(dark, r, r * 0.09, 6, 18, TAU, at(x, y, z - r * 1.1));
        for i in 0..6 {
            let a = i as f32 / 6.0 * TAU;
            self.bx_r(dark, r * 0.08, r * 0.55, r * 0.9, v(x + a.cos() * r * 0.55, y + a.sin() * r * 0.55, z - r * 0.5), Quat::from_rotation_z(a + FRAC_PI_2));
        }
        self.out.nozzles.push((v(x, y, z - r * 1.1), r));
    }
}

// ---------------------------------------------------------------------------
// Fighters
// ---------------------------------------------------------------------------

struct F {
    hull: M,
    dark: M,
    accent: M,
    canopy: M,
    glow: M,
    line: M,
    decal: M,
}

fn fpal(p: Pal, decal: u8) -> F {
    F { hull: M::Hull(p), dark: M::Dark(p), accent: M::Accent(p), canopy: M::Canopy(p), glow: M::Glow(p), line: M::Line(p), decal: M::Decal(decal) }
}

fn craft(p: Pal, decal: u8, seed: u32, build: impl FnOnce(&mut B, &F)) -> Built {
    let f = fpal(p, decal);
    let mut b = B::new(Eng { dark: f.dark, throat: f.line, small: true }, seed);
    build(&mut b, &f);
    b.out
}

fn slab_at(b: &mut B, m: M, pts: &[[f32; 2]], thick: f32, y: f32, bevel: f32) {
    b.add(m, &slab(pts, thick, bevel), at(0.0, y, 0.0));
}

/// cockpit canopy with frame arches
fn canopy(b: &mut B, f: &F, x: f32, y: f32, z: f32, w: f32, h: f32, l: f32) {
    b.ell(f.canopy, x, y, z, w, h, l, 16);
    for dz in [-0.45f32, 0.0, 0.45] {
        let k = 1.0 - dz.abs() * 0.9;
        b.torus(f.dark, 1.0, 0.05, 4, 16, PI, at(x, y, z + dz * l) * sc(w * k, h * k, 1.0));
    }
}

/// gun pod: barrel, sooty muzzle; registers the muzzle
fn gun_pod(b: &mut B, f: &F, x: f32, y: f32, z: f32, len: f32) {
    b.tube(f.dark, x, y, z + len / 2.0, 0.11, 0.14, len, 8);
    b.tube(M::Soot, x, y, z + len, 0.19, 0.19, 0.25, 8);
    b.out.pods.push(v(x, y, z + len));
}

fn nav_lights(b: &mut B, xl: f32, y: f32, z: f32, tail_y: f32, tail_z: f32) {
    b.light(xl, y, z, RED, 1.1, 0.0, 1.8);
    b.light(-xl, y, z, GREEN, 1.1, 0.5, 1.8);
    b.light(0.0, tail_y, tail_z, STROBE, 0.8, 0.25, 2.2);
}

/// flank decals on both sides; `splay` = how much the hull side widens towards the stern (x per z)
fn decals(b: &mut B, f: &F, x: f32, y: f32, z: f32, len: f32, h: f32, splay: f32) {
    for sx in [-1.0f32, 1.0] {
        b.add(f.decal, &plane(len, h), at(sx * (x + 0.02), y, z) * ry(sx * (FRAC_PI_2 - splay.atan())));
    }
}

/// Union engine nacelle: hull tube, glowing intake ring, coil strip, dorsal rail, drive at the back
fn nacelle(b: &mut B, f: &F, x: f32, y: f32, z: f32, r: f32, len: f32, inner: f32) {
    b.tube(f.hull, x, y, z, r * 0.92, r, len, 14);
    b.ell(f.dark, x, y, z + len / 2.0, r * 0.92, r * 0.92, r * 0.8, 12);
    b.torus(f.glow, r * 0.95, r * 0.14, 6, 16, TAU, at(x, y, z + len / 2.0 - r * 0.25));
    b.bx(f.line, 0.08, r * 0.5, len * 0.62, x - inner * r * 0.98, y, z - len * 0.06);
    b.bx(f.dark, r * 0.5, 0.1, len * 0.7, x, y + r * 0.98, z);
    b.engine(x, y, z - len / 2.0 - r * 0.4, r * 0.85);
}

/// Sperber: light interceptor - an armoured wedge with two drive pods on short struts
fn sperber() -> Built {
    craft(Pal::Union, 0, 1, |b, f| {
        slab_at(b, f.hull, &[[0.0, 7.4], [1.4, 6.2], [2.4, 3.2], [3.1, -3.6], [2.6, -6.4], [-2.6, -6.4], [-3.1, -3.6], [-2.4, 3.2], [-1.4, 6.2]], 1.2, 0.0, 0.25);
        slab_at(b, f.dark, &[[0.0, 4.8], [1.7, 2.4], [2.1, -5.6], [-2.1, -5.6], [-1.7, 2.4]], 0.7, 0.85, 0.15);
        b.ell(f.dark, 0.0, -0.75, 0.5, 1.6, 0.55, 4.2, 12);
        canopy(b, f, 0.0, 1.25, 2.4, 0.95, 0.62, 1.9);
        for sx in [-1.0f32, 1.0] {
            b.beam_z(f.hull, v(sx * 2.4, 0.0, -2.4), v(sx * 4.4, -0.3, -2.8), 0.35, 3.2);
            nacelle(b, f, sx * 4.6, -0.3, -2.2, 0.72, 7.6, sx);
            gun_pod(b, f, sx * 4.6, -0.95, 1.4, 1.6);
            b.bx_r(f.accent, 0.06, 0.18, 5.2, v(sx * 2.75, 0.62, -0.6), Quat::from_rotation_y(sx * 0.13));
        }
        b.add(f.hull, &wing(1.8, 3.2, 1.2, 1.5, 0.22), at(0.0, 1.05, -4.6) * rz(FRAC_PI_2));
        b.engine(0.0, 0.1, -6.8, 0.75);
        b.ell(f.accent, 0.9, 1.25, -3.6, 0.2, 0.2, 0.2, 8);
        decals(b, f, 3.14, 0.15, -1.6, 3.0, 0.8, 0.103);
        nav_lights(b, 5.5, -0.3, -2.4, 1.6, -6.2);
    })
}

/// Falke: multirole fighter - crew hull, two nacelles on swept pylons, chin gun
fn falke() -> Built {
    craft(Pal::Union, 1, 2, |b, f| {
        b.ell(f.hull, 0.0, 0.0, 0.8, 1.75, 1.0, 7.2, 20);
        slab_at(b, f.dark, &[[0.0, 6.6], [1.5, 3.2], [1.8, -4.6], [-1.8, -4.6], [-1.5, 3.2]], 0.5, 0.75, 0.12);
        b.ell(f.dark, 0.0, 0.0, 7.6, 0.7, 0.55, 0.9, 10);
        b.torus(f.line, 0.62, 0.06, 6, 14, TAU, at(0.0, 0.0, 7.15));
        canopy(b, f, 0.0, 0.95, 3.4, 0.85, 0.55, 1.7);
        b.tube(f.dark, 0.0, -0.95, 4.4, 0.32, 0.42, 5.0, 12);
        b.tube(f.dark, 0.0, -1.0, 7.6, 0.12, 0.14, 1.6, 8);
        b.tube(M::Soot, 0.0, -1.0, 8.4, 0.18, 0.18, 0.25, 8);
        for sx in [-1.0f32, 1.0] {
            b.beam_z(f.hull, v(sx * 1.4, 0.1, -2.6), v(sx * 5.1, 1.1, -3.8), 0.3, 4.6);
            b.beam_z(f.dark, v(sx * 1.4, -0.2, -1.4), v(sx * 5.1, 0.6, -2.2), 0.18, 1.2);
            nacelle(b, f, sx * 5.2, 1.1, -2.6, 0.85, 10.5, sx);
            gun_pod(b, f, sx * 5.2, 0.2, 2.5, 1.8);
            b.bx_r(f.accent, 0.06, 0.12, 3.6, v(sx * 3.3, 0.85, -3.2), Quat::from_rotation_y(sx * 0.3));
        }
        b.engine(0.0, 0.0, -6.6, 0.7);
        b.cyl_y(f.dark, 0.4, 1.6, -2.6, 0.05, 0.07, 1.4, 5);
        decals(b, f, 1.62, 0.1, 0.6, 3.4, 0.8, 0.0);
        nav_lights(b, 6.2, 1.1, -3.0, 1.4, -6.4);
    })
}

/// Greif: heavy strike craft - a manta-shaped lifting body, four drives, underslung weapon pods
fn greif() -> Built {
    craft(Pal::Union, 2, 3, |b, f| {
        slab_at(b, f.hull, &[[0.0, 9.2], [2.2, 7.2], [5.2, 0.5], [8.6, -5.4], [8.2, -8.2], [-8.2, -8.2], [-8.6, -5.4], [-5.2, 0.5], [-2.2, 7.2]], 1.5, 0.0, 0.25);
        b.ell(f.hull, 0.0, 0.6, 0.6, 2.2, 1.35, 7.4, 20);
        slab_at(b, f.dark, &[[0.0, 3.5], [4.8, -3.0], [6.6, -7.6], [-6.6, -7.6], [-4.8, -3.0]], 0.5, 1.05, 0.12);
        canopy(b, f, 0.0, 1.75, 3.6, 1.0, 0.62, 2.0);
        for sx in [-1.0f32, 1.0] {
            b.tube(f.dark, sx * 6.0, -1.35, -0.6, 0.5, 0.62, 7.2, 12);
            b.beam_z(f.dark, v(sx * 6.0, -0.9, -0.6), v(sx * 6.0, -0.2, -0.6), 0.3, 3.2);
            gun_pod(b, f, sx * 6.0, -1.35, 3.0, 1.6);
            b.tube(f.dark, sx * 2.0, -0.95, 6.4, 0.18, 0.24, 2.6, 8);
            b.tube(M::Soot, sx * 2.0, -0.95, 7.8, 0.17, 0.17, 0.25, 8);
            let rzv = if sx > 0.0 { 1.15 } else { PI - 1.15 };
            b.add(f.hull, &wing(2.6, 3.6, 1.4, 1.6, 0.25), at(sx * 6.2, 0.7, -6.4) * rz(rzv));
            b.bx_r(f.accent, 4.2, 0.07, 0.25, v(sx * 5.4, 0.78, -2.4), Quat::from_rotation_y(sx * -0.55));
            b.engine(sx * 2.4, 0.2, -8.7, 0.85);
            b.engine(sx * 5.6, 0.0, -8.6, 0.75);
            for i in 0..4 {
                b.bx(f.dark, 0.9, 0.08, 0.12, sx * (3.5 + i as f32 * 0.3), 0.8, -5.0 + i as f32 * 0.4);
            }
        }
        decals(b, f, 2.2, 0.6, 0.4, 3.4, 0.8, 0.0);
        nav_lights(b, 8.9, 0.0, -5.8, 1.9, -7.8);
    })
}

/// Dorn: Aszendenz drone - a glowing core in a thorned chitin shell
fn dorn() -> Built {
    craft(Pal::Asz, DECAL_GLYPH, 4, |b, f| {
        b.ell(f.hull, 0.0, 0.0, 0.0, 1.8, 1.5, 2.8, 18);
        b.ell(f.glow, 0.0, 0.0, 2.3, 0.65, 0.55, 0.6, 10);
        for (x, y, len) in [(0.0f32, 1.1f32, 6.2f32), (1.2, -0.8, 5.2), (-1.2, -0.8, 5.2)] {
            b.add(f.dark, &cone(0.45, len, 6), trs(v(x, y, 1.6 + len / 2.0), eul(-y * 0.05, x * 0.05, 0.0), Vec3::ONE));
        }
        for i in 0..5 {
            let a = i as f32 / 5.0 * TAU;
            b.cone_to(f.dark, 0.3, 3.2, 5, v(a.cos() * 1.5, a.sin() * 1.3, -1.6), v(a.cos() * 4.0, a.sin() * 3.6, -4.5));
        }
        for sx in [-1.0f32, 1.0] {
            b.torus(f.line, 1.75, 0.06, 4, 20, PI * 0.8, trs(v(0.0, 0.0, sx * 0.7), eul(0.0, FRAC_PI_2, sx * 0.4), Vec3::ONE));
        }
        b.tube(f.dark, 0.0, -0.5, 4.6, 0.12, 0.2, 2.6, 6);
        b.engine(0.0, 0.0, -3.2, 0.8);
        nav_lights(b, 2.2, 0.0, -0.6, 1.8, -2.2);
    })
}

/// crescent blade: arc bulging backwards, tips forward
fn crescent(b: &mut B, m: M, big_r: f32, tube_r: f32, y: f32, flat: f32, arc: f32) {
    let geo_rot = rx(-FRAC_PI_2) * rz((PI - arc) / 2.0);
    b.torus(m, big_r, tube_r, 8, 32, arc, at(0.0, y, big_r) * sc(1.0, flat, 1.0) * geo_rot);
}

/// Klinge (and Holt): a sickle-shaped blade around a slim pod
fn klinge(holt: bool) -> Built {
    craft(Pal::Asz, DECAL_GLYPH, if holt { 6 } else { 5 }, |b, f| {
        crescent(b, f.hull, 6.4, 0.75, 0.0, 0.35, PI);
        crescent(b, f.line, 6.4, 0.12, 0.28, 1.0, PI);
        if holt {
            crescent(b, f.dark, 4.6, 0.45, 1.1, 0.4, PI * 0.8);
            crescent(b, f.dark, 4.6, 0.45, -1.1, 0.4, PI * 0.8);
        }
        b.ell(f.hull, 0.0, 0.0, -0.4, 1.3, 0.95, 4.0, 18);
        b.ell(f.canopy, 0.0, 0.55, 1.4, 0.6, 0.4, 1.3, 12);
        b.add(f.dark, &cone(0.35, 3.4, 5), at(0.0, 0.9, -2.6) * ry(PI));
        for sx in [-1.0f32, 1.0] {
            b.cone_z(f.dark, 0.45, 2.4, 6, v(sx * 6.4, 0.0, 7.2));
            gun_pod(b, f, sx * 6.4, -0.35, 6.2, 1.2);
            b.beam_z(f.dark, v(sx * 1.1, 0.0, -0.6), v(sx * 5.4, 0.0, -2.6), 0.25, 0.9);
            b.engine(sx * 0.75, 0.0, -4.4, 0.62);
        }
        decals(b, f, 1.32, 0.0, -0.6, 2.4, 0.9, 0.0);
        nav_lights(b, 7.3, 0.0, 6.0, 1.2, -3.8);
    })
}

/// Hammer: Aszendenz bomber - a broad hammerhead on a long spine, twin drives, fusion-charge pod
fn hammer() -> Built {
    craft(Pal::Asz, DECAL_GLYPH, 7, |b, f| {
        b.ell(f.hull, 0.0, 0.0, 6.2, 5.6, 1.35, 2.2, 20);
        b.ell(f.line, 0.0, 0.0, 7.9, 4.2, 0.25, 0.3, 12);
        b.ell(f.hull, 0.0, 0.0, -1.2, 1.7, 1.5, 7.2, 18);
        b.ell(f.dark, 0.0, -1.45, 0.6, 1.1, 0.9, 3.6, 12);
        b.ell(f.glow, 0.0, -1.9, 0.6, 0.4, 0.3, 2.2, 8);
        b.ell(f.canopy, 0.0, 1.1, 4.8, 0.8, 0.45, 1.1, 12);
        for sx in [-1.0f32, 1.0] {
            b.ell(f.dark, sx * 5.4, 0.0, 6.6, 0.9, 0.9, 1.2, 10);
            gun_pod(b, f, sx * 5.2, -0.3, 7.4, 1.4);
            b.tube(f.hull, sx * 2.7, 0.0, -5.4, 0.85, 1.05, 5.5, 14);
            b.beam_z(f.dark, v(sx * 1.2, 0.0, -4.2), v(sx * 2.4, 0.0, -4.8), 0.3, 2.6);
            b.engine(sx * 2.7, 0.0, -8.6, 0.95);
            for i in 0..3 {
                let i = i as f32;
                b.cone_y(f.dark, 0.25, 1.8 - i * 0.3, 5, v(sx * (1.5 + i * 1.1), 1.0, 6.6 - i * 0.2), eul(-0.5, 0.0, -sx * 0.4));
            }
        }
        for i in 0..4 {
            let i = i as f32;
            b.cone_y(f.dark, 0.28, 2.0 - i * 0.3, 5, v(0.0, 1.6, 1.5 - i * 2.2), eul(-0.6, 0.0, 0.0));
        }
        nav_lights(b, 6.4, 0.0, 6.0, 1.8, -8.0);
    })
}

/// Archon: the ace's craft - a gilded trident with swept fins and three drives
fn archon() -> Built {
    craft(Pal::Ace, DECAL_GLYPH, 8, |b, f| {
        b.ell(f.hull, 0.0, 0.0, 0.0, 1.4, 1.0, 6.6, 20);
        b.cone_z(f.dark, 0.7, 7.0, 6, v(0.0, 0.0, 9.4));
        b.ell(f.canopy, 0.0, 0.75, 2.6, 0.7, 0.45, 1.5, 12);
        for sx in [-1.0f32, 1.0] {
            b.cone_z(f.dark, 0.5, 6.4, 6, v(sx * 4.2, 0.0, 6.6));
            b.beam_z(f.hull, v(sx * 1.2, 0.0, 1.2), v(sx * 4.2, 0.0, 3.4), 0.35, 2.2);
            gun_pod(b, f, sx * 4.2, -0.4, 4.4, 1.2);
            b.add(f.hull, &wing(5.2, 4.6, 1.2, 4.2, 0.3), trs(v(sx * 1.1, 0.0, -3.4), Quat::from_rotation_z(sx * -0.25), v(sx, 1.0, 1.0)));
            b.bx_r(f.accent, 4.0, 0.08, 0.3, v(sx * 3.4, 0.25, -4.6), Quat::from_rotation_y(sx * -0.7));
            b.engine(sx * 1.05, 0.0, -6.8, 0.6);
        }
        b.torus(f.accent, 1.5, 0.12, 6, 20, TAU, at(0.0, 0.0, -1.0) * sc(1.0, 0.7, 1.0));
        b.add(f.accent, &wing(2.4, 3.6, 0.8, 2.4, 0.25), at(0.0, 0.8, -3.6) * rz(FRAC_PI_2));
        b.engine(0.0, 0.5, -7.0, 0.7);
        decals(b, f, 1.42, 0.0, 0.0, 2.6, 0.9, 0.0);
        nav_lights(b, 6.4, 0.0, -6.8, 2.6, -5.6);
    })
}

/// Schwinge: the one-winged gunship - a single great curved sail to starboard with the main gun at its tip
fn schwinge() -> Built {
    craft(Pal::Asz, DECAL_GLYPH, 9, |b, f| {
        b.ell(f.hull, 0.0, 0.0, 0.0, 1.5, 1.2, 5.6, 20);
        b.ell(f.canopy, -0.2, 0.75, 2.4, 0.65, 0.45, 1.4, 12);
        b.cone_z(f.dark, 0.55, 3.2, 8, v(0.0, 0.0, 6.8));
        // the sail: a thin crescent from the pod's shoulder up and out
        let mut outline: Vec<Vec2> = Vec::new();
        for p in bezier2(v(0.0, -3.5, 0.0), v(3.5, -1.5, 0.0), v(8.4, 4.8, 0.0), 10) {
            outline.push(p.truncate());
        }
        outline.push(Vec2::new(8.9, 6.6));
        for p in bezier2(v(8.9, 6.6, 0.0), v(4.2, 2.6, 0.0), v(0.2, 2.8, 0.0), 10).into_iter().skip(1) {
            outline.push(p.truncate());
        }
        let sail = prism(&outline, 0.45, 0.15, 0.2, 35.0);
        b.add(M::Sail, &sail, at(0.8, 0.4, 0.0) * rz(0.95) * at(0.0, 0.22, 0.0) * rx(FRAC_PI_2));
        // glowing veins along both edges, one on each face
        let (c95, s95) = (0.95f32.cos(), 0.95f32.sin());
        let w = |t: f32, x: f32, y: f32| v(x * c95 - t * s95 + 0.8, x * s95 + t * c95 + 0.4, y);
        for t in [0.62f32, -0.63] {
            for (p0, c, p1) in [((0.0, -3.5), (3.5, -1.5), (8.4, 4.8)), ((0.2, 2.8), (4.2, 2.6), (8.9, 6.6))] {
                let pts = bezier2(w(t, p0.0, p0.1), w(t, c.0, c.1), w(t, p1.0, p1.1), 16);
                b.add(f.line, &sweep(&pts, 0.2, 6, false), Affine3A::IDENTITY);
            }
        }
        gun_pod(b, f, 6.0, 6.0, 4.6, 1.4);
        b.ell(f.dark, 6.0, 6.0, 4.4, 0.55, 0.55, 1.4, 10);
        b.add(f.dark, &cone(0.3, 2.6, 6), at(6.2, 6.4, 2.0) * ry(PI));
        b.beam_z(f.dark, v(-1.2, -0.2, -2.2), v(-3.4, -0.9, -2.6), 0.3, 2.2);
        b.tube(f.hull, -3.6, -0.9, -2.4, 0.6, 0.75, 4.6, 12);
        b.engine(-3.6, -0.9, -4.9, 0.6);
        b.engine(0.3, 0.0, -6.2, 0.85);
        b.tube(f.dark, 0.0, -0.6, 4.6, 0.12, 0.18, 2.4, 6);
        for i in 0..3 {
            let i = i as f32;
            b.cone_y(f.dark, 0.22, 1.5 - i * 0.3, 5, v(-0.3, 1.1, 0.5 - i * 1.6), eul(-0.6, 0.0, 0.0));
        }
        decals(b, f, 1.52, 0.0, -0.5, 2.4, 0.9, 0.0);
        b.light(6.5, 6.8, 4.0, GREEN, 1.1, 0.5, 1.8);
        b.light(-4.3, -0.9, -2.4, RED, 1.1, 0.0, 1.8);
        b.light(0.0, 1.4, -5.6, STROBE, 0.8, 0.25, 2.2);
    })
}

/// Kurier: a fast, unarmed courier - a long capsule with a stabiliser ring and two big drives
fn kurier() -> Built {
    craft(Pal::Asz, DECAL_GLYPH, 10, |b, f| {
        b.ell(f.hull, 0.0, 0.0, 0.0, 2.6, 2.2, 11.0, 22);
        b.ell(f.canopy, 0.0, 1.1, 7.4, 1.1, 0.8, 2.2, 12);
        b.torus(f.dark, 4.2, 0.45, 8, 32, TAU, at(0.0, 0.0, -3.5));
        b.torus(f.line, 4.2, 0.1, 4, 32, TAU, at(0.0, 0.0, -3.1));
        for a in [0.0f32, FRAC_PI_2, PI, PI * 1.5] {
            b.beam_z(f.dark, v(a.cos() * 2.2, a.sin() * 1.9, -3.5), v(a.cos() * 4.0, a.sin() * 4.0, -3.5), 0.35, 1.4);
        }
        for sx in [-1.0f32, 1.0] {
            b.engine(sx * 1.5, 0.0, -11.4, 1.25);
        }
        decals(b, f, 2.62, 0.0, 1.0, 4.0, 1.2, 0.0);
        nav_lights(b, 4.6, 0.0, -3.5, 2.4, -10.0);
    })
}

// ---------------------------------------------------------------------------
// Capital ships
// ---------------------------------------------------------------------------

struct C {
    hull: M,
    tank: M,
    dark: M,
    glow: M,
    accent: M,
    strip: M,
}

fn cmats(cp: Cp) -> C {
    C { hull: M::CHull(cp), tank: M::CTank(cp), dark: M::CDark(cp), glow: M::CGlow(cp), accent: M::CAccent(cp), strip: M::CStrip(cp) }
}

/// launch / landing tunnel of the TUS Aurora in carrier coordinates (centre line, half width / height)
pub struct Bay {
    pub y: f32,
    pub back: f32,
    pub mouth: f32,
    pub hw: f32,
    pub hh: f32,
}
pub const BAY: Bay = Bay { y: -23.5, back: 30.0, mouth: 142.0, hw: 12.0, hh: 4.5 };

const SAUCER: [(f32, f32); 14] = [
    (0.01, 11.0), (14.0, 10.8), (30.0, 9.8), (50.0, 8.0), (75.0, 5.6), (96.0, 3.0), (106.0, 1.2), (110.0, -0.4), (107.0, -2.2), (92.0, -3.8), (66.0, -5.6), (38.0, -7.2), (16.0, -8.2), (0.01, -8.6),
];
/// saucer surface height at radius r (top or bottom side)
fn saucer_y(r: f32, top: bool) -> f32 {
    let pts: Vec<(f32, f32)> = if top { SAUCER[..8].to_vec() } else { SAUCER[7..].iter().rev().copied().collect() };
    for i in 1..pts.len() {
        if r <= pts[i].0 {
            let ((r0, y0), (r1, y1)) = (pts[i - 1], pts[i]);
            return y0 + (y1 - y0) * ((r - r0) / (r1 - r0));
        }
    }
    pts[pts.len() - 1].1
}

const SC_Y: f32 = 12.0;
const SC_Z: f32 = 100.0;
const SC_K: f32 = 1.08;

/// TUS Aurora / Valkyrie: explorer-style carrier - saucer on a swept neck above a long drive hull whose
/// bow holds the flyable hangar, two warp nacelles on pylons, lit windows, registry, nav lights.
fn carrier(wreck: bool) -> Built {
    let cp = if wreck { Cp::Wreck } else { Cp::Union };
    let c = cmats(cp);
    let mut b = B::new(Eng { dark: c.dark, throat: M::Throat(cp), small: false }, if wreck { 31 } else { 30 });
    b.out.turret_mat = Some(c.dark);
    let coil = if wreck { c.dark } else { M::Coil };
    let intake = if wreck { M::Soot } else { M::Intake };
    let glow = if wreck { c.strip } else { c.glow };
    let drv = |b: &mut B, x: f32, y: f32, z: f32, r: f32| {
        if wreck {
            b.tube(c.dark, x, y, z, r, r * 0.8, r * 2.2, 16);
            b.tube(M::Soot, x, y, z - r * 1.1, r * 0.95, r * 0.95, r * 0.6, 16);
        } else {
            b.engine(x, y, z, r);
        }
    };
    let lamp = |b: &mut B, x: f32, y: f32, z: f32, col: u8, rate: f32, phase: f32, size: f32| {
        if !wreck {
            b.light(x, y, z, col, rate, phase, size);
        }
    };
    // --- saucer: uv round the disc and along ln(r), so plates keep their shape towards the hub
    let k_uv = 60.0 * 10.0 / TAU;
    let rim_log = 110f32.ln();
    let uvf = move |r: f32, h: f32, ph: f32| -> Vec2 {
        let rr = r.max(14.0);
        let top = h > -0.4;
        Vec2::new(ph * k_uv, k_uv * if top { rr.ln() } else { 2.0 * rim_log - rr.ln() })
    };
    let saucer = lathe(&SAUCER, 96, LatheAxis::Y, LatheUv::Custom(&uvf), false);
    b.add(c.hull, &saucer, at(0.0, SC_Y, SC_Z) * sc(1.0, 1.0, SC_K));
    let flat = |y: f32| trs(v(0.0, y, SC_Z), Quat::from_rotation_x(FRAC_PI_2), v(1.0, SC_K, 1.0));
    b.torus(c.dark, 109.0, 1.1, 6, 120, TAU, flat(SC_Y - 0.4));
    b.torus(c.strip, 103.0, 0.35, 4, 120, TAU, flat(SC_Y + 2.1));
    for r in [42.0f32, 74.0] {
        b.torus(c.dark, r, 0.3, 4, 96, TAU, flat(SC_Y + saucer_y(r, true) + 0.2));
    }
    // command deck: low dome with a window band and a sensor mast
    b.add(c.hull, &ellipsoid(v(15.0, 4.2, 15.0 * SC_K), 32, 10, FRAC_PI_2, true), at(0.0, SC_Y + 10.8, SC_Z));
    b.torus(c.strip, 13.4, 0.35, 4, 48, TAU, flat(SC_Y + 12.6));
    b.cyl_y(c.dark, 0.0, SC_Y + 19.0, SC_Z - 4.0, 0.4, 0.7, 9.0, 6);
    b.cyl_y(c.dark, 0.0, SC_Y + 15.2, SC_Z - 4.0, 4.5, 4.5, 0.8, 16);
    // sensor array and impulse deck at the saucer's rear edge
    b.add(c.dark, &ellipsoid(v(9.0, 3.0, 9.0), 24, 8, FRAC_PI_2, true), at(0.0, SC_Y - 8.4, SC_Z + 40.0) * rx(PI));
    let rear = SC_Z - SC_K * 104.0;
    b.bx(c.dark, 40.0, 6.5, 14.0, 0.0, SC_Y + 3.5, rear + 9.0);
    for ex in [-11.0f32, 11.0] {
        drv(&mut b, ex, SC_Y + 3.5, rear + 1.6, 3.2);
    }
    b.bx(c.strip, 34.0, 1.2, 1.2, 0.0, SC_Y + 6.9, rear + 3.0);
    // registry across the saucer top
    let reg = M::Registry(if wreck { 1 } else { 0 });
    for sz in [1.0f32, -1.0] {
        let r0 = 62.0;
        let slope = (saucer_y(r0 - 15.0, true) - saucer_y(r0 + 15.0, true)).atan2(30.0);
        let p = v(0.0, SC_Y + saucer_y(r0, true) + 0.35, SC_Z + sz * r0 * SC_K);
        b.add(reg, &plane(76.0, 12.0), trs(p, eul(-FRAC_PI_2 + sz * slope, 0.0, if sz > 0.0 { 0.0 } else { PI }), Vec3::ONE));
    }
    // --- neck: a swept fin joining the saucer to the drive hull
    let neck = [Vec2::new(-40.0, -2.0), Vec2::new(78.0, -2.0), Vec2::new(58.0, 8.0), Vec2::new(6.0, 8.0)];
    b.add(c.hull, &prism(&neck, 14.0, 1.5, 1.5, 20.0), at(7.0, -1.0, 0.0) * ry(-FRAC_PI_2));
    for sx in [-1.0f32, 1.0] {
        b.bx(c.strip, 0.4, 1.0, 60.0, sx * 8.7, 3.0, 20.0);
    }
    // --- drive hull, open at the bow for the hangar
    const HY: f32 = -22.0;
    const HS: f32 = 0.85;
    let drive_prof: [(f32, f32); 9] = [(0.01, -176.0), (9.0, -174.0), (15.0, -165.0), (20.0, -150.0), (23.5, -120.0), (24.0, -60.0), (24.0, 60.0), (23.4, 118.0), (22.2, 142.0)];
    let hull_r = |z: f32| -> f32 {
        for i in 1..drive_prof.len() {
            if z <= drive_prof[i].1 {
                let ((r0, z0), (r1, z1)) = (drive_prof[i - 1], drive_prof[i]);
                return r0 + (r1 - r0) * ((z - z0) / (z1 - z0));
            }
        }
        22.2
    };
    b.add(c.hull, &lathe(&drive_prof, 64, LatheAxis::Z, LatheUv::Swap, false), at(0.0, HY, 0.0) * sc(1.0, HS, 1.0));
    // bow plate round the hangar mouth: an elliptic ring around the rectangular opening
    let bay = &BAY;
    let (len, mid) = (bay.mouth - bay.back, (bay.mouth + bay.back) / 2.0);
    {
        let hy = bay.y - HY;
        let (hw, hh) = (bay.hw + 1.0, bay.hh + 1.0);
        let (ra, rb) = (22.4f32, 22.4 * HS);
        let n = 64;
        let mut g = Geo::default();
        let mut outer = Vec::with_capacity(n);
        let mut inner = Vec::with_capacity(n);
        for i in 0..n {
            let a = i as f32 / n as f32 * TAU;
            let d = Vec2::new(a.cos(), a.sin());
            // ray from the hole centre to the ellipse
            let (o, dd) = (Vec2::new(0.0, hy), d);
            let (qa, qb, qc) = (dd.x * dd.x / (ra * ra) + dd.y * dd.y / (rb * rb), 2.0 * (o.x * dd.x / (ra * ra) + o.y * dd.y / (rb * rb)), o.x * o.x / (ra * ra) + o.y * o.y / (rb * rb) - 1.0);
            let t = (-qb + (qb * qb - 4.0 * qa * qc).max(0.0).sqrt()) / (2.0 * qa);
            outer.push(o + dd * t);
            let ti = (hw / dd.x.abs().max(1e-4)).min(hh / dd.y.abs().max(1e-4));
            inner.push(o + dd * ti);
        }
        for (z, nz) in [(0.0f32, -1.0f32), (4.0, 1.0)] {
            let base = g.vcount() as u32;
            for i in 0..n {
                g.vert(outer[i].extend(z), Vec3::Z * nz, outer[i]);
                g.vert(inner[i].extend(z), Vec3::Z * nz, inner[i]);
            }
            for i in 0..n as u32 {
                let j = (i + 1) % n as u32;
                g.quad(base + i * 2, base + j * 2, base + j * 2 + 1, base + i * 2 + 1);
            }
        }
        for (ring_pts, outer_wall) in [(&outer, true), (&inner, false)] {
            let base = g.vcount() as u32;
            for i in 0..=n {
                let p = ring_pts[i % n];
                // outer wall: ellipse gradient; hole wall: towards the opening's centre line
                let nn = if outer_wall {
                    Vec2::new(p.x / (ra * ra), p.y / (rb * rb)).normalize_or(Vec2::Y)
                } else {
                    let d = p - Vec2::new(0.0, hy);
                    if d.x.abs() / hw > d.y.abs() / hh { Vec2::new(-d.x.signum(), 0.0) } else { Vec2::new(0.0, -d.y.signum()) }
                };
                g.vert(p.extend(0.0), nn.extend(0.0), Vec2::new(i as f32 * 2.0, 0.0));
                g.vert(p.extend(4.0), nn.extend(0.0), Vec2::new(i as f32 * 2.0, 4.0));
            }
            for i in 0..n as u32 {
                g.quad(base + i * 2, base + i * 2 + 2, base + i * 2 + 3, base + i * 2 + 1);
            }
        }
        g.fix_winding();
        b.add(c.dark, &g, at(0.0, HY, bay.mouth - 3.0));
    }
    let bow_ring = |z: f32| at(0.0, HY, z) * sc(1.0, HS, 1.0);
    b.torus(c.accent, 22.6, 0.8, 6, 64, TAU, bow_ring(bay.mouth + 0.6));
    b.torus(c.strip, 19.0, 0.35, 4, 64, TAU, bow_ring(bay.mouth + 1.15));
    // hangar tunnel: a real, flyable launch / landing bay
    let (by, hw, hh) = (bay.y, bay.hw, bay.hh);
    b.bx(c.dark, hw * 2.0 + 10.0, 2.0, len, 0.0, by - hh - 1.0, mid);
    b.bx(c.dark, hw * 2.0 + 10.0, 2.0, len, 0.0, by + hh + 1.0, mid);
    for sx in [-1.0f32, 1.0] {
        b.bx(c.tank, 5.0, hh * 2.0 + 4.0, len, sx * (hw + 2.5), by, mid);
    }
    b.bx(c.dark, hw * 2.0, hh * 2.0, 2.0, 0.0, by, bay.back);
    let mut z = bay.back + 8.0;
    while z < bay.mouth - 4.0 {
        b.bx(M::BayGlow, 7.0, 0.3, 2.6, 0.0, by + hh - 0.2, z);
        z += 10.0;
    }
    let mut z = bay.back + 6.0;
    while z < bay.mouth {
        for sx in [-1.0f32, 1.0] {
            b.bx(c.strip, 0.8, 0.25, 2.2, sx * 6.0, by - hh + 0.15, z);
        }
        z += 6.0;
    }
    for sx in [-1.0f32, 1.0] {
        b.bx(M::BayBand, 0.3, 0.5, len - 4.0, sx * (hw - 0.05), by + 1.5, mid);
    }
    b.bx(glow, hw * 2.0, 0.7, 0.7, 0.0, by + hh - 0.4, bay.mouth);
    b.bx(glow, hw * 2.0, 0.7, 0.7, 0.0, by - hh + 0.4, bay.mouth);
    for sx in [-1.0f32, 1.0] {
        b.bx(glow, 0.7, hh * 2.0, 0.7, sx * (hw - 0.4), by, bay.mouth);
    }
    if !wreck {
        for (i, m) in [M::BayRed, M::BayAmber, M::BayGreen].into_iter().enumerate() {
            b.bx(m, 2.2, 1.2, 0.6, (i as f32 - 1.0) * 3.2, by + hh - 1.6, bay.mouth - 2.0);
        }
        b.add(M::BayField, &plane(hw * 2.0 - 1.0, hh * 2.0 - 1.0), at(0.0, by, bay.mouth - 0.5));
        for z in [bay.back + 16.0, bay.back + 52.0] {
            for sx in [-1.0f32, 1.0] {
                b.bx(c.dark, 2.4, 1.2, 5.0, sx * 2.6, by - hh + 0.6, z);
                b.bx(M::Clamp, 2.0, 0.25, 4.2, sx * 2.6, by - hh + 1.25, z);
            }
        }
    }
    // drive hull detail: rails, flank coils, stern drives
    b.bx(c.dark, 6.0, 3.0, 200.0, 0.0, HY + 24.0 * HS + 0.6, -40.0);
    b.bx(c.dark, 8.0, 3.0, 160.0, 0.0, HY - 24.0 * HS - 0.6, -10.0);
    for sx in [-1.0f32, 1.0] {
        b.bx(coil, 0.6, 1.0, 230.0, sx * 24.1, HY + 4.0, -20.0);
    }
    b.bx(c.dark, 24.0, 17.0, 12.0, 0.0, HY, -172.0);
    for ex in [-6.5f32, 6.5] {
        drv(&mut b, ex, HY, -180.0, 5.2);
    }
    // --- warp nacelles on swept pylons
    let nac: [(f32, f32); 8] = [(0.01, -98.0), (5.5, -98.0), (8.4, -94.0), (9.2, -80.0), (9.2, 70.0), (8.4, 84.0), (6.5, 92.0), (0.01, 95.0)];
    let nac_geo = lathe(&nac, 32, LatheAxis::Z, LatheUv::Swap, false);
    let pylon_geo = prism(&[Vec2::new(0.0, 0.0), Vec2::new(56.0, 0.0), Vec2::new(44.0, 24.0), Vec2::new(16.0, 24.0)], 4.0, 1.0, 1.0, 20.0);
    let pylon_local = at(2.0, 0.0, -28.0) * ry(-FRAC_PI_2);
    for sx in [-1.0f32, 1.0] {
        let (nx, ny, nz) = (sx * 64.0, 16.0, -102.0);
        let torn = wreck && sx > 0.0;
        let cp0 = b.checkpoint();
        let nozzles0 = b.out.nozzles.len();
        b.add(c.tank, &nac_geo, at(nx, ny, nz));
        b.add(intake, &ellipsoid(v(7.4, 6.2, 7.4), 24, 12, FRAC_PI_2, true), at(nx, ny, nz + 89.0) * rx(FRAC_PI_2));
        b.torus(c.dark, 8.9, 0.8, 6, 32, TAU, at(nx, ny, nz + 88.5));
        b.bx(coil, 1.2, 5.2, 140.0, nx - sx * 9.05, ny, nz - 6.0);
        b.bx_r(coil, 1.2, 5.2, 140.0, v(nx, ny - 9.05, nz - 6.0), Quat::from_rotation_z(FRAC_PI_2));
        b.bx(c.dark, 3.0, 1.4, 150.0, nx, ny + 9.2, nz);
        drv(&mut b, nx, ny, nz - 98.0, 6.0);
        lamp(&mut b, nx + sx * 9.5, ny, nz + 60.0, if sx < 0.0 { GREEN } else { RED }, 0.9, if sx < 0.0 { 0.5 } else { 0.0 }, 6.0);
        if torn {
            // ripped off its pylon: tumbling beside the hull
            let piv = v(nx, ny, nz);
            let q = eul(0.5, 0.35, 1.1);
            let off = v(55.0, -48.0, -40.0);
            let xf = Affine3A::from_translation(piv + off) * Affine3A::from_quat(q) * Affine3A::from_translation(-piv);
            b.move_since(&cp0, &xf);
            b.out.nozzles.truncate(nozzles0);
        }
        let a = v(sx * 16.0, HY + 8.0, nz);
        let bb = v(nx, ny, nz);
        let sy = a.distance(bb) / 24.0 * if torn { 0.42 } else { 1.0 };
        let rot = Quat::from_rotation_z(-(bb.x - a.x).atan2(bb.y - a.y));
        b.add(c.hull, &pylon_geo, trs(a, rot, v(1.0, sy, 1.0)) * pylon_local);
        if torn {
            for i in 0..5 {
                let fi = i as f32;
                let p = a + (bb - a) * 0.42;
                b.bx_r(c.dark, 1.5 + (i % 3) as f32, 2.0 + ((i * 7) % 5) as f32, 6.0 + ((i * 13) % 14) as f32, v(p.x, p.y + 2.0, nz - 20.0 + fi * 10.0), eul(fi * 0.7, fi * 1.3, fi * 0.4));
            }
        }
    }
    // strobes on the rim and stern, red beacon on the mast, port/starboard at the saucer's edge
    lamp(&mut b, 0.0, SC_Y, SC_Z + 110.0 * SC_K, STROBE, 1.1, 0.1, 7.0);
    lamp(&mut b, 0.0, SC_Y + 24.0, SC_Z - 4.0, BEACON, 0.6, 0.3, 6.0);
    lamp(&mut b, 0.0, HY + 10.0, -180.0, STROBE, 1.1, 0.6, 7.0);
    for sx in [-1.0f32, 1.0] {
        lamp(&mut b, sx * 110.0, SC_Y - 0.4, SC_Z, if sx < 0.0 { GREEN } else { RED }, 0.9, if sx < 0.0 { 0.5 } else { 0.0 }, 6.0);
    }
    // lit windows round the saucer rim and along the drive hull's flanks
    let (ca, cb) = if wreck { ([0.9, 0.32, 0.1], [0.5, 0.08, 0.05]) } else { ([2.4, 1.9, 1.15], [1.2, 1.9, 2.6]) };
    let gone = if wreck { 0.86 } else { 0.3 };
    let mut wg = Geo::default();
    let mut quad = |rng: &mut Rng, p0: Vec3, n: Vec3, t: Vec3, w: f32, h: f32| {
        let bt = n.cross(t).normalize();
        let col: [f32; 3] = if rng.f() < 0.15 { cb } else { ca };
        let dim = 0.55 + rng.f() * 0.45;
        let c4 = [col[0] * dim, col[1] * dim, col[2] * dim, 1.0];
        let base = wg.vcount() as u32;
        for (a, bb) in [(-1.0f32, -1.0f32), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)] {
            wg.vert(p0 + t * (a * w) + bt * (bb * h) + n * 0.18, n, Vec2::ZERO);
            wg.col.push(c4);
        }
        wg.quad(base, base + 1, base + 2, base + 3);
    };
    for (r, top) in [(100.0f32, true), (93.0, true), (86.0, true), (102.0, false), (94.0, false), (80.0, false), (56.0, false)] {
        let n = (r * 1.6).round() as usize;
        for i in 0..n {
            if b.rng.f() < gone {
                continue;
            }
            let a = i as f32 / n as f32 * TAU;
            let (sa, ca_) = a.sin_cos();
            if !top && r > 90.0 && (sa * r).abs() < 20.0 && ca_ < 0.0 {
                continue; // over the neck
            }
            let p0 = v(sa * r, SC_Y + saucer_y(r, top), SC_Z + ca_ * r * SC_K);
            let nn = v(sa * 0.55, if top { 0.85 } else { -0.85 }, ca_ * 0.55).normalize();
            let t = v(ca_, 0.0, -sa);
            quad(&mut b.rng, p0, nn, t, 1.0, 0.45);
        }
    }
    for th in [0.35f32, 0.6, -0.15, -0.4, 2.8, 2.55, 3.3, 3.55] {
        let mut z = -150.0;
        while z < 128.0 {
            if b.rng.f() >= gone {
                let r = hull_r(z) + 0.15;
                let (cx, cy) = (th.cos(), th.sin());
                let p0 = v(cx * r, HY + cy * r * HS, z);
                let nn = v(cx, cy / HS, 0.0).normalize();
                quad(&mut b.rng, p0, nn, Vec3::Z, 0.55, 0.4);
            }
            z += 3.6;
        }
    }
    b.add(M::Windows, &wg, Affine3A::IDENTITY);
    if wreck {
        wreck_damage(&mut b, c.dark);
    }
    b.out
}

/// Battle damage on the Valkyrie: burnt breach in the saucer, bent plating, embers, drifting debris.
fn wreck_damage(b: &mut B, dark: M) {
    let mut seed: u64 = 7;
    let mut rnd = move || {
        seed = (seed * 16807) % 2147483647;
        seed as f32 / 2147483647.0
    };
    let a0 = 1.9f32;
    let rr = 72.0;
    let (hx, hz) = (a0.sin() * rr, SC_Z + a0.cos() * rr * SC_K);
    let jag = |b: &mut B, rad: Vec2, jit: f32, lift: f32, top: bool, m: M, rnd: &mut dyn FnMut() -> f32| {
        let jk: Vec<f32> = (0..32).map(|_| 1.0 + (rnd() - 0.5) * jit).collect();
        let mut g = Geo::default();
        let (rings, segs) = (6, 32);
        for j in 0..=rings {
            let rf = j as f32 / rings as f32;
            for i in 0..=segs {
                let a = i as f32 / segs as f32 * TAU;
                let k = 1.0 + (jk[i % segs] - 1.0) * rf;
                let (mut wx, mut wz) = (hx + a.cos() * rf * k * rad.x, hz + a.sin() * rf * k * rad.y);
                let (rx_, rz_) = (wx, (wz - SC_Z) / SC_K);
                let r0 = (rx_ * rx_ + rz_ * rz_).sqrt();
                if r0 > 106.0 {
                    wx = rx_ / r0 * 106.0;
                    wz = SC_Z + rz_ / r0 * 106.0 * SC_K;
                }
                let y = SC_Y + saucer_y(r0.min(106.0), top) + if top { lift } else { -lift };
                g.vert(v(wx, y, wz), if top { Vec3::Y } else { Vec3::NEG_Y }, Vec2::new(wx, wz));
            }
        }
        let w = segs as u32 + 1;
        for j in 0..rings as u32 {
            for i in 0..segs as u32 {
                let a = j * w + i;
                g.quad(a, a + 1, a + w + 1, a + w);
            }
        }
        g.fix_winding();
        b.add(m, &g, Affine3A::IDENTITY);
    };
    for top in [true, false] {
        jag(b, Vec2::new(40.0, 30.0), 0.5, 0.25, top, M::Soot, &mut rnd);
        jag(b, Vec2::new(28.0, 20.0), 0.6, 0.45, top, M::Ember, &mut rnd);
        jag(b, Vec2::new(25.0, 17.0), 0.55, 0.6, top, M::Hole, &mut rnd);
    }
    for _ in 0..26 {
        let a = a0 + (rnd() - 0.5) * 0.7;
        let r = rr + (rnd() - 0.5) * 40.0;
        let (w, h, d) = (3.0 + rnd() * 9.0, 0.8 + rnd() * 1.5, 3.0 + rnd() * 10.0);
        let p = v(a.sin() * r, SC_Y + (rnd() - 0.3) * 14.0, SC_Z + a.cos() * r * SC_K);
        let q = eul(rnd() * 2.5, rnd() * 3.0, rnd() * 2.5);
        b.bx_r(dark, w, h, d, p, q);
    }
    for i in 0..14 {
        let a = a0 + (rnd() - 0.5) * 0.6;
        let r = rr + (rnd() - 0.5) * 30.0;
        let s = v(1.0 + rnd() * 2.0, 1.0 + rnd() * 2.0, 1.0 + rnd() * 2.0);
        let p = v(a.sin() * r, SC_Y + (rnd() - 0.5) * 10.0, SC_Z + a.cos() * r * SC_K);
        b.bx(if i % 3 != 0 { M::Ember } else { M::Burn }, s.x, s.y, s.z, p.x, p.y, p.z);
    }
    for _ in 0..12 {
        let s = v(1.0 + rnd() * 2.0, 1.0 + rnd() * 2.0, 1.0 + rnd() * 2.0);
        let p = v((rnd() - 0.5) * 40.0, -22.0 + (rnd() - 0.5) * 30.0, -150.0 + rnd() * 280.0);
        b.bx(M::Ember, s.x, s.y, s.z, p.x, p.y, p.z);
    }
    for _ in 0..18 {
        let (w, h, l) = (2.0 + rnd() * 10.0, 1.0 + rnd() * 4.0, 3.0 + rnd() * 16.0);
        let p = v((rnd() - 0.5) * 300.0, (rnd() - 0.5) * 120.0, (rnd() - 0.5) * 420.0);
        let q = eul(rnd() * 3.0, rnd() * 3.0, rnd() * 3.0);
        b.bx_r(dark, w, h, l, p, q);
    }
}

/// organic Aszendenz capital parameters
struct AszOpt {
    a: f32,
    b: f32,
    c: f32,
    prow: f32,
    ribs: &'static [f32],
    rib_r: f32,
    blade: f32,
    spines: usize,
    crown: bool,
    eng: &'static [(f32, f32)],
    eng_r: f32,
}

/// Organic capital: ellipsoid hull, ventral carapace, lance prow, rib cage, curved blades, spines, veins.
fn asz(b: &mut B, c: &C, o: &AszOpt) {
    let (a, bb, cc) = (o.a, o.b, o.c);
    b.ell(c.hull, 0.0, 0.0, 0.0, a, bb, cc, 48);
    b.ell(c.dark, 0.0, -bb * 0.35, -cc * 0.05, a * 0.8, bb * 0.75, cc * 0.9, 32);
    if o.prow > 0.0 {
        b.cone_z(c.dark, a * 0.32, o.prow * 2.0, 14, v(0.0, 0.0, cc * 0.86 + o.prow));
    }
    b.ell(c.glow, 0.0, bb * 0.1, cc * 0.9, a * 0.18, bb * 0.16, cc * 0.05, 14);
    for &z in o.ribs {
        let k = (1.0 - (z / cc).powi(2)).max(0.1).sqrt();
        let rr = o.rib_r * k + a * 0.15;
        let xf = trs(v(0.0, -bb * 0.15, z), eul(-0.35, 0.0, -PI * 0.075), v(1.15, 1.0, 1.0));
        b.torus(c.dark, rr, a * 0.07, 8, 32, PI * 1.15, xf);
        let xf2 = trs(v(0.0, -bb * 0.15 + a * 0.05, z + a * 0.04), eul(-0.35, 0.0, -PI * 0.075), v(1.15, 1.0, 1.0));
        b.torus(c.strip, rr, a * 0.018, 4, 32, PI * 1.15, xf2);
    }
    for sx in [-1.0f32, 1.0] {
        let rzv = if sx > 0.0 { -PI * 0.05 } else { PI * 0.5 };
        b.torus(c.dark, o.blade, a * 0.12, 8, 36, PI * 0.55, trs(v(sx * a * 0.4, 0.0, -cc * 0.1), eul(FRAC_PI_2, 0.0, rzv), v(1.0, 1.0, 0.3)));
        b.bx(c.strip, a * 0.04, bb * 0.08, cc * 1.2, sx * a * 0.92, bb * 0.15, -cc * 0.05);
    }
    for i in 0..o.spines {
        let z = cc * 0.55 - (i as f32 / (o.spines.max(2) - 1) as f32) * cc * 1.2;
        let k = (1.0 - (z / cc).powi(2)).max(0.05).sqrt();
        b.cone_y(c.dark, a * 0.07, bb * (0.55 + (i % 2) as f32 * 0.35), 6, v(0.0, bb * k * 0.98 + bb * 0.2, z), eul(-0.5, 0.0, 0.0));
    }
    if o.crown {
        for z in [cc * 0.25, -cc * 0.35] {
            b.torus(c.dark, a * 1.9, a * 0.09, 8, 64, TAU, at(0.0, 0.0, z) * sc(1.0, 0.75, 1.0));
            b.torus(c.strip, a * 1.9, a * 0.025, 4, 64, TAU, at(0.0, 0.0, z + a * 0.1) * sc(1.0, 0.75, 1.0));
            for ang in [0.6f32, 2.5, 3.8, 5.6] {
                b.beam_z(c.dark, v(ang.cos() * a * 0.8, ang.sin() * bb * 0.8, z), v(ang.cos() * a * 1.9, ang.sin() * a * 1.42, z), a * 0.06, a * 0.12);
            }
        }
    }
    b.ell(c.dark, 0.0, 0.0, -cc * 0.95, a * 0.55, bb * 0.55, cc * 0.12, 24);
    for &(ex, ey) in o.eng {
        b.engine(ex, ey, -cc * 1.05, o.eng_r);
    }
}

fn asz_capital(seed: u32, o: AszOpt, extra: impl FnOnce(&mut B, &C)) -> Built {
    let c = cmats(Cp::Asz);
    let mut b = B::new(Eng { dark: c.dark, throat: M::Throat(Cp::Asz), small: false }, seed);
    b.out.turret_mat = Some(c.dark);
    asz(&mut b, &c, &o);
    extra(&mut b, &c);
    b.out
}

/// Ketten: glowing prisoner cells along the flanks, chain links, the bow maw a fighter launches from
fn prison_detail(b: &mut B, c: &C) {
    for sx in [-1.0f32, 1.0] {
        for i in 0..7 {
            let z = 30.0 - i as f32 * 9.0;
            let k = (1.0 - (z / 46.0).powi(2)).max(0.1).sqrt();
            b.ell(c.dark, sx * 13.5 * k, -2.0, z, 2.4, 3.2, 3.2, 12);
            b.ell(M::Cell, sx * (13.5 * k + 2.2), -2.0, z, 0.45, 2.1, 2.1, 12);
        }
        for i in 0..7 {
            let z = 26.0 - i as f32 * 8.0;
            let hs = 12.0 * (1.0 - (6.0f32 / 14.0).powi(2) - (z / 46.0).powi(2)).max(0.0).sqrt();
            let odd = i % 2 == 1;
            b.torus(c.dark, 1.4, 0.35, 6, 14, TAU, trs(v(sx * 6.0, hs + if odd { 0.8 } else { 0.3 }, z), eul(FRAC_PI_2, if odd { FRAC_PI_2 } else { 0.0 }, 0.0), v(1.0, 1.6, 1.0)));
        }
    }
    // docking maw: a dark opening on the bow ringed by a glowing lip
    let (ea, eb, ec, mx, my, mcy) = (14.0f32, 12.0f32, 46.0f32, 7.4f32, 3.6f32, -1.2f32);
    let on_hull = |x: f32, y: f32, lift: f32| ec * (1.0 - (x / ea).powi(2) - (y / eb).powi(2)).max(0.0).sqrt() + lift;
    let mut g = Geo::default();
    let (rings, segs) = (8u32, 32u32);
    for j in 0..=rings {
        let rf = j as f32 / rings as f32;
        for i in 0..=segs {
            let a = i as f32 / segs as f32 * TAU;
            let (x, y) = (a.cos() * rf * mx, mcy + a.sin() * rf * my);
            g.vert(v(x, y, on_hull(x, y, 0.12)), Vec3::Z, Vec2::new(x, y));
        }
    }
    let w = segs + 1;
    for j in 0..rings {
        for i in 0..segs {
            let a = j * w + i;
            g.quad(a, a + 1, a + w + 1, a + w);
        }
    }
    g.fix_winding();
    add_backfaces(&mut g);
    b.add(M::Hole, &g, Affine3A::IDENTITY);
    let lip: Vec<Vec3> = (0..40)
        .map(|i| {
            let t = i as f32 / 40.0 * TAU;
            let (x, y) = (t.cos() * mx * 1.05, mcy + t.sin() * my * 1.08);
            v(x, y, on_hull(x, y, 0.2))
        })
        .collect();
    b.add(c.strip, &sweep(&lip, 0.4, 6, true), Affine3A::IDENTITY);
}

/// small Union nacelle for freighters (a plain drive)
fn freight_nacelle(b: &mut B, c: &C, x: f32, y: f32, z: f32, r: f32, len: f32) {
    b.tube(c.tank, x, y, z, r * 0.9, r, len, 18);
    b.ell(c.dark, x, y, z + len / 2.0, r * 0.9, r * 0.9, r * 0.7, 14);
    b.torus(c.strip, r * 0.95, r * 0.12, 6, 18, TAU, at(x, y, z + len / 2.0 - r * 0.3));
    b.engine(x, y, z - len / 2.0 - r * 0.3, r * 0.85);
}

fn union_capital(seed: u32, build: impl FnOnce(&mut B, &C)) -> Built {
    let c = cmats(Cp::Union);
    let mut b = B::new(Eng { dark: c.dark, throat: M::Throat(Cp::Union), small: false }, seed);
    b.out.turret_mat = Some(c.dark);
    build(&mut b, &c);
    b.out
}

/// Samariter: medical transport - command section, two long ward modules, drive section with nacelles
fn samariter() -> Built {
    union_capital(40, |b, c| {
        b.ell(c.hull, 0.0, 3.0, 34.0, 13.0, 7.5, 17.0, 32);
        b.ell(M::Bridge, 0.0, 5.4, 49.6, 4.2, 1.1, 1.4, 24);
        b.tube(c.dark, 0.0, 0.0, 0.0, 4.5, 5.0, 80.0, 16);
        for sx in [-1.0f32, 1.0] {
            b.add(c.hull, &lathe(&[(0.0, -31.0), (6.2, -31.0), (6.2, 27.0), (0.0, 27.0)], 24, LatheAxis::Z, LatheUv::Swap, false), at(sx * 10.5, 0.0, 0.0));
            b.ell(c.hull, sx * 10.5, 0.0, 27.0, 6.2, 6.2, 4.0, 20);
            b.ell(c.dark, sx * 10.5, 0.0, -31.0, 6.0, 6.0, 3.0, 20);
            for z in [-24.0f32, -6.0, 12.0] {
                b.torus(c.dark, 6.4, 0.45, 6, 28, TAU, at(sx * 10.5, 0.0, z) * sc(1.0, 1.0, 1.5));
            }
            for yy in [3.6f32, -3.0] {
                b.bx(M::Ward, 0.4, 0.6, 50.0, sx * (10.5 + 5.6), yy, -2.0);
            }
            b.bx(c.accent, 0.5, 3.6, 10.0, sx * (10.5 + 6.1), 0.0, 18.0);
            b.beam_z(c.dark, v(sx * 4.0, 0.0, 12.0), v(sx * 5.5, 0.0, 12.0), 1.4, 6.0);
            b.beam_z(c.dark, v(sx * 4.0, 0.0, -20.0), v(sx * 5.5, 0.0, -20.0), 1.4, 6.0);
            freight_nacelle(b, c, sx * 15.0, 8.0, -42.0, 3.4, 26.0);
            b.beam_z(c.hull, v(sx * 4.0, 3.0, -40.0), v(sx * 13.0, 7.5, -42.0), 1.4, 10.0);
        }
        b.bx(c.hull, 8.0, 4.0, 40.0, 0.0, 11.2, 4.0);
        b.bx(c.dark, 18.0, 14.0, 14.0, 0.0, 0.0, -44.0);
        for ex in [-5.0f32, 5.0] {
            b.engine(ex, 0.0, -52.0, 3.4);
        }
        for sx in [-1.0f32, 1.0] {
            b.add(M::Registry(2), &plane(16.0, 2.5), at(sx * (10.5 + 6.3), 0.2, 3.0) * ry(sx * FRAC_PI_2));
            b.light(sx * 17.0, 0.0, 0.0, if sx < 0.0 { GREEN } else { RED }, 0.9, if sx < 0.0 { 0.5 } else { 0.0 }, 3.0);
        }
        b.light(0.0, 14.0, 4.0, STROBE, 1.1, 0.2, 3.5);
    })
}

/// Versorger: fuel tanker - command module, truss spine with six pressure tanks, drive section
fn tanker() -> Built {
    union_capital(41, |b, c| {
        b.ell(c.hull, 0.0, 3.0, 44.0, 9.0, 7.0, 10.0, 28);
        b.ell(M::Bridge, 0.0, 5.4, 52.6, 3.4, 1.0, 1.4, 12);
        b.bx(c.dark, 5.0, 5.0, 96.0, 0.0, 0.0, 0.0);
        let mut z = -40;
        while z <= 36 {
            for sx in [-1.0f32, 1.0] {
                let y = 2.6 * if z % 16 != 0 { 1.0 } else { -1.0 };
                b.bx_r(c.dark, 0.5, 0.5, 7.0, v(sx * 2.6, y, z as f32), Quat::from_rotation_x(0.7));
            }
            z += 8;
        }
        for z in [26.0f32, 4.0, -18.0] {
            for sx in [-1.0f32, 1.0] {
                b.ell_r(c.tank, v(sx * 9.6, 0.0, z), v(9.0, 9.0, 9.6), 26, Quat::from_rotation_y(z * 0.37 + sx));
                b.torus(c.dark, 9.05, 0.4, 6, 36, TAU, at(sx * 9.6, 0.0, z) * ry(FRAC_PI_2));
                b.torus(c.accent, 9.1, 0.25, 4, 36, TAU, at(sx * 9.6, 0.0, z) * rx(FRAC_PI_2));
                b.tube(c.dark, sx * 4.0, 6.0, z, 0.6, 0.6, 18.0, 8);
            }
        }
        b.bx(c.hull, 8.0, 4.0, 50.0, 0.0, 11.6, 4.0);
        for sx in [-1.0f32, 1.0] {
            b.bx(M::Ward, 0.3, 0.4, 88.0, sx * 2.55, 0.0, 0.0);
        }
        b.bx(c.dark, 18.0, 14.0, 14.0, 0.0, 0.0, -44.0);
        for sx in [-1.0f32, 1.0] {
            freight_nacelle(b, c, sx * 14.0, 7.0, -42.0, 3.0, 22.0);
            b.beam_z(c.hull, v(sx * 4.0, 3.0, -42.0), v(sx * 12.0, 6.5, -42.0), 1.2, 8.0);
        }
        for ex in [-5.0f32, 5.0] {
            b.engine(ex, 0.0, -52.0, 3.4);
        }
        for sx in [-1.0f32, 1.0] {
            b.add(M::Registry(3), &plane(16.0, 2.5), at(sx * 4.05, 11.6, 4.0) * ry(sx * FRAC_PI_2));
            b.light(sx * 19.0, 0.0, 4.0, if sx < 0.0 { GREEN } else { RED }, 0.9, if sx < 0.0 { 0.5 } else { 0.0 }, 3.0);
        }
        b.light(0.0, 14.5, 4.0, STROBE, 1.1, 0.2, 3.5);
    })
}

/// Relaisstation: a tower with a dish, glowing rings and three struts
fn relay() -> Built {
    let c = cmats(Cp::Asz);
    let mut b = B::new(Eng { dark: c.dark, throat: M::Throat(Cp::Asz), small: false }, 50);
    b.out.turret_mat = Some(c.dark);
    b.bx(c.hull, 22.0, 104.0, 22.0, 0.0, 0.0, 0.0);
    b.bx(c.dark, 30.0, 8.0, 30.0, 0.0, -50.0, 0.0);
    b.add(c.dark, &lathe(&[(30.0, -7.0), (0.0, 7.0)], 24, LatheAxis::Y, LatheUv::Around, true), at(0.0, 60.0, 0.0) * rx(PI));
    for y in [20.0f32, -20.0] {
        b.torus(c.strip, 26.0, 1.4, 6, 48, TAU, at(0.0, y, 0.0) * rx(FRAC_PI_2));
    }
    b.ell(c.glow, 0.0, 70.0, 0.0, 6.0, 6.0, 6.0, 14);
    for a in [0.0f32, 2.1, 4.2] {
        b.bx_r(c.dark, 4.0, 4.0, 46.0, v(a.cos() * 16.0, 0.0, a.sin() * 16.0), Quat::from_rotation_y(-a));
    }
    // signal lamps on the tower
    b.light(0.0, 77.0, 0.0, BEACON, 0.6, 0.0, 8.0);
    for (i, a) in [0.0f32, 2.1, 4.2].into_iter().enumerate() {
        b.light(a.cos() * 34.0, 0.0, a.sin() * 34.0, STROBE, 0.9, i as f32 * 0.33, 5.0);
    }
    b.out
}

/// Ring stations: Brutstätte (station), Habitat Keth IV (habitat), Sprungtor (gate)
fn ring_station(kind: &str) -> Built {
    let gate = kind == "gate";
    let habitat = kind == "habitat";
    let cp = if habitat { Cp::Union } else { Cp::Asz };
    let c = cmats(cp);
    let mut b = B::new(Eng { dark: c.dark, throat: M::Throat(cp), small: false }, 60);
    b.out.turret_mat = Some(c.dark);
    let r = if gate { 300.0 } else { 150.0 };
    let (tube_r, gap) = if gate { (24.0, 26.0) } else { (16.0, 18.0) };
    b.torus(c.dark, r, tube_r, 16, 96, TAU, Affine3A::IDENTITY);
    b.torus(c.strip, r + gap, 1.6, 6, 128, TAU, Affine3A::IDENTITY);
    b.torus(c.strip, r - gap, 1.6, 6, 128, TAU, Affine3A::IDENTITY);
    let n = if gate { 8 } else { 4 };
    for i in 0..n {
        let a = i as f32 / n as f32 * TAU;
        if gate {
            b.bx_r(c.hull, 30.0, 30.0, 60.0, v(a.cos() * r, a.sin() * r, 0.0), Quat::from_rotation_z(a));
            b.ell(c.glow, a.cos() * (r - 30.0), a.sin() * (r - 30.0), 0.0, 7.0, 7.0, 7.0, 12);
            b.light(a.cos() * (r + 34.0), a.sin() * (r + 34.0), 0.0, STROBE, 0.5, i as f32 / n as f32, 14.0);
        } else {
            b.add(c.dark, &tube(4.0, 4.0, r - 40.0, 8, true), trs(v(a.cos() * r / 2.0, a.sin() * r / 2.0, 0.0), Quat::from_rotation_z(a - FRAC_PI_2), Vec3::ONE) * rx(-FRAC_PI_2));
        }
    }
    if habitat {
        b.add(c.hull, &tube(30.0, 30.0, 90.0, 28, true), rx(-FRAC_PI_2));
        for sy in [-1.0f32, 1.0] {
            b.add(c.dark, &tube(46.0, 46.0, 10.0, 32, true), at(0.0, sy * 50.0, 0.0) * rx(-FRAC_PI_2));
        }
        for i in 0..4 {
            let a = i as f32 / 4.0 * TAU + 0.4;
            b.light(a.cos() * (r + tube_r + 2.0), a.sin() * (r + tube_r + 2.0), 0.0, if i % 2 == 0 { RED } else { GREEN }, 0.8, i as f32 * 0.25, 8.0);
        }
        b.light(0.0, 58.0, 0.0, STROBE, 1.0, 0.0, 9.0);
    } else if gate {
        b.add(M::GateField, &disc_uv(r - 24.0, 96), Affine3A::IDENTITY);
    } else {
        b.add(c.hull, &icosphere(50.0, 1), Affine3A::IDENTITY);
        b.add(c.glow, &icosphere(30.0, 0), sc(1.15, 1.15, 1.15));
        for d in [Vec3::X, Vec3::NEG_X, Vec3::Y, Vec3::NEG_Y, Vec3::Z, Vec3::NEG_Z] {
            b.cone_to(c.dark, 9.0, 60.0, 6, d * 70.0, d * 200.0);
        }
    }
    b.out
}

/// Build one ship type (`kind` = key of ships.json); unknown kinds get None.
pub fn build(kind: &str) -> Option<Built> {
    Some(match kind {
        "sperber" => sperber(),
        "falke" => falke(),
        "greif" => greif(),
        "dorn" => dorn(),
        "klinge" => klinge(false),
        "holt" => klinge(true),
        "hammer" => hammer(),
        "archon" => archon(),
        "schwinge" => schwinge(),
        "kurier" => kurier(),
        "aurora" => carrier(false),
        "valkyrie" => carrier(true),
        "transport" => samariter(),
        "tanker" => tanker(),
        "prison" => asz_capital(70, AszOpt { a: 14.0, b: 12.0, c: 46.0, prow: 0.0, ribs: &[26.0, 8.0, -10.0, -28.0], rib_r: 16.0, blade: 32.0, spines: 5, crown: false, eng: &[(-5.0, 0.0), (5.0, 0.0)], eng_r: 3.6 }, prison_detail),
        "zerstoerer" => asz_capital(71, AszOpt { a: 22.0, b: 18.0, c: 120.0, prow: 46.0, ribs: &[70.0, 25.0, -20.0, -65.0], rib_r: 27.0, blade: 62.0, spines: 6, crown: false, eng: &[(-9.0, 0.0), (9.0, 0.0), (0.0, 8.0)], eng_r: 7.0 }, |_, _| {}),
        "dreadnought" => asz_capital(72, AszOpt { a: 48.0, b: 38.0, c: 240.0, prow: 110.0, ribs: &[150.0, 80.0, 10.0, -60.0, -130.0], rib_r: 56.0, blade: 130.0, spines: 9, crown: true, eng: &[(-22.0, 12.0), (22.0, 12.0), (-22.0, -12.0), (22.0, -12.0), (0.0, 0.0)], eng_r: 11.0 }, |_, _| {}),
        "relay" => relay(),
        "station" | "gate" | "habitat" => ring_station(kind),
        _ => return None,
    })
}

/// Turret mounts for a capital: the organic hulls get their turrets moved onto the curved surface
/// (as the web does), every mount gets an outward normal for the dome and the turret head.
pub fn turret_mounts(kind: &str, raw: &[[f32; 3]]) -> Vec<(Vec3, Vec3)> {
    let ellipse = match kind {
        "zerstoerer" => Some(v(22.0, 18.0, 120.0)),
        "dreadnought" => Some(v(48.0, 38.0, 240.0)),
        _ => None,
    };
    raw.iter()
        .map(|&[x, y, z]| {
            let p = v(x, y, z);
            if let Some(ax) = ellipse {
                let k = 1.0 / (p / ax).length().max(1e-6);
                let q = p * k;
                return (q, (q / (ax * ax)).normalize_or(Vec3::Y));
            }
            let n = if x == 0.0 && y == 0.0 {
                Vec3::Z * z.signum()
            } else if y < 0.0 {
                Vec3::NEG_Y
            } else if x.abs() > y.abs() {
                Vec3::X * x.signum()
            } else {
                Vec3::Y
            };
            (p, n)
        })
        .collect()
}

/// Add the turret domes to a built capital.
pub fn add_turret_domes(out: &mut Built, mounts: &[(Vec3, Vec3)]) {
    let Some(m) = out.turret_mat else { return };
    let dome = ellipsoid(Vec3::splat(3.2), 14, 6, 1.6, true);
    let ring_g = torus(3.25, 0.35, 4, 18, TAU);
    for &(p, n) in mounts {
        let q = Quat::from_rotation_arc(Vec3::Y, n);
        let g = out.geos.entry(m).or_default();
        g.append(&dome, &trs(p, q, Vec3::ONE));
        g.append(&ring_g, &trs(p, q * Quat::from_rotation_x(FRAC_PI_2), Vec3::ONE));
    }
    out.turrets = mounts.to_vec();
}

/// Turret head (rotating part): a squat housing with twin barrels along +Z, base at y = 0.
pub fn turret_head() -> Geo {
    let mut g = Geo::default();
    g.append(&tube(1.9, 2.2, 1.4, 14, true), &(at(0.0, 0.7, 0.0) * rx(-FRAC_PI_2)));
    g.append(&cuboid(2.6, 1.3, 3.2), &at(0.0, 1.9, 0.4));
    for sx in [-0.6f32, 0.6] {
        g.append(&tube(0.22, 0.3, 4.6, 8, true), &at(sx, 1.9, 4.2));
        g.append(&tube(0.32, 0.32, 0.5, 8, true), &at(sx, 1.9, 6.4));
    }
    g
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::GameData;

    #[test]
    fn every_ship_type_builds_a_sane_model() {
        let data = GameData::load();
        for (kind, def) in data.ships.iter() {
            let b = build(kind).unwrap_or_else(|| panic!("no model for {kind}"));
            assert!(!b.geos.is_empty(), "{kind}: empty model");
            for (m, g) in &b.geos {
                assert_eq!(g.pos.len(), g.nor.len(), "{kind} {m:?}");
                assert_eq!(g.pos.len(), g.uv.len(), "{kind} {m:?}");
                assert!(g.col.is_empty() || g.col.len() == g.pos.len(), "{kind} {m:?}: colours");
                assert!(g.idx.iter().all(|&i| (i as usize) < g.pos.len()), "{kind} {m:?}: index out of range");
                assert!(g.pos.iter().chain(&g.nor).all(|v| v.is_finite()), "{kind} {m:?}: NaN");
            }
            // anything that moves under its own power has drives (the wrecked Valkyrie and stations don't)
            if def.speed > 0.0 {
                assert!(!b.nozzles.is_empty(), "{kind}: no engine nozzles");
            }
            if !def.capital && def.guns.iter().any(|g| g[0].abs() >= 3.0) {
                assert!(!b.pods.is_empty(), "{kind}: wing guns without pods");
            }
        }
    }

    #[test]
    fn organic_turrets_sit_on_the_hull() {
        let m = turret_mounts("zerstoerer", &[[20.0, 14.0, 70.0]]);
        let p = m[0].0 / Vec3::new(22.0, 18.0, 120.0);
        assert!((p.length() - 1.0).abs() < 1e-4);
    }
}
