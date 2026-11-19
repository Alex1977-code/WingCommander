//! A small software canvas for the cockpit's instrument screens and textures: anti-aliased rectangles,
//! lines, arcs, polygons, a vector stroke font with umlauts, seven-segment digits and label-maker tape.
//! Colours are sRGB values with straight alpha, like an HTML canvas.

use bevy::asset::RenderAssetUsages;
use bevy::image::{Image, ImageAddressMode, ImageFilterMode, ImageSampler, ImageSamplerDescriptor};
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};

pub type Rgba = [f32; 4];

/// `0xRRGGBB` + alpha -> colour
pub const fn hex(c: u32, a: f32) -> Rgba {
    [((c >> 16) & 255) as f32 / 255.0, ((c >> 8) & 255) as f32 / 255.0, (c & 255) as f32 / 255.0, a]
}

/// same colour, other alpha
pub const fn with_a(c: Rgba, a: f32) -> Rgba {
    [c[0], c[1], c[2], a]
}

pub fn mix(a: Rgba, b: Rgba, t: f32) -> Rgba {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]
}

/// Small deterministic random generator (xorshift), no allocations, good enough for wear and noise.
#[derive(Clone, Copy, Debug)]
pub struct Rng(u32);

impl Rng {
    pub fn new(seed: u32) -> Self {
        Self(seed.wrapping_mul(2_654_435_761).max(1))
    }
    pub fn u(&mut self) -> u32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        x
    }
    /// 0..1
    pub fn f(&mut self) -> f32 {
        (self.u() >> 8) as f32 / (1u32 << 24) as f32
    }
    pub fn range(&mut self, a: f32, b: f32) -> f32 {
        a + self.f() * (b - a)
    }
    pub fn chance(&mut self, p: f32) -> bool {
        self.f() < p
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Align {
    Left,
    Center,
    Right,
}

pub struct Canvas {
    pub w: usize,
    pub h: usize,
    pub px: Vec<Rgba>,
    /// draw additively ("lighter") instead of alpha blending
    pub additive: bool,
    /// clip rectangle (x0, y0, x1, y1) in pixels
    clip: (i32, i32, i32, i32),
    xs: Vec<f32>,
    cover: Vec<f32>,
    pts: Vec<(f32, f32)>,
}

impl Canvas {
    pub fn new(w: usize, h: usize, fill: Rgba) -> Self {
        Self { w, h, px: vec![fill; w * h], additive: false, clip: (0, 0, w as i32, h as i32), xs: Vec::with_capacity(16), cover: vec![0.0; w], pts: Vec::with_capacity(64) }
    }

    pub fn clear(&mut self, c: Rgba) {
        self.px.fill(c);
    }

    pub fn set_clip(&mut self, x: f32, y: f32, w: f32, h: f32) {
        self.clip = (x.max(0.0) as i32, y.max(0.0) as i32, ((x + w) as i32).min(self.w as i32), ((y + h) as i32).min(self.h as i32));
    }
    pub fn reset_clip(&mut self) {
        self.clip = (0, 0, self.w as i32, self.h as i32);
    }

    #[inline]
    pub fn put(&mut self, x: i32, y: i32, c: Rgba, cov: f32) {
        if x < self.clip.0 || y < self.clip.1 || x >= self.clip.2 || y >= self.clip.3 {
            return;
        }
        let a = (c[3] * cov).clamp(0.0, 1.0);
        if a <= 0.0 {
            return;
        }
        let p = &mut self.px[y as usize * self.w + x as usize];
        if self.additive {
            for k in 0..3 {
                p[k] = (p[k] + c[k] * a).min(1.0);
            }
        } else {
            for k in 0..3 {
                p[k] += (c[k] - p[k]) * a;
            }
            p[3] += a * (1.0 - p[3]);
        }
    }

    /// destination-out: erase alpha
    pub fn erase(&mut self, x: i32, y: i32, a: f32) {
        if x < 0 || y < 0 || x >= self.w as i32 || y >= self.h as i32 {
            return;
        }
        let p = &mut self.px[y as usize * self.w + x as usize];
        p[3] *= 1.0 - a.clamp(0.0, 1.0);
    }

    pub fn erase_rect(&mut self, x: f32, y: f32, w: f32, h: f32, a: f32) {
        for yy in y.floor() as i32..(y + h).ceil() as i32 {
            for xx in x.floor() as i32..(x + w).ceil() as i32 {
                self.erase(xx, yy, a);
            }
        }
    }

    /// filled rectangle with anti-aliased edges
    pub fn rect(&mut self, x: f32, y: f32, w: f32, h: f32, c: Rgba) {
        if w <= 0.0 || h <= 0.0 {
            return;
        }
        let (x0, y0, x1, y1) = (x.floor() as i32, y.floor() as i32, (x + w).ceil() as i32, (y + h).ceil() as i32);
        let (x0, y0, x1, y1) = (x0.max(self.clip.0), y0.max(self.clip.1), x1.min(self.clip.2), y1.min(self.clip.3));
        for yy in y0..y1 {
            let cy = (((yy + 1) as f32).min(y + h) - (yy as f32).max(y)).clamp(0.0, 1.0);
            for xx in x0..x1 {
                let cx = (((xx + 1) as f32).min(x + w) - (xx as f32).max(x)).clamp(0.0, 1.0);
                self.put(xx, yy, c, cx * cy);
            }
        }
    }

    pub fn rect_line(&mut self, x: f32, y: f32, w: f32, h: f32, lw: f32, c: Rgba) {
        self.rect(x - lw * 0.5, y - lw * 0.5, w + lw, lw, c);
        self.rect(x - lw * 0.5, y + h - lw * 0.5, w + lw, lw, c);
        self.rect(x - lw * 0.5, y + lw * 0.5, lw, h - lw, c);
        self.rect(x + w - lw * 0.5, y + lw * 0.5, lw, h - lw, c);
    }

    /// vertical gradient c0 (top) -> c1 (bottom)
    pub fn vgrad(&mut self, x: f32, y: f32, w: f32, h: f32, c0: Rgba, c1: Rgba) {
        for yy in y.floor() as i32..(y + h).ceil() as i32 {
            let t = ((yy as f32 + 0.5 - y) / h).clamp(0.0, 1.0);
            self.rect(x, yy as f32, w, 1.0, mix(c0, c1, t));
        }
    }

    /// thick anti-aliased segment with round caps; cost grows with length x width only
    pub fn line(&mut self, x0: f32, y0: f32, x1: f32, y1: f32, lw: f32, c: Rgba) {
        let hw = lw * 0.5;
        let (dx, dy) = (x1 - x0, y1 - y0);
        let l2 = dx * dx + dy * dy;
        let reach = hw + 1.0;
        let dist = |px: f32, py: f32| {
            let t = if l2 > 1e-9 { (((px - x0) * dx + (py - y0) * dy) / l2).clamp(0.0, 1.0) } else { 0.0 };
            let (ex, ey) = (px - (x0 + dx * t), py - (y0 + dy * t));
            (ex * ex + ey * ey).sqrt()
        };
        if dx.abs() >= dy.abs() {
            // walk columns, a short vertical span around the line in each
            let (xa, xb) = ((x0.min(x1) - reach).floor() as i32, (x0.max(x1) + reach).ceil() as i32);
            let slope = if dx.abs() > 1e-6 { dy / dx } else { 0.0 };
            let span = reach * (1.0 + slope * slope).sqrt() + 1.0;
            for xx in xa.max(self.clip.0)..xb.min(self.clip.2) {
                let px = xx as f32 + 0.5;
                let tx = if dx.abs() > 1e-6 { ((px - x0) / dx).clamp(0.0, 1.0) } else { 0.0 };
                let yc = y0 + dy * tx;
                for yy in (yc - span).floor() as i32..(yc + span).ceil() as i32 {
                    let cov = (hw + 0.5 - dist(px, yy as f32 + 0.5)).clamp(0.0, 1.0);
                    if cov > 0.0 {
                        self.put(xx, yy, c, cov);
                    }
                }
            }
        } else {
            let (ya, yb) = ((y0.min(y1) - reach).floor() as i32, (y0.max(y1) + reach).ceil() as i32);
            let slope = dx / dy;
            let span = reach * (1.0 + slope * slope).sqrt() + 1.0;
            for yy in ya.max(self.clip.1)..yb.min(self.clip.3) {
                let py = yy as f32 + 0.5;
                let ty = ((py - y0) / dy).clamp(0.0, 1.0);
                let xc = x0 + dx * ty;
                for xx in (xc - span).floor() as i32..(xc + span).ceil() as i32 {
                    let cov = (hw + 0.5 - dist(xx as f32 + 0.5, py)).clamp(0.0, 1.0);
                    if cov > 0.0 {
                        self.put(xx, yy, c, cov);
                    }
                }
            }
        }
    }

    pub fn polyline(&mut self, pts: &[(f32, f32)], lw: f32, c: Rgba) {
        for w in pts.windows(2) {
            self.line(w[0].0, w[0].1, w[1].0, w[1].1, lw, c);
        }
    }

    /// stroked elliptical arc from angle a0 to a1 (radians, 0 = +x, clockwise on screen as y points down)
    pub fn arc(&mut self, cx: f32, cy: f32, rx: f32, ry: f32, a0: f32, a1: f32, lw: f32, c: Rgba) {
        let n = (((a1 - a0).abs() * rx.max(ry) / 4.0).ceil() as usize).clamp(4, 96);
        let mut prev = (cx + a0.cos() * rx, cy + a0.sin() * ry);
        for i in 1..=n {
            let a = a0 + (a1 - a0) * i as f32 / n as f32;
            let p = (cx + a.cos() * rx, cy + a.sin() * ry);
            self.line(prev.0, prev.1, p.0, p.1, lw, c);
            prev = p;
        }
    }

    /// filled axis-aligned ellipse with an anti-aliased edge
    pub fn ellipse(&mut self, cx: f32, cy: f32, rx: f32, ry: f32, c: Rgba) {
        let (rx, ry) = (rx.max(0.3), ry.max(0.3));
        let (y0, y1) = (((cy - ry).floor() as i32).max(self.clip.1), ((cy + ry).ceil() as i32).min(self.clip.3));
        let (x0, x1) = (((cx - rx).floor() as i32).max(self.clip.0), ((cx + rx).ceil() as i32).min(self.clip.2));
        let m = rx.min(ry);
        for yy in y0..y1 {
            let v = (yy as f32 + 0.5 - cy) / ry;
            for xx in x0..x1 {
                let u = (xx as f32 + 0.5 - cx) / rx;
                let d = (u * u + v * v).sqrt();
                let cov = ((1.0 - d) * m + 0.5).clamp(0.0, 1.0);
                if cov > 0.0 {
                    self.put(xx, yy, c, cov);
                }
            }
        }
    }

    /// soft radial glow: alpha falls off smoothly to zero at `r`
    pub fn glow(&mut self, cx: f32, cy: f32, r: f32, c: Rgba) {
        let (y0, y1) = (((cy - r).floor() as i32).max(self.clip.1), ((cy + r).ceil() as i32).min(self.clip.3));
        let (x0, x1) = (((cx - r).floor() as i32).max(self.clip.0), ((cx + r).ceil() as i32).min(self.clip.2));
        for yy in y0..y1 {
            for xx in x0..x1 {
                let (dx, dy) = (xx as f32 + 0.5 - cx, yy as f32 + 0.5 - cy);
                let t = 1.0 - (dx * dx + dy * dy).sqrt() / r;
                if t > 0.0 {
                    self.put(xx, yy, c, t * t);
                }
            }
        }
    }

    /// filled polygon (even-odd rule) with 4x vertical supersampling
    pub fn poly(&mut self, pts: &[(f32, f32)], c: Rgba) {
        if pts.len() < 3 {
            return;
        }
        let miny = (pts.iter().fold(f32::MAX, |m, p| m.min(p.1)).floor() as i32).max(self.clip.1);
        let maxy = (pts.iter().fold(f32::MIN, |m, p| m.max(p.1)).ceil() as i32).min(self.clip.3);
        let minx = (pts.iter().fold(f32::MAX, |m, p| m.min(p.0)).floor() as i32).max(self.clip.0);
        let maxx = (pts.iter().fold(f32::MIN, |m, p| m.max(p.0)).ceil() as i32 + 1).min(self.clip.2);
        if minx >= maxx {
            return;
        }
        let mut xs = std::mem::take(&mut self.xs);
        let mut cover = std::mem::take(&mut self.cover);
        for yy in miny..maxy {
            cover[minx as usize..maxx as usize].fill(0.0);
            for sub in 0..4 {
                let sy = yy as f32 + (sub as f32 + 0.5) * 0.25;
                xs.clear();
                for i in 0..pts.len() {
                    let (a, b) = (pts[i], pts[(i + 1) % pts.len()]);
                    if (a.1 <= sy) != (b.1 <= sy) {
                        xs.push(a.0 + (sy - a.1) / (b.1 - a.1) * (b.0 - a.0));
                    }
                }
                xs.sort_unstable_by(|a, b| a.total_cmp(b));
                for pair in xs.chunks_exact(2) {
                    let (xa, xb) = (pair[0].max(minx as f32), pair[1].min(maxx as f32));
                    if xb <= xa {
                        continue;
                    }
                    // exact horizontal coverage of the span in each pixel
                    let (ia, ib) = (xa.floor() as i32, xb.ceil() as i32);
                    for xx in ia..ib {
                        let l = (xx as f32).max(xa);
                        let r = ((xx + 1) as f32).min(xb);
                        if r > l {
                            cover[xx as usize] += (r - l) * 0.25;
                        }
                    }
                }
            }
            for xx in minx..maxx {
                let a = cover[xx as usize];
                if a > 0.0 {
                    self.put(xx, yy, c, a.min(1.0));
                }
            }
        }
        self.xs = xs;
        self.cover = cover;
    }

    pub fn tri(&mut self, a: (f32, f32), b: (f32, f32), c2: (f32, f32), c: Rgba) {
        self.poly(&[a, b, c2], c);
    }

    /// draws `mask` (alpha 0..1, `mw` x `mh`) tinted with `c`, scaled into the box at (x, y, w, h)
    pub fn mask(&mut self, mask: &[f32], mw: usize, mh: usize, x: f32, y: f32, w: f32, h: f32, c: Rgba) {
        let (x0, y0) = ((x.floor() as i32).max(self.clip.0), (y.floor() as i32).max(self.clip.1));
        let (x1, y1) = (((x + w).ceil() as i32).min(self.clip.2), ((y + h).ceil() as i32).min(self.clip.3));
        let (sx, sy) = (mw as f32 / w, mh as f32 / h);
        for yy in y0..y1 {
            let my = ((yy as f32 + 0.5 - y) * sy) as i32;
            if my < 0 || my >= mh as i32 {
                continue;
            }
            for xx in x0..x1 {
                let mx = ((xx as f32 + 0.5 - x) * sx) as i32;
                if mx < 0 || mx >= mw as i32 {
                    continue;
                }
                let a = mask[my as usize * mw + mx as usize];
                if a > 0.003 {
                    self.put(xx, yy, c, a);
                }
            }
        }
    }

    /// horizontal CRT scanlines: darken every `step`-th row
    pub fn scanlines(&mut self, step: usize, k: f32) {
        for y in (0..self.h).step_by(step.max(1)) {
            for p in &mut self.px[y * self.w..(y + 1) * self.w] {
                p[0] *= k;
                p[1] *= k;
                p[2] *= k;
            }
        }
    }

    /// phosphor glow: a blurred copy of the bright parts added back on top (quarter resolution, cheap)
    pub fn phosphor(&mut self, gain: f32, tmp: &mut Vec<[f32; 3]>) {
        let (qw, qh) = (self.w / 4, self.h / 4);
        tmp.clear();
        tmp.resize(qw * qh * 2, [0.0; 3]);
        let (small, blur) = tmp.split_at_mut(qw * qh);
        for qy in 0..qh {
            for qx in 0..qw {
                let mut acc = [0.0f32; 3];
                for dy in 0..4 {
                    let row = (qy * 4 + dy) * self.w + qx * 4;
                    for p in &self.px[row..row + 4] {
                        acc[0] += p[0];
                        acc[1] += p[1];
                        acc[2] += p[2];
                    }
                }
                small[qy * qw + qx] = [acc[0] / 16.0, acc[1] / 16.0, acc[2] / 16.0];
            }
        }
        // separable 5-tap blur
        const W: [f32; 5] = [0.1, 0.2, 0.4, 0.2, 0.1];
        for qy in 0..qh {
            for qx in 0..qw {
                let mut acc = [0.0f32; 3];
                for (i, w) in W.iter().enumerate() {
                    let sx = (qx as i32 + i as i32 - 2).clamp(0, qw as i32 - 1) as usize;
                    let s = small[qy * qw + sx];
                    acc[0] += s[0] * w;
                    acc[1] += s[1] * w;
                    acc[2] += s[2] * w;
                }
                blur[qy * qw + qx] = acc;
            }
        }
        for qy in 0..qh {
            for qx in 0..qw {
                let mut acc = [0.0f32; 3];
                for (i, w) in W.iter().enumerate() {
                    let sy = (qy as i32 + i as i32 - 2).clamp(0, qh as i32 - 1) as usize;
                    let s = blur[sy * qw + qx];
                    acc[0] += s[0] * w;
                    acc[1] += s[1] * w;
                    acc[2] += s[2] * w;
                }
                small[qy * qw + qx] = acc;
            }
        }
        // bilinear upsample and add
        for y in 0..self.h {
            let fy = ((y as f32 + 0.5) / 4.0 - 0.5).clamp(0.0, (qh - 1) as f32);
            let (y0, ty) = (fy as usize, fy.fract());
            let y1 = (y0 + 1).min(qh - 1);
            for x in 0..self.w {
                let fx = ((x as f32 + 0.5) / 4.0 - 0.5).clamp(0.0, (qw - 1) as f32);
                let (x0, tx) = (fx as usize, fx.fract());
                let x1 = (x0 + 1).min(qw - 1);
                let p = &mut self.px[y * self.w + x];
                for k in 0..3 {
                    let a = small[y0 * qw + x0][k] * (1.0 - tx) + small[y0 * qw + x1][k] * tx;
                    let b = small[y1 * qw + x0][k] * (1.0 - tx) + small[y1 * qw + x1][k] * tx;
                    p[k] = (p[k] + (a * (1.0 - ty) + b * ty) * gain).min(1.0);
                }
            }
        }
    }

    // ---------- text ----------

    /// Width of `txt` in the stroke font at cap height `h` (x-scale `sx`).
    pub fn text_width(txt: &str, h: f32, weight: f32) -> f32 {
        let k = h / 6.0;
        let mut w = 0.0;
        for ch in txt.chars() {
            for g in upper(ch) {
                w += (glyph(g).0 + weight + 1.7) * k;
            }
        }
        (w - 1.7 * k).max(0.0)
    }

    /// Draws `txt` with the vector stroke font. `y` = top of the capitals, `h` = cap height in pixels,
    /// `weight` = stroke width in font units (~1 regular, 1.4 bold), `sx` squeezes horizontally.
    /// Returns the x after the text.
    #[allow(clippy::too_many_arguments)]
    pub fn text_ex(&mut self, txt: &str, x: f32, y: f32, h: f32, weight: f32, c: Rgba, align: Align, sx: f32) -> f32 {
        let k = h / 6.0;
        let w = Self::text_width(txt, h, weight) * sx;
        let mut cx = match align {
            Align::Left => x,
            Align::Center => x - w * 0.5,
            Align::Right => x - w,
        };
        let lw = (weight * k).max(0.8);
        cx += lw * 0.5 * sx;
        for ch in txt.chars() {
            for g in upper(ch) {
                let (adv, strokes) = glyph(g);
                match g {
                    '▲' => self.poly(&[(cx + 2.0 * k * sx, y), (cx + 4.0 * k * sx, y + 6.0 * k), (cx, y + 6.0 * k)], c),
                    '◆' => self.poly(&[(cx + 2.0 * k * sx, y), (cx + 4.0 * k * sx, y + 3.0 * k), (cx + 2.0 * k * sx, y + 6.0 * k), (cx, y + 3.0 * k)], c),
                    '▌' => self.rect(cx, y - 0.5 * k, 2.4 * k * sx, 7.0 * k, c),
                    _ => {
                        for s in strokes {
                            if s.len() == 1 {
                                // dot
                                let (px, py) = (cx + s[0].0 * k * sx, y + s[0].1 * k);
                                self.ellipse(px, py, lw * 0.62, lw * 0.62, c);
                                continue;
                            }
                            for seg in s.windows(2) {
                                self.line(cx + seg[0].0 * k * sx, y + seg[0].1 * k, cx + seg[1].0 * k * sx, y + seg[1].1 * k, lw, c);
                            }
                        }
                    }
                }
                cx += (adv + weight + 1.7) * k * sx;
            }
        }
        cx
    }

    pub fn text(&mut self, txt: &str, x: f32, y: f32, h: f32, c: Rgba, align: Align) -> f32 {
        self.text_ex(txt, x, y, h, 1.1, c, align, 1.0)
    }

    /// text squeezed to fit `max_w`
    pub fn text_fit(&mut self, txt: &str, x: f32, y: f32, h: f32, max_w: f32, c: Rgba, align: Align) -> f32 {
        let w = Self::text_width(txt, h, 1.1);
        let sx = if w > max_w { max_w / w } else { 1.0 };
        self.text_ex(txt, x, y, h, 1.1, c, align, sx)
    }

    // ---------- instruments ----------

    /// one seven-segment digit (also '-', ' ', 'E', 'r', 'o') of size w x h
    pub fn seg7(&mut self, ch: char, x: f32, y: f32, w: f32, h: f32, on: Rgba, off: Rgba) {
        let segs = match ch {
            '0' | 'O' => "abcdef",
            '1' => "bc",
            '2' => "abdeg",
            '3' => "abcdg",
            '4' => "bcfg",
            '5' | 'S' => "acdfg",
            '6' => "acdefg",
            '7' => "abc",
            '8' => "abcdefg",
            '9' => "abcdfg",
            '-' => "g",
            'E' => "adefg",
            'r' => "eg",
            'o' => "cdeg",
            _ => "",
        };
        let t = w * 0.2;
        let h2 = h / 2.0;
        for k in ['a', 'b', 'c', 'd', 'e', 'f', 'g'] {
            let (bx, by, bw, bh, hor) = match k {
                'a' => (x + t * 0.6, y, w - t * 1.2, t, true),
                'd' => (x + t * 0.6, y + h - t, w - t * 1.2, t, true),
                'g' => (x + t * 0.6, y + h2 - t / 2.0, w - t * 1.2, t, true),
                'f' => (x, y + t * 0.6, t, h2 - t * 0.9, false),
                'b' => (x + w - t, y + t * 0.6, t, h2 - t * 0.9, false),
                'e' => (x, y + h2 + t * 0.3, t, h2 - t * 0.9, false),
                _ => (x + w - t, y + h2 + t * 0.3, t, h2 - t * 0.9, false),
            };
            let lit = segs.contains(k);
            let mut pts = std::mem::take(&mut self.pts);
            pts.clear();
            if hor {
                pts.extend_from_slice(&[(bx, by + bh / 2.0), (bx + bh / 2.0, by), (bx + bw - bh / 2.0, by), (bx + bw, by + bh / 2.0), (bx + bw - bh / 2.0, by + bh), (bx + bh / 2.0, by + bh)]);
            } else {
                pts.extend_from_slice(&[(bx + bw / 2.0, by), (bx + bw, by + bw / 2.0), (bx + bw, by + bh - bw / 2.0), (bx + bw / 2.0, by + bh), (bx, by + bh - bw / 2.0), (bx, by + bw / 2.0)]);
            }
            if lit {
                // halo, then the bright segment
                let (gx, gy) = (bx + bw / 2.0, by + bh / 2.0);
                let add = std::mem::replace(&mut self.additive, true);
                self.glow(gx, gy, bw.max(bh) * 0.75, with_a(on, 0.22));
                self.additive = add;
                self.poly(&pts, on);
            } else {
                self.poly(&pts, off);
            }
            self.pts = pts;
        }
    }

    /// a row of seven-segment characters; '.' and ':' squeeze in between
    #[allow(clippy::too_many_arguments)]
    pub fn seg_text(&mut self, s: &str, x: f32, y: f32, w: f32, h: f32, on: Rgba, off: Rgba) {
        let mut cx = x;
        for ch in s.chars() {
            match ch {
                '.' => self.rect(cx - w * 0.12, y + h - w * 0.2, w * 0.18, w * 0.18, on),
                ':' => {
                    self.rect(cx, y + h * 0.28, w * 0.18, w * 0.18, on);
                    self.rect(cx, y + h * 0.65, w * 0.18, w * 0.18, on);
                    cx += w * 0.4;
                }
                _ => {
                    self.seg7(ch, cx, y, w, h, on, off);
                    cx += w * 1.3;
                }
            }
        }
    }

    /// picture lost: snow, a rolling bar and an intermittent message
    pub fn static_noise(&mut self, rng: &mut Rng, t: f32, dead: bool) {
        self.clear(if dead { hex(0x020403, 1.0) } else { hex(0x06100b, 1.0) });
        let n = if dead { 260 } else { 900 } * self.w * self.h / (320 * 240);
        let (w, h) = (self.w as f32, self.h as f32);
        for _ in 0..n {
            let v = rng.f() * if dead { 0.27 } else { 0.75 };
            let (x, y) = (rng.f() * w, rng.f() * h);
            self.rect(x, y, rng.range(1.0, 4.0), rng.range(1.0, 2.0), [v, v + 0.04, v, 1.0]);
        }
        let by = (t * 250.0) % h;
        self.rect(0.0, by, w, h * 0.12, hex(0xa0ffc8, 0.08));
        if (t * 3.85).sin() > -0.3 {
            let c = if dead { hex(0xff4d6d, 0.85) } else { hex(0xffc857, 0.85) };
            let th = w / 16.0;
            self.text_fit(if dead { "SIGNAL VERLOREN" } else { "STÖRUNG" }, w / 2.0, h / 2.0 - th / 2.0, th, w * 0.9, c, Align::Center);
        }
    }

    // ---------- output ----------

    /// RGBA8 sRGB bytes (the canvas holds sRGB values already)
    pub fn write_rgba8(&self, out: &mut [u8]) {
        for (o, p) in out.chunks_exact_mut(4).zip(&self.px) {
            o[0] = to_u8(p[0]);
            o[1] = to_u8(p[1]);
            o[2] = to_u8(p[2]);
            o[3] = to_u8(p[3]);
        }
    }

    /// A live screen image: one mip level, linear filtering, data kept in the main world for updates.
    pub fn live_image(&self) -> Image {
        let mut data = vec![0u8; self.w * self.h * 4];
        self.write_rgba8(&mut data);
        let mut img = Image::new(
            Extent3d { width: self.w as u32, height: self.h as u32, depth_or_array_layers: 1 },
            TextureDimension::D2,
            data,
            TextureFormat::Rgba8UnormSrgb,
            RenderAssetUsages::default(),
        );
        img.sampler = sampler(false, 4);
        img
    }

    /// A static texture with a box-filtered mip chain. `srgb` = colour data.
    pub fn static_image(&self, srgb: bool, repeat: bool) -> Image {
        image_with_mips(self.w, self.h, &self.px, srgb, repeat)
    }
}

#[inline]
pub fn to_u8(v: f32) -> u8 {
    (v.clamp(0.0, 1.0) * 255.0 + 0.5) as u8
}

pub fn sampler(repeat: bool, aniso: u16) -> ImageSampler {
    let mode = if repeat { ImageAddressMode::Repeat } else { ImageAddressMode::ClampToEdge };
    ImageSampler::Descriptor(ImageSamplerDescriptor {
        address_mode_u: mode,
        address_mode_v: mode,
        address_mode_w: mode,
        mag_filter: ImageFilterMode::Linear,
        min_filter: ImageFilterMode::Linear,
        mipmap_filter: ImageFilterMode::Linear,
        anisotropy_clamp: aniso,
        ..Default::default()
    })
}

/// RGBA8 image with a box-filtered mip chain (static textures).
pub fn image_with_mips(w: usize, h: usize, base: &[Rgba], srgb: bool, repeat: bool) -> Image {
    let mut data: Vec<u8> = Vec::with_capacity(w * h * 6);
    let mut level: Vec<Rgba> = base.to_vec();
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
                    let p = level[(y * 2 + dy).min(lh - 1) * lw + (x * 2 + dx).min(lw - 1)];
                    for k in 0..4 {
                        acc[k] += p[k] * 0.25;
                    }
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
    img.sampler = sampler(repeat, 8);
    img
}

// ---------- stroke font ----------

/// Upper-case form(s) of a character: 'ß' becomes "SS", lower case maps to capitals.
fn upper(ch: char) -> impl Iterator<Item = char> {
    let (a, b) = match ch {
        'ß' => ('S', Some('S')),
        'ä' => ('Ä', None),
        'ö' => ('Ö', None),
        'ü' => ('Ü', None),
        c if c.is_ascii_lowercase() => (c.to_ascii_uppercase(), None),
        c => (c, None),
    };
    std::iter::once(a).chain(b)
}

type Strokes = &'static [&'static [(f32, f32)]];

