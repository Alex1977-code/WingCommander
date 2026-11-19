//! Procedural mesh building for the ship models: a small triangle-soup builder plus the primitives the
//! web version gets from three.js (lathe, torus, extruded/bevelled outlines, swept tubes, ...).
//! UVs are in metres of surface; the library divides them by the material's tile size when it builds the mesh.

use bevy::asset::RenderAssetUsages;
use bevy::math::{Affine3A, Mat3A, Vec3A};
use bevy::mesh::{Indices, PrimitiveTopology};
use bevy::prelude::*;
use std::f32::consts::{PI, TAU};

/// Triangle list with per-vertex normal, uv (metres) and optional colour.
#[derive(Default, Clone)]
pub struct Geo {
    pub pos: Vec<Vec3>,
    pub nor: Vec<Vec3>,
    pub uv: Vec<Vec2>,
    pub col: Vec<[f32; 4]>,
    pub idx: Vec<u32>,
}

impl Geo {
    pub fn vert(&mut self, p: Vec3, n: Vec3, uv: Vec2) -> u32 {
        self.pos.push(p);
        self.nor.push(n);
        self.uv.push(uv);
        (self.pos.len() - 1) as u32
    }
    pub fn tri(&mut self, a: u32, b: u32, c: u32) {
        self.idx.extend_from_slice(&[a, b, c]);
    }
    pub fn quad(&mut self, a: u32, b: u32, c: u32, d: u32) {
        self.idx.extend_from_slice(&[a, b, c, a, c, d]);
    }
    pub fn vcount(&self) -> usize {
        self.pos.len()
    }
    pub fn tris(&self) -> usize {
        self.idx.len() / 3
    }

    /// Make every triangle face the way its vertex normals point (primitives are then winding-agnostic).
    pub fn fix_winding(&mut self) {
        self.fix_winding_from(0);
    }
    fn fix_winding_from(&mut self, first_index: usize) {
        for t in self.idx[first_index..].chunks_exact_mut(3) {
            let (a, b, c) = (t[0] as usize, t[1] as usize, t[2] as usize);
            let g = (self.pos[b] - self.pos[a]).cross(self.pos[c] - self.pos[a]);
            let n = self.nor[a] + self.nor[b] + self.nor[c];
            if g.dot(n) < 0.0 {
                t.swap(1, 2);
            }
        }
    }

    /// Append `o` transformed by `xf` (normals by the inverse transpose; mirrored transforms keep facing).
    pub fn append(&mut self, o: &Geo, xf: &Affine3A) {
        let base = self.pos.len() as u32;
        let nm: Mat3A = xf.matrix3.inverse().transpose();
        for i in 0..o.pos.len() {
            self.pos.push(Vec3::from(xf.transform_point3a(Vec3A::from(o.pos[i]))));
            self.nor.push(Vec3::from(nm * Vec3A::from(o.nor[i])).normalize_or(Vec3::Y));
            self.uv.push(o.uv[i]);
        }
        if !o.col.is_empty() || !self.col.is_empty() {
            self.col.resize(base as usize, [1.0; 4]);
            if o.col.is_empty() {
                self.col.resize(self.pos.len(), [1.0; 4]);
            } else {
                self.col.extend_from_slice(&o.col);
            }
        }
        let flip = xf.matrix3.determinant() < 0.0;
        for t in o.idx.chunks_exact(3) {
            if flip {
                self.idx.extend_from_slice(&[t[0] + base, t[2] + base, t[1] + base]);
            } else {
                self.idx.extend_from_slice(&[t[0] + base, t[1] + base, t[2] + base]);
            }
        }
    }

    /// Transform the vertices from `first` on in place (used to move an already built sub-assembly).
    pub fn transform_from(&mut self, first: usize, xf: &Affine3A) {
        let nm: Mat3A = xf.matrix3.inverse().transpose();
        for i in first..self.pos.len() {
            self.pos[i] = Vec3::from(xf.transform_point3a(Vec3A::from(self.pos[i])));
            self.nor[i] = Vec3::from(nm * Vec3A::from(self.nor[i])).normalize_or(Vec3::Y);
        }
    }

