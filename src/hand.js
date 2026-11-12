/**
 * Organic pilot hands, sculpted as one smooth surface instead of glued-together capsules.
 *
 * Each hand is described as a little skeleton of tapered bones (round cones) and soft
 * ellipsoids. The bones of the palm blend into one another with a wide smooth union, each
 * finger blends into the palm with a narrow one (so fingers stay separate), and the result
 * is meshed with surface nets. Normals come from the field gradient, vertex colours add
 * ambient occlusion between the fingers, reddish knuckles, pale nails and fine mottling.
 * Geometries are cached per pose and built in small slices while the menus are idle, once per session.
 */
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// signed distance primitives (plain numbers, no allocations in the hot loop)
// ---------------------------------------------------------------------------
function roundCone(px, py, pz, b) {
  // b = [ax, ay, az, bx, by, bz, r1, r2] (Inigo Quilez' round cone)
  const bax = b[3] - b[0], bay = b[4] - b[1], baz = b[5] - b[2];
  const l2 = bax * bax + bay * bay + baz * baz, rr = b[6] - b[7], a2 = l2 - rr * rr, il2 = 1 / l2;
  const pax = px - b[0], pay = py - b[1], paz = pz - b[2];
  const y = pax * bax + pay * bay + paz * baz, z = y - l2;
  const qx = pax * l2 - bax * y, qy = pay * l2 - bay * y, qz = paz * l2 - baz * y;
  const x2 = qx * qx + qy * qy + qz * qz, y2 = y * y * l2, z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - b[7];
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - b[6];
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - b[6];
}

function ellipsoid(px, py, pz, e) {
  // e = [cx, cy, cz, rx, ry, rz] axis aligned
  const x = (px - e[0]) / e[3], y = (py - e[1]) / e[4], z = (pz - e[2]) / e[5];
  const k0 = Math.sqrt(x * x + y * y + z * z);
  const x1 = x / e[3], y1 = y / e[4], z1 = z / e[5];
  const k1 = Math.sqrt(x1 * x1 + y1 * y1 + z1 * z1);
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(e[3], e[4], e[5]);
}

function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

// ---------------------------------------------------------------------------
// pose descriptions
// ---------------------------------------------------------------------------
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const cone = (a, b, r1, r2) => [a.x, a.y, a.z, b.x, b.y, b.z, r1, r2];
// finger thickness: slim enough that neighbouring fingers keep a gap wider than one grid cell
const FT = 0.92;
const fingerBones = (K, A, B, C, s) => [cone(K, A, 0.0102 * s * FT, 0.009 * s * FT), cone(A, B, 0.0088 * s * FT, 0.0079 * s * FT), cone(B, C, 0.0077 * s * FT, 0.0066 * s * FT)];

/** builds the distance field from a pose */
function makeField(pose) {
  const palm = pose.palm, pe = pose.palmEll, fingers = pose.fingers;
  const kPalm = 0.011, kFinger = 0.0045, kJoint = 0.0028;
  // bounding spheres so far-away fingers are skipped cheaply
  const sph = fingers.map((f) => {
    const pts = f.flatMap((b) => [[b[0], b[1], b[2], b[6]], [b[3], b[4], b[5], b[7]]]);
    const c = pts.reduce((a, q) => [a[0] + q[0] / pts.length, a[1] + q[1] / pts.length, a[2] + q[2] / pts.length], [0, 0, 0]);
    const r = Math.max(...pts.map((q) => Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]) + q[3]));
    return [c[0], c[1], c[2], r];
  });
  return (x, y, z) => {
    let dp = 1;
    for (const b of palm) dp = smin(dp, roundCone(x, y, z, b), kPalm);
    for (const e of pe) dp = smin(dp, ellipsoid(x, y, z, e), kPalm);
    let d = dp;
    for (let fi = 0; fi < fingers.length; fi++) {
      const f = fingers[fi], S = sph[fi];
      if (Math.hypot(x - S[0], y - S[1], z - S[2]) - S[3] > d + kFinger) continue;
      let df = 1;
      for (const b of f) df = smin(df, roundCone(x, y, z, b), kJoint);
      d = Math.min(d, smin(df, dp, kFinger));
    }
    return d;
  };
}

