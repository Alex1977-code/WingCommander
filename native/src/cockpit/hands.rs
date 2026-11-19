//! The pilot's hands (port of src/hand.js): each hand is a little skeleton of tapered bones and soft
//! ellipsoids blended into one smooth signed distance field, meshed with surface nets. Normals come from
//! the field gradient; vertex colours add ambient occlusion, flushed knuckles, pale nails and mottling.
//! Built once on a background thread at startup; the forearms in flight-suit sleeves follow the hands.

use bevy::light::NotShadowCaster;
use bevy::prelude::*;
use bevy::tasks::{futures::check_ready, AsyncComputeTaskPool, Task};

use super::geom::{self, Geo};
use super::{HandMount, M};

/// round cone from a (radius r1) to b (radius r2)
#[derive(Clone, Copy)]
struct Cone {
    a: Vec3,
    b: Vec3,
    r1: f32,
    r2: f32,
}

/// axis-aligned ellipsoid
#[derive(Clone, Copy)]
struct Ell {
    c: Vec3,
    r: Vec3,
}

struct Nail {
    a: Vec3,
    b: Vec3,
    r: f32,
    out: Vec3,
}

struct Pose {
    fingers: Vec<Vec<Cone>>,
    palm: Vec<Cone>,
    palm_ell: Vec<Ell>,
    knuckles: Vec<Vec3>,
    nails: Vec<Nail>,
    wrist: Vec3,
}

const FT: f32 = 0.92;

fn cone(a: Vec3, b: Vec3, r1: f32, r2: f32) -> Cone {
    Cone { a, b, r1, r2 }
}

fn finger_bones(k: Vec3, a: Vec3, b: Vec3, c: Vec3, s: f32) -> Vec<Cone> {
    vec![cone(k, a, 0.0102 * s * FT, 0.009 * s * FT), cone(a, b, 0.0088 * s * FT, 0.0079 * s * FT), cone(b, c, 0.0077 * s * FT, 0.0066 * s * FT)]
}

/// Inigo Quilez' round cone distance
fn round_cone(p: Vec3, b: &Cone) -> f32 {
    let ba = b.b - b.a;
    let l2 = ba.length_squared();
    let rr = b.r1 - b.r2;
    let a2 = l2 - rr * rr;
    let il2 = 1.0 / l2;
    let pa = p - b.a;
    let y = pa.dot(ba);
    let z = y - l2;
    let q = pa * l2 - ba * y;
    let x2 = q.length_squared();
    let y2 = y * y * l2;
    let z2 = z * z * l2;
    let k = rr.signum() * rr * rr * x2;
    if z.signum() * a2 * z2 > k {
        return (x2 + z2).sqrt() * il2 - b.r2;
    }
    if y.signum() * a2 * y2 < k {
        return (x2 + y2).sqrt() * il2 - b.r1;
    }
    ((x2 * a2 * il2).sqrt() + y * rr) * il2 - b.r1
}

fn ellipsoid(p: Vec3, e: &Ell) -> f32 {
    let q = (p - e.c) / e.r;
    let k0 = q.length();
    let k1 = (q / e.r).length();
    if k1 > 1e-9 { k0 * (k0 - 1.0) / k1 } else { -e.r.min_element() }
}

fn smin(a: f32, b: f32, k: f32) -> f32 {
    if k <= 0.0 {
        return a.min(b);
    }
    let h = (k - (a - b).abs()).max(0.0) / k;
    a.min(b) - h * h * k * 0.25
}

struct Field<'a> {
    pose: &'a Pose,
    spheres: Vec<(Vec3, f32)>,
}