    /// Build the GPU mesh; `uv_scale` = 1 / tile size in metres. Tangents are generated for normal mapping.
    pub fn to_mesh(&self, uv_scale: f32, tangents: bool) -> Mesh {
        let uv: Vec<[f32; 2]> = self.uv.iter().map(|u| [u.x * uv_scale, u.y * uv_scale]).collect();
        let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default())
            .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, self.pos.iter().map(|p| p.to_array()).collect::<Vec<_>>())
            .with_inserted_attribute(Mesh::ATTRIBUTE_NORMAL, self.nor.iter().map(|p| p.to_array()).collect::<Vec<_>>());
        if tangents {
            mesh.insert_attribute(Mesh::ATTRIBUTE_TANGENT, self.tangents(&uv));
        }
        mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, uv);
        if !self.col.is_empty() {
            mesh.insert_attribute(Mesh::ATTRIBUTE_COLOR, self.col.clone());
        }
        mesh.insert_indices(Indices::U32(self.idx.clone()));
        mesh
    }

    /// Per-vertex tangents (Lengyel): xyz along +u, w = handedness so that B = w * cross(N, T) runs along +v.
    fn tangents(&self, uv: &[[f32; 2]]) -> Vec<[f32; 4]> {
        let n = self.pos.len();
        let mut tan = vec![Vec3::ZERO; n];
        let mut bit = vec![Vec3::ZERO; n];
        for t in self.idx.chunks_exact(3) {
            let (a, b, c) = (t[0] as usize, t[1] as usize, t[2] as usize);
            let e1 = self.pos[b] - self.pos[a];
            let e2 = self.pos[c] - self.pos[a];
            let (du1, dv1) = (uv[b][0] - uv[a][0], uv[b][1] - uv[a][1]);
            let (du2, dv2) = (uv[c][0] - uv[a][0], uv[c][1] - uv[a][1]);
            let det = du1 * dv2 - du2 * dv1;
            if det.abs() < 1e-12 {
                continue;
            }
            let r = 1.0 / det;
            let sd = (e1 * dv2 - e2 * dv1) * r;
            let td = (e2 * du1 - e1 * du2) * r;
            for &i in &[a, b, c] {
                tan[i] += sd;
                bit[i] += td;
            }
        }
        (0..n)
            .map(|i| {
                let nn = self.nor[i];
                let mut t = tan[i] - nn * nn.dot(tan[i]);
                if t.length_squared() < 1e-12 {
                    t = nn.any_orthonormal_vector();
                }
                let t = t.normalize();
                let w = if nn.cross(t).dot(bit[i]) < 0.0 { -1.0 } else { 1.0 };
                [t.x, t.y, t.z, w]
            })
            .collect()
    }
}

// ---------- transforms (three.js conventions: Euler XYZ = Rx * Ry * Rz, mesh matrix = T * R * S) ----------

pub fn eul(x: f32, y: f32, z: f32) -> Quat {
    Quat::from_rotation_x(x) * Quat::from_rotation_y(y) * Quat::from_rotation_z(z)
}
pub fn at(x: f32, y: f32, z: f32) -> Affine3A {
    Affine3A::from_translation(Vec3::new(x, y, z))
}
pub fn trs(p: Vec3, r: Quat, s: Vec3) -> Affine3A {
    Affine3A::from_scale_rotation_translation(s, r, p)
}
pub fn rx(a: f32) -> Affine3A {
    Affine3A::from_rotation_x(a)
}
pub fn ry(a: f32) -> Affine3A {
    Affine3A::from_rotation_y(a)
}
pub fn rz(a: f32) -> Affine3A {
    Affine3A::from_rotation_z(a)
}
pub fn sc(x: f32, y: f32, z: f32) -> Affine3A {
    Affine3A::from_scale(Vec3::new(x, y, z))
}
/// rotation that turns +Z into `dir`
pub fn look_z(dir: Vec3) -> Quat {
    Quat::from_rotation_arc(Vec3::Z, dir.normalize_or(Vec3::Z))
}

// ---------- primitives ----------