/** right hand wrapped round a vertical grip of radius r (grip axis = local y) */
function gripPose(r) {
  const P = (a, rad, y) => V(Math.cos(a) * rad, y, -Math.sin(a) * rad);
  const fingers = [], palm = [], palmEll = [], knuckles = [], nails = [];
  // [height on the grip, thickness scale, length scale]: index, middle, ring, little
  [[0.0285, 0.96, 1.0], [0.01, 1.0, 1.07], [-0.0085, 0.95, 1.0], [-0.0255, 0.82, 0.8]].forEach(([y, s, ls]) => {
    const fr = 0.0087 * s, ring = r + fr * 0.92;
    const a0 = -0.32, a1 = a0 + (0.043 * ls) / ring, a2 = a1 + (0.026 * ls) / ring, a3 = Math.min(3.3, a2 + (0.019 * ls) / ring);
    const K = P(a0, ring + 0.012, y + 0.002), A = P(a1, ring, y), B = P(a2, ring, y - 0.002), C = P(a3, ring * 0.97, y - 0.004);
    fingers.push(fingerBones(K, A, B, C, s));
    // metacarpal back to the wrist: together they form the back of the hand
    const M = V(r + 0.008, y * 0.42 - 0.004, 0.074);
    palm.push(cone(K, M, 0.0105 * s, 0.0118));
    knuckles.push(K, A, B);
    nails.push({ a: B, b: C, r: 0.0072 * s, out: V(C.x + B.x, 0, C.z + B.z).normalize() });
  });
  // palm pad against the back of the grip, outer edge of the palm, wrist
  palmEll.push([r - 0.006, -0.003, 0.032, 0.016, 0.034, 0.016]);
  palmEll.push([r + 0.012, -0.02, 0.05, 0.012, 0.018, 0.03]);
  palm.push(cone(V(r + 0.005, -0.004, 0.07), V(r + 0.007, -0.009, 0.104), 0.02, 0.0215));
  // thumb: metacarpal (part of the palm) + two phalanges lying over the top of the grip
  const top = r + 0.03;
  const TB = V(0.001, 0.006, 0.062), T0 = V(-0.007, 0.027, 0.038), T1 = V(-0.01, top - 0.005, 0.019), T2 = V(0.001, top + 0.004, -0.011);
  palm.push(cone(TB, T0, 0.0125, 0.0112));
  palmEll.push([-0.003, 0.016, 0.046, 0.013, 0.016, 0.02]);
  fingers.push([cone(T0, T1, 0.0108, 0.0096), cone(T1, T2, 0.0094, 0.0078)]);
  knuckles.push(T0, T1);
  nails.push({ a: T1, b: T2, r: 0.0084, out: V(0, 1, 0.15).normalize() });
  return { fingers, palm, palmEll, knuckles, nails, wrist: V(r + 0.007, -0.009, 0.1) };
}

/** left hand resting on a throttle knob: palm on top, fingers over the front edge, thumb along the inboard side */
function throttlePose() {
  const fingers = [], palm = [], palmEll = [], knuckles = [], nails = [];
  [[0.0205, 0.96, 1.0], [0.0068, 1.0, 1.06], [-0.0072, 0.95, 1.0], [-0.0205, 0.82, 0.82]].forEach(([x, s, ls]) => {
    const K = V(x, 0.032, 0.012);
    const A = K.clone().add(V(0, -0.004, -0.034 * ls)), B = A.clone().add(V(0, -0.021 * ls, -0.011 * ls)), C = B.clone().add(V(0, -0.015 * ls, 0.007 * ls));
    fingers.push(fingerBones(K, A, B, C, s));
    palm.push(cone(K, V(x * 0.42, 0.046, 0.074), 0.0105 * s, 0.0118));
    knuckles.push(K, A, B);
    nails.push({ a: B, b: C, r: 0.0072 * s, out: V(0, -0.35, -1).normalize() });
  });
  palmEll.push([0, 0.024, 0.032, 0.033, 0.009, 0.03]);
  palmEll.push([-0.028, 0.03, 0.05, 0.012, 0.012, 0.03]);
  palm.push(cone(V(-0.002, 0.04, 0.068), V(-0.004, 0.043, 0.102), 0.02, 0.0215));
  const TB = V(0.012, 0.03, 0.064), T0 = V(0.031, 0.027, 0.043), T1 = V(0.043, 0.019, 0.023), T2 = V(0.045, 0.006, -0.009);
  palm.push(cone(TB, T0, 0.0125, 0.0112));
  palmEll.push([0.022, 0.026, 0.048, 0.013, 0.012, 0.02]);
  fingers.push([cone(T0, T1, 0.0108, 0.0096), cone(T1, T2, 0.0094, 0.0078)]);
  knuckles.push(T0, T1);
  nails.push({ a: T1, b: T2, r: 0.0084, out: V(1, 0.2, 0).normalize() });
  return { fingers, palm, palmEll, knuckles, nails, wrist: V(-0.004, 0.043, 0.1) };
}

