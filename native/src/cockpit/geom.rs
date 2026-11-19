//! Mesh building for the cockpit: a triangle builder with the shapes the web version takes from three.js
//! (rounded bevelled slabs, tubes along Catmull-Rom curves, cylinder shells, sphere patches, ...).
//! UVs are in metres of surface (scaled per material when meshes are merged).

use bevy::asset::RenderAssetUsages;
use bevy::mesh::{Indices, PrimitiveTopology};
use bevy::prelude::*;
use std::f32::consts::{PI, TAU};

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
    pub fn is_empty(&self) -> bool {
        self.idx.is_empty()
    }

    /// Appends `other` transformed by `m` (rigid or uniformly scaled), UVs scaled by `uv_k`.
    pub fn append(&mut self, other: &Geo, m: &Mat4, uv_k: f32) {
        let base = self.pos.len() as u32;
        let nm = Mat3::from_mat4(*m).inverse().transpose();
        for i in 0..other.pos.len() {
            self.pos.push(m.transform_point3(other.pos[i]));
            self.nor.push((nm * other.nor[i]).normalize_or(Vec3::Y));
            self.uv.push(other.uv[i] * uv_k);
        }
        if !other.col.is_empty() || !self.col.is_empty() {
            self.col.resize(base as usize, [1.0; 4]);
            if other.col.is_empty() {
                self.col.resize(self.pos.len(), [1.0; 4]);
            } else {
                self.col.extend_from_slice(&other.col);
            }
        }
        self.idx.extend(other.idx.iter().map(|i| i + base));
    }

    pub fn transformed(mut self, m: &Mat4) -> Self {
        let nm = Mat3::from_mat4(*m).inverse().transpose();
        for p in &mut self.pos {
            *p = m.transform_point3(*p);
        }
        for n in &mut self.nor {
            *n = (nm * *n).normalize_or(Vec3::Y);
        }
        self
    }

    pub fn to_mesh(&self) -> Mesh {
        let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::RENDER_WORLD)
            .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, self.pos.iter().map(|p| p.to_array()).collect::<Vec<_>>())
            .with_inserted_attribute(Mesh::ATTRIBUTE_NORMAL, self.nor.iter().map(|p| p.to_array()).collect::<Vec<_>>())
            .with_inserted_attribute(Mesh::ATTRIBUTE_UV_0, self.uv.iter().map(|p| p.to_array()).collect::<Vec<_>>());
        if !self.col.is_empty() {
            mesh.insert_attribute(Mesh::ATTRIBUTE_COLOR, self.col.clone());
        }
        mesh.insert_indices(Indices::U32(self.idx.clone()));
        mesh
    }
}

/// Box centred at the origin.
pub fn cuboid(w: f32, h: f32, d: f32) -> Geo {
    let mut g = Geo::default();
    let hs = Vec3::new(w, h, d) * 0.5;
    for (n, u, v) in [(Vec3::X, Vec3::NEG_Z, Vec3::Y), (Vec3::NEG_X, Vec3::Z, Vec3::Y), (Vec3::Y, Vec3::X, Vec3::NEG_Z), (Vec3::NEG_Y, Vec3::X, Vec3::Z), (Vec3::Z, Vec3::X, Vec3::Y), (Vec3::NEG_Z, Vec3::NEG_X, Vec3::Y)] {
        let c = n * hs;
        let (eu, ev) = (u * hs, v * hs);
        let su = (eu.length() * 2.0).max(1e-4);
        let sv = (ev.length() * 2.0).max(1e-4);
        let a = g.vert(c - eu - ev, n, Vec2::new(0.0, sv));
        let b = g.vert(c + eu - ev, n, Vec2::new(su, sv));
        let cc = g.vert(c + eu + ev, n, Vec2::new(su, 0.0));
        let d = g.vert(c - eu + ev, n, Vec2::new(0.0, 0.0));
        g.quad(a, b, cc, d);
    }
    g
}

/// Outline of a rounded rectangle (counter-clockwise seen from +Z), `seg` points per corner.
fn rounded_outline(w: f32, h: f32, r: f32, seg: usize) -> Vec<(Vec2, Vec2)> {
    let r = r.min(w * 0.5).min(h * 0.5).max(0.0);
    let mut out = Vec::with_capacity(seg * 4 + 4);
    let corners = [(Vec2::new(w * 0.5 - r, -h * 0.5 + r), -PI * 0.5), (Vec2::new(w * 0.5 - r, h * 0.5 - r), 0.0), (Vec2::new(-w * 0.5 + r, h * 0.5 - r), PI * 0.5), (Vec2::new(-w * 0.5 + r, -h * 0.5 + r), PI)];
    for (c, a0) in corners {
        for i in 0..=seg {
            let a = a0 + (i as f32 / seg as f32) * PI * 0.5;
            let n = Vec2::new(a.cos(), a.sin());
            out.push((c + n * r, n));
        }
    }
    out
}