/// Ellipsoid (or a cap of one) with half axes `s`. Pole along +Z, or along +Y when `pole_y`.
/// `theta_max` = PI for a full ellipsoid, PI/2 for a dome.
pub fn ellipsoid(s: Vec3, seg: u32, rings: u32, theta_max: f32, pole_y: bool) -> Geo {
    let mut g = Geo::default();
    let ur = if pole_y { (s.x + s.z) * 0.5 } else { (s.x + s.y) * 0.5 };
    let vr = (ur + if pole_y { s.y } else { s.z }) * 0.5;
    let rings = rings.max(2);
    for j in 0..=rings {
        let th = theta_max * j as f32 / rings as f32;
        for i in 0..=seg {
            let ph = TAU * i as f32 / seg as f32;
            let (st, ct, sp, cp) = (th.sin(), th.cos(), ph.sin(), ph.cos());
            let (u, p) = if pole_y {
                (Vec3::new(st * sp, ct, st * cp), Vec3::new(s.x * st * sp, s.y * ct, s.z * st * cp))
            } else {
                (Vec3::new(st * cp, st * sp, ct), Vec3::new(s.x * st * cp, s.y * st * sp, s.z * ct))
            };
            let n = Vec3::new(u.x / s.x, u.y / s.y, u.z / s.z).normalize_or(Vec3::Z);
            g.vert(p, n, Vec2::new(ph * ur, th * vr));
        }
    }
    let w = seg + 1;
    for j in 0..rings {
        for i in 0..seg {
            let a = j * w + i;
            g.quad(a, a + w, a + w + 1, a + 1);
        }
    }
    g.fix_winding();
    g
}

