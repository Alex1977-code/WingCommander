import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Drive exhaust: plasma plumes on every engine nozzle and ribbon trails behind the fighters.
// ---------------------------------------------------------------------------

/** shared clock of all plume materials (advanced by Trails.update) */
const CLOCK = { value: 0 };

/**
 * One mesh per nozzle, two quads ('corner'.z picks which):
 *  - glow: a camera-facing billboard at the nozzle exit with a white-hot core and a small halo
 *  - plume: a quad along the drive axis (local -Z) that turns about it to face the camera
 * Length and width come from the engine group's scale (see thrust()); the stretch ratio is the
 * throttle: hot core, colour falloff, shock diamonds and flicker grow with it.
 */
const PLUME_VERT = `
  attribute vec3 corner; uniform float uTime;
  varying vec2 vUv; varying float vKind; varying float vFace; varying float vThr; varying float vFl;
  void main(){
    vec3 o = modelMatrix[3].xyz, axW = -modelMatrix[2].xyz;
    float len = length(axW), wid = length(modelMatrix[0].xyz);
    vThr = clamp((len / wid - 0.6) / 2.2, 0.0, 1.0);
    float seed = dot(o, vec3(0.13, 0.071, 0.097));
    vFl = 0.86 + 0.14 * sin(uTime * 47.0 + seed) * sin(uTime * 29.0 + seed * 1.7);
    vUv = corner.xy; vKind = corner.z;
    if (corner.z > 0.5) {
      vFace = 1.0;
      vec4 mv = viewMatrix * vec4(o, 1.0);
      mv.xy += corner.xy * wid * 0.45;
      gl_Position = projectionMatrix * mv;
      return;
    }
    vec3 ax = axW / len;
    // close to the camera (own ship in chase view) the plume shortens and fades: no 'searchlight'
    // beams towards the lens, and less fill on phones; the glow billboard keeps the hot spot
    vec3 p = o + axW * corner.x * mix(0.45, 1.0, smoothstep(8.0, 40.0, distance(cameraPosition, o)));
    vec3 sd = cross(ax, normalize(cameraPosition - p));
    float s = length(sd);
    vFace = smoothstep(0.06, 0.45, s) // seen end-on the glow carries the look
          * smoothstep(8.0, 40.0, distance(cameraPosition, p));
    p += (s > 1e-4 ? sd / s : vec3(0.0)) * corner.y * wid * 0.25;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;
const PLUME_FRAG = `
  uniform vec3 uColor; uniform vec3 uHot;
  varying vec2 vUv; varying float vKind; varying float vFace; varying float vThr; varying float vFl;
  void main(){
    vec3 col;
    if (vKind > 0.5) {
      float d2 = dot(vUv, vUv);
      col = uHot * exp(-d2 * 70.0) * 0.4 + uColor * exp(-d2 * 7.0) * max(0.0, 1.0 - d2) * 0.16;
      col *= 0.8 + 0.4 * vThr;
    } else {
      float u = max(vUv.x, 0.0), v = abs(vUv.y);
      float x = v / mix(0.78, 0.3, u);                    // envelope narrows towards the tail
      float fade = smoothstep(-0.1, 0.02, vUv.x) * pow(1.0 - u, 1.6);
      // shock diamonds: standing knots along the core, more and tighter with throttle
      float ph = fract(u * (2.5 + 3.0 * vThr) + 0.15);
      float knot = pow(max(1.0 - abs(ph - 0.5) * 2.0, 0.0), 3.0) * smoothstep(0.04, 0.2, u);
      float cw = 0.2 + 0.16 * knot;                      // the core bulges at each knot
      float body = exp(-x * x * 3.0);
      float core = exp(-(x * x) / (cw * cw));
      float throat = exp(-u * 9.0);                      // white-hot right behind the nozzle
      col = (uColor * body * (0.16 + 0.34 * vThr)
          + uHot * core * ((0.25 + 0.45 * vThr) * (0.55 + 1.3 * knot) + throat * 1.1)) * fade * vFace;
    }
    gl_FragColor = vec4(col * vFl, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

let plumeGeo = null;
const plumeMats = new Map();
function key(c) { return `${c.r.toFixed(2)},${c.g.toFixed(2)},${c.b.toFixed(2)}`; }
/** white-hot centre of a drive colour (HDR, so it blooms on 'high') */
function hotOf(c) { const m = Math.max(c.r, c.g, c.b); return new THREE.Color(c.r * 0.45 + m * 0.55, c.g * 0.45 + m * 0.55, c.b * 0.45 + m * 0.55); }
function shared(o) { o.userData.shared = true; return o; }

function plumeGeometry() {
  if (plumeGeo) return plumeGeo;
  // the vertex shader places the quads from 'corner'; position only feeds three's culling sphere,
  // which covers glow and plume at any stretch
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(24), 3));
  g.setAttribute('corner', new THREE.Float32BufferAttribute([
    -0.1, -1, 0, -0.1, 1, 0, 1, -1, 0, 1, 1, 0, // plume: x along the axis, y across
    -1, -1, 1, 1, -1, 1, -1, 1, 1, 1, 1, 1,     // glow billboard
  ], 3));
  g.setIndex([0, 2, 1, 1, 2, 3, 4, 5, 6, 6, 5, 7]);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -0.4), 0.95);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());
  plumeGeo = shared(g);
  return g;
}
function plumeMaterial(color) {
  const k = key(color);
  if (!plumeMats.has(k)) {
    plumeMats.set(k, shared(new THREE.ShaderMaterial({
      uniforms: { uColor: { value: color.clone() }, uHot: { value: hotOf(color) }, uTime: CLOCK },
      vertexShader: PLUME_VERT, fragmentShader: PLUME_FRAG,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide,
    })));
  }
  return plumeMats.get(k);
}

