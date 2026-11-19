// Effects shader (fx.rs): one material type, the mode uniform picks the effect.
//
// Particle modes read their instances from a storage buffer; the mesh is a static strip of quads whose
// vertex position carries (particle index, corner x, corner y):
//   0 GLOW    additive camera-facing glow (fire points, flashes, lens streaks, debris heat)
//   1 SMOKE   premultiplied-alpha smoke puff with procedural lumps
//   2 STREAK  additive spark / ember streak from tail to head (motion blur)
//   7 RIBBON  additive exhaust ribbon (points of the ribbon pool, side in corner x)
// Shape modes draw one mesh per entity; the Transform carries position/size/orientation and the MeshTag
// packs the per-instance animation state:
//   3 FIREBALL turbulent fireball (displaced icosphere), white-hot -> orange -> red -> smoke
//   4 RING     expanding shockwave ring (camera-facing) or flat plasma ring wave (oriented)
//   5 SHIELD   hexagonal shield ripple on a bubble, impact at local +Z
//   6 PLUME    engine plume along local -Z plus the hot glow billboard at the nozzle
// All modes write premultiplied colour: additive effects output alpha 0.

import bevy_pbr::render::mesh_functions::{get_world_from_local, get_tag};
import bevy_pbr::render::mesh_view_bindings::{view, globals};

struct FxUniform {
    mode: u32,
    gain: f32,
    p0: f32,
    p1: f32,
    color: vec4<f32>,
    hot: vec4<f32>,
}

struct Particle {
    pos: vec3<f32>,
    size: f32,
    color: vec4<f32>,
    ext: vec4<f32>,
}

@group(constants::MATERIAL_BIND_GROUP) @binding(0) var<uniform> fx: FxUniform;
@group(constants::MATERIAL_BIND_GROUP) @binding(1) var<storage, read> particles: array<Particle>;

struct Vertex {
    @builtin(instance_index) instance_index: u32,
    @location(0) position: vec3<f32>,
};

struct VOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
    @location(2) ext: vec4<f32>,
    @location(3) lpos: vec3<f32>,
    @location(4) wpos: vec3<f32>,
    @location(5) wnorm: vec3<f32>,
};

const PI: f32 = 3.14159265;

// ---------- noise ----------

fn hash3(p0: vec3<f32>) -> f32 {
    var p = fract(p0 * 0.3183099 + 0.1);
    p = p * 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

fn vnoise(x: vec3<f32>) -> f32 {
    let i = floor(x);
    var f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(mix(hash3(i), hash3(i + vec3(1.0, 0.0, 0.0)), f.x), mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
        mix(mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), f.x), mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
        f.z);
}

fn fbm(p0: vec3<f32>) -> f32 {
    var p = p0;
    var s = 0.0;
    var a = 0.5;
    for (var i = 0; i < 4; i++) {
        s += a * vnoise(p);
        p = p * 2.07 + vec3(3.1, 1.7, 5.3);
        a *= 0.5;
    }
    return s / 0.9375;
}

// ---------- camera helpers ----------

fn cam_pos() -> vec3<f32> {
    return view.world_position;
}
fn cam_right() -> vec3<f32> {
    return normalize(view.world_from_view[0].xyz);
}
fn cam_up() -> vec3<f32> {
    return normalize(view.world_from_view[1].xyz);
}
// world size of one pixel at distance d
fn pixel_size(d: f32) -> f32 {
    return 2.0 * max(d, 0.01) / (max(view.viewport.w, 1.0) * view.clip_from_view[1][1]);
}
fn to_clip(p: vec3<f32>) -> vec4<f32> {
    return view.clip_from_world * vec4(p, 1.0);
}

// ---------- vertex ----------