pub fn ell(sx: f32, sy: f32, sz: f32, seg: u32) -> Geo {
    ellipsoid(Vec3::new(sx, sy, sz), seg, (seg / 2).max(6), PI, false)
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum LatheAxis {
    Y,
    Z,
}

/// How a lathe maps its uv: around the axis × along the profile, swapped, or a custom function.
pub enum LatheUv<'a> {
    Around,
    Swap,
    Custom(&'a dyn Fn(f32, f32, f32) -> Vec2), // (r, h, phi) -> uv
}

/// Surface of revolution of the profile (r, h) around `axis`. Corners sharper than ~40 degrees get
/// split normals. `double` also emits the inside (open cones, nozzles).
pub fn lathe(profile: &[(f32, f32)], seg: u32, axis: LatheAxis, uvm: LatheUv, double: bool) -> Geo {
    let n = profile.len();
    // orientation of the profile (with the axis closing it): flips the 2D normal so it points outward
    let mut area = 0.0;
    let mut ring: Vec<(f32, f32)> = profile.to_vec();
    ring.push((0.0, profile[n - 1].1));
    ring.push((0.0, profile[0].1));
    for i in 0..ring.len() {
        let (a, b) = (ring[i], ring[(i + 1) % ring.len()]);
        area += a.0 * b.1 - b.0 * a.1;
    }
    let sign = if area >= 0.0 { 1.0 } else { -1.0 };
    let seg_n: Vec<Vec2> = (0..n - 1)
        .map(|i| {
            let d = Vec2::new(profile[i + 1].0 - profile[i].0, profile[i + 1].1 - profile[i].1);
            (Vec2::new(d.y, -d.x) * sign).normalize_or(Vec2::X)
        })
        .collect();
    // rings of (r, h, n2, s): one per profile vertex, two at sharp corners
    let mut s_acc = 0.0;
    let mut rows: Vec<(f32, f32, Vec2, f32, usize)> = Vec::new(); // last = segment the row belongs to (for quads)
    let r_ref = profile.iter().fold(0.0f32, |m, p| m.max(p.0)).max(0.01);
    for i in 0..n {
        if i > 0 {
            s_acc += Vec2::new(profile[i].0 - profile[i - 1].0, profile[i].1 - profile[i - 1].1).length();
        }
        let (r, h) = profile[i];
        let prev = if i > 0 { Some(seg_n[i - 1]) } else { None };
        let next = if i + 1 < n { Some(seg_n[i]) } else { None };
        match (prev, next) {
            (Some(a), Some(b)) if a.dot(b) > 0.766 => rows.push((r, h, (a + b).normalize(), s_acc, i)),
            (Some(a), Some(b)) => {
                rows.push((r, h, a, s_acc, i));
                rows.push((r, h, b, s_acc, i));
            }
            (Some(a), None) => rows.push((r, h, a, s_acc, i)),
            (None, Some(b)) => rows.push((r, h, b, s_acc, i)),
            (None, None) => {}
        }
    }
    let mut g = Geo::default();
    let mut row_start = Vec::with_capacity(rows.len());
    for &(r, h, n2, s, _) in &rows {
        row_start.push(g.vcount() as u32);
        for i in 0..=seg {
            let ph = TAU * i as f32 / seg as f32;
            let (sp, cp) = (ph.sin(), ph.cos());
            let (p, nn) = match axis {
                LatheAxis::Z => (Vec3::new(r * cp, r * sp, h), Vec3::new(n2.x * cp, n2.x * sp, n2.y)),
                LatheAxis::Y => (Vec3::new(r * sp, h, r * cp), Vec3::new(n2.x * sp, n2.y, n2.x * cp)),
            };
            let uv = match &uvm {
                LatheUv::Around => Vec2::new(ph * r_ref, s),
                LatheUv::Swap => Vec2::new(s, ph * r_ref),
                LatheUv::Custom(f) => f(r, h, ph),
            };
            g.vert(p, nn, uv);
        }
    }
    // connect consecutive rows that belong to consecutive profile vertices
    for k in 0..rows.len().saturating_sub(1) {
        if rows[k + 1].4 != rows[k].4 + 1 {
            continue; // the split pair at a corner
        }
        let (a0, b0) = (row_start[k], row_start[k + 1]);
        for i in 0..seg {
            g.quad(a0 + i, b0 + i, b0 + i + 1, a0 + i + 1);
        }
    }
    g.fix_winding();
    if double {
        add_backfaces(&mut g);
    }
    g
}

/// Duplicate every triangle facing the other way (for thin open surfaces).
pub fn add_backfaces(g: &mut Geo) {
    let base = g.vcount() as u32;
    for i in 0..g.vcount() {
        let (p, n, u) = (g.pos[i], -g.nor[i], g.uv[i]);
        g.vert(p, n, u);
    }
    let tris: Vec<u32> = g.idx.clone();
    for t in tris.chunks_exact(3) {
        g.tri(t[0] + base, t[2] + base, t[1] + base);
    }
}

/// Tapered tube along Z, centred (front radius at +Z, like three's CylinderGeometry rotated by +90 deg about X).
pub fn tube(r_front: f32, r_back: f32, len: f32, seg: u32, caps: bool) -> Geo {
    let h = len * 0.5;
    if caps {
        lathe(&[(0.0, -h), (r_back, -h), (r_front, h), (0.0, h)], seg, LatheAxis::Z, LatheUv::Around, false)
    } else {
        lathe(&[(r_back, -h), (r_front, h)], seg, LatheAxis::Z, LatheUv::Around, true)
    }
}

/// Cone along +Z (apex at +len/2), centred, with a base cap.
pub fn cone(r: f32, len: f32, seg: u32) -> Geo {
    let h = len * 0.5;
    lathe(&[(0.0, -h), (r, -h), (0.0, h)], seg, LatheAxis::Z, LatheUv::Around, false)
}

/// Torus in the XY plane around Z (three's TorusGeometry), `arc` radians of the main ring from +X.
pub fn torus(big_r: f32, r: f32, rseg: u32, tseg: u32, arc: f32) -> Geo {
    let mut g = Geo::default();
    for j in 0..=rseg {
        let v = TAU * j as f32 / rseg as f32;
        for i in 0..=tseg {
            let u = arc * i as f32 / tseg as f32;
            let (cu, su, cv, sv) = (u.cos(), u.sin(), v.cos(), v.sin());
            let p = Vec3::new((big_r + r * cv) * cu, (big_r + r * cv) * su, r * sv);
            let n = Vec3::new(cv * cu, cv * su, sv);
            g.vert(p, n, Vec2::new(u * big_r, v * r));
        }
    }
    let w = tseg + 1;
    for j in 0..rseg {
        for i in 0..tseg {
            let a = j * w + i;
            g.quad(a, a + 1, a + w + 1, a + w);
        }
    }
    g.fix_winding();
    if arc < TAU - 1e-3 {
        // end caps of an open arc
        for (u, dir) in [(0.0f32, -1.0f32), (arc, 1.0)] {
            let t = Vec3::new(-u.sin(), u.cos(), 0.0) * dir;
            let c = Vec3::new(big_r * u.cos(), big_r * u.sin(), 0.0);
            let ci = g.vert(c, t, Vec2::ZERO);
            let first = g.vcount() as u32;
            for j in 0..=rseg {
                let v = TAU * j as f32 / rseg as f32;
                let p = Vec3::new((big_r + r * v.cos()) * u.cos(), (big_r + r * v.cos()) * u.sin(), r * v.sin());
                g.vert(p, t, Vec2::new(v.cos() * r, v.sin() * r));
            }
            let start = g.idx.len();
            for j in 0..rseg {
                g.tri(ci, first + j, first + j + 1);
            }
            g.fix_winding_from(start);
        }
    }
    g
}

/// Axis-aligned box centred on the origin, uv in metres per face.
pub fn cuboid(w: f32, h: f32, d: f32) -> Geo {
    let (x, y, z) = (w * 0.5, h * 0.5, d * 0.5);
    let mut g = Geo::default();
    let faces: [(Vec3, Vec3, Vec3, f32, f32); 6] = [
        (Vec3::X, Vec3::NEG_Z, Vec3::Y, d, h),
        (Vec3::NEG_X, Vec3::Z, Vec3::Y, d, h),
        (Vec3::Y, Vec3::X, Vec3::NEG_Z, w, d),
        (Vec3::NEG_Y, Vec3::X, Vec3::Z, w, d),
        (Vec3::Z, Vec3::X, Vec3::Y, w, h),
        (Vec3::NEG_Z, Vec3::NEG_X, Vec3::Y, w, h),
    ];
    for (n, u, v, fu, fv) in faces {
        let c = Vec3::new(n.x * x, n.y * y, n.z * z);
        let hu = Vec3::new(u.x * x, u.y * y, u.z * z).length();
        let hv = Vec3::new(v.x * x, v.y * y, v.z * z).length();
        let a = g.vert(c - u * hu - v * hv, n, Vec2::new(0.0, fv));
        let b = g.vert(c + u * hu - v * hv, n, Vec2::new(fu, fv));
        let cc = g.vert(c + u * hu + v * hv, n, Vec2::new(fu, 0.0));
        let dd = g.vert(c - u * hu + v * hv, n, Vec2::new(0.0, 0.0));
        g.quad(a, b, cc, dd);
    }
    g.fix_winding();
    g
}

/// Flat-shaded hexahedron from 8 corners: [x0y0z0, x1y0z0, x1y1z0, x0y1z0, x0y0z1, x1y0z1, x1y1z1, x0y1z1].
pub fn hexa(c: [Vec3; 8]) -> Geo {
    let mut g = Geo::default();
    let centre = c.iter().copied().sum::<Vec3>() / 8.0;
    for f in [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]] {
        let p = [c[f[0]], c[f[1]], c[f[2]], c[f[3]]];
        let mut n = (p[1] - p[0]).cross(p[2] - p[0]) + (p[2] - p[0]).cross(p[3] - p[0]);
        let fc = (p[0] + p[1] + p[2] + p[3]) * 0.25;
        if n.dot(fc - centre) < 0.0 {
            n = -n;
        }
        let n = n.normalize_or(Vec3::Y);
        let (t, b) = (n.any_orthonormal_pair().0, n.any_orthonormal_pair().1);
        let ids: Vec<u32> = p.iter().map(|q| g.vert(*q, n, Vec2::new(q.dot(t), q.dot(b)))).collect();
        g.quad(ids[0], ids[1], ids[2], ids[3]);
    }
    g.fix_winding();
    g
}