/**
 * The glowing part of a drive nozzle of radius r, as a group at the nozzle exit facing -Z
 * (one draw call: glow and plume share a mesh). userData.base = r * 4 (group scale 1 = base).
 */
export function exhaust(color, r) {
  const e = new THREE.Group();
  const plume = new THREE.Mesh(plumeGeometry(), plumeMaterial(color));
  plume.userData.plume = true; // not part of the hull: no hit boxes
  plume.renderOrder = 2;
  e.add(plume);
  e.userData.base = r * 4;
  e.userData.engine = true;
  e.userData.r = r;
  e.userData.rgb = [color.r, color.g, color.b]; // plain array: userData is JSON-copied on clone
  e.scale.set(r * 4, r * 4, r * 4 * 1.3);
  return e;
}

/**
 * Drive output k (0.55 idle … ~1.15 cruise … ~2.2 boost, with flicker): the plume grows long and
 * bright, the core and halo only a little.
 */
export function thrust(e, k) {
  const b = e.userData.base, w = b * (0.7 + 0.3 * Math.min(k, 2.2));
  e.scale.set(w, w, b * 1.2 * Math.pow(Math.max(0.2, k), 1.5));
}

// ---------------------------------------------------------------------------
// Ribbon trails: a fixed pool of ribbons in one draw call. Each ribbon is a strip of N points
// (newest first), extruded towards the camera in the vertex shader and faded by age. Engines
// feed their ribbon every frame; a ribbon that is not fed (ship dead, removed, far away) keeps
// fading in place and returns to the pool.
// ---------------------------------------------------------------------------
const TRAIL_VERT = `
  attribute vec3 dir; attribute vec2 tw; attribute vec3 tcol;
  uniform float uTime; uniform float uLife;
  varying vec3 vCol; varying float vA; varying float vSide;
  void main(){
    float age = uTime - tw.x;
    float k = age / uLife;
    vSide = float(gl_VertexID & 1) * 2.0 - 1.0;
    if (k >= 1.0 || k < 0.0) {
      // dead point: stays where it is with no width and no alpha, so its segments collapse
      gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
      vA = 0.0; vCol = vec3(0.0);
      return;
    }
    vec3 toCam = cameraPosition - position;
    float dc = length(toCam);
    vec3 sd = cross(dir, toCam / dc);
    float s = length(sd);
    sd = s > 1e-4 ? sd / s : vec3(0.0);
    float w = tw.y * (0.5 + k * 1.5);                // the exhaust spreads as it cools
    float wd = max(w, dc * 0.0015);                  // at least ~1.5 px: far ribbons stay lines, not crawling dots
    vec3 p = position + sd * vSide * wd;
    // fade in behind the nozzle (the plume covers that part), out with age and right at the camera;
    // a widened ribbon dims by the same ratio, so its brightness on screen stays the same
    vA = (1.0 - k) * (1.0 - k) * smoothstep(0.0, 0.08, age) * smoothstep(12.0, 70.0, dc) * (w / wd);
    vCol = tcol * mix(vec3(1.0), vec3(0.7, 0.55, 0.9), k); // cools slightly towards violet
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;
const TRAIL_FRAG = `
  uniform float uK;
  varying vec3 vCol; varying float vA; varying float vSide;
  void main(){
    float a = exp(-vSide * vSide * 3.0) * vA * uK;
    gl_FragColor = vec4(vCol * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const STRIDE = 11; // position 3, dir 3, t0 + width 2, colour 3
const DEAD = -1e6;

export class Trails {
  constructor(scene, quality) {
    const hi = quality === 'high';
    this.N = hi ? 22 : 14;          // points per ribbon
    this.max = hi ? 64 : 48;        // ribbons
    this.step = hi ? 1 / 36 : 1 / 24; // seconds between frozen points
    this.life = (this.N - 2) * this.step;
    this.time = 0; this.frame = 0;
    const V = this.max * this.N * 2;
    this.buf = new Float32Array(V * STRIDE);
    for (let i = 0; i < V; i++) this.buf[i * STRIDE + 6] = DEAD;
    this.ib = new THREE.InterleavedBuffer(this.buf, STRIDE).setUsage(THREE.DynamicDrawUsage);
    this.range = { start: 0, count: 0 };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.InterleavedBufferAttribute(this.ib, 3, 0));
    geo.setAttribute('dir', new THREE.InterleavedBufferAttribute(this.ib, 3, 3));
    geo.setAttribute('tw', new THREE.InterleavedBufferAttribute(this.ib, 2, 6));
    geo.setAttribute('tcol', new THREE.InterleavedBufferAttribute(this.ib, 3, 8));
    const idx = new Uint16Array(this.max * (this.N - 1) * 6);
    let j = 0;
    for (let r = 0; r < this.max; r++) {
      for (let i = 0; i < this.N - 1; i++) {
        const a = (r * this.N + i) * 2;
        idx[j++] = a; idx[j++] = a + 1; idx[j++] = a + 2;
        idx[j++] = a + 1; idx[j++] = a + 3; idx[j++] = a + 2;
      }
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uLife: { value: this.life }, uK: { value: hi ? 0.3 : 0.34 } },
      vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    // per ribbon: owner engine, frame last fed, time since the last frozen point, live flag,
    // time claimed, priority owner (the player's ship)
    this.owner = new Array(this.max).fill(null);
    this.fed = new Int32Array(this.max).fill(-1);
    this.acc = new Float32Array(this.max);
    this.used = new Uint8Array(this.max);
    this.born = new Float32Array(this.max);
    this.pri = new Uint8Array(this.max);
    this.top = 0; // ribbons [0, top) may be live
  }

  /**
   * A ribbon for engine e: a free one, else the fading one closest to its end, else (priority
   * engines only) the oldest live ribbon of a non-priority engine. Non-priority engines never take
   * a live ribbon, so a full pool cannot make them steal from each other every frame.
   */
  claim(e, pri) {
    let id = -1;
    for (let i = 0; i < this.max; i++) if (!this.used[i]) { id = i; break; }
    if (id < 0) {
      const b = this.buf, S2 = this.N * 2 * STRIDE;
      let best = Infinity;
      for (let i = 0; i < this.max; i++) {
        if (this.fed[i] === this.frame || this.fed[i] === this.frame - 1) continue;
        const t = b[i * S2 + 6]; // newest point
        if (t < best) { best = t; id = i; }
      }
    }
    if (id < 0 && pri) {
      let best = Infinity;
      for (let i = 0; i < this.max; i++) if (!this.pri[i] && this.born[i] < best) { best = this.born[i]; id = i; }
    }
    if (id < 0) return -1;
    if (this.owner[id] && this.owner[id].userData.trail === id) this.owner[id].userData.trail = -1;
    this.used[id] = 1; this.owner[id] = e; e.userData.trail = id;
    this.born[id] = this.time; this.pri[id] = pri ? 1 : 0;
    this.top = Math.max(this.top, id + 1);
    return id;
  }

  /** write point i of ribbon id (both strip vertices) */
  put(id, i, x, y, z, dx, dy, dz, t0, w, c) {
    const b = this.buf;
    let o = ((id * this.N + i) * 2) * STRIDE;
    for (let v = 0; v < 2; v++, o += STRIDE) {
      b[o] = x; b[o + 1] = y; b[o + 2] = z; b[o + 3] = dx; b[o + 4] = dy; b[o + 5] = dz;
      b[o + 6] = t0; b[o + 7] = w; b[o + 8] = c[0]; b[o + 9] = c[1]; b[o + 10] = c[2];
    }
  }

  /**
   * Engine group e (see exhaust()) is at world position p this frame. width: ribbon half width,
   * c: [r, g, b] colour. pri: the player's engines, which always get a ribbon (taken from
   * another ship if the pool is full). Call once per frame for every engine that should leave a trail.
   */
  feed(e, p, width, c, dt, pri = false) {
    let id = e.userData.trail ?? -1;
    if (id < 0 || this.owner[id] !== e) id = -1;
    const N = this.N, b = this.buf, S = STRIDE;
    let fresh = id < 0;
    // a jump (spawn, autopilot, cut-scene hop) restarts the ribbon instead of a streak across space
    if (!fresh) {
      const head = (id * N) * 2 * S;
      fresh = (p.x - b[head]) ** 2 + (p.y - b[head + 1]) ** 2 + (p.z - b[head + 2]) ** 2 > 400 * 400;
      if (fresh) { this.born[id] = this.time; this.pri[id] = pri ? 1 : 0; }
    }
    if (fresh) {
      if (id < 0) id = this.claim(e, pri);
      if (id < 0) return;
      for (let i = 0; i < N; i++) this.put(id, i, p.x, p.y, p.z, 0, 0, 1, i ? DEAD : this.time, width, c);
      this.acc[id] = 0;
    }
    this.fed[id] = this.frame;
    const h = (id * N) * 2 * S;
    this.acc[id] += dt;
    if (this.acc[id] >= this.step) {
      // freeze the head: shift the strip one point back (newest first)
      this.acc[id] = Math.min(this.acc[id] - this.step, this.step);
      b.copyWithin(h + 2 * S, h, h + (N - 1) * 2 * S);
    }
    // the head follows the nozzle; its direction points back along the ribbon
    const n = h + 2 * S;
    let dx = p.x - b[n], dy = p.y - b[n + 1], dz = p.z - b[n + 2];
    const l = Math.hypot(dx, dy, dz);
    if (l > 1e-3) { dx /= l; dy /= l; dz /= l; } else { dx = b[n + 3]; dy = b[n + 4]; dz = b[n + 5]; }
    this.put(id, 0, p.x, p.y, p.z, dx, dy, dz, this.time, width, c);
    // the newest frozen point turns with the head, so the strip has no kink at the nozzle
    if (b[n + 6] > DEAD) for (let v = 0; v < 2; v++) { const o = n + v * S; b[o + 3] = dx; b[o + 4] = dy; b[o + 5] = dz; }
  }

  update(dt) {
    this.time += dt; CLOCK.value = this.time;
    this.mat.uniforms.uTime.value = this.time;
    const N = this.N, S = STRIDE, b = this.buf;
    let top = 0;
    for (let id = 0; id < this.top; id++) {
      if (!this.used[id]) continue;
      // not fed this frame: fades where it is; back to the pool once its newest point is too old
      if (this.fed[id] !== this.frame && this.time - b[(id * N) * 2 * S + 6] > this.life) {
        this.used[id] = 0; this.pri[id] = 0;
        if (this.owner[id]?.userData.trail === id) this.owner[id].userData.trail = -1;
        this.owner[id] = null;
        for (let i = 0; i < N * 2; i++) b[(id * N * 2 + i) * S + 6] = DEAD;
        continue;
      }
      top = id + 1;
    }
    // freed ribbons above the new top were cleared above and still need their upload
    const upTo = Math.max(top, this.top);
    this.top = top;
    this.frame++;
    if (upTo) {
      this.range.start = 0; this.range.count = upTo * N * 2 * S;
      if (!this.ib.updateRanges.length) this.ib.updateRanges.push(this.range);
      this.ib.needsUpdate = true;
    }
    this.mesh.geometry.setDrawRange(0, top * (N - 1) * 6);
  }
}