fn particle_vertex(v: Vertex) -> VOut {
    var out: VOut;
    let pt = particles[u32(v.position.x + 0.5)];
    let corner = v.position.yz;
    out.color = pt.color;
    out.ext = pt.ext;
    out.uv = corner;
    out.lpos = vec3(0.0);
    out.wnorm = vec3(0.0);
    var p = pt.pos;
    if fx.mode == 2u {
        // streak from tail (ext.xyz) to head (pos): quad along the motion, turned to the camera
        let head = pt.pos;
        let tail = pt.ext.xyz;
        let x = corner.x * 0.5 + 0.5;
        p = mix(tail, head, x);
        let dv = head - tail;
        let dl = length(dv);
        let dir = select(vec3(0.0, 1.0, 0.0), dv / max(dl, 1e-5), dl > 1e-4);
        let to_cam = cam_pos() - p;
        var s = cross(dir, to_cam);
        let sl = length(s);
        s = select(cam_right(), s / max(sl, 1e-6), sl > 1e-5);
        // never thinner than ~1.5 px: thinner ones get dimmer instead (no shimmering sub-pixel lines)
        let w = max(pt.size, 0.75 * pixel_size(length(to_cam)));
        p += dir * w * corner.x + s * w * corner.y;
        out.color = vec4(pt.color.rgb, pt.color.a * pt.size / max(w, 1e-6));
        out.uv = vec2(x, corner.y);
    } else if fx.mode == 7u {
        // ribbon point: extruded sideways (towards the camera), widening with age
        let to_cam = cam_pos() - p;
        let dc = length(to_cam);
        var sd = cross(pt.ext.xyz, to_cam / max(dc, 1e-4));
        let sl = length(sd);
        sd = select(vec3(0.0), sd / max(sl, 1e-6), sl > 1e-4);
        let k = pt.ext.w;
        let w = pt.size * (0.5 + k * 1.5);
        let wd = max(w, dc * 0.0015);
        p += sd * corner.x * wd;
        let fade = smoothstep(12.0, 70.0, dc) * w / max(wd, 1e-6);
        out.color = vec4(pt.color.rgb * mix(vec3(1.0), vec3(0.7, 0.55, 0.9), k), pt.color.a * fade);
        out.uv = vec2(corner.x, 0.0);
    } else {
        // camera-facing quad; ext.x = height/width ratio (lens streaks), smoke turns by ext.x instead
        let d = length(cam_pos() - p);
        var sx = pt.size;
        var sy = pt.size;
        var c = corner;
        // no screen-filling blobs when a particle passes the camera
        out.color.a *= smoothstep(pt.size * 0.3, pt.size * 1.2, d);
        if fx.mode == 0u {
            sy = pt.size * pt.ext.x;
            // keep tiny far glows at least ~2 px across, dimmed by the area ratio
            let minw = pixel_size(d) * 1.2;
            let gx = max(sx, minw);
            let gy = max(sy, minw);
            out.color = vec4(pt.color.rgb, pt.color.a * (sx * sy) / max(gx * gy, 1e-8));
            sx = gx;
            sy = gy;
        } else {
            let a = pt.ext.x;
            c = vec2(c.x * cos(a) - c.y * sin(a), c.x * sin(a) + c.y * cos(a));
        }
        p += cam_right() * c.x * sx + cam_up() * c.y * sy;
    }
    out.wpos = p;
    out.clip = to_clip(p);
    return out;
}