/// three's wingGeo: a box (span along +X from 0, thickness, root chord along Z) tapered to the tip and swept back.
pub fn wing(span: f32, root: f32, tip: f32, sweep: f32, thick: f32) -> Geo {
    let mut c = [Vec3::ZERO; 8];
    let k = tip / root;
    for (i, ci) in c.iter_mut().enumerate() {
        let xi = matches!(i % 4, 1 | 2);
        let yi = matches!(i % 4, 2 | 3);
        let zi = i >= 4;
        let t = if xi { 1.0 } else { 0.0 };
        let y = if yi { thick * 0.5 } else { -thick * 0.5 } * (1.0 - 0.65 * t);
        let z = if zi { root * 0.5 } else { -root * 0.5 } * (1.0 + (k - 1.0) * t) - sweep * t;
        *ci = Vec3::new(t * span, y, z);
    }
    hexa(c)
}

/// Disc of radius r facing +Z.
pub fn disc(r: f32, seg: u32) -> Geo {
    ring(0.0, r, seg)
}

/// Disc facing +Z with planar image-style uv (0..1 across the diameter), for textured fields.
pub fn disc_uv(r: f32, seg: u32) -> Geo {
    let mut g = ring(0.0, r, seg);
    for (u, p) in g.uv.iter_mut().zip(&g.pos) {
        *u = Vec2::new(0.5 + p.x / (2.0 * r), 0.5 - p.y / (2.0 * r));
    }
    g
}