// ---------------------------------------------------------------------------
// meshing: naive surface nets on a narrow-band grid
// ---------------------------------------------------------------------------
function bounds(pose) {
  const bb = new THREE.Box3();
  const addCone = (b) => { bb.expandByPoint(V(b[0] - b[6], b[1] - b[6], b[2] - b[6])); bb.expandByPoint(V(b[0] + b[6], b[1] + b[6], b[2] + b[6])); bb.expandByPoint(V(b[3] - b[7], b[4] - b[7], b[5] - b[7])); bb.expandByPoint(V(b[3] + b[7], b[4] + b[7], b[5] + b[7])); };
  pose.palm.forEach(addCone); pose.fingers.flat().forEach(addCone);
  for (const e of pose.palmEll) { bb.expandByPoint(V(e[0] - e[3], e[1] - e[4], e[2] - e[5])); bb.expandByPoint(V(e[0] + e[3], e[1] + e[4], e[2] + e[5])); }
  return bb.expandByScalar(0.005);
}

function* mesh(pose, h = 0.0016) {
  const F = makeField(pose);
  const bb = bounds(pose);
  const nx = Math.ceil((bb.max.x - bb.min.x) / h) + 1, ny = Math.ceil((bb.max.y - bb.min.y) / h) + 1, nz = Math.ceil((bb.max.z - bb.min.z) / h) + 1;
  const ox = bb.min.x, oy = bb.min.y, oz = bb.min.z;
  const val = new Float32Array(nx * ny * nz);
  const id = (i, j, k) => i + nx * (j + ny * k);
  // evaluate block-wise and skip blocks far from the surface
  const B = 4, reach = B * h * 0.9 + h;
  for (let bk = 0; bk < nz; bk += B) for (let bj = 0; bj < ny; bj += B) {
    yield;
    for (let bi = 0; bi < nx; bi += B) {
    const dc = F(ox + (bi + B / 2) * h, oy + (bj + B / 2) * h, oz + (bk + B / 2) * h);
    const far = Math.abs(dc) > reach;
    for (let k = bk; k < Math.min(nz, bk + B); k++) for (let j = bj; j < Math.min(ny, bj + B); j++) for (let i = bi; i < Math.min(nx, bi + B); i++) {
      val[id(i, j, k)] = far ? dc : F(ox + i * h, oy + j * h, oz + k * h);
    }
    }
  }
  // one vertex per cell that the surface passes through
  const cell = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cid = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k);
  const pos = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) {
    if (!(j & 7)) yield;
    for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) { const [a, b, d] = corners[c]; cv[c] = val[id(i + a, j + b, k + d)]; if (cv[c] < 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [e0, e1] of edges) {
      const v0 = cv[e0], v1 = cv[e1];
      if ((v0 < 0) === (v1 < 0)) continue;
      const t = v0 / (v0 - v1), c0 = corners[e0], c1 = corners[e1];
      sx += c0[0] + (c1[0] - c0[0]) * t; sy += c0[1] + (c1[1] - c0[1]) * t; sz += c0[2] + (c1[2] - c0[2]) * t; n++;
    }
    cell[cid(i, j, k)] = pos.length / 3;
    pos.push(ox + (i + sx / n) * h, oy + (j + sy / n) * h, oz + (k + sz / n) * h);
    }
  }
  // one quad per grid edge crossing the surface, wound so the face points outwards
  const idx = [];
  const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) idx.push(a, d, c, a, c, b); else idx.push(a, b, c, a, c, d); };
  for (let k = 1; k < nz - 1; k++) { yield; for (let j = 1; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const v0 = val[id(i, j, k)], v1 = val[id(i + 1, j, k)];
    if ((v0 < 0) !== (v1 < 0)) quad(cell[cid(i, j - 1, k - 1)], cell[cid(i, j, k - 1)], cell[cid(i, j, k)], cell[cid(i, j - 1, k)], !(v0 < 0));
  } }
  for (let k = 1; k < nz - 1; k++) { yield; for (let j = 0; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const v0 = val[id(i, j, k)], v1 = val[id(i, j + 1, k)];
    if ((v0 < 0) !== (v1 < 0)) quad(cell[cid(i - 1, j, k - 1)], cell[cid(i - 1, j, k)], cell[cid(i, j, k)], cell[cid(i, j, k - 1)], !(v0 < 0));
  } }
  for (let k = 0; k < nz - 1; k++) { yield; for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const v0 = val[id(i, j, k)], v1 = val[id(i, j, k + 1)];
    if ((v0 < 0) !== (v1 < 0)) quad(cell[cid(i - 1, j - 1, k)], cell[cid(i, j - 1, k)], cell[cid(i, j, k)], cell[cid(i - 1, j, k)], !(v0 < 0));
  } }
  return { F, pos, idx };
}

