//! Procedural hull textures (port of the canvas painting in src/ships.js): coated metal plates with seams,
//! fasteners, hatches and wear; organic Aszendenz chitin with glowing veins; lit cabin windows; squadron
//! codes, alien glyphs and registry lettering drawn with a small built-in stencil font.
//! Every map is tileable (all drawing wraps) and gets a full mip chain.

use bevy::asset::RenderAssetUsages;
use bevy::image::{Image, ImageAddressMode, ImageFilterMode, ImageSampler, ImageSamplerDescriptor};
use bevy::prelude::*;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};

// ---------- seeded random numbers (mulberry32, as in the web version) ----------

#[derive(Clone)]
pub struct Rng(u32);

impl Rng {
    pub fn new(seed: u32) -> Self {
        Self(seed)
    }
    pub fn f(&mut self) -> f32 {
        self.0 = self.0.wrapping_add(0x6d2b79f5);
        let mut r = (self.0 ^ (self.0 >> 15)).wrapping_mul(1 | self.0);
        r ^= r.wrapping_add((r ^ (r >> 7)).wrapping_mul(61 | r));
        ((r ^ (r >> 14)) as f64 / 4294967296.0) as f32
    }
    pub fn range(&mut self, a: f32, b: f32) -> f32 {
        a + self.f() * (b - a)
    }
}

// ---------- a tiny wrapping canvas ----------

pub type Rgba = [f32; 4];

pub fn hex(c: u32, a: f32) -> Rgba {
    [((c >> 16) & 255) as f32 / 255.0, ((c >> 8) & 255) as f32 / 255.0, (c & 255) as f32 / 255.0, a]
}
pub const fn rgba(r: u8, g: u8, b: u8, a: f32) -> Rgba {
    [r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0, a]
}

/// Float RGBA canvas; colour canvases hold sRGB values like an HTML canvas, data canvases use the red channel.
pub struct Canvas {
    pub w: usize,
    pub h: usize,
    pub px: Vec<Rgba>,
    /// wrap drawing around the edges (tileable textures)
    pub wrap: bool,
}

impl Canvas {
    pub fn new(w: usize, h: usize, fill: Rgba) -> Self {
        Self { w, h, px: vec![fill; w * h], wrap: true }
    }
    #[inline]
    fn put(&mut self, x: i32, y: i32, c: Rgba, cov: f32) {
        let (w, h) = (self.w as i32, self.h as i32);
        let (x, y) = if self.wrap {
            (x.rem_euclid(w), y.rem_euclid(h))
        } else if x < 0 || y < 0 || x >= w || y >= h {
            return;
        } else {
            (x, y)
        };
        let a = (c[3] * cov).clamp(0.0, 1.0);
        if a <= 0.0 {
            return;
        }
        let p = &mut self.px[y as usize * self.w + x as usize];
        for k in 0..3 {
            p[k] += (c[k] - p[k]) * a;
        }
        p[3] = p[3] + a * (1.0 - p[3]);
    }
    /// erase alpha (destination-out)
    fn erase(&mut self, x: i32, y: i32, a: f32) {
        if x < 0 || y < 0 || x >= self.w as i32 || y >= self.h as i32 {
            return;
        }
        let p = &mut self.px[y as usize * self.w + x as usize];
        p[3] *= 1.0 - a.clamp(0.0, 1.0);
    }
    pub fn rect(&mut self, x: f32, y: f32, w: f32, h: f32, c: Rgba) {
        if w <= 0.0 || h <= 0.0 {
            return;
        }
        let (x0, y0, x1, y1) = (x.floor() as i32, y.floor() as i32, (x + w).ceil() as i32, (y + h).ceil() as i32);
        for yy in y0..y1 {
            let cy = ((yy + 1) as f32).min(y + h) - (yy as f32).max(y);
            for xx in x0..x1 {
                let cx = ((xx + 1) as f32).min(x + w) - (xx as f32).max(x);
                self.put(xx, yy, c, cx.clamp(0.0, 1.0) * cy.clamp(0.0, 1.0));
            }
        }
    }
    pub fn erase_rect(&mut self, x: f32, y: f32, w: f32, h: f32, a: f32) {
        for yy in y.floor() as i32..(y + h).ceil() as i32 {
            for xx in x.floor() as i32..(x + w).ceil() as i32 {
                self.erase(xx, yy, a);
            }
        }
    }
    /// stroked rectangle outline
    pub fn rect_line(&mut self, x: f32, y: f32, w: f32, h: f32, lw: f32, c: Rgba) {
        self.rect(x - lw * 0.5, y - lw * 0.5, w + lw, lw, c);
        self.rect(x - lw * 0.5, y + h - lw * 0.5, w + lw, lw, c);
        self.rect(x - lw * 0.5, y + lw * 0.5, lw, h - lw, c);
        self.rect(x + w - lw * 0.5, y + lw * 0.5, lw, h - lw, c);
    }
    /// vertical linear gradient c0 (top) -> c1 (bottom)
    pub fn vgrad(&mut self, x: f32, y: f32, w: f32, h: f32, c0: Rgba, c1: Rgba) {
        let (y0, y1) = (y.floor() as i32, (y + h).ceil() as i32);
        for yy in y0..y1 {
            let t = ((yy as f32 + 0.5 - y) / h).clamp(0.0, 1.0);
            let c = [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t, c0[3] + (c1[3] - c0[3]) * t];
            self.rect(x, yy as f32, w, 1.0, c);
        }
    }
    /// filled ellipse with rotation (anti-aliased edge); `stops` = radial gradient (t, colour) or a single colour
    pub fn ellipse_grad(&mut self, cx: f32, cy: f32, rx: f32, ry: f32, rot: f32, stops: &[(f32, Rgba)]) {
        let r = rx.max(ry) + 1.0;
        let (s, c) = rot.sin_cos();
        for yy in (cy - r).floor() as i32..(cy + r).ceil() as i32 {
            for xx in (cx - r).floor() as i32..(cx + r).ceil() as i32 {
                let (dx, dy) = (xx as f32 + 0.5 - cx, yy as f32 + 0.5 - cy);
                let (u, v) = ((dx * c + dy * s) / rx.max(0.01), (-dx * s + dy * c) / ry.max(0.01));
                let d = (u * u + v * v).sqrt();
                let edge = ((1.0 - d) * rx.min(ry).max(0.5)).clamp(0.0, 1.0);
                if edge <= 0.0 {
                    continue;
                }
                let col = grad_at(stops, d);
                self.put(xx, yy, col, edge);
            }
        }
    }
    pub fn ellipse(&mut self, cx: f32, cy: f32, rx: f32, ry: f32, rot: f32, c: Rgba) {
        self.ellipse_grad(cx, cy, rx, ry, rot, &[(0.0, c)]);
    }
    /// thick anti-aliased line segment with round caps
    pub fn line(&mut self, x0: f32, y0: f32, x1: f32, y1: f32, lw: f32, c: Rgba) {
        let hw = lw * 0.5;
        let (minx, maxx) = (x0.min(x1) - hw - 1.0, x0.max(x1) + hw + 1.0);
        let (miny, maxy) = (y0.min(y1) - hw - 1.0, y0.max(y1) + hw + 1.0);
        let (dx, dy) = (x1 - x0, y1 - y0);
        let l2 = (dx * dx + dy * dy).max(1e-6);
        for yy in miny.floor() as i32..maxy.ceil() as i32 {
            for xx in minx.floor() as i32..maxx.ceil() as i32 {
                let (px, py) = (xx as f32 + 0.5, yy as f32 + 0.5);
                let t = (((px - x0) * dx + (py - y0) * dy) / l2).clamp(0.0, 1.0);
                let (ex, ey) = (px - (x0 + dx * t), py - (y0 + dy * t));
                let d = (ex * ex + ey * ey).sqrt();
                let cov = (hw + 0.5 - d).clamp(0.0, 1.0);
                if cov > 0.0 {
                    self.put(xx, yy, c, cov);
                }
            }
        }
    }
    /// filled polygon (even-odd), 4x vertical supersampling for smooth edges
    pub fn poly(&mut self, pts: &[(f32, f32)], c: Rgba) {
        let miny = pts.iter().fold(f32::MAX, |m, p| m.min(p.1)).floor() as i32;
        let maxy = pts.iter().fold(f32::MIN, |m, p| m.max(p.1)).ceil() as i32;
        let mut xs: Vec<f32> = Vec::with_capacity(8);
        for yy in miny..maxy {
            let mut cover: Vec<(i32, f32)> = Vec::new();
            for sub in 0..4 {
                let sy = yy as f32 + (sub as f32 + 0.5) / 4.0;
                xs.clear();
                for i in 0..pts.len() {
                    let (a, b) = (pts[i], pts[(i + 1) % pts.len()]);
                    if (a.1 <= sy) != (b.1 <= sy) {
                        xs.push(a.0 + (sy - a.1) / (b.1 - a.1) * (b.0 - a.0));
                    }
                }
                xs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                for pair in xs.chunks_exact(2) {
                    for xx in pair[0].round() as i32..pair[1].round() as i32 {
                        cover.push((xx, 0.25));
                    }
                }
            }
            cover.sort_by_key(|c| c.0);
            let mut i = 0;
            while i < cover.len() {
                let x = cover[i].0;
                let mut a = 0.0;
                while i < cover.len() && cover[i].0 == x {
                    a += cover[i].1;
                    i += 1;
                }
                self.put(x, yy, c, a);
            }
        }
    }
}