/// Flat ring (r0..r1) facing +Z.
pub fn ring(r0: f32, r1: f32, seg: u32) -> Geo {
    let mut g = Geo::default();
    for i in 0..=seg {
        let a = TAU * i as f32 / seg as f32;
        let d = Vec2::new(a.cos(), a.sin());
        g.vert((d * r0).extend(0.0), Vec3::Z, d * r0);
        g.vert((d * r1).extend(0.0), Vec3::Z, d * r1);
    }
    for i in 0..seg {
        let a = i * 2;
        g.quad(a, a + 2, a + 3, a + 1);
    }
    g.fix_winding();
    g
}

/// Quad w x h facing +Z with image-style uv (0,0 top left .. 1,1 bottom right) - for decals.
pub fn plane(w: f32, h: f32) -> Geo {
    let mut g = Geo::default();
    let (x, y) = (w * 0.5, h * 0.5);
    let a = g.vert(Vec3::new(-x, -y, 0.0), Vec3::Z, Vec2::new(0.0, 1.0));
    let b = g.vert(Vec3::new(x, -y, 0.0), Vec3::Z, Vec2::new(1.0, 1.0));
    let c = g.vert(Vec3::new(x, y, 0.0), Vec3::Z, Vec2::new(1.0, 0.0));
    let d = g.vert(Vec3::new(-x, y, 0.0), Vec3::Z, Vec2::new(0.0, 0.0));
    g.quad(a, b, c, d);
    g.fix_winding();
    g
}

fn poly_area(p: &[Vec2]) -> f32 {
    let mut a = 0.0;
    for i in 0..p.len() {
        let (u, v) = (p[i], p[(i + 1) % p.len()]);
        a += u.x * v.y - v.x * u.y;
    }
    a * 0.5
}

/// Ear-clipping triangulation of a simple polygon (any orientation). Returns index triples.
pub fn triangulate(p: &[Vec2]) -> Vec<[usize; 3]> {
    let n = p.len();
    let mut out = Vec::with_capacity(n.saturating_sub(2));
    if n < 3 {
        return out;
    }
    let ccw = poly_area(p) >= 0.0;
    let mut v: Vec<usize> = if ccw { (0..n).collect() } else { (0..n).rev().collect() };
    let cross = |a: Vec2, b: Vec2, c: Vec2| (b - a).perp_dot(c - a);
    let mut guard = 0;
    while v.len() > 3 && guard < n * n {
        guard += 1;
        let m = v.len();
        let mut clipped = false;
        for i in 0..m {
            let (ia, ib, ic) = (v[(i + m - 1) % m], v[i], v[(i + 1) % m]);
            let (a, b, c) = (p[ia], p[ib], p[ic]);
            if cross(a, b, c) <= 1e-9 {
                continue; // reflex or degenerate
            }
            let inside = v.iter().any(|&k| {
                if k == ia || k == ib || k == ic {
                    return false;
                }
                let q = p[k];
                cross(a, b, q) >= 0.0 && cross(b, c, q) >= 0.0 && cross(c, a, q) >= 0.0
            });
            if inside {
                continue;
            }
            out.push([ia, ib, ic]);
            v.remove(i);
            clipped = true;
            break;
        }
        if !clipped {
            // numerically stuck (nearly collinear points): drop the flattest vertex
            v.remove(0);
        }
    }
    if v.len() == 3 {
        out.push([v[0], v[1], v[2]]);
    }
    out
}

/// Offset a CCW outline outwards by d (mitred, clamped).
fn offset_outline(p: &[Vec2], d: f32) -> Vec<Vec2> {
    let n = p.len();
    (0..n)
        .map(|i| {
            let (a, b, c) = (p[(i + n - 1) % n], p[i], p[(i + 1) % n]);
            let n1 = { let e = (b - a).normalize_or(Vec2::X); Vec2::new(e.y, -e.x) };
            let n2 = { let e = (c - b).normalize_or(Vec2::X); Vec2::new(e.y, -e.x) };
            let m = (n1 + n2).normalize_or(n1);
            let k = m.dot(n1).max(0.35);
            b + m * (d / k)
        })
        .collect()
}

