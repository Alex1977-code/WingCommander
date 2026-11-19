//! Procedural "well used" cockpit surfaces (ported from src/cockpit.js): worn paint with rivets, seams,
//! scratches, chipped edges, grime, hazard stripes and faded stencils; brushed steel; cable sleeves;
//! maintenance stickers; canopy smudges; fingerprints for the displays.

use super::canvas::{hex, with_a, Align, Canvas, Rng};

/// Colour and roughness maps of a worn surface. Roughness is in the green channel (Bevy layout), metal in blue.
pub struct Worn {
    pub color: Canvas,
    pub rough: Canvas,
}

pub fn worn(base: u32, size: usize, seed: u32, stripes: bool, labels: &[&str], rivets: bool, grime: f32) -> Worn {
    let mut rng = Rng::new(seed);
    let s = size as f32;
    let base_c = hex(base, 1.0);
    let mut g = Canvas::new(size, size, base_c);
    let mut r = Canvas::new(size, size, [0.0, 0.706, 1.0, 1.0]);
    for _ in 0..900 {
        let a = rng.f() * 0.06;
        let c = if rng.chance(0.5) { [1.0, 1.0, 1.0, a] } else { [0.0, 0.0, 0.0, a] };
        g.rect(rng.f() * s, rng.f() * s, rng.range(2.0, 14.0), rng.range(1.0, 6.0), c);
    }
    // panel seams
    for _ in 0..4 {
        let y = rng.f() * s;
        g.line(0.0, y, s, y, 2.0, [0.0, 0.0, 0.0, 0.5]);
    }
    for _ in 0..3 {
        let x = rng.f() * s;
        g.line(x, 0.0, x, s, 2.0, [0.0, 0.0, 0.0, 0.5]);
    }
    if rivets {
        for _ in 0..70 {
            let (x, y) = (rng.f() * s, rng.f() * s);
            g.ellipse(x + 1.0, y + 1.0, 2.4, 2.4, [0.0, 0.0, 0.0, 0.45]);
            g.ellipse(x, y, 2.0, 2.0, [1.0, 1.0, 1.0, 0.22]);
        }
    }
    if stripes {
        let (y0, y1) = (s * 0.84, s * 0.94);
        g.set_clip(0.0, y0, s, y1 - y0);
        let mut x = -s;
        let mut k = 0;
        while x < s * 2.0 {
            let c = if k % 2 == 1 { [0.9, 0.7, 0.16, 0.75] } else { [0.08, 0.08, 0.08, 0.75] };
            g.poly(&[(x, y0), (x + 28.0, y0), (x + 78.0, y1), (x + 50.0, y1)], c);
            x += 28.0;
            k += 1;
        }
        for _ in 0..260 {
            g.rect(rng.f() * s, rng.range(y0, y1), rng.range(2.0, 12.0), rng.range(1.0, 5.0), with_a(base_c, rng.f() * 0.8));
        }
        g.reset_clip();
    }
    let n = labels.len() as f32;
    for (i, t) in labels.iter().enumerate() {
        let (x, y) = (rng.range(30.0, s * 0.55), 40.0 + i as f32 * (s / (n + 1.0)));
        let h = s / 34.0;
        g.text_ex(t, x, y - h, h, 1.4, [0.86, 0.89, 0.91, 0.55], Align::Left, 1.0);
        for _ in 0..40 {
            g.rect(x + rng.range(0.0, 180.0), y + rng.range(-16.0, 4.0), rng.range(1.0, 6.0), rng.range(1.0, 3.0), with_a(base_c, rng.f() * 0.7));
        }
    }
    // scratches (bright, and smoother in the roughness map)
    for _ in 0..140 {
        let (x, y, a, l) = (rng.f() * s, rng.f() * s, rng.f() * 6.283, rng.range(6.0, 60.0));
        let (mx, my) = (x + a.cos() * l * 0.5 + rng.range(-4.0, 4.0), y + a.sin() * l * 0.5 + rng.range(-4.0, 4.0));
        let (ex, ey) = (x + a.cos() * l, y + a.sin() * l);
        let c = [0.9, 0.92, 0.94, rng.range(0.08, 0.32)];
        let lw = rng.range(0.5, 1.4);
        g.line(x, y, mx, my, lw, c);
        g.line(mx, my, ex, ey, lw, c);
        r.line(x, y, ex, ey, 1.5, [0.0, 0.27, 1.0, 0.7]);
    }
    // chipped edges along the top and bottom
    for _ in 0..40 {
        let x = rng.f() * s;
        let y = if rng.chance(0.5) { rng.range(0.0, 20.0) } else { rng.range(s - 20.0, s) };
        g.ellipse(x, y, rng.range(2.0, 10.0), rng.range(1.0, 4.0), [0.67, 0.69, 0.71, rng.range(0.25, 0.6)]);
    }
    // grime: dark and rough
    for _ in 0..(26.0 * grime) as usize {
        let (x, y, rr) = (rng.f() * s, rng.range(s * 0.3, s), rng.range(15.0, 70.0));
        g.glow(x, y, rr, [0.1, 0.08, 0.06, rng.range(0.15, 0.35)]);
        r.glow(x, y, rr * 0.6, [0.0, 1.0, 1.0, 0.08]);
    }
    Worn { color: g, rough: r }
}