/// Vector font on a 4 x 6 grid (y down, cap height 6). Returns (advance, strokes); single-point strokes are dots.
fn glyph(ch: char) -> (f32, Strokes) {
    match ch {
        'A' => (4.0, &[&[(0.0, 6.0), (0.0, 1.6), (1.5, 0.0), (2.5, 0.0), (4.0, 1.6), (4.0, 6.0)], &[(0.0, 3.7), (4.0, 3.7)]]),
        'Ä' => (4.0, &[&[(0.0, 6.0), (0.0, 1.6), (1.5, 0.0), (2.5, 0.0), (4.0, 1.6), (4.0, 6.0)], &[(0.0, 3.7), (4.0, 3.7)], &[(1.0, -1.4)], &[(3.0, -1.4)]]),
        'B' => (4.0, &[&[(0.0, 0.0), (3.0, 0.0), (4.0, 1.0), (4.0, 2.0), (3.0, 3.0), (0.0, 3.0)], &[(3.0, 3.0), (4.0, 4.0), (4.0, 5.0), (3.0, 6.0), (0.0, 6.0), (0.0, 0.0)]]),
        'C' => (4.0, &[&[(4.0, 0.6), (3.4, 0.0), (1.0, 0.0), (0.0, 1.0), (0.0, 5.0), (1.0, 6.0), (3.4, 6.0), (4.0, 5.4)]]),
        'D' => (4.0, &[&[(0.0, 0.0), (2.8, 0.0), (4.0, 1.2), (4.0, 4.8), (2.8, 6.0), (0.0, 6.0), (0.0, 0.0)]]),
        'E' => (3.6, &[&[(3.6, 0.0), (0.0, 0.0), (0.0, 6.0), (3.6, 6.0)], &[(0.0, 3.0), (3.0, 3.0)]]),
        'F' => (3.6, &[&[(3.6, 0.0), (0.0, 0.0), (0.0, 6.0)], &[(0.0, 3.0), (3.0, 3.0)]]),
        'G' => (4.0, &[&[(4.0, 1.0), (3.0, 0.0), (1.0, 0.0), (0.0, 1.0), (0.0, 5.0), (1.0, 6.0), (3.0, 6.0), (4.0, 5.0), (4.0, 3.2), (2.2, 3.2)]]),
        'H' => (4.0, &[&[(0.0, 0.0), (0.0, 6.0)], &[(4.0, 0.0), (4.0, 6.0)], &[(0.0, 3.0), (4.0, 3.0)]]),
        'I' => (0.0, &[&[(0.0, 0.0), (0.0, 6.0)]]),
        'J' => (3.6, &[&[(3.6, 0.0), (3.6, 5.0), (2.6, 6.0), (1.0, 6.0), (0.0, 5.0)]]),
        'K' => (4.0, &[&[(0.0, 0.0), (0.0, 6.0)], &[(4.0, 0.0), (1.2, 3.0), (0.0, 3.0)], &[(1.2, 3.0), (4.0, 6.0)]]),
        'L' => (3.4, &[&[(0.0, 0.0), (0.0, 6.0), (3.4, 6.0)]]),
        'M' => (5.0, &[&[(0.0, 6.0), (0.0, 0.0), (2.5, 3.4), (5.0, 0.0), (5.0, 6.0)]]),
        'N' => (4.0, &[&[(0.0, 6.0), (0.0, 0.0), (4.0, 6.0), (4.0, 0.0)]]),
        'O' => (4.0, &[&[(1.0, 0.0), (3.0, 0.0), (4.0, 1.0), (4.0, 5.0), (3.0, 6.0), (1.0, 6.0), (0.0, 5.0), (0.0, 1.0), (1.0, 0.0)]]),
        'Ö' => (4.0, &[&[(1.0, 0.0), (3.0, 0.0), (4.0, 1.0), (4.0, 5.0), (3.0, 6.0), (1.0, 6.0), (0.0, 5.0), (0.0, 1.0), (1.0, 0.0)], &[(1.0, -1.4)], &[(3.0, -1.4)]]),
        'P' => (4.0, &[&[(0.0, 6.0), (0.0, 0.0), (3.0, 0.0), (4.0, 1.0), (4.0, 2.2), (3.0, 3.2), (0.0, 3.2)]]),
        'Q' => (4.0, &[&[(1.0, 0.0), (3.0, 0.0), (4.0, 1.0), (4.0, 5.0), (3.0, 6.0), (1.0, 6.0), (0.0, 5.0), (0.0, 1.0), (1.0, 0.0)], &[(2.6, 4.6), (4.0, 6.2)]]),
        'R' => (4.0, &[&[(0.0, 6.0), (0.0, 0.0), (3.0, 0.0), (4.0, 1.0), (4.0, 2.2), (3.0, 3.2), (0.0, 3.2)], &[(2.2, 3.2), (4.0, 6.0)]]),
        'S' => (4.0, &[&[(4.0, 0.6), (3.4, 0.0), (1.0, 0.0), (0.0, 1.0), (0.0, 2.0), (1.0, 3.0), (3.0, 3.0), (4.0, 4.0), (4.0, 5.0), (3.0, 6.0), (0.6, 6.0), (0.0, 5.4)]]),
        'T' => (4.0, &[&[(0.0, 0.0), (4.0, 0.0)], &[(2.0, 0.0), (2.0, 6.0)]]),
        'U' => (4.0, &[&[(0.0, 0.0), (0.0, 5.0), (1.0, 6.0), (3.0, 6.0), (4.0, 5.0), (4.0, 0.0)]]),
        'Ü' => (4.0, &[&[(0.0, 0.0), (0.0, 5.0), (1.0, 6.0), (3.0, 6.0), (4.0, 5.0), (4.0, 0.0)], &[(1.0, -1.4)], &[(3.0, -1.4)]]),
        'V' => (4.0, &[&[(0.0, 0.0), (2.0, 6.0), (4.0, 0.0)]]),
        'W' => (5.0, &[&[(0.0, 0.0), (1.25, 6.0), (2.5, 2.2), (3.75, 6.0), (5.0, 0.0)]]),
        'X' => (4.0, &[&[(0.0, 0.0), (4.0, 6.0)], &[(4.0, 0.0), (0.0, 6.0)]]),
        'Y' => (4.0, &[&[(0.0, 0.0), (2.0, 3.0), (4.0, 0.0)], &[(2.0, 3.0), (2.0, 6.0)]]),
        'Z' => (4.0, &[&[(0.0, 0.0), (4.0, 0.0), (0.0, 6.0), (4.0, 6.0)]]),
        '0' => (4.0, &[&[(1.0, 0.0), (3.0, 0.0), (4.0, 1.0), (4.0, 5.0), (3.0, 6.0), (1.0, 6.0), (0.0, 5.0), (0.0, 1.0), (1.0, 0.0)], &[(3.2, 1.2), (0.8, 4.8)]]),
        '1' => (2.0, &[&[(0.0, 1.4), (1.6, 0.0), (1.6, 6.0)]]),
        '2' => (4.0, &[&[(0.0, 1.0), (1.0, 0.0), (3.0, 0.0), (4.0, 1.0), (4.0, 2.2), (0.0, 6.0), (4.0, 6.0)]]),
        '3' => (4.0, &[&[(0.0, 0.0), (4.0, 0.0), (1.8, 2.6), (3.0, 2.6), (4.0, 3.6), (4.0, 5.0), (3.0, 6.0), (0.0, 6.0)]]),
        '4' => (4.0, &[&[(3.0, 6.0), (3.0, 0.0), (0.0, 4.2), (4.0, 4.2)]]),
        '5' => (4.0, &[&[(4.0, 0.0), (0.0, 0.0), (0.0, 2.6), (3.0, 2.6), (4.0, 3.6), (4.0, 5.0), (3.0, 6.0), (0.0, 6.0)]]),
        '6' => (4.0, &[&[(3.6, 0.0), (1.0, 0.0), (0.0, 1.0), (0.0, 5.0), (1.0, 6.0), (3.0, 6.0), (4.0, 5.0), (4.0, 3.6), (3.0, 2.6), (0.0, 2.6)]]),
        '7' => (4.0, &[&[(0.0, 0.0), (4.0, 0.0), (1.4, 6.0)]]),
        '8' => (4.0, &[&[(1.0, 3.0), (0.0, 2.0), (0.0, 1.0), (1.0, 0.0), (3.0, 0.0), (4.0, 1.0), (4.0, 2.0), (3.0, 3.0), (1.0, 3.0), (0.0, 4.0), (0.0, 5.0), (1.0, 6.0), (3.0, 6.0), (4.0, 5.0), (4.0, 4.0), (3.0, 3.0)]]),
        '9' => (4.0, &[&[(0.4, 6.0), (3.0, 6.0), (4.0, 5.0), (4.0, 1.0), (3.0, 0.0), (1.0, 0.0), (0.0, 1.0), (0.0, 2.4), (1.0, 3.4), (4.0, 3.4)]]),
        '-' => (3.0, &[&[(0.0, 3.2), (3.0, 3.2)]]),
        '+' => (4.0, &[&[(0.0, 3.2), (4.0, 3.2)], &[(2.0, 1.2), (2.0, 5.2)]]),
        '=' => (3.6, &[&[(0.0, 2.2), (3.6, 2.2)], &[(0.0, 4.2), (3.6, 4.2)]]),
        '_' => (4.0, &[&[(0.0, 6.4), (4.0, 6.4)]]),
        '.' => (0.0, &[&[(0.0, 6.0)]]),
        ',' => (0.6, &[&[(0.6, 5.6), (0.0, 7.2)]]),
        ':' => (0.0, &[&[(0.0, 1.8)], &[(0.0, 5.6)]]),
        ';' => (0.6, &[&[(0.6, 1.8)], &[(0.6, 5.2), (0.0, 7.0)]]),
        '·' => (0.0, &[&[(0.0, 3.2)]]),
        '\'' => (0.0, &[&[(0.0, 0.0), (0.0, 1.8)]]),
        '"' => (1.2, &[&[(0.0, 0.0), (0.0, 1.8)], &[(1.2, 0.0), (1.2, 1.8)]]),
        '!' => (0.0, &[&[(0.0, 0.0), (0.0, 4.0)], &[(0.0, 6.0)]]),
        '?' => (3.6, &[&[(0.0, 1.0), (1.0, 0.0), (2.6, 0.0), (3.6, 1.0), (3.6, 2.0), (1.8, 3.4), (1.8, 4.2)], &[(1.8, 6.0)]]),
        '%' => (4.0, &[&[(4.0, 0.0), (0.0, 6.0)], &[(0.4, 0.2), (1.2, 0.2), (1.2, 1.6), (0.4, 1.6), (0.4, 0.2)], &[(2.8, 4.4), (3.6, 4.4), (3.6, 5.8), (2.8, 5.8), (2.8, 4.4)]]),
        '/' => (3.0, &[&[(3.0, 0.0), (0.0, 6.0)]]),
        '(' => (1.4, &[&[(1.4, -0.4), (0.0, 1.4), (0.0, 4.6), (1.4, 6.4)]]),
        ')' => (1.4, &[&[(0.0, -0.4), (1.4, 1.4), (1.4, 4.6), (0.0, 6.4)]]),
        '<' => (3.0, &[&[(3.0, 1.0), (0.0, 3.2), (3.0, 5.4)]]),
        '>' => (3.0, &[&[(0.0, 1.0), (3.0, 3.2), (0.0, 5.4)]]),
        '#' => (4.0, &[&[(1.2, 0.0), (0.8, 6.0)], &[(3.2, 0.0), (2.8, 6.0)], &[(0.0, 2.0), (4.0, 2.0)], &[(0.0, 4.2), (4.0, 4.2)]]),
        '°' => (1.6, &[&[(0.0, 0.0), (1.6, 0.0), (1.6, 1.6), (0.0, 1.6), (0.0, 0.0)]]),
        '×' => (3.0, &[&[(0.0, 1.8), (3.0, 4.8)], &[(3.0, 1.8), (0.0, 4.8)]]),
        '→' => (4.6, &[&[(0.0, 3.2), (4.6, 3.2)], &[(2.8, 1.4), (4.6, 3.2), (2.8, 5.0)]]),
        '✓' => (4.0, &[&[(0.0, 3.4), (1.4, 5.6), (4.0, 0.6)]]),
        '⚠' => (5.0, &[&[(2.5, 0.0), (5.0, 6.0), (0.0, 6.0), (2.5, 0.0)], &[(2.5, 2.0), (2.5, 4.0)], &[(2.5, 5.1)]]),
        '–' | '—' => (4.0, &[&[(0.0, 3.2), (4.0, 3.2)]]),
        '…' => (3.0, &[&[(0.0, 6.0)], &[(1.5, 6.0)], &[(3.0, 6.0)]]),
        '▲' | '◆' => (4.0, &[]),
        '▌' => (2.4, &[]),
        _ => (2.6, &[]),
    }
}