fn grad_at(stops: &[(f32, Rgba)], t: f32) -> Rgba {
    if stops.len() == 1 || t <= stops[0].0 {
        return stops[0].1;
    }
    for w in stops.windows(2) {
        if t <= w[1].0 {
            let k = (t - w[0].0) / (w[1].0 - w[0].0).max(1e-6);
            let (a, b) = (w[0].1, w[1].1);
            return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
        }
    }
    stops[stops.len() - 1].1
}

// ---------- coated hull metal ----------

/// The three maps of a hull material, drawn from one layout.
pub struct HullMaps {
    pub color: Canvas,
    /// height for the normal map (red channel, 0.5 = neutral)
    pub height: Canvas,
    /// red = roughness, green = metallic
    pub rough: Canvas,
}

/// Irregular aerospace panel layout: the square split recursively into large and small plates.
fn panel_layout(s: f32, seed: u32, min: f32) -> Vec<[f32; 4]> {
    let mut r = Rng::new(seed);
    let mut out = Vec::new();
    fn split(r: &mut Rng, out: &mut Vec<[f32; 4]>, x: f32, y: f32, w: f32, h: f32, d: u32, min: f32) {
        if (w < min * 2.0 && h < min * 2.0) || (d > 2 && r.f() < 0.22) {
            out.push([x, y, w, h]);
            return;
        }
        let vert = if w > h * 1.3 { true } else if h > w * 1.3 { false } else { r.f() < 0.5 };
        if vert && w >= min * 2.0 {
            let k = ((0.3 + r.f() * 0.4) * w).round();
            split(r, out, x, y, k, h, d + 1, min);
            split(r, out, x + k, y, w - k, h, d + 1, min);
        } else if !vert && h >= min * 2.0 {
            let k = ((0.3 + r.f() * 0.4) * h).round();
            split(r, out, x, y, w, k, d + 1, min);
            split(r, out, x, y + k, w, h - k, d + 1, min);
        } else {
            out.push([x, y, w, h]);
        }
    }
    split(&mut r, &mut out, 0.0, 0.0, s, s, 0, min);
    out
}