impl<'a> Field<'a> {
    fn new(pose: &'a Pose) -> Self {
        let spheres = pose
            .fingers
            .iter()
            .map(|f| {
                let pts: Vec<(Vec3, f32)> = f.iter().flat_map(|b| [(b.a, b.r1), (b.b, b.r2)]).collect();
                let c = pts.iter().map(|p| p.0).sum::<Vec3>() / pts.len() as f32;
                let r = pts.iter().map(|p| p.0.distance(c) + p.1).fold(0.0, f32::max);
                (c, r)
            })
            .collect();
        Self { pose, spheres }
    }
    fn d(&self, p: Vec3) -> f32 {
        let (k_palm, k_finger, k_joint) = (0.011, 0.0045, 0.0028);
        let mut dp = 1.0f32;
        for b in &self.pose.palm {
            dp = smin(dp, round_cone(p, b), k_palm);
        }
        for e in &self.pose.palm_ell {
            dp = smin(dp, ellipsoid(p, e), k_palm);
        }
        let mut d = dp;
        for (fi, f) in self.pose.fingers.iter().enumerate() {
            let (c, r) = self.spheres[fi];
            if p.distance(c) - r > d + k_finger {
                continue;
            }
            let mut df = 1.0f32;
            for b in f {
                df = smin(df, round_cone(p, b), k_joint);
            }
            d = d.min(smin(df, dp, k_finger));
        }
        d
    }
}

/// right hand wrapped round a vertical grip of radius r (grip axis = local y)
fn grip_pose(r: f32) -> Pose {
    let pp = |a: f32, rad: f32, y: f32| Vec3::new(a.cos() * rad, y, -a.sin() * rad);
    let mut pose = Pose { fingers: vec![], palm: vec![], palm_ell: vec![], knuckles: vec![], nails: vec![], wrist: Vec3::new(r + 0.007, -0.009, 0.1) };
    for (y, s, ls) in [(0.0285, 0.96, 1.0), (0.01, 1.0, 1.07), (-0.0085, 0.95, 1.0), (-0.0255, 0.82, 0.8)] {
        let fr = 0.0087 * s;
        let ring = r + fr * 0.92;
        let a0 = -0.32;
        let a1 = a0 + 0.043 * ls / ring;
        let a2 = a1 + 0.026 * ls / ring;
        let a3 = (a2 + 0.019 * ls / ring).min(3.3);
        let (k, a, b, c) = (pp(a0, ring + 0.012, y + 0.002), pp(a1, ring, y), pp(a2, ring, y - 0.002), pp(a3, ring * 0.97, y - 0.004));
        pose.fingers.push(finger_bones(k, a, b, c, s));
        pose.palm.push(cone(k, Vec3::new(r + 0.008, y * 0.42 - 0.004, 0.074), 0.0105 * s, 0.0118));
        pose.knuckles.extend([k, a, b]);
        pose.nails.push(Nail { a: b, b: c, r: 0.0072 * s, out: Vec3::new(c.x + b.x, 0.0, c.z + b.z).normalize() });
    }
    pose.palm_ell.push(Ell { c: Vec3::new(r - 0.006, -0.003, 0.032), r: Vec3::new(0.016, 0.034, 0.016) });
    pose.palm_ell.push(Ell { c: Vec3::new(r + 0.012, -0.02, 0.05), r: Vec3::new(0.012, 0.018, 0.03) });
    pose.palm.push(cone(Vec3::new(r + 0.005, -0.004, 0.07), Vec3::new(r + 0.007, -0.009, 0.104), 0.02, 0.0215));
    let top = r + 0.03;
    let (tb, t0, t1, t2) = (Vec3::new(0.001, 0.006, 0.062), Vec3::new(-0.007, 0.027, 0.038), Vec3::new(-0.01, top - 0.005, 0.019), Vec3::new(0.001, top + 0.004, -0.011));
    pose.palm.push(cone(tb, t0, 0.0125, 0.0112));
    pose.palm_ell.push(Ell { c: Vec3::new(-0.003, 0.016, 0.046), r: Vec3::new(0.013, 0.016, 0.02) });
    pose.fingers.push(vec![cone(t0, t1, 0.0108, 0.0096), cone(t1, t2, 0.0094, 0.0078)]);
    pose.knuckles.extend([t0, t1]);
    pose.nails.push(Nail { a: t1, b: t2, r: 0.0084, out: Vec3::new(0.0, 1.0, 0.15).normalize() });
    pose
}