// ---------------------------------------------------------------------------
// shading baked into vertex colours
// ---------------------------------------------------------------------------
const SKIN = new THREE.Color('#a8714f'), FLUSH = new THREE.Color('#9a4f44'), NAIL = new THREE.Color('#d9b2a6'), PALE = new THREE.Color('#bd8a6c');

function* build(pose) {
  const { F, pos, idx } = yield* mesh(pose);
  const n = pos.length / 3, nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const e = 0.0004, c = new THREE.Color(), p = new THREE.Vector3(), nv = new THREE.Vector3(), tmp = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    if (!(i % 1500)) yield;
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    nv.set(F(x + e, y, z) - F(x - e, y, z), F(x, y + e, z) - F(x, y - e, z), F(x, y, z + e) - F(x, y, z - e)).normalize();
    nor[i * 3] = nv.x; nor[i * 3 + 1] = nv.y; nor[i * 3 + 2] = nv.z;
    p.set(x, y, z);
    // ambient occlusion: how much the field "closes in" a little way out along the normal
    let ao = 0;
    for (const s of [0.003, 0.007, 0.012]) ao += Math.max(0, s - F(x + nv.x * s, y + nv.y * s, z + nv.z * s)) / s;
    ao = Math.max(0.35, 1 - ao * 0.55);
    c.copy(SKIN);
    // palm side lighter, knuckles flushed
    const back = nv.dot(tmp.set(1, 0.3, 0.2).normalize());
    if (back < -0.2) c.lerp(PALE, Math.min(1, (-back - 0.2) * 0.6));
    let flush = 0;
    for (const k of pose.knuckles) flush = Math.max(flush, 1 - p.distanceTo(k) / 0.011);
    if (flush > 0) c.lerp(FLUSH, flush * 0.35);
    // nails
    for (const nl of pose.nails) {
      tmp.copy(nl.a).lerp(nl.b, 0.66).addScaledVector(nl.out, nl.r * 0.75);
      const d = p.distanceTo(tmp);
      if (d < nl.r * 0.85 && nv.dot(nl.out) > 0.45) c.lerp(NAIL, 0.75 * Math.min(1, (nl.r * 0.85 - d) / (nl.r * 0.25)));
    }
    // fine mottling
    const m = Math.sin(x * 900 + y * 470) * Math.sin(y * 830 - z * 610) * Math.sin(z * 760 + x * 390);
    c.multiplyScalar((0.94 + m * 0.06) * ao);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.userData.shared = true;
  return { geometry: g, wrist: pose.wrist };
}

/**
 * Builds run as generators so they can be sliced into small chunks while the menus idle;
 * a cockpit that needs a hand before warm-up finished simply completes the remaining work at once.
 */
const JOBS = {};
const job = (key, pose) => JOBS[key] || (JOBS[key] = { it: build(pose()), done: null });
function finish(j) { while (!j.done) { const r = j.it.next(); if (r.done) j.done = r.value; } return j.done; }

/** smooth right hand round a 17 mm grip (mirror with a negative scale.x for the left hand) */
export function gripHandGeometry() { return finish(job('grip', () => gripPose(0.017))); }
/** smooth left hand for the throttle knob */
export function throttleHandGeometry() { return finish(job('thr', throttlePose)); }

/** build both hands ahead of time in ~6 ms slices so the title screen keeps animating */
export function warmHands() {
  const queue = [job('grip', () => gripPose(0.017)), job('thr', throttlePose)];
  const step = () => {
    const t0 = performance.now();
    while (queue.length && performance.now() - t0 < 6) {
      const j = queue[0];
      if (j.done) { queue.shift(); continue; }
      const r = j.it.next();
      if (r.done) { j.done = r.value; queue.shift(); }
    }
    if (queue.length) setTimeout(step, 16);
  };
  setTimeout(step, 0);
}