/// brushed stainless steel: fine horizontal grain, a few smudges and scuffs
pub fn brushed(seed: u32) -> Canvas {
    let mut rng = Rng::new(seed);
    let s = 512.0;
    let mut g = Canvas::new(512, 512, hex(0xa7adb3, 1.0));
    for _ in 0..2600 {
        let (y, l, x) = (rng.f() * s, rng.range(40.0, 400.0), rng.range(-100.0, s));
        let c = if rng.chance(0.5) { [1.0, 1.0, 1.0, rng.range(0.03, 0.12)] } else { [0.16, 0.18, 0.2, rng.range(0.03, 0.12)] };
        g.line(x, y, x + l, y + rng.range(-1.0, 1.0), rng.range(0.5, 1.5), c);
    }
    for _ in 0..30 {
        let (x, y, rr) = (rng.f() * s, rng.f() * s, rng.range(20.0, 60.0));
        g.glow(x, y, rr, [0.24, 0.22, 0.2, 0.18]);
    }
    for _ in 0..60 {
        let (x, y, a, l) = (rng.f() * s, rng.f() * s, rng.f() * 6.283, rng.range(8.0, 50.0));
        g.line(x, y, x + a.cos() * l, y + a.sin() * l, 0.7, [1.0, 1.0, 1.0, 0.25]);
    }
    g
}

/// stripes along a cable or the ribs of a corrugated conduit (u runs along the tube)
pub fn ribs(base: u32, rib: bool) -> Canvas {
    let mut g = Canvas::new(64, 8, hex(base, 1.0));
    if rib {
        for x in (0..64).step_by(8) {
            g.rect(x as f32, 0.0, 2.0, 8.0, [0.0, 0.0, 0.0, 0.55]);
            g.rect(x as f32 + 3.0, 0.0, 2.0, 8.0, [1.0, 1.0, 1.0, 0.18]);
        }
    } else {
        // faint printed marks along the sleeve
        for x in (4..64).step_by(32) {
            g.rect(x as f32, 2.0, 10.0, 1.0, [1.0, 1.0, 1.0, 0.12]);
        }
    }
    g
}

/// a worn sticker / maintenance plaque with chipped edges (alpha cut out)
pub fn decal(title: &str, sub: &str, color: u32, seed: u32) -> Canvas {
    let mut rng = Rng::new(seed);
    let mut g = Canvas::new(256, 96, [0.0; 4]);
    g.rect(4.0, 4.0, 248.0, 88.0, hex(color, 1.0));
    let ink = [0.06, 0.06, 0.06, 0.85];
    g.text_fit(title, 14.0, 18.0, 20.0, 228.0, ink, Align::Left);
    g.text_fit(sub, 14.0, 56.0, 13.0, 228.0, ink, Align::Left);
    for _ in 0..160 {
        let y = if rng.chance(0.6) { rng.range(0.0, 18.0) } else { rng.range(0.0, 96.0) };
        let a = rng.f() * 0.8;
        g.erase_rect(rng.range(0.0, 256.0), y, rng.range(1.0, 8.0), rng.range(1.0, 4.0), a);
    }
    for _ in 0..12 {
        let (x0, y0, x1, y1) = (rng.range(0.0, 256.0), rng.range(0.0, 96.0), rng.range(0.0, 256.0), rng.range(0.0, 96.0));
        let n = ((x1 - x0).abs().max((y1 - y0).abs()) as usize).max(1);
        for i in 0..n {
            let t = i as f32 / n as f32;
            g.erase((x0 + (x1 - x0) * t) as i32, (y0 + (y1 - y0) * t) as i32, 0.5);
        }
    }
    g
}