/// left hand resting on a throttle knob: palm on top, fingers over the front edge, thumb along the side
fn throttle_pose() -> Pose {
    let mut pose = Pose { fingers: vec![], palm: vec![], palm_ell: vec![], knuckles: vec![], nails: vec![], wrist: Vec3::new(-0.004, 0.043, 0.1) };
    for (x, s, ls) in [(0.0205, 0.96, 1.0), (0.0068, 1.0, 1.06), (-0.0072, 0.95, 1.0), (-0.0205, 0.82, 0.82)] {
        let k = Vec3::new(x, 0.032, 0.012);
        let a = k + Vec3::new(0.0, -0.004, -0.034 * ls);
        let b = a + Vec3::new(0.0, -0.021 * ls, -0.011 * ls);
        let c = b + Vec3::new(0.0, -0.015 * ls, 0.007 * ls);
        pose.fingers.push(finger_bones(k, a, b, c, s));
        pose.palm.push(cone(k, Vec3::new(x * 0.42, 0.046, 0.074), 0.0105 * s, 0.0118));
        pose.knuckles.extend([k, a, b]);
        pose.nails.push(Nail { a: b, b: c, r: 0.0072 * s, out: Vec3::new(0.0, -0.35, -1.0).normalize() });
    }
    pose.palm_ell.push(Ell { c: Vec3::new(0.0, 0.024, 0.032), r: Vec3::new(0.033, 0.009, 0.03) });
    pose.palm_ell.push(Ell { c: Vec3::new(-0.028, 0.03, 0.05), r: Vec3::new(0.012, 0.012, 0.03) });
    pose.palm.push(cone(Vec3::new(-0.002, 0.04, 0.068), Vec3::new(-0.004, 0.043, 0.102), 0.02, 0.0215));
    let (tb, t0, t1, t2) = (Vec3::new(0.012, 0.03, 0.064), Vec3::new(0.031, 0.027, 0.043), Vec3::new(0.043, 0.019, 0.023), Vec3::new(0.045, 0.006, -0.009));
    pose.palm.push(cone(tb, t0, 0.0125, 0.0112));
    pose.palm_ell.push(Ell { c: Vec3::new(0.022, 0.026, 0.048), r: Vec3::new(0.013, 0.012, 0.02) });
    pose.fingers.push(vec![cone(t0, t1, 0.0108, 0.0096), cone(t1, t2, 0.0094, 0.0078)]);
    pose.knuckles.extend([t0, t1]);
    pose.nails.push(Nail { a: t1, b: t2, r: 0.0084, out: Vec3::new(1.0, 0.2, 0.0).normalize() });
    pose
}

fn bounds(pose: &Pose) -> (Vec3, Vec3) {
    let (mut lo, mut hi) = (Vec3::splat(f32::MAX), Vec3::splat(f32::MIN));
    let mut add = |c: Vec3, r: Vec3| {
        lo = lo.min(c - r);
        hi = hi.max(c + r);
    };
    for b in pose.palm.iter().chain(pose.fingers.iter().flatten()) {
        add(b.a, Vec3::splat(b.r1));
        add(b.b, Vec3::splat(b.r2));
    }
    for e in &pose.palm_ell {
        add(e.c, e.r);
    }
    (lo - Vec3::splat(0.005), hi + Vec3::splat(0.005))
}

fn srgb_lin(c: u32) -> Vec3 {
    let f = |v: u32| {
        let s = v as f32 / 255.0;
        if s <= 0.04045 { s / 12.92 } else { ((s + 0.055) / 1.055).powf(2.4) }
    };
    Vec3::new(f((c >> 16) & 255), f((c >> 8) & 255), f(c & 255))
}