/// three's ExtrudeGeometry: outline in XY extruded along +Z over [0, depth]; the bevel adds `bt` beyond
/// both ends and grows the outline by `bs` in the middle. Side normals are smooth where the outline turns
/// by less than `smooth_deg`.
pub fn prism(outline: &[Vec2], depth: f32, bt: f32, bs: f32, smooth_deg: f32) -> Geo {
    let mut p: Vec<Vec2> = outline.to_vec();
    if poly_area(&p) < 0.0 {
        p.reverse();
    }
    let n = p.len();
    let mut g = Geo::default();
    // caps
    let tris = triangulate(&p);
    for (z, nz) in [(-bt, -1.0f32), (depth + bt, 1.0)] {
        let base = g.vcount() as u32;
        for q in &p {
            g.vert(Vec3::new(q.x, q.y, z), Vec3::Z * nz, *q);
        }
        for t in &tris {
            g.tri(base + t[0] as u32, base + t[1] as u32, base + t[2] as u32);
        }
    }
    // side sections: (outline, z, chamfer kind) pairs
    let grown = if bs > 0.0 { offset_outline(&p, bs) } else { p.clone() };
    let edge_n: Vec<Vec2> = (0..n)
        .map(|i| {
            let e = (p[(i + 1) % n] - p[i]).normalize_or(Vec2::X);
            Vec2::new(e.y, -e.x)
        })
        .collect();
    let cos_s = smooth_deg.to_radians().cos();
    let vn = |i: usize, edge: usize| -> Vec2 {
        let (a, b) = (edge_n[(i + n - 1) % n], edge_n[i]);
        if a.dot(b) > cos_s { (a + b).normalize_or(b) } else { edge_n[edge] }
    };
    let mut per = vec![0.0f32; n + 1];
    for i in 0..n {
        per[i + 1] = per[i] + (p[(i + 1) % n] - p[i]).length();
    }
    let sections: Vec<(&[Vec2], f32, &[Vec2], f32, i32)> = if bt > 0.0 || bs > 0.0 {
        vec![(&p[..], -bt, &grown[..], 0.0, -1), (&grown[..], 0.0, &grown[..], depth, 0), (&grown[..], depth, &p[..], depth + bt, 1)]
    } else {
        vec![(&p[..], 0.0, &p[..], depth, 0)]
    };
    for (o0, z0, o1, z1, kind) in sections {
        for e in 0..n {
            let (i, j) = (e, (e + 1) % n);
            let ni = vn(i, e);
            let nj = vn(j, e);
            let mk = |n2: Vec2| -> Vec3 {
                match kind {
                    0 => n2.extend(0.0),
                    k => (n2 * bt.max(1e-4)).extend(k as f32 * bs.max(1e-4)).normalize(),
                }
            };
            let a = g.vert(o0[i].extend(z0), mk(ni), Vec2::new(per[e], z0));
            let b = g.vert(o0[j].extend(z0), mk(nj), Vec2::new(per[e + 1], z0));
            let c = g.vert(o1[j].extend(z1), mk(nj), Vec2::new(per[e + 1], z1));
            let d = g.vert(o1[i].extend(z1), mk(ni), Vec2::new(per[e], z1));
            g.quad(a, b, c, d);
        }
    }
    g.fix_winding();
    g
}

/// The web's slab(): outline given as (x, z) pairs, thickness centred on y = 0 (then placed by the caller).
pub fn slab(pts: &[[f32; 2]], thick: f32, bevel: f32) -> Geo {
    let outline: Vec<Vec2> = pts.iter().map(|p| Vec2::new(p[0], p[1])).collect();
    let mut g = Geo::default();
    // extrude along +Z, then rotate +90 deg about X (shape y -> world z, depth -> -y), centre the thickness
    g.append(&prism(&outline, thick, bevel, bevel, 30.0), &(at(0.0, thick * 0.5, 0.0) * rx(PI / 2.0)));
    g
}