/// greasy smudges and fine scratches on the canopy glass (drawn additively, black = clear)
pub fn smudges(seed: u32) -> Canvas {
    let mut rng = Rng::new(seed);
    let mut g = Canvas::new(512, 512, [0.0, 0.0, 0.0, 1.0]);
    g.additive = true;
    for _ in 0..60 {
        let (x, y, rr) = (rng.f() * 512.0, rng.f() * 512.0, rng.range(20.0, 90.0));
        g.glow(x, y, rr, [1.0, 1.0, 1.0, rng.range(0.04, 0.12)]);
    }
    for _ in 0..90 {
        let (x, y, a, l) = (rng.f() * 512.0, rng.f() * 512.0, rng.f() * 6.283, rng.range(20.0, 140.0));
        g.line(x, y, x + a.cos() * l, y + a.sin() * l, rng.range(0.5, 1.5), [1.0, 1.0, 1.0, rng.range(0.05, 0.25)]);
    }
    g
}

/// faint fingerprints and palm smears for the display glass: alpha mask (w x h)
pub fn fingerprints(w: usize, h: usize, seed: u32) -> Vec<f32> {
    let mut rng = Rng::new(seed);
    let mut g = Canvas::new(w, h, [0.0, 0.0, 0.0, 0.0]);
    for _ in 0..5 {
        let (x, y) = (rng.range(20.0, w as f32 - 20.0), rng.range(20.0, h as f32 - 20.0));
        for k in 1..9 {
            g.arc(x, y, k as f32 * 2.2, k as f32 * 3.0, 0.0, 6.283, 1.0, [1.0, 1.0, 1.0, 0.05]);
        }
    }
    for _ in 0..3 {
        let (x, y) = (rng.f() * w as f32, rng.f() * h as f32);
        g.glow(x, y, 60.0, [1.0, 1.0, 1.0, 0.06]);
    }
    g.px.iter().map(|p| p[3]).collect()
}

/// adds a radial glass crack (accumulates on heavy hits)
pub fn add_crack(c: &mut Canvas, rng: &mut Rng) {
    let (w, h) = (c.w as f32, c.h as f32);
    let (x, y) = (rng.range(w * 0.12, w * 0.88), rng.range(h * 0.1, h * 0.75));
    let arms = 6 + (rng.f() * 6.0) as usize;
    for a in 0..arms {
        let (mut px, mut py) = (x, y);
        let mut ang = a as f32 / arms as f32 * 6.283 + rng.range(-0.3, 0.3);
        let len = rng.range(60.0, 200.0);
        let col = [0.92, 0.96, 1.0, rng.range(0.22, 0.5)];
        let lw = rng.range(0.8, 2.0);
        let mut d = 0.0;
        while d < len {
            ang += rng.range(-0.35, 0.35);
            let (nx, ny) = (px + ang.cos() * 16.0, py + ang.sin() * 16.0);
            c.line(px, py, nx, ny, lw, col);
            px = nx;
            py = ny;
            d += rng.range(10.0, 26.0);
        }
    }
    for ring in 1..4 {
        let mut prev: Option<(f32, f32)> = None;
        for a in 0..=arms {
            let ang = a as f32 / arms as f32 * 6.283;
            let rr = ring as f32 * rng.range(12.0, 22.0);
            let p = (x + ang.cos() * rr, y + ang.sin() * rr);
            if let Some(q) = prev {
                c.line(q.0, q.1, p.0, p.1, 0.8, [0.92, 0.96, 1.0, 0.35]);
            }
            prev = Some(p);
        }
    }
    c.glow(x, y, 26.0, [1.0, 1.0, 1.0, 0.55]);
}