/// Painted metal: brushed base under a thin coat, plates with seams and bevel highlights, fasteners,
/// hatches, grilles, service ports, stencils and hazard chevrons (metalHull() of the web version).
pub fn metal_hull(size: usize, seed: u32, min: f32, accent: Rgba) -> HullMaps {
    let s = size as f32;
    let mut c = Canvas::new(size, size, hex(0xc6c9cd, 1.0));
    let mut h = Canvas::new(size, size, [0.5, 0.5, 0.5, 1.0]);
    let mut ro = Canvas::new(size, size, [0.46, 0.72, 0.0, 1.0]);
    let mut r = Rng::new(seed + 99);
    let white = |a: f32| [1.0, 1.0, 1.0, a];
    let black = |a: f32| [0.0, 0.0, 0.0, a];
    for _ in 0..(s * 1.6) as usize {
        let col = if r.f() < 0.5 { white(0.015 + r.f() * 0.03) } else { black(0.015 + r.f() * 0.03) };
        c.rect(r.f() * s, r.f() * s, 20.0 + r.f() * 160.0, 1.0, col);
    }
    for _ in 0..26 {
        let (x, y, rad) = (r.f() * s, r.f() * s, s * (0.08 + r.f() * 0.2));
        let col = if r.f() < 0.5 { [60.0 / 255.0, 62.0 / 255.0, 68.0 / 255.0, 0.06] } else { white(0.06) };
        c.ellipse_grad(x, y, rad, rad, 0.0, &[(0.0, col), (1.0, [col[0], col[1], col[2], 0.0])]);
    }
    for [x, y, w, hh] in panel_layout(s, seed, min) {
        let t = r.f() - 0.5;
        c.rect(x, y, w, hh, if t > 0.0 { white(t * 0.07) } else { [20.0 / 255.0, 22.0 / 255.0, 26.0 / 255.0, -t * 0.08] });
        h.rect(x, y, w, hh, if t > 0.0 { white(t.abs() * 0.12) } else { black(t.abs() * 0.12) });
        ro.rect(x, y, w, hh, [0.46 + t * 0.12, 0.72, 0.0, 1.0]);
        // seam: a fine groove with a bevel highlight
        c.rect(x, y, w, 1.2, rgba(18, 20, 24, 0.6));
        c.rect(x, y, 1.2, hh, rgba(18, 20, 24, 0.6));
        c.rect(x + 1.2, y + 1.2, w - 1.2, 1.0, white(0.22));
        c.rect(x + 1.2, y + 1.2, 1.0, hh - 1.2, white(0.22));
        h.rect(x, y, w, 2.0, [0.16, 0.16, 0.16, 1.0]);
        h.rect(x, y, 2.0, hh, [0.16, 0.16, 0.16, 1.0]);
        ro.rect(x, y, w, 2.0, [0.65, 0.5, 0.0, 1.0]);
        ro.rect(x, y, 2.0, hh, [0.65, 0.5, 0.0, 1.0]);
        if r.f() < 0.45 {
            let mut k = 6.0;
            while k < w - 4.0 {
                c.rect(x + k, y + 4.0, 1.6, 1.6, rgba(235, 238, 242, 0.35));
                h.rect(x + k, y + 4.0, 1.6, 1.6, [0.78, 0.78, 0.78, 1.0]);
                k += 11.0;
            }
            if r.f() < 0.5 {
                let mut k = 6.0;
                while k < hh - 4.0 {
                    c.rect(x + 4.0, y + k, 1.6, 1.6, rgba(235, 238, 242, 0.35));
                    h.rect(x + 4.0, y + k, 1.6, 1.6, [0.78, 0.78, 0.78, 1.0]);
                    k += 11.0;
                }
            }
        }
        if w > min * 1.4 && hh > min * 1.2 && r.f() < 0.55 {
            let kind = r.f();
            let (cx, cy) = (x + w * (0.25 + r.f() * 0.5), y + hh * (0.25 + r.f() * 0.5));
            let ink = rgba(20, 22, 26, 0.55);
            let dent = [0.3, 0.3, 0.3, 1.0];
            if kind < 0.35 {
                // access hatch with a latch
                let (hw, hhh) = ((w * 0.5).min(60.0), (hh * 0.45).min(40.0));
                c.rect_line(cx - hw / 2.0, cy - hhh / 2.0, hw, hhh, 1.2, ink);
                h.rect_line(cx - hw / 2.0, cy - hhh / 2.0, hw, hhh, 1.6, dent);
                c.rect(cx + hw / 2.0 - 8.0, cy - 3.0, 5.0, 6.0, rgba(214, 160, 40, 0.7));
                ro.rect(cx - hw / 2.0, cy - hhh / 2.0, hw, hhh, [0.4, 0.72, 0.0, 0.5]);
            } else if kind < 0.6 {
                // vent grille
                let n = 5 + (r.f() * 5.0) as usize;
                let gw = (w * 0.5).min(54.0);
                for i in 0..n {
                    let yy = cy - n as f32 * 2.5 + i as f32 * 5.0;
                    c.rect(cx - gw / 2.0, yy, gw, 2.0, ink);
                    h.rect(cx - gw / 2.0, yy, gw, 2.0, [0.22, 0.22, 0.22, 1.0]);
                    ro.rect(cx - gw / 2.0, yy, gw, 2.0, [0.8, 0.4, 0.0, 1.0]);
                }
            } else if kind < 0.8 {
                // service port with bolts
                let rad = w.min(hh) * 0.12 + 5.0;
                ring_stroke(&mut c, cx, cy, rad, 1.2, ink);
                ring_stroke(&mut h, cx, cy, rad, 1.6, dent);
                for i in 0..6 {
                    let a = i as f32 / 6.0 * std::f32::consts::TAU;
                    c.rect(cx + a.cos() * (rad - 3.0) - 1.0, cy + a.sin() * (rad - 3.0) - 1.0, 2.0, 2.0, ink);
                    h.rect(cx + a.cos() * (rad - 3.0) - 1.0, cy + a.sin() * (rad - 3.0) - 1.0, 2.0, 2.0, [0.75, 0.75, 0.75, 1.0]);
                }
            } else {
                // stencil marking: a coloured bar and small print
                c.rect(cx - 18.0, cy - 6.0, 6.0, 12.0, accent);
                for i in 0..3 {
                    c.rect(cx - 9.0, cy - 6.0 + i as f32 * 4.5, 18.0 + r.f() * 22.0, 2.0, rgba(30, 32, 36, 0.55));
                }
                ro.rect(cx - 18.0, cy - 6.0, 50.0, 12.0, [0.38, 0.5, 0.0, 1.0]);
            }
        }
    }
    // hazard chevrons
    for _ in 0..2 {
        let (x, y, w) = (r.f() * s, r.f() * s, 40.0 + r.f() * 50.0);
        let mut k = -10.0;
        let mut i = 0;
        while k < w + 10.0 {
            let col = if i % 2 == 1 { rgba(25, 25, 28, 0.7) } else { rgba(214, 170, 40, 0.75) };
            let p = [(x + k, y + 8.0), (x + k + 6.0, y), (x + k + 10.0, y), (x + k + 4.0, y + 8.0)];
            let clipped: Vec<(f32, f32)> = p.iter().map(|&(px, py)| (px.clamp(x, x + w), py)).collect();
            c.poly(&clipped, col);
            k += 8.0;
            i += 1;
        }
    }
    HullMaps { color: c, height: h, rough: ro }
}