/// naive surface nets on a grid of cell size `h`, then normals and vertex colours from the field
fn mesh_hand(pose: &Pose, h: f32) -> Geo {
    let field = Field::new(pose);
    let (lo, hi) = bounds(pose);
    let n = ((hi - lo) / h).ceil().as_uvec3() + UVec3::ONE;
    let (nx, ny, nz) = (n.x as usize, n.y as usize, n.z as usize);
    let id = |i: usize, j: usize, k: usize| i + nx * (j + ny * k);
    let mut val = vec![0.0f32; nx * ny * nz];
    // evaluate block-wise and skip blocks far from the surface
    let bsz = 4;
    let reach = bsz as f32 * h * 0.9 + h;
    for bk in (0..nz).step_by(bsz) {
        for bj in (0..ny).step_by(bsz) {
            for bi in (0..nx).step_by(bsz) {
                let dc = field.d(lo + Vec3::new(bi as f32 + bsz as f32 / 2.0, bj as f32 + bsz as f32 / 2.0, bk as f32 + bsz as f32 / 2.0) * h);
                let far = dc.abs() > reach;
                for k in bk..(bk + bsz).min(nz) {
                    for j in bj..(bj + bsz).min(ny) {
                        for i in bi..(bi + bsz).min(nx) {
                            val[id(i, j, k)] = if far { dc } else { field.d(lo + Vec3::new(i as f32, j as f32, k as f32) * h) };
                        }
                    }
                }
            }
        }
    }
    let (cx, cy) = (nx - 1, ny - 1);
    let cid = |i: usize, j: usize, k: usize| i + cx * (j + cy * k);
    let mut cell = vec![-1i32; cx * cy * (nz - 1)];
    let corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
    let edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    let mut pos: Vec<Vec3> = Vec::new();
    for k in 0..nz - 1 {
        for j in 0..ny - 1 {
            for i in 0..nx - 1 {
                let mut cv = [0.0f32; 8];
                let mut mask = 0u32;
                for (c, o) in corners.iter().enumerate() {
                    cv[c] = val[id(i + o[0], j + o[1], k + o[2])];
                    if cv[c] < 0.0 {
                        mask |= 1 << c;
                    }
                }
                if mask == 0 || mask == 255 {
                    continue;
                }
                let (mut s, mut cnt) = (Vec3::ZERO, 0.0);
                for e in edges {
                    let (v0, v1) = (cv[e[0]], cv[e[1]]);
                    if (v0 < 0.0) == (v1 < 0.0) {
                        continue;
                    }
                    let t = v0 / (v0 - v1);
                    let (c0, c1) = (corners[e[0]], corners[e[1]]);
                    let a = Vec3::new(c0[0] as f32, c0[1] as f32, c0[2] as f32);
                    let b = Vec3::new(c1[0] as f32, c1[1] as f32, c1[2] as f32);
                    s += a + (b - a) * t;
                    cnt += 1.0;
                }
                cell[cid(i, j, k)] = pos.len() as i32;
                pos.push(lo + (Vec3::new(i as f32, j as f32, k as f32) + s / cnt) * h);
            }
        }
    }
    // one quad per grid edge crossing the surface, wound so the face points outwards
    let mut idx: Vec<u32> = Vec::new();
    let mut quad = |a: i32, b: i32, c: i32, d: i32, flip: bool| {
        if a < 0 || b < 0 || c < 0 || d < 0 {
            return;
        }
        let (a, b, c, d) = (a as u32, b as u32, c as u32, d as u32);
        if flip {
            idx.extend_from_slice(&[a, d, c, a, c, b]);
        } else {
            idx.extend_from_slice(&[a, b, c, a, c, d]);
        }
    };
    for k in 1..nz - 1 {
        for j in 1..ny - 1 {
            for i in 0..nx - 1 {
                let (v0, v1) = (val[id(i, j, k)], val[id(i + 1, j, k)]);
                if (v0 < 0.0) != (v1 < 0.0) {
                    quad(cell[cid(i, j - 1, k - 1)], cell[cid(i, j, k - 1)], cell[cid(i, j, k)], cell[cid(i, j - 1, k)], v0 >= 0.0);
                }
            }
        }
    }
    for k in 1..nz - 1 {
        for j in 0..ny - 1 {
            for i in 1..nx - 1 {
                let (v0, v1) = (val[id(i, j, k)], val[id(i, j + 1, k)]);
                if (v0 < 0.0) != (v1 < 0.0) {
                    quad(cell[cid(i - 1, j, k - 1)], cell[cid(i - 1, j, k)], cell[cid(i, j, k)], cell[cid(i, j, k - 1)], v0 >= 0.0);
                }
            }
        }
    }
    for k in 0..nz - 1 {
        for j in 1..ny - 1 {
            for i in 1..nx - 1 {
                let (v0, v1) = (val[id(i, j, k)], val[id(i, j, k + 1)]);
                if (v0 < 0.0) != (v1 < 0.0) {
                    quad(cell[cid(i - 1, j - 1, k)], cell[cid(i, j - 1, k)], cell[cid(i, j, k)], cell[cid(i - 1, j, k)], v0 >= 0.0);
                }
            }
        }
    }
    // shading baked into vertex colours (linear)
    let (skin, flush_c, nail_c, pale) = (srgb_lin(0xa8714f), srgb_lin(0x9a4f44), srgb_lin(0xd9b2a6), srgb_lin(0xbd8a6c));
    let e = 0.0004;
    let back_dir = Vec3::new(1.0, 0.3, 0.2).normalize();
    let mut g = Geo { pos: Vec::with_capacity(pos.len()), nor: Vec::with_capacity(pos.len()), uv: Vec::with_capacity(pos.len()), col: Vec::with_capacity(pos.len()), idx };
    for p in pos {
        let nv = Vec3::new(
            field.d(p + Vec3::X * e) - field.d(p - Vec3::X * e),
            field.d(p + Vec3::Y * e) - field.d(p - Vec3::Y * e),
            field.d(p + Vec3::Z * e) - field.d(p - Vec3::Z * e),
        )
        .normalize_or(Vec3::Y);
        // ambient occlusion: how much the field closes in a little way out along the normal
        let mut ao = 0.0;
        for s in [0.003, 0.007, 0.012] {
            ao += (s - field.d(p + nv * s)).max(0.0) / s;
        }
        let ao = (1.0 - ao * 0.55).max(0.35);
        let mut c = skin;
        let back = nv.dot(back_dir);
        if back < -0.2 {
            c = c.lerp(pale, ((-back - 0.2) * 0.6).min(1.0));
        }
        let flush = pose.knuckles.iter().map(|k| 1.0 - p.distance(*k) / 0.011).fold(0.0, f32::max);
        if flush > 0.0 {
            c = c.lerp(flush_c, flush * 0.35);
        }
        for nl in &pose.nails {
            let centre = nl.a.lerp(nl.b, 0.66) + nl.out * nl.r * 0.75;
            let d = p.distance(centre);
            if d < nl.r * 0.85 && nv.dot(nl.out) > 0.45 {
                c = c.lerp(nail_c, 0.75 * ((nl.r * 0.85 - d) / (nl.r * 0.25)).min(1.0));
            }
        }
        let m = (p.x * 900.0 + p.y * 470.0).sin() * (p.y * 830.0 - p.z * 610.0).sin() * (p.z * 760.0 + p.x * 390.0).sin();
        c *= (0.94 + m * 0.06) * ao;
        g.pos.push(p);
        g.nor.push(nv);
        g.uv.push(Vec2::ZERO);
        g.col.push([c.x, c.y, c.z, 1.0]);
    }
    g
}