/// Rounded rectangle slab (web roundedRect): front face at z = +bevel, body from z = 0 back to z = -depth,
/// bevelled front edge. The back is closed.
pub fn rounded_slab(w: f32, h: f32, r: f32, depth: f32, bevel: f32) -> Geo {
    let mut g = Geo::default();
    let seg = 4;
    let outer = rounded_outline(w, h, r, seg);
    let inner = rounded_outline((w - bevel * 2.0).max(1e-4), (h - bevel * 2.0).max(1e-4), (r - bevel).max(0.0), seg);
    let n = outer.len();
    // front face (fan around the centre)
    let c = g.vert(Vec3::new(0.0, 0.0, bevel), Vec3::Z, Vec2::ZERO);
    let first = g.pos.len() as u32;
    for (p, _) in &inner {
        g.vert(p.extend(bevel), Vec3::Z, *p);
    }
    for i in 0..n {
        g.tri(c, first + i as u32, first + ((i + 1) % n) as u32);
    }
    // bevel band, side wall, back face
    let ring = |g: &mut Geo, pts: &[(Vec2, Vec2)], z: f32, nz: f32, len_v: f32| -> u32 {
        let s = g.pos.len() as u32;
        let mut acc = 0.0;
        for i in 0..pts.len() {
            if i > 0 {
                acc += (pts[i].0 - pts[i - 1].0).length();
            }
            let nrm = (pts[i].1.extend(0.0) * (1.0 - nz.abs()) + Vec3::Z * nz).normalize_or(Vec3::Z);
            g.vert(pts[i].0.extend(z), nrm, Vec2::new(acc, len_v));
        }
        s
    };
    let band = |g: &mut Geo, a: u32, b: u32| {
        for i in 0..n as u32 {
            let j = (i + 1) % n as u32;
            g.quad(a + i, b + i, b + j, a + j);
        }
    };
    let f0 = ring(&mut g, &inner, bevel, 0.75, 0.0);
    let f1 = ring(&mut g, &outer, 0.0, 0.35, bevel * 1.4);
    band(&mut g, f0, f1);
    let s0 = ring(&mut g, &outer, 0.0, 0.0, 0.0);
    let s1 = ring(&mut g, &outer, -depth, 0.0, depth);
    band(&mut g, s0, s1);
    let cb = g.vert(Vec3::new(0.0, 0.0, -depth), Vec3::NEG_Z, Vec2::ZERO);
    let bf = g.pos.len() as u32;
    for (p, _) in &outer {
        g.vert(p.extend(-depth), Vec3::NEG_Z, *p);
    }
    for i in 0..n as u32 {
        g.tri(cb, bf + (i + 1) % n as u32, bf + i);
    }
    g
}

/// Frustum / cylinder along +Y centred at the origin, optional caps.
pub fn cylinder(r_top: f32, r_bot: f32, h: f32, seg: usize, caps: bool) -> Geo {
    let mut g = Geo::default();
    let slope = (r_bot - r_top) / h;
    for i in 0..=seg {
        let a = i as f32 / seg as f32 * TAU;
        let (s, c) = a.sin_cos();
        let n = Vec3::new(s, slope, c).normalize();
        let u = a * (r_top + r_bot) * 0.5;
        g.vert(Vec3::new(s * r_top, h * 0.5, c * r_top), n, Vec2::new(u, 0.0));
        g.vert(Vec3::new(s * r_bot, -h * 0.5, c * r_bot), n, Vec2::new(u, h));
    }
    for i in 0..seg as u32 {
        let (a, b) = (i * 2, i * 2 + 2);
        g.quad(a, a + 1, b + 1, b);
    }
    if caps {
        for (y, r, n) in [(h * 0.5, r_top, Vec3::Y), (-h * 0.5, r_bot, Vec3::NEG_Y)] {
            if r <= 0.0 {
                continue;
            }
            let c = g.vert(Vec3::new(0.0, y, 0.0), n, Vec2::ZERO);
            let s0 = g.pos.len() as u32;
            for i in 0..seg {
                let a = i as f32 / seg as f32 * TAU;
                let p = Vec3::new(a.sin() * r, y, a.cos() * r);
                g.vert(p, n, Vec2::new(p.x, p.z));
            }
            for i in 0..seg as u32 {
                let j = (i + 1) % seg as u32;
                if n.y > 0.0 {
                    g.tri(c, s0 + i, s0 + j);
                } else {
                    g.tri(c, s0 + j, s0 + i);
                }
            }
        }
    }
    g
}