fn ring_stroke(c: &mut Canvas, cx: f32, cy: f32, r: f32, lw: f32, col: Rgba) {
    let n = ((r * 0.8) as usize).max(12);
    for i in 0..n {
        let (a0, a1) = (i as f32 / n as f32 * std::f32::consts::TAU, (i + 1) as f32 / n as f32 * std::f32::consts::TAU);
        c.line(cx + a0.cos() * r, cy + a0.sin() * r, cx + a1.cos() * r, cy + a1.sin() * r, lw, col);
    }
}

/// Battle and service wear: replacement plates, grime streaks, soot, oil stains, chipped paint, scratches.
pub fn weather(m: &mut HullMaps, seed: u32, k: f32) {
    let s = m.color.w as f32;
    let mut r = Rng::new(seed);
    let (c, ro) = (&mut m.color, &mut m.rough);
    for _ in 0..(3.0 * k) as usize {
        let (x, y, w, h) = (r.range(0.0, s), r.range(0.0, s), r.range(30.0, 90.0), r.range(20.0, 60.0));
        let v = if r.f() < 0.5 { rgba(120, 128, 138, 0.14) } else { rgba(205, 200, 185, 0.12) };
        c.rect(x, y, w, h, v);
        c.rect_line(x, y, w, h, 1.5, rgba(20, 20, 22, 0.6));
        let mut q = 4.0;
        while q < w - 3.0 {
            c.rect(x + q, y + 3.0, 1.5, 1.5, [1.0, 1.0, 1.0, 0.4]);
            c.rect(x + q, y + h - 4.0, 1.5, 1.5, [1.0, 1.0, 1.0, 0.4]);
            q += 7.0;
        }
        ro.rect(x, y, w, h, [0.36, 0.72, 0.0, 0.6]);
    }
    for _ in 0..(160.0 * k) as usize {
        let (x, y, len, w) = (r.range(0.0, s), r.range(0.0, s), r.range(10.0, 70.0), r.range(1.0, 4.0));
        let a = r.range(0.15, 0.4);
        c.vgrad(x, y, w, len, rgba(35, 30, 25, a), rgba(35, 30, 25, 0.0));
        ro.vgrad(x, y, w, len, [0.85, 0.5, 0.0, 0.3], [0.85, 0.5, 0.0, 0.0]);
    }
    for _ in 0..(9.0 * k) as usize {
        let (x, y, rad) = (r.range(0.0, s), r.range(0.0, s), r.range(14.0, 55.0));
        let (sq, rot) = (r.range(0.25, 0.6), r.range(-0.3, 0.3));
        c.ellipse_grad(x, y, rad * 1.4, rad * sq, rot, &[(0.0, rgba(10, 8, 6, 0.45)), (0.45, rgba(45, 30, 18, 0.25)), (1.0, rgba(60, 40, 20, 0.0))]);
        ro.ellipse_grad(x, y, rad * 0.6, rad * 0.6, 0.0, &[(0.0, [0.92, 0.3, 0.0, 0.5]), (1.0, [0.92, 0.3, 0.0, 0.0])]);
    }
    for _ in 0..(12.0 * k) as usize {
        let (x, y, rad) = (r.range(0.0, s), r.range(0.0, s), r.range(6.0, 20.0));
        let (a, rot) = (r.range(0.12, 0.3), r.range(0.0, 3.0));
        c.ellipse(x, y, rad, rad * 0.6, rot, rgba(30, 24, 40, a));
        ro.ellipse(x, y, rad, rad * 0.6, rot, [0.25, 0.6, 0.0, a]);
    }
    for _ in 0..(520.0 * k) as usize {
        let edge = r.f() < 0.6;
        let x = r.range(0.0, s);
        let y = if edge { (r.range(0.0, 8.0)).round() * (s / 8.0) + r.range(-4.0, 5.0) } else { r.range(0.0, s) };
        let (w, h) = (r.range(1.0, 6.0), r.range(1.0, 3.5));
        let (a, rot) = (r.range(0.35, 0.85), r.range(0.0, 3.0));
        c.ellipse(x, y, w, h, rot, rgba(225, 228, 232, a));
        // bare metal: smoother and fully metallic
        ro.rect(x - w / 2.0, y - h / 2.0, w, h, [0.22, 1.0, 0.0, 0.8]);
    }
    for _ in 0..(90.0 * k) as usize {
        let (x, y, a, l) = (r.range(0.0, s), r.range(0.0, s), r.range(-0.6, 0.6), r.range(8.0, 60.0));
        let (al, lw) = (r.range(0.15, 0.45), r.range(0.5, 1.4));
        c.line(x, y, x + a.cos() * l, y + a.sin() * l, lw, rgba(235, 235, 235, al));
    }
}

// ---------- organic Aszendenz chitin ----------