fn shape_vertex(v: Vertex) -> VOut {
    var out: VOut;
    let m = get_world_from_local(v.instance_index);
    let tag = get_tag(v.instance_index);
    let center = m[3].xyz;
    var pos = v.position;
    out.lpos = pos;
    out.uv = pos.xy;
    out.color = vec4(1.0);
    out.ext = vec4(0.0);
    var world = (m * vec4(pos, 1.0)).xyz;
    if fx.mode == 3u {
        // fireball: age 10 bits, fade 8, seed 8, hot 6
        let age = f32(tag & 1023u) / 1023.0;
        let fade = f32((tag >> 10u) & 255u) / 255.0;
        let sd = f32((tag >> 18u) & 255u);
        let hot = f32((tag >> 26u) & 63u) / 42.0;
        let seed = vec3(sd * 0.371, sd * 0.713 + 3.0, sd * 0.137 + 7.0);
        let q = pos * 1.6 + seed + vec3(0.0, age * 1.3, 0.0);
        let n = vnoise(q) * 0.67 + vnoise(q * 2.3 - seed) * 0.33;
        let p = pos * (1.0 + (n - 0.5) * (0.45 + age * 0.35));
        world = (m * vec4(p, 1.0)).xyz;
        let r = length(m[0].xyz);
        // 0 while the camera is clear of the ball, 1 once it is inside: back faces are drawn only then
        let cd = length(cam_pos() - center) / max(r, 1e-3);
        out.ext = vec4(age, fade, hot, clamp((1.35 - cd) / 0.35, 0.0, 1.0));
        out.color = vec4(seed, 0.0);
        out.wnorm = normalize((m * vec4(pos, 0.0)).xyz);
    } else if fx.mode == 4u {
        // ring: k 8 bits, width 8, seed 8, billboard 1
        let k = f32(tag & 255u) / 255.0;
        let w = f32((tag >> 8u) & 255u) / 255.0;
        let sd = f32((tag >> 16u) & 255u) / 255.0 * 6.2831;
        let bill = (tag >> 24u) & 1u;
        if bill == 1u {
            let r = length(m[0].xyz);
            world = center + (cam_right() * pos.x + cam_up() * pos.y) * r;
        }
        out.ext = vec4(k, w, sd, 0.0);
    } else if fx.mode == 5u {
        // shield: age 10 bits (0..1 s), k 8, team 2, lattice scale 6
        let age = f32(tag & 1023u) / 1023.0;
        let k = f32((tag >> 10u) & 255u) / 255.0 * 1.5;
        let team = f32((tag >> 18u) & 3u);
        let sc = f32((tag >> 20u) & 63u);
        out.ext = vec4(age, k, team, sc);
        out.wnorm = normalize((m * vec4(pos, 0.0)).xyz);
    } else if fx.mode == 6u {
        // engine plume: glow billboard (corner z = 1) or the plume quad along local -Z, turned to the camera
        let ax_w = -m[2].xyz;
        let len = length(ax_w);
        let wid = length(m[0].xyz);
        let thr = clamp((len / max(wid, 1e-4) - 0.6) / 2.2, 0.0, 1.0);
        let seed = dot(center, vec3(0.13, 0.071, 0.097)) + f32(tag & 255u);
        let t = globals.time;
        let fl = 0.86 + 0.14 * sin(t * 47.0 + seed) * sin(t * 29.0 + seed * 1.7);
        let dcam = distance(cam_pos(), center);
        if pos.z > 0.5 {
            world = center + (cam_right() * pos.x + cam_up() * pos.y) * wid * 0.45;
            out.ext = vec4(thr, fl, 1.0, 1.0);
        } else {
            let ax = ax_w / max(len, 1e-5);
            // close to the camera (own ship in chase view) the plume shortens and fades: no beams into the lens
            var p = center + ax_w * pos.x * mix(0.45, 1.0, smoothstep(8.0, 40.0, dcam));
            var sd = cross(ax, normalize(cam_pos() - p));
            let s = length(sd);
            let face = smoothstep(0.06, 0.45, s) * smoothstep(8.0, 40.0, distance(cam_pos(), p));
            sd = select(vec3(0.0), sd / max(s, 1e-6), s > 1e-4);
            p += sd * pos.y * wid * 0.25;
            world = p;
            out.ext = vec4(thr, fl, 0.0, face);
        }
    }
    out.wpos = world;
    out.clip = to_clip(world);
    return out;
}

@vertex
fn vertex(v: Vertex) -> VOut {
    if fx.mode == 0u || fx.mode == 1u || fx.mode == 2u || fx.mode == 7u {
        return particle_vertex(v);
    }
    return shape_vertex(v);
}

// ---------- fragment ----------

fn fireball_ramp(t: f32) -> vec3<f32> {
    var c = mix(vec3(0.03, 0.025, 0.022), vec3(0.36, 0.05, 0.012), smoothstep(0.05, 0.28, t));
    c = mix(c, vec3(1.0, 0.24, 0.035), smoothstep(0.28, 0.5, t));
    c = mix(c, vec3(1.6, 0.72, 0.15), smoothstep(0.5, 0.75, t));
    return mix(c, vec3(2.4, 1.95, 1.4), smoothstep(0.78, 1.05, t));
}