/// UV sphere patch: azimuth `phi` from `p0` over `dp` (0 = +Z, towards +X), polar `theta` from `t0` over `dt`
/// (0 = +Y). `inward` flips the faces to be seen from inside.
pub fn sphere_patch(r: f32, p0: f32, dp: f32, t0: f32, dt: f32, seg: usize, rings: usize, inward: bool) -> Geo {
    let mut g = Geo::default();
    for j in 0..=rings {
        let t = t0 + dt * j as f32 / rings as f32;
        for i in 0..=seg {
            let p = p0 + dp * i as f32 / seg as f32;
            let n = Vec3::new(t.sin() * p.sin(), t.cos(), t.sin() * p.cos());
            g.vert(n * r, if inward { -n } else { n }, Vec2::new(i as f32 / seg as f32, j as f32 / rings as f32));
        }
    }
    let row = seg as u32 + 1;
    for j in 0..rings as u32 {
        for i in 0..seg as u32 {
            let (a, b, c, d) = (j * row + i, j * row + i + 1, (j + 1) * row + i + 1, (j + 1) * row + i);
            if inward {
                g.quad(a, b, c, d);
            } else {
                g.quad(a, d, c, b);
            }
        }
    }
    g
}

pub fn sphere(r: f32, seg: usize, rings: usize) -> Geo {
    sphere_patch(r, 0.0, TAU, 0.0, PI, seg, rings, false)
}

/// Torus around +Y (ring radius `rr`, tube radius `tr`).
pub fn torus(rr: f32, tr: f32, seg: usize, tube_seg: usize) -> Geo {
    let mut g = Geo::default();
    for i in 0..=seg {
        let a = i as f32 / seg as f32 * TAU;
        let dir = Vec3::new(a.sin(), 0.0, a.cos());
        for j in 0..=tube_seg {
            let b = j as f32 / tube_seg as f32 * TAU;
            let n = dir * b.cos() + Vec3::Y * b.sin();
            g.vert(dir * rr + n * tr, n, Vec2::new(a * rr, b * tr));
        }
    }
    let row = tube_seg as u32 + 1;
    for i in 0..seg as u32 {
        for j in 0..tube_seg as u32 {
            let (a, b, c, d) = (i * row + j, (i + 1) * row + j, (i + 1) * row + j + 1, i * row + j + 1);
            g.quad(a, b, c, d);
        }
    }
    g
}

/// Capsule along +Y: cylinder of length `len` with hemispherical ends of radius `r`.
pub fn capsule(r: f32, len: f32, seg: usize) -> Geo {
    let mut g = Geo::default();
    let rings = 6;
    let mut nring = 0u32;
    for (off, t0) in [(len * 0.5, 0.0f32), (-len * 0.5, PI * 0.5)] {
        for j in 0..=rings {
            let t = t0 + j as f32 / rings as f32 * PI * 0.5;
            for i in 0..=seg {
                let a = i as f32 / seg as f32 * TAU;
                let n = Vec3::new(t.sin() * a.sin(), t.cos(), t.sin() * a.cos());
                g.vert(n * r + Vec3::Y * off, n, Vec2::new(a * r, -(n.y * r + off)));
            }
            nring += 1;
        }
    }
    let row = seg as u32 + 1;
    for j in 0..nring - 1 {
        for i in 0..seg as u32 {
            let (a, b, c, d) = (j * row + i, j * row + i + 1, (j + 1) * row + i + 1, (j + 1) * row + i);
            g.quad(a, d, c, b);
        }
    }
    g
}

/// Uniform Catmull-Rom point on the poly `pts` at parameter t in 0..1 (end points repeated).
pub fn catmull(pts: &[Vec3], t: f32) -> Vec3 {
    let n = pts.len();
    if n == 1 {
        return pts[0];
    }
    let f = t.clamp(0.0, 1.0) * (n - 1) as f32;
    let i = (f.floor() as usize).min(n - 2);
    let u = f - i as f32;
    let p0 = pts[i.saturating_sub(1)];
    let p1 = pts[i];
    let p2 = pts[i + 1];
    let p3 = pts[(i + 2).min(n - 1)];
    let (u2, u3) = (u * u, u * u * u);
    0.5 * ((2.0 * p1) + (-p0 + p2) * u + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * u2 + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * u3)
}