/// Chitin scales from a tileable Worley pattern: raised cells, dark crevices, oily mottling, and a vein
/// map (emissive) along some of the cell borders. Returns (maps, veins).
pub fn chitin(size: usize, seed: u32, cells: usize, vein_share: f32) -> (HullMaps, Canvas) {
    let mut r = Rng::new(seed);
    let n = cells;
    // jittered feature points per grid cell
    let pts: Vec<(f32, f32, f32)> = (0..n * n).map(|_| (r.f(), r.f(), r.f())).collect();
    let mut c = Canvas::new(size, size, [0.0; 4]);
    let mut h = Canvas::new(size, size, [0.5, 0.5, 0.5, 1.0]);
    let mut ro = Canvas::new(size, size, [0.4, 0.6, 0.0, 1.0]);
    let mut v = Canvas::new(size, size, [0.0, 0.0, 0.0, 1.0]);
    let noise = ValueNoise::new(seed ^ 0x5bd1e995, 8);
    let cs = size as f32 / n as f32;
    for y in 0..size {
        for x in 0..size {
            let (fx, fy) = (x as f32 / cs, y as f32 / cs);
            let (gx, gy) = (fx.floor() as i32, fy.floor() as i32);
            let (mut d1, mut d2, mut id1, mut id2) = (f32::MAX, f32::MAX, 0usize, 0usize);
            for oy in -1..=1 {
                for ox in -1..=1 {
                    let (cx, cy) = (gx + ox, gy + oy);
                    let id = (cy.rem_euclid(n as i32) as usize) * n + cx.rem_euclid(n as i32) as usize;
                    let p = pts[id];
                    let (px, py) = (cx as f32 + 0.15 + p.0 * 0.7, cy as f32 + 0.15 + p.1 * 0.7);
                    // slightly elongated scales
                    let d = ((px - fx) * (px - fx) * 0.8 + (py - fy) * (py - fy) * 1.25).sqrt();
                    if d < d1 {
                        d2 = d1;
                        id2 = id1;
                        d1 = d;
                        id1 = id;
                    } else if d < d2 {
                        d2 = d;
                        id2 = id;
                    }
                }
            }
            let edge = d2 - d1;
            let u = (x as f32 / size as f32, y as f32 / size as f32);
            let nz = noise.fbm(u.0, u.1, 3);
            let cell = pts[id1].2;
            let ridge = smooth(0.0, 0.22, edge);
            let dome = 1.0 - d1.min(1.0) * 0.6;
            let hv = 0.28 + ridge * (0.32 + dome * 0.25) + (nz - 0.5) * 0.12;
            let i = y * size + x;
            h.px[i] = [hv, hv, hv, 1.0];
            // colour: violet-black chitin with reddish and blue-green oily tints, lighter cell centres
            let t = cell * 0.6 + nz * 0.4;
            let base = [0.55 + 0.25 * t, 0.42 + 0.12 * (1.0 - t), 0.62 + 0.25 * (1.0 - t)];
            let shade = 0.35 + 0.65 * ridge * (0.7 + 0.3 * dome);
            c.px[i] = [base[0] * shade, base[1] * shade, base[2] * shade, 1.0];
            ro.px[i] = [0.55 - 0.3 * ridge + (nz - 0.5) * 0.2, 0.45 + 0.3 * ridge, 0.0, 1.0];
            // veins: along cell borders where the pair hash is low, brighter where the noise rises
            let pair = hash2(id1.min(id2) as u32, id1.max(id2) as u32, seed);
            if pair < vein_share {
                let w = smooth(0.09, 0.0, edge);
                let g = w * (0.4 + 0.9 * nz.powf(1.5));
                v.px[i] = [g, g, g, 1.0];
            }
        }
    }
    (HullMaps { color: c, height: h, rough: ro }, v)
}

fn smooth(e0: f32, e1: f32, x: f32) -> f32 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn hash2(a: u32, b: u32, seed: u32) -> f32 {
    let mut h = a.wrapping_mul(0x9E3779B1) ^ b.wrapping_mul(0x85EBCA77) ^ seed.wrapping_mul(0xC2B2AE3D);
    h ^= h >> 15;
    h = h.wrapping_mul(0x2C1B3C6D);
    h ^= h >> 12;
    (h & 0xffff) as f32 / 65535.0
}

/// Tileable value noise on a `period` lattice.
pub struct ValueNoise {
    v: Vec<f32>,
    period: usize,
}

impl ValueNoise {
    pub fn new(seed: u32, period: usize) -> Self {
        let mut r = Rng::new(seed);
        Self { v: (0..period * period * 16).map(|_| r.f()).collect(), period }
    }
    fn sample(&self, x: f32, y: f32, p: usize) -> f32 {
        let (x0, y0) = (x.floor(), y.floor());
        let (tx, ty) = (x - x0, y - y0);
        let (sx, sy) = (tx * tx * (3.0 - 2.0 * tx), ty * ty * (3.0 - 2.0 * ty));
        let at = |i: i32, j: i32| self.v[(j.rem_euclid(p as i32) as usize) * p + i.rem_euclid(p as i32) as usize];
        let (i, j) = (x0 as i32, y0 as i32);
        let a = at(i, j) + (at(i + 1, j) - at(i, j)) * sx;
        let b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
        a + (b - a) * sy
    }
    /// u, v in 0..1 (one tile)
    pub fn fbm(&self, u: f32, v: f32, oct: u32) -> f32 {
        let (mut sum, mut amp, mut norm) = (0.0, 0.5, 0.0);
        let mut p = self.period;
        for _ in 0..oct {
            if p * p > self.v.len() {
                break;
            }
            sum += self.sample(u * p as f32, v * p as f32, p) * amp;
            norm += amp;
            amp *= 0.5;
            p *= 2;
        }
        sum / norm
    }
}

// ---------- windows, glow, decals ----------

/// Rows of lit cabin windows on black (emissive map for capital hulls). `pores`: round organic lights.
pub fn windows(size: usize, seed: u32, pores: bool) -> Canvas {
    let mut c = Canvas::new(size, size, [0.0, 0.0, 0.0, 1.0]);
    let mut r = Rng::new(seed);
    let s = size as f32 / 512.0;
    for row in 0..12 {
        if r.f() < 0.35 {
            continue;
        }
        let y = (20.0 + row as f32 * 40.0 + r.f() * 8.0) * s;
        let mut x = 8.0 * s;
        while x < size as f32 - 8.0 * s {
            if r.f() < 0.55 {
                let v = if r.f() < 0.85 { 1.0 } else { 0.53 };
                if pores {
                    c.ellipse(x + 2.0 * s, y + 1.5 * s, 2.0 * s, 1.6 * s, 0.0, [v, v, v, 1.0]);
                } else {
                    c.rect(x, y, 4.0 * s, 3.0 * s, [v, v, v, 1.0]);
                }
            }
            x += 9.0 * s;
        }
    }
    c
}