/// Tube swept along a polyline (parallel-transport frames).
pub fn sweep(path: &[Vec3], radius: f32, rseg: u32, closed: bool) -> Geo {
    let n = path.len();
    let mut g = Geo::default();
    if n < 2 {
        return g;
    }
    let tangent = |i: usize| -> Vec3 {
        let (a, b) = if closed {
            (path[(i + n - 1) % n], path[(i + 1) % n])
        } else {
            (path[i.saturating_sub(1)], path[(i + 1).min(n - 1)])
        };
        (b - a).normalize_or(Vec3::Z)
    };
    let mut normal = tangent(0).any_orthonormal_vector();
    let mut s = 0.0;
    let count = if closed { n + 1 } else { n };
    for k in 0..count {
        let i = k % n;
        let t = tangent(i);
        normal = (normal - t * normal.dot(t)).normalize_or(t.any_orthonormal_vector());
        let bin = t.cross(normal);
        if k > 0 {
            s += (path[i] - path[(k - 1) % n]).length();
        }
        for j in 0..=rseg {
            let a = TAU * j as f32 / rseg as f32;
            let d = normal * a.cos() + bin * a.sin();
            g.vert(path[i] + d * radius, d, Vec2::new(s, a * radius));
        }
    }
    let w = rseg + 1;
    for k in 0..(count - 1) as u32 {
        for j in 0..rseg {
            let a = k * w + j;
            g.quad(a, a + w, a + w + 1, a + 1);
        }
    }
    g.fix_winding();
    g
}

/// Quadratic Bezier as points.
pub fn bezier2(p0: Vec3, c: Vec3, p1: Vec3, steps: usize) -> Vec<Vec3> {
    (0..=steps)
        .map(|i| {
            let t = i as f32 / steps as f32;
            p0 * (1.0 - t) * (1.0 - t) + c * 2.0 * t * (1.0 - t) + p1 * t * t
        })
        .collect()
}

/// Flat-shaded icosphere (detail 0 = icosahedron, each level splits every face into four).
pub fn icosphere(r: f32, detail: u32) -> Geo {
    let t = (1.0 + 5f32.sqrt()) / 2.0;
    let v0 = [
        Vec3::new(-1.0, t, 0.0), Vec3::new(1.0, t, 0.0), Vec3::new(-1.0, -t, 0.0), Vec3::new(1.0, -t, 0.0),
        Vec3::new(0.0, -1.0, t), Vec3::new(0.0, 1.0, t), Vec3::new(0.0, -1.0, -t), Vec3::new(0.0, 1.0, -t),
        Vec3::new(t, 0.0, -1.0), Vec3::new(t, 0.0, 1.0), Vec3::new(-t, 0.0, -1.0), Vec3::new(-t, 0.0, 1.0),
    ];
    let f0: [[usize; 3]; 20] = [
        [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
        [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    let mut faces: Vec<[Vec3; 3]> = f0.iter().map(|f| [v0[f[0]].normalize(), v0[f[1]].normalize(), v0[f[2]].normalize()]).collect();
    for _ in 0..detail {
        let mut nf = Vec::with_capacity(faces.len() * 4);
        for [a, b, c] in faces {
            let (ab, bc, ca) = ((a + b).normalize(), (b + c).normalize(), (c + a).normalize());
            nf.extend_from_slice(&[[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]);
        }
        faces = nf;
    }
    let mut g = Geo::default();
    for [a, b, c] in faces {
        let n = (a + b + c).normalize();
        let (tu, tv) = n.any_orthonormal_pair();
        let ids: Vec<u32> = [a, b, c].iter().map(|p| g.vert(*p * r, n, Vec2::new(p.dot(tu) * r, p.dot(tv) * r))).collect();
        g.tri(ids[0], ids[1], ids[2]);
    }
    g.fix_winding();
    g
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn triangulates_concave() {
        let p = [Vec2::new(0.0, 0.0), Vec2::new(4.0, 0.0), Vec2::new(4.0, 4.0), Vec2::new(2.0, 1.0), Vec2::new(0.0, 4.0)];
        assert_eq!(triangulate(&p).len(), 3);
    }
    #[test]
    fn lathe_normals_point_out() {
        let g = tube(1.0, 1.0, 2.0, 12, true);
        for (p, n) in g.pos.iter().zip(&g.nor) {
            assert!(p.dot(*n) >= -1e-3);
        }
    }
}