pub struct HandMeshes {
    grip: Geo,
    grip_wrist: Vec3,
    thr: Geo,
    thr_wrist: Vec3,
}

#[derive(Resource)]
pub struct HandBuild(Option<Task<HandMeshes>>);

#[derive(Resource)]
pub struct HandAssets {
    grip: Handle<Mesh>,
    grip_wrist: Vec3,
    thr: Handle<Mesh>,
    thr_wrist: Vec3,
    skin: Handle<StandardMaterial>,
    arm: Handle<Mesh>,
    cuff: Handle<Mesh>,
    watch: Vec<(Handle<Mesh>, Handle<StandardMaterial>, Mat4)>,
}

pub fn start_hand_build(mut commands: Commands) {
    let task = AsyncComputeTaskPool::get().spawn(async move {
        let gp = grip_pose(0.017);
        let tp = throttle_pose();
        HandMeshes { grip: mesh_hand(&gp, 0.0019), grip_wrist: gp.wrist, thr: mesh_hand(&tp, 0.0019), thr_wrist: tp.wrist }
    });
    commands.insert_resource(HandBuild(Some(task)));
}

/// Forearm direction in hand space: along the back of the hand, drooping a little (web GRIP_ARM / THR_ARM).
fn arm_dir(throttle: bool) -> Vec3 {
    if throttle { Vec3::new(-0.12, -0.55, 1.0).normalize() } else { Vec3::new(0.1, -0.55, 1.0).normalize() }
}