/// Soft radial glow (nav lights)
pub fn glow(size: usize) -> Canvas {
    let mut c = Canvas::new(size, size, [0.0; 4]);
    c.wrap = false;
    let h = size as f32 / 2.0;
    for y in 0..size {
        for x in 0..size {
            let d = (((x as f32 + 0.5 - h).powi(2) + (y as f32 + 0.5 - h).powi(2)).sqrt() / h).min(1.0);
            let a = grad_at(&[(0.0, [1.0; 4]), (0.2, [0.65; 4]), (0.5, [0.18; 4]), (1.0, [0.0; 4])], d)[0];
            c.px[y * size + x] = [a, a, a, a];
        }
    }
    c
}

/// Jump-gate field: faint concentric ripples brightening towards the rim (additive, alpha = brightness)
pub fn ripples(size: usize) -> Canvas {
    let mut c = Canvas::new(size, size, [0.0; 4]);
    c.wrap = false;
    let h = size as f32 / 2.0;
    for y in 0..size {
        for x in 0..size {
            let (dx, dy) = (x as f32 + 0.5 - h, y as f32 + 0.5 - h);
            let d = ((dx * dx + dy * dy).sqrt() / h).min(1.0);
            let a = dy.atan2(dx);
            let wave = 0.5 + 0.5 * (d * 38.0 - a * 2.0 + (a * 5.0).sin() * 0.6).sin();
            let v = (0.25 + 0.45 * wave * d + 0.9 * d.powi(6)) * if d >= 1.0 { 0.0 } else { 1.0 };
            c.px[y * size + x] = [v, v, v, v];
        }
    }
    c
}

/// stencil font: polylines on a 4 x 6 grid (y down); (advance, strokes)
fn glyph(ch: char) -> (f32, &'static [&'static [(f32, f32)]]) {
    match ch {
        'A' => (4.0, &[&[(0.0, 6.0), (0.0, 1.5), (1.5, 0.0), (2.5, 0.0), (4.0, 1.5), (4.0, 6.0)], &[(0.0, 3.6), (4.0, 3.6)]]),
        'B' => (4.0, &[&[(0.0, 0.0), (3.0, 0.0), (4.0, 1.0), (4.0, 2.0), (3.0, 3.0), (0.0, 3.0)], &[(3.0, 3.0), (4.0, 4.0), (4.0, 5.0), (3.0, 6.0), (0.0, 6.0), (0.0, 0.0)]]),
        'C' => (4.0, &[&[(4.0, 0.0), (1.0, 0.0), (0.0, 1.0), (0.0, 5.0), (1.0, 6.0), (4.0, 6.0)]]),
        'D' => (4.0, &[&[(0.0, 0.0), (3.0, 0.0), (4.0, 1.0), (4.0, 5.0), (3.0, 6.0), (0.0, 6.0), (0.0, 0.0)]]),
        'E' => (3.6, &[&[(3.6, 0.0), (0.0, 0.0), (0.0, 6.0), (3.6, 6.0)], &[(0.0, 3.0), (3.0, 3.0)]]),
        'F' => (3.6, &[&[(3.6, 0.0), (0.0, 0.0), (0.0, 6.0)], &[(0.0, 3.0), (3.0, 3.0)]]),
        'G' => (4.0, &[&[(4.0, 1.0), (3.0, 0.0), (1.0, 0.0), (0.0, 1.0), (0.0, 5.0), (1.0, 6.0), (3.0, 6.0), (4.0, 5.0), (4.0, 3.2), (2.2, 3.2)]]),
        'H' => (4.0, &[&[(0.0, 0.0), (0.0, 6.0)], &[(4.0, 0.0), (4.0, 6.0)], &[(0.0, 3.0), (4.0, 3.0)]]),
        'I' => (0.0, &[&[(0.0, 0.0), (0.0, 6.0)]]),
        'J' => (4.0, &[&[(4.0, 0.0), (4.0, 5.0), (3.0, 6.0), (1.0, 6.0), (0.0, 5.0)]]),
        'K' => (4.0, &[&[(0.0, 0.0), (0.0, 6.0)], &[(4.0, 0.0), (1.2, 3.0), (0.0, 3.0)], &[(1.2, 3.0), (4.0, 6.0)]]),
        'L' => (3.6, &[&[(0.0, 0.0), (0.0, 6.0), (3.6, 6.0)]]),
        'M' => (5.0, &[&[(0.0, 6.0), (0.0, 0.0), (2.5, 3.2), (5.0, 0.0), (5.0, 6.0)]]),
        'N' => (4.0, &[&[(0.0, 6.0), (0.0, 0.0), (4.0, 6.0), (4.0, 0.0)]]),
        'O' | '0' => (4.0, &[&[(1.0, 0.0), (3.0, 0.0), (4.0, 1.0), (4.0, 5.0), (3.0, 6.0), (1.0, 6.0), (0.0, 5.0), (0.0, 1.0), (1.0, 0.0)]]),
        'P' => (4.0, &[&[(0.0, 6.0), (0.0, 0.0), (3.0, 0.0), (4.0, 1.0), (4.0, 2.2), (3.0, 3.2), (0.0, 3.2)]]),
        'Q' => (4.0, &[&[(1.0, 0.0), (3.0, 0.0), (4.0, 1.0), (4.0, 5.0), (3.0, 6.0), (1.0, 6.0), (0.0, 5.0), (0.0, 1.0), (1.0, 0.0)], &[(2.6, 4.6), (4.0, 6.0)]]),
        'R' => (4.0, &[&[(0.0, 6.0), (0.0, 0.0), (3.0, 0.0), (4.0, 1.0), (4.0, 2.2), (3.0, 3.2), (0.0, 3.2)], &[(2.2, 3.2), (4.0, 6.0)]]),
        'S' => (4.0, &[&[(4.0, 0.0), (1.0, 0.0), (0.0, 1.0), (0.0, 2.0), (1.0, 3.0), (3.0, 3.0), (4.0, 4.0), (4.0, 5.0), (3.0, 6.0), (0.0, 6.0)]]),
        'T' => (4.0, &[&[(0.0, 0.0), (4.0, 0.0)], &[(2.0, 0.0), (2.0, 6.0)]]),
        'U' => (4.0, &[&[(0.0, 0.0), (0.0, 5.0), (1.0, 6.0), (3.0, 6.0), (4.0, 5.0), (4.0, 0.0)]]),
        'V' => (4.0, &[&[(0.0, 0.0), (2.0, 6.0), (4.0, 0.0)]]),
        'W' => (5.0, &[&[(0.0, 0.0), (1.25, 6.0), (2.5, 2.2), (3.75, 6.0), (5.0, 0.0)]]),
        'X' => (4.0, &[&[(0.0, 0.0), (4.0, 6.0)], &[(4.0, 0.0), (0.0, 6.0)]]),
        'Y' => (4.0, &[&[(0.0, 0.0), (2.0, 3.0), (4.0, 0.0)], &[(2.0, 3.0), (2.0, 6.0)]]),
        'Z' => (4.0, &[&[(0.0, 0.0), (4.0, 0.0), (0.0, 6.0), (4.0, 6.0)]]),
        '1' => (2.0, &[&[(0.0, 1.4), (1.6, 0.0), (1.6, 6.0)]]),
        '2' => (4.0, &[&[(0.0, 1.0), (1.0, 0.0), (3.0, 0.0), (4.0, 1.0), (4.0, 2.2), (0.0, 6.0), (4.0, 6.0)]]),
        '3' => (4.0, &[&[(0.0, 0.0), (4.0, 0.0), (1.8, 2.6), (3.0, 2.6), (4.0, 3.6), (4.0, 5.0), (3.0, 6.0), (0.0, 6.0)]]),
        '4' => (4.0, &[&[(3.0, 6.0), (3.0, 0.0), (0.0, 4.2), (4.0, 4.2)]]),
        '5' => (4.0, &[&[(4.0, 0.0), (0.0, 0.0), (0.0, 2.6), (3.0, 2.6), (4.0, 3.6), (4.0, 5.0), (3.0, 6.0), (0.0, 6.0)]]),
        '6' => (4.0, &[&[(4.0, 0.0), (1.0, 0.0), (0.0, 1.0), (0.0, 5.0), (1.0, 6.0), (3.0, 6.0), (4.0, 5.0), (4.0, 3.6), (3.0, 2.6), (0.0, 2.6)]]),
        '7' => (4.0, &[&[(0.0, 0.0), (4.0, 0.0), (1.4, 6.0)]]),
        '8' => (4.0, &[&[(1.0, 3.0), (0.0, 2.0), (0.0, 1.0), (1.0, 0.0), (3.0, 0.0), (4.0, 1.0), (4.0, 2.0), (3.0, 3.0), (1.0, 3.0), (0.0, 4.0), (0.0, 5.0), (1.0, 6.0), (3.0, 6.0), (4.0, 5.0), (4.0, 4.0), (3.0, 3.0)]]),
        '9' => (4.0, &[&[(0.0, 6.0), (3.0, 6.0), (4.0, 5.0), (4.0, 1.0), (3.0, 0.0), (1.0, 0.0), (0.0, 1.0), (0.0, 2.4), (1.0, 3.4), (4.0, 3.4)]]),
        '-' => (3.0, &[&[(0.0, 3.2), (3.0, 3.2)]]),
        '·' => (0.0, &[&[(0.0, 3.0), (0.0, 3.0)]]),
        _ => (2.6, &[]),
    }
}