/// Tube along a Catmull-Rom curve through `pts`, elliptical section (`rx` sideways, `ry` along the frame's
/// up vector which starts closest to `up`), with flat end caps.
pub fn tube(pts: &[Vec3], rx: f32, ry: f32, steps: usize, radial: usize, up: Vec3) -> Geo {
    let mut g = Geo::default();
    let samples: Vec<Vec3> = (0..=steps).map(|i| catmull(pts, i as f32 / steps as f32)).collect();
    let tangent = |i: usize| -> Vec3 {
        let a = samples[i.saturating_sub(1)];
        let b = samples[(i + 1).min(steps)];
        (b - a).normalize_or(Vec3::Z)
    };
    // parallel transport frames
    let t0 = tangent(0);
    let mut nrm = (up - t0 * up.dot(t0)).normalize_or(t0.any_orthonormal_vector());
    let mut along = 0.0;
    for i in 0..=steps {
        let t = tangent(i);
        nrm = (nrm - t * nrm.dot(t)).normalize_or(t.any_orthonormal_vector());
        let bin = t.cross(nrm);
        if i > 0 {
            along += (samples[i] - samples[i - 1]).length();
        }
        for j in 0..=radial {
            let a = j as f32 / radial as f32 * TAU;
            let (s, c) = a.sin_cos();
            let off = bin * (c * rx) + nrm * (s * ry);
            let n = (bin * (c / rx.max(1e-5)) + nrm * (s / ry.max(1e-5))).normalize_or(off);
            g.vert(samples[i] + off, n, Vec2::new(along, -a * (rx + ry) * 0.5));
        }
    }
    let row = radial as u32 + 1;
    for i in 0..steps as u32 {
        for j in 0..radial as u32 {
            let (a, b, c, d) = (i * row + j, (i + 1) * row + j, (i + 1) * row + j + 1, i * row + j + 1);
            g.quad(a, b, c, d);
        }
    }
    // caps
    for (end, sign) in [(0usize, -1.0f32), (steps, 1.0)] {
        let n = tangent(end) * sign;
        let c = g.vert(samples[end], n, Vec2::ZERO);
        let base = end as u32 * row;
        for j in 0..radial as u32 {
            let (p, q) = (g.pos[(base + j) as usize], g.pos[(base + j + 1) as usize]);
            let a = g.vert(p, n, Vec2::ZERO);
            let b = g.vert(q, n, Vec2::ZERO);
            if sign > 0.0 {
                g.tri(c, b, a);
            } else {
                g.tri(c, a, b);
            }
        }
    }
    g
}

/// Inner face of a cylinder section around the camera (web console): radius `r_top` at y = +h/2 and `r_bot`
/// at -h/2, angles in degrees measured like `place()` (0 = straight ahead, positive to the right).
pub fn shell(r_top: f32, r_bot: f32, h: f32, deg0: f32, deg1: f32, seg: usize) -> Geo {
    let mut g = Geo::default();
    for i in 0..=seg {
        let a = (deg0 + (deg1 - deg0) * i as f32 / seg as f32).to_radians();
        let (s, c) = a.sin_cos();
        let top = Vec3::new(r_top * s, h * 0.5, -r_top * c);
        let bot = Vec3::new(r_bot * s, -h * 0.5, -r_bot * c);
        // inward normal, tilted by the flare
        let n = Vec3::new(-s, (r_bot - r_top) / h, c).normalize();
        let u = a * r_top;
        g.vert(top, n, Vec2::new(u, 0.0));
        g.vert(bot, n, Vec2::new(u, h));
    }
    for i in 0..seg as u32 {
        let (a, b) = (i * 2, i * 2 + 2);
        g.quad(a, a + 1, b + 1, b);
    }
    g
}

/// Flat rectangle in the XY plane facing +Z.
pub fn plane(w: f32, h: f32) -> Geo {
    let mut g = Geo::default();
    let a = g.vert(Vec3::new(-w * 0.5, -h * 0.5, 0.0), Vec3::Z, Vec2::new(0.0, 1.0));
    let b = g.vert(Vec3::new(w * 0.5, -h * 0.5, 0.0), Vec3::Z, Vec2::new(1.0, 1.0));
    let c = g.vert(Vec3::new(w * 0.5, h * 0.5, 0.0), Vec3::Z, Vec2::new(1.0, 0.0));
    let d = g.vert(Vec3::new(-w * 0.5, h * 0.5, 0.0), Vec3::Z, Vec2::new(0.0, 0.0));
    g.quad(a, b, c, d);
    g
}