/// Finishes the hand build and puts hands (with forearms) on every mount that has none yet.
#[allow(clippy::too_many_arguments)]
pub fn attach_hands(
    mut commands: Commands,
    build: Option<ResMut<HandBuild>>,
    hand_assets: Option<Res<HandAssets>>,
    assets: Option<Res<super::CockpitAssets>>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut mats: ResMut<Assets<StandardMaterial>>,
    mounts: Query<(Entity, &HandMount), Without<Children>>,
) {
    let Some(assets) = assets else { return };
    let Some(ha) = hand_assets else {
        // still building?
        let Some(mut build) = build else { return };
        let Some(task) = build.0.as_mut() else { return };
        let Some(hm) = check_ready(task) else { return };
        build.0 = None;
        let skin = mats.add(StandardMaterial { base_color: Color::WHITE, perceptual_roughness: 0.58, reflectance: 0.35, double_sided: true, cull_mode: None, ..default() });
        // forearm in a flight-suit sleeve (unit length along +Y, scaled per arm) and a cuff at the wrist
        let mut arm = geom::cylinder(0.028, 0.038, 1.0, 16, false);
        for p in &mut arm.pos {
            p.y += 0.5 + 0.035;
        }
        let cuff = geom::cylinder(0.026, 0.031, 0.026, 18, true).transformed(&Mat4::from_translation(Vec3::new(0.0, 0.024, 0.0)));
        // chunky pilot's watch on the left wrist
        let steel = assets.mat(M::Steel);
        let cuff_mat = assets.mat(M::Cuff);
        let glass = mats.add(StandardMaterial {
            base_color: Color::srgb_u8(0x10, 0x12, 0x14),
            emissive: LinearRgba::rgb(0.0047 * 1.6, 0.023 * 1.6, 0.012 * 1.6),
            perceptual_roughness: 0.08,
            metallic: 0.2,
            ..default()
        });
        let w0 = Mat4::from_translation(hm.thr_wrist + Vec3::new(0.0, 0.001, -0.008));
        let watch = vec![
            (meshes.add(geom::torus(0.0225, 0.0045, 24, 6).to_mesh()), cuff_mat, w0 * Mat4::from_scale(Vec3::new(1.05, 0.9, 2.2))),
            (meshes.add(geom::cylinder(0.011, 0.012, 0.006, 24, true).to_mesh()), steel, w0 * Mat4::from_translation(Vec3::new(0.0, 0.021, 0.0))),
            (meshes.add(geom::cylinder(0.009, 0.009, 0.0015, 20, true).to_mesh()), glass, w0 * Mat4::from_translation(Vec3::new(0.0, 0.0245, 0.0))),
        ];
        commands.insert_resource(HandAssets {
            grip: meshes.add(hm.grip.to_mesh()),
            grip_wrist: hm.grip_wrist,
            thr: meshes.add(hm.thr.to_mesh()),
            thr_wrist: hm.thr_wrist,
            skin,
            arm: meshes.add(arm.to_mesh()),
            cuff: meshes.add(cuff.to_mesh()),
            watch,
        });
        return;
    };
    let (sleeve, cuff_mat) = (assets.mat(M::Sleeve), assets.mat(M::Cuff));
    for (e, mount) in &mounts {
        let throttle = matches!(mount, HandMount::Throttle);
        let (mesh, wrist) = if throttle { (ha.thr.clone(), ha.thr_wrist) } else { (ha.grip.clone(), ha.grip_wrist) };
        commands.spawn((Mesh3d(mesh), MeshMaterial3d(ha.skin.clone()), Transform::IDENTITY, ChildOf(e), NotShadowCaster));
        // the forearm continues the line of the hand, so the wrist never looks broken; it leaves the view below
        let dir = arm_dir(throttle);
        let rot = Quat::from_rotation_arc(Vec3::Y, dir);
        let arm_tf = Transform { translation: wrist, rotation: rot, scale: Vec3::new(1.0, 0.42, 1.0) };
        commands.spawn((Mesh3d(ha.arm.clone()), MeshMaterial3d(sleeve.clone()), arm_tf, ChildOf(e), NotShadowCaster));
        commands.spawn((Mesh3d(ha.cuff.clone()), MeshMaterial3d(cuff_mat.clone()), Transform { translation: wrist, rotation: rot, scale: Vec3::ONE }, ChildOf(e), NotShadowCaster));
        if throttle {
            for (m, mat, xf) in &ha.watch {
                commands.spawn((Mesh3d(m.clone()), MeshMaterial3d(mat.clone()), Transform::from_matrix(*xf), ChildOf(e), NotShadowCaster));
            }
        }
    }
}