/// Width of `txt` drawn by `text()` at cap height `h`.
pub fn text_width(txt: &str, h: f32, weight: f32) -> f32 {
    let k = h / 6.0;
    txt.chars().map(|ch| glyph(ch).0 * k + weight * k + 1.6 * k).sum::<f32>()
}

/// Draw `text` with the stencil font; `h` = cap height in pixels. Returns the end x.
pub fn text(c: &mut Canvas, txt: &str, x: f32, y: f32, h: f32, weight: f32, col: Rgba) -> f32 {
    let k = h / 6.0;
    let lw = weight * k;
    let mut cx = x + lw * 0.5;
    for ch in txt.chars() {
        let (adv, strokes) = glyph(ch);
        for s in strokes {
            for w in s.windows(2) {
                c.line(cx + w[0].0 * k, y + w[0].1 * k, cx + w[1].0 * k, y + w[1].1 * k, lw, col);
            }
        }
        cx += adv * k + lw + 1.6 * k;
    }
    cx
}

/// Squadron code on a Union fighter's flank: orange bars and a chipped white stencil.
pub fn code_decal(code: &str, seed: u32) -> Canvas {
    let mut c = Canvas::new(256, 64, [0.0; 4]);
    c.wrap = false;
    c.rect(0.0, 22.0, 18.0, 20.0, rgba(200, 88, 26, 0.95));
    c.rect(22.0, 22.0, 8.0, 20.0, rgba(200, 88, 26, 0.95));
    text(&mut c, code, 40.0, 14.0, 38.0, 1.5, rgba(235, 238, 240, 0.95));
    let mut r = Rng::new(seed);
    for _ in 0..260 {
        let a = r.f() * 0.9;
        c.erase_rect(r.f() * 256.0, r.f() * 64.0, 1.0 + r.f() * 5.0, 1.0 + r.f() * 3.0, a);
    }
    for p in &mut c.px {
        p[3] *= 0.65;
    }
    c
}

/// Aszendenz glyph band (emissive pink)
pub fn glyph_decal() -> Canvas {
    let mut c = Canvas::new(256, 64, [0.0; 4]);
    c.wrap = false;
    let col = rgba(255, 90, 200, 1.0);
    for i in 0..6 {
        let x = 20.0 + i as f32 * 38.0;
        c.line(x, 12.0, x + 14.0, 32.0, 4.0, col);
        c.line(x + 14.0, 32.0, x, 52.0, 4.0, col);
        if i % 2 == 1 {
            c.line(x + 22.0, 14.0, x + 22.0, 50.0, 4.0, col);
        }
    }
    c
}