// nearest hex cell: xy = offset inside the cell, zw = cell id
fn hex_coords(uv: vec2<f32>) -> vec4<f32> {
    let hs = vec2(1.0, 1.7320508);
    let hc = floor(vec4(uv, uv - vec2(0.5, 1.0)) / hs.xyxy) + 0.5;
    let h = vec4(uv - hc.xy * hs, uv - (hc.zw + 0.5) * hs);
    if dot(h.xy, h.xy) < dot(h.zw, h.zw) {
        return vec4(h.xy, hc.xy);
    }
    return vec4(h.zw, hc.zw + 9.7);
}

const SHIELD_COL = array<vec3<f32>, 3>(vec3(0.45, 1.5, 3.2), vec3(3.0, 0.55, 1.6), vec3(0.6, 2.6, 1.4));

@fragment
fn fragment(in: VOut, @builtin(front_facing) front: bool) -> @location(0) vec4<f32> {
    let g = fx.gain;
    switch fx.mode {
        case 0u: {
            // ext.y: 0 soft fire point, 1 flash glow (bright core, wide halo), 2 anamorphic lens streak
            let d = length(in.uv);
            var a = 0.0;
            if in.ext.y < 0.5 {
                let s = 1.0 - smoothstep(0.0, 1.0, d);
                a = s * s;
            } else if in.ext.y < 1.5 {
                a = select(0.0, mix(0.65, 1.0, exp(-d * d * 30.0)) * exp(-d * d * 3.2) * (1.0 - smoothstep(0.75, 1.0, d)), d < 1.0);
            } else {
                let u = abs(in.uv.x);
                let v = abs(in.uv.y);
                a = pow(max(1.0 - u, 0.0), 2.2) * exp(-v * v * 9.0) * (0.6 + 0.4 * exp(-u * 18.0));
            }
            return vec4(in.color.rgb * a * in.color.a * g, 0.0);
        }
        case 1u: {
            // smoke: lumpy puff from value noise, seeded per particle (ext.y), lit by its own heat
            let r = length(in.uv);
            let p = in.uv * 0.5 + 0.5;
            let s = vec3(in.ext.y * 17.0, in.ext.y * 5.3, 0.0);
            let n = 0.5 * vnoise(vec3(p * 4.0, 0.0) + s) + 0.3 * vnoise(vec3(p * 8.0, 1.7) + s) + 0.2 * vnoise(vec3(p * 8.0 + vec2(3.3, 1.7), 3.1) + s);
            let a0 = clamp((1.0 - r) * 1.6 - 0.15, 0.0, 1.0) * (0.35 + 0.9 * n);
            let a = min(1.0, a0 * a0 * 1.4) * in.color.a;
            return vec4(in.color.rgb * g * a, a);
        }
        case 2u: {
            let across = 1.0 - abs(in.uv.y);
            let a = across * across * (0.2 + 0.8 * in.uv.x * in.uv.x);
            return vec4(in.color.rgb * a * in.color.a * g, 0.0);
        }
        case 7u: {
            let s = in.uv.x;
            let a = exp(-s * s * 3.0) * in.color.a * fx.p0;
            return vec4(in.color.rgb * a * g, 0.0);
        }
        case 3u: {
            let age = in.ext.x;
            let fade = in.ext.y;
            let hot = in.ext.z;
            let inside = in.ext.w;
            if !front && inside <= 0.0 {
                discard;
            }
            let nrm = select(-in.wnorm, in.wnorm, front);
            let face = clamp(dot(normalize(nrm), normalize(cam_pos() - in.wpos)), 0.0, 1.0);
            let n = fbm(in.lpos * 2.1 + in.color.xyz + vec3(0.0, -age * 1.8, age * 0.9));
            // hot where the shell is thick (facing us) and early on; cooler in the turbulent edges
            let t = hot - pow(age, 0.7) * 1.25 + (n - 0.5) * 1.3 + face * 0.35;
            var a = smoothstep(age * 1.05 - 0.15, age * 1.05 + 0.2, n * 0.9 + face * 0.45) * smoothstep(0.0, 0.6, face + (n - 0.5) * 0.5) * fade;
            if !front {
                a *= 0.5 * inside;
            }
            // the hot core glows (premultiplied, mostly additive), the cooled smoke occludes
            let col = fireball_ramp(t) * g;
            let cover = a * (1.0 - smoothstep(0.35, 0.8, t)) * 0.85;
            return vec4(col * a, cover);
        }
        case 4u: {
            let k = in.ext.x;
            let w = max(in.ext.y, 0.01);
            let sd = in.ext.z;
            let ang = atan2(in.uv.y, in.uv.x + 1e-5);
            let d = length(in.uv) + (0.012 * sin(ang * 7.0 + sd) + 0.006 * sin(ang * 17.0 - sd * 2.3)) * (1.0 - k);
            let x = clamp((1.0 - d) / w, 0.0, 1.0);
            let band = (1.0 - smoothstep(0.985, 1.0, d)) * (1.0 - x) * (1.0 - x);
            let col = fx.color.rgb * band * 0.7 + vec3(0.6) * pow(band, 6.0) * k;
            return vec4(col * k * g, 0.0);
        }
        case 5u: {
            let age = in.ext.x;
            let k = in.ext.y;
            let team = u32(in.ext.z + 0.5);
            let sc = in.ext.w;
            let l = normalize(in.lpos);
            let c = l.z;
            let ang = acos(clamp(c, -1.0, 1.0));
            // azimuthal equidistant projection around the hit point: a hex lattice radiating from the impact
            let q = vec2(l.x, l.y);
            let ql = length(q);
            let uv = select(vec2(0.0), q / max(ql, 1e-6), ql > 1e-4) * ang * sc;
            let hx = hex_coords(uv);
            let hp = abs(hx.xy);
            let e = max(dot(hp, vec2(0.5, 0.8660254)), hp.x);
            let edge = smoothstep(0.40, 0.49, e);
            let cell = fract(sin(dot(hx.zw, vec2(12.9898, 78.233))) * 43758.5453);
            let front_r = age * 4.2;
            let rip = exp(-(ang - front_r) * (ang - front_r) * 22.0);
            let wake = step(ang, front_r) * exp(-(front_r - ang) * 3.0);
            let spot = exp(-ang * ang * 70.0);
            let v = normalize(cam_pos() - in.wpos);
            let rim = pow(1.0 - abs(dot(normalize(in.wnorm), v)), 2.5);
            var i = rim * 0.3 + edge * (rip * 1.5 + wake * 0.3 + spot * 1.2) + rip * cell * 0.3 + wake * cell * 0.06 + spot * 1.1;
            i *= select(0.45, 0.85, front);
            return vec4(SHIELD_COL[min(team, 2u)] * i * k * g, 0.0);
        }
        case 6u: {
            let thr = in.ext.x;
            let fl = in.ext.y;
            var col = vec3(0.0);
            if in.ext.z > 0.5 {
                let d2 = dot(in.uv, in.uv);
                col = fx.hot.rgb * exp(-d2 * 70.0) * 0.4 + fx.color.rgb * exp(-d2 * 7.0) * max(0.0, 1.0 - d2) * 0.16;
                col *= 0.8 + 0.4 * thr;
            } else {
                let u = max(in.uv.x, 0.0);
                let v = abs(in.uv.y);
                let x = v / mix(0.78, 0.3, u);
                let fade = smoothstep(-0.1, 0.02, in.uv.x) * pow(1.0 - min(u, 1.0), 1.6);
                // shock diamonds: standing knots along the core, more and tighter with throttle
                let ph = fract(u * (2.5 + 3.0 * thr) + 0.15);
                let knot = pow(max(1.0 - abs(ph - 0.5) * 2.0, 0.0), 3.0) * smoothstep(0.04, 0.2, u);
                let cw = 0.2 + 0.16 * knot;
                let body = exp(-x * x * 3.0);
                let core = exp(-(x * x) / (cw * cw));
                let throat = exp(-u * 9.0);
                col = (fx.color.rgb * body * (0.16 + 0.34 * thr) + fx.hot.rgb * core * ((0.25 + 0.45 * thr) * (0.55 + 1.3 * knot) + throat * 1.1)) * fade * in.ext.w;
            }
            return vec4(col * fl * g, 0.0);
        }
        default: {
            return vec4(0.0);
        }
    }
}