/// Ship name, class line and the Union emblem (ring with a star), as on the web's registryTexture().
pub fn registry(name: &str, sub: &str) -> Canvas {
    let mut c = Canvas::new(1024, 160, [0.0; 4]);
    c.wrap = false;
    let white = rgba(232, 236, 240, 0.92);
    let orange = rgba(232, 120, 40, 0.95);
    // shrink long names to the plate (1024 px wide, text from x = 150)
    let fit = |t: &str, h: f32, w: f32| h.min(h * 850.0 / text_width(t, h, w).max(1.0));
    let hn = fit(name, 74.0, 1.25);
    text(&mut c, name, 150.0, 28.0 + (74.0 - hn) * 0.5, hn, 1.25, white);
    let hs = fit(sub, 30.0, 1.3);
    text(&mut c, sub, 152.0, 118.0, hs, 1.3, orange);
    ring_stroke(&mut c, 70.0, 80.0, 52.0, 9.0, orange);
    let star: Vec<(f32, f32)> = (0..10)
        .map(|i| {
            let a = -std::f32::consts::FRAC_PI_2 + i as f32 * std::f32::consts::PI / 5.0;
            let rr = if i % 2 == 1 { 16.0 } else { 40.0 };
            (70.0 + a.cos() * rr, 80.0 + a.sin() * rr)
        })
        .collect();
    c.poly(&star, white);
    c
}

// ---------- conversion to GPU images ----------

fn to_u8(v: f32) -> u8 {
    (v.clamp(0.0, 1.0) * 255.0 + 0.5) as u8
}

fn sampler(repeat: bool) -> ImageSampler {
    let mode = if repeat { ImageAddressMode::Repeat } else { ImageAddressMode::ClampToEdge };
    ImageSampler::Descriptor(ImageSamplerDescriptor {
        address_mode_u: mode,
        address_mode_v: mode,
        address_mode_w: mode,
        mag_filter: ImageFilterMode::Linear,
        min_filter: ImageFilterMode::Linear,
        mipmap_filter: ImageFilterMode::Linear,
        anisotropy_clamp: 8,
        ..default()
    })
}

/// RGBA8 image with a box-filtered mip chain. `normal`: renormalise each level as a normal map.
fn image_from(w: usize, h: usize, base: Vec<[f32; 4]>, srgb: bool, repeat: bool, normal: bool) -> Image {
    let mut data: Vec<u8> = Vec::with_capacity(w * h * 6);
    let mut level = base;
    let (mut lw, mut lh) = (w, h);
    let mut levels = 0;
    loop {
        for p in &level {
            data.extend_from_slice(&[to_u8(p[0]), to_u8(p[1]), to_u8(p[2]), to_u8(p[3])]);
        }
        levels += 1;
        if lw == 1 && lh == 1 {
            break;
        }
        let (nw, nh) = ((lw / 2).max(1), (lh / 2).max(1));
        let mut next = vec![[0.0f32; 4]; nw * nh];
        for y in 0..nh {
            for x in 0..nw {
                let mut acc = [0.0f32; 4];
                for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                    let (sx, sy) = ((x * 2 + dx).min(lw - 1), (y * 2 + dy).min(lh - 1));
                    let p = level[sy * lw + sx];
                    for k in 0..4 {
                        acc[k] += p[k] * 0.25;
                    }
                }
                if normal {
                    let n = Vec3::new(acc[0] * 2.0 - 1.0, acc[1] * 2.0 - 1.0, acc[2] * 2.0 - 1.0).normalize_or(Vec3::Z);
                    acc = [n.x * 0.5 + 0.5, n.y * 0.5 + 0.5, n.z * 0.5 + 0.5, 1.0];
                }
                next[y * nw + x] = acc;
            }
        }
        level = next;
        lw = nw;
        lh = nh;
    }
    let format = if srgb { TextureFormat::Rgba8UnormSrgb } else { TextureFormat::Rgba8Unorm };
    let mut img = Image::new_uninit(Extent3d { width: w as u32, height: h as u32, depth_or_array_layers: 1 }, TextureDimension::D2, format, RenderAssetUsages::RENDER_WORLD);
    img.texture_descriptor.mip_level_count = levels;
    img.data = Some(data);
    img.sampler = sampler(repeat);
    img
}

/// Colour canvas -> sRGB image.
pub fn color_image(c: Canvas, repeat: bool) -> Image {
    image_from(c.w, c.h, c.px, true, repeat, false)
}

/// Height canvas -> tangent-space normal map (B = +v, i.e. down the image).
pub fn normal_image(hc: &Canvas, strength: f32) -> Image {
    let (w, h) = (hc.w, hc.h);
    let at = |x: i32, y: i32| hc.px[(y.rem_euclid(h as i32) as usize) * w + x.rem_euclid(w as i32) as usize][0];
    let mut px = Vec::with_capacity(w * h);
    for y in 0..h as i32 {
        for x in 0..w as i32 {
            let dx = (at(x + 1, y - 1) + 2.0 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2.0 * at(x - 1, y) + at(x - 1, y + 1));
            let dy = (at(x - 1, y + 1) + 2.0 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2.0 * at(x, y - 1) + at(x + 1, y - 1));
            let n = Vec3::new(-dx * strength, -dy * strength, 1.0).normalize();
            px.push([n.x * 0.5 + 0.5, n.y * 0.5 + 0.5, n.z * 0.5 + 0.5, 1.0]);
        }
    }
    image_from(w, h, px, false, true, true)
}

/// Roughness (red) / metallic (green) canvas -> Bevy's metallic-roughness layout (G = roughness, B = metallic).
pub fn metal_rough_image(c: Canvas) -> Image {
    let px = c.px.into_iter().map(|p| [0.0, p[0].clamp(0.05, 1.0), p[1].clamp(0.0, 1.0), 1.0]).collect();
    image_from(c.w, c.h, px, false, true, false)
}

/// Emissive data canvas (red channel) -> sRGB grey image (emissive maps are colour textures in Bevy).
pub fn emissive_image(c: Canvas) -> Image {
    let px = c.px.into_iter().map(|p| { let v = p[0].clamp(0.0, 1.0).powf(1.0 / 2.2); [v, v, v, 1.0] }).collect();
    image_from(c.w, c.h, px, true, true, false)
}
