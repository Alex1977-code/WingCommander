import * as THREE from 'three';

/**
 * Weapon visuals: laser bolts as glowing energy bolts (white-hot core in a coloured halo), muzzle
 * flashes, impact flares and shield splashes, the neutron cannon's beam and the plasma seekers'
 * glowing heads. Everything is pooled and drawn with a handful of instanced, additive draw calls
 * (one for all bolts, one for all flares), so the per-frame cost is O(objects) with no allocations.
 * Gameplay (positions, speeds, hits) stays in game.js; this file only draws.
 */

/** Shared clock for weapon shaders (also drives the plasma seekers' ion tails in game.js). */
export const WFX_TIME = { value: 0 };

/** Bolt looks per colour key: halo colour (HDR), white-hot core tint, length and halo half-width (m). */
const BOLT = {
  ally: { halo: new THREE.Color(0.2, 1.0, 4.2), core: new THREE.Color(1.5, 2.6, 4.4), len: 20, w: 1.2 },
  foe: { halo: new THREE.Color(4.2, 0.18, 0.7), core: new THREE.Color(4.4, 1.5, 2.0), len: 20, w: 1.2 },
  // capital ship turrets: heavier, longer bolts
  turret: { halo: new THREE.Color(0.55, 3.4, 0.35), core: new THREE.Color(2.4, 4.4, 2.0), len: 30, w: 1.6 },
  turretFoe: { halo: new THREE.Color(4.0, 1.0, 0.1), core: new THREE.Color(4.6, 2.8, 1.2), len: 30, w: 1.6 },
};
const SHIELD_COL = new THREE.Color(0.55, 1.5, 3.2);

const MAX_FLARES = 160;
const MUZZLE0 = 112; // slots MUZZLE0..MAX_FLARES are muzzle flashes only, so gunfire never overwrites impact flashes
const MUZZLE_FAR = 1200; // no muzzle flash beyond this distance from the viewer (sub-pixel anyway)
const MAX_BEAMS = 4;
const tV = new THREE.Vector3(), tV2 = new THREE.Vector3(), tVp = new THREE.Vector4(), tQ = new THREE.Quaternion();

/** Unit quad (corners at ±1) as the per-vertex part of an instanced draw. */
function quadGeo(cap, attrs) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3));
  g.setIndex([0, 1, 2, 2, 1, 3]);
  for (const [name, size] of attrs) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size);
    a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute(name, a);
  }
  g.instanceCount = 0;
  return g;
}
/** upload only the first n instances of an attribute */
function touch(a, n) {
  a.clearUpdateRanges();
  a.addUpdateRange(0, n * a.itemSize);
  a.needsUpdate = true;
}
/** world size of one framebuffer pixel at view depth 1, for the minimum on-screen width */
function pxUniform(u) {
  return (renderer, scene, camera) => {
    renderer.getCurrentViewport(tVp);
    u.value = 2 / (camera.projectionMatrix.elements[5] * Math.max(1, tVp.w));
  };
}

const OUT = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>`;

// Bolts: a camera-facing capsule stretched from tail to head, built in view space.
const BOLT_VS = /* glsl */ `
  attribute vec4 iA; // head (world), halo half-width
  attribute vec4 iB; // head - tail (world), brightness
  attribute vec3 iC; // halo colour
  attribute vec3 iD; // core colour
  uniform float uPx, uHalo;
  varying vec3 vHalo; varying vec3 vCore; varying vec2 vQ; varying float vLw;
  void main(){
    vec3 head = (viewMatrix * vec4(iA.xyz, 1.0)).xyz;
    vec3 ax = mat3(viewMatrix) * iB.xyz;
    vec3 mid = head - ax * 0.5;
    float L = length(ax);
    vec3 V = normalize(-mid);
    vec3 side = cross(ax / max(L, 1e-4), V);
    float sl = length(side);
    side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
    vec3 cap = cross(V, side); // screen-plane direction towards the head
    float w = max(iA.w, -mid.z * uPx * 1.5); // never thinner than a few pixels
    float lw = 0.5 * L * sl / w; // projected half-length in halo widths
    vec3 p = mid + ax * 0.5 * position.x + (side * position.y + cap * position.x) * w;
    vQ = vec2(position.x * (lw + 1.0), position.y);
    vLw = lw;
    float k = iB.w * smoothstep(3.0, 16.0, -mid.z); // no glare when a bolt brushes past the camera
    vHalo = iC * k * uHalo; vCore = iD * k;
    // invisible (faded or right at the eye): collapse the quad so it costs no fill
    gl_Position = k < 0.01 ? vec4(0.0, 0.0, 2.0, 1.0) : projectionMatrix * vec4(p, 1.0);
  }`;
const BOLT_FS = /* glsl */ `
  varying vec3 vHalo; varying vec3 vCore; varying vec2 vQ; varying float vLw;
  void main(){
    float r = length(vec2(max(abs(vQ.x) - vLw, 0.0), vQ.y));
    if (r >= 1.0) discard;
    float t = clamp(vQ.x / (vLw + 1.0) * 0.5 + 0.5, 0.0, 1.0); // 0 tail .. 1 head
    float h = 1.0 - r;
    float glow = exp(-r * r * 7.0) * 0.7 + h * h * h * 0.3;
    float core = 1.0 - smoothstep(0.05, 0.3, r);
    gl_FragColor = vec4(vHalo * glow * (0.3 + 0.7 * t) + vCore * core * (0.45 + 0.55 * t), 1.0);
    ${OUT}
  }`;

// Flares: muzzle flashes, impact flashes (glow + four-point star) and expanding shield rings.
const FLARE_VS = /* glsl */ `
  attribute vec4 iA; // position (world), radius
  attribute vec4 iB; // colour * intensity, ring radius (< 0: flare)
  attribute vec2 iC; // rotation, star strength
  varying vec2 vUv; varying vec3 vCol; varying float vRing; varying float vStar;
  void main(){
    vec4 mv = viewMatrix * vec4(iA.xyz, 1.0);
    float c = cos(iC.x), s = sin(iC.x);
    vUv = mat2(c, s, -s, c) * position.xy;
    vCol = iB.rgb; vRing = iB.w; vStar = iC.y;
    vec3 p = mv.xyz + vec3(position.xy * iA.w, 0.0);
    // slide towards the camera along the view ray (same screen spot) so the hull doesn't cut the flash
    float l = length(p);
    p *= max(0.05, (l - iA.w * 0.7) / max(l, 1e-3));
    gl_Position = projectionMatrix * vec4(p, 1.0);
  }`;
const FLARE_FS = /* glsl */ `
  varying vec2 vUv; varying vec3 vCol; varying float vRing; varying float vStar;
  void main(){
    float r = length(vUv);
    if (r >= 1.0) discard;
    vec3 c;
    if (vRing < 0.0) {
      vec2 a = abs(vUv);
      float star = (exp(-a.y * 38.0) * (1.0 - a.x) + exp(-a.x * 38.0) * (1.0 - a.y)) * vStar;
      float e = exp(-r * r * 16.0) * 1.3 + exp(-r * r * 4.0) * 0.3 + star;
      float hot = max(vCol.r, max(vCol.g, vCol.b)) * exp(-r * r * 70.0) * 0.7; // white-hot centre
      c = vCol * e + vec3(hot);
    } else {
      float d = (r - vRing) / (0.06 + 0.1 * vRing);
      c = vCol * (exp(-d * d) + exp(-r * r * 8.0) * 0.15 * (1.0 - vRing));
    }
    gl_FragColor = vec4(c * (1.0 - smoothstep(0.7, 1.0, r)), 1.0);
    ${OUT}
  }`;

// Neutron beam: a camera-facing ribbon bent along a quadratic Bezier in the vertex shader (one shared
// geometry, no per-shot buffers), with a white-hot core, a soft glow and two crackling arcs.
const BEAM_SEG = 64;
const BEAM_VS = /* glsl */ `
  uniform vec3 uP0, uP1, uP2; uniform float uW, uPx, uLen;
  varying vec2 vTV; varying float vS;
  void main(){
    float t = position.x, u = 1.0 - t;
    vec3 B = u * u * uP0 + 2.0 * u * t * uP1 + t * t * uP2;
    vec3 T = 2.0 * u * (uP1 - uP0) + 2.0 * t * (uP2 - uP1);
    vec3 P = (viewMatrix * vec4(B, 1.0)).xyz;
    vec3 V = normalize(-P);
    vec3 side = cross(mat3(viewMatrix) * T, V);
    float sl = length(side);
    side = sl > 1e-5 ? side / sl : vec3(1.0, 0.0, 0.0);
    // thinner right at the emitter and close to the eye, never below a couple of pixels far away
    float w = uW * clamp(-P.z / 90.0, 0.3, 1.0) * mix(0.25, 1.0, smoothstep(0.0, 0.05, t));
    w = max(w, -P.z * uPx * 2.0);
    P += side * position.y * w;
    vTV = vec2(t, position.y); vS = t * uLen;
    gl_Position = projectionMatrix * vec4(P, 1.0);
  }`;
const BEAM_FS = /* glsl */ `
  uniform vec3 uCore, uGlow, uArc; uniform vec3 uK; uniform float uTime, uSeed;
  varying vec2 vTV; varying float vS;
  float h1(float n){ return fract(sin(n) * 43758.5453); }
  float zig(float s, float seed){ float i = floor(s); return mix(h1(i + seed), h1(i + 1.0 + seed), fract(s)) * 2.0 - 1.0; }
  void main(){
    float a = abs(vTV.y);
    float tick = mod(floor(uTime * 28.0), 61.0); // arcs re-roll ~28 times a second; small hash input keeps mobile precision
    float core = exp(-a * a * 150.0);
    float glow = exp(-a * a * 12.0) * (0.85 + 0.15 * sin(vS * 0.07 - uTime * 90.0));
    float haze = (1.0 - a) * (1.0 - a);
    float fw = max(fwidth(vTV.y) * 1.3, 0.02);
    float d1 = (vTV.y - zig(vS / 7.0, tick * 13.1 + uSeed) * 0.42) / fw;
    float d2 = (vTV.y - zig(vS / 4.5, tick * 7.7 + uSeed + 50.0) * 0.3) / fw;
    float arc = exp(-d1 * d1) + 0.6 * exp(-d2 * d2);
    float ends = smoothstep(0.0, 0.012, vTV.x);
    vec3 c = uCore * core * 1.3 * uK.x + uGlow * (glow * 1.2 + haze * 0.25) * uK.y + uArc * arc * uK.z;
    gl_FragColor = vec4(c * ends, 1.0);
    ${OUT}
  }`;

export class WeaponsFx {
  /** fx: the scene's Fx (sparks are spawned through it). Objects live in the scene and are freed with it. */
  constructor(scene, fx) {
    this.scene = scene; this.fx = fx;
    this.hi = fx.hi;
    this.time = 0;

    // ---- bolts ----
    this.boltCap = 0;
    this.boltPx = { value: 0.002 };
    this.boltMat = new THREE.ShaderMaterial({
      // with bloom ('high') the halo is partly drawn by the bloom pass, so the bolt's own halo is fainter
      uniforms: { uPx: this.boltPx, uHalo: { value: this.hi ? 0.7 : 1 } }, vertexShader: BOLT_VS, fragmentShader: BOLT_FS,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide, forceSinglePass: true, // winding follows the bolt's direction
    });
    this.bolts = new THREE.Mesh(this.makeBoltGeo(512), this.boltMat);
    this.bolts.frustumCulled = false;
    this.bolts.renderOrder = 3;
    this.bolts.onBeforeRender = pxUniform(this.boltPx);
    scene.add(this.bolts);

    // ---- flares ----
    this.flares = [];
    for (let i = 0; i < MAX_FLARES; i++) this.flares.push({ pos: new THREE.Vector3(), off: new THREE.Vector3(), owner: null, col: new THREE.Color(), size: 1, grow: 0, life: 0, max: 1, ring: -1, rot: 0, star: 0 });
    this.fCursor = 0; this.mCursor = MUZZLE0;
    this.spots = 0; // one-frame flares (missile heads), staged in the slots after MAX_FLARES
    this.flareMesh = new THREE.Mesh(quadGeo(MAX_FLARES + 32, [['iA', 4], ['iB', 4], ['iC', 2]]), new THREE.ShaderMaterial({
      vertexShader: FLARE_VS, fragmentShader: FLARE_FS,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    this.flareMesh.frustumCulled = false;
    this.flareMesh.renderOrder = 3;
    scene.add(this.flareMesh);

    // ---- neutron beams ----
    const pos = [], idx = [];
    for (let i = 0; i <= BEAM_SEG; i++) {
      pos.push(i / BEAM_SEG, -1, 0, i / BEAM_SEG, 1, 0);
      if (i < BEAM_SEG) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
    }
    const beamGeo = new THREE.BufferGeometry();
    beamGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    beamGeo.setIndex(idx);
    this.beams = [];
    for (let i = 0; i < MAX_BEAMS; i++) {
      const u = {
        uP0: { value: new THREE.Vector3() }, uP1: { value: new THREE.Vector3() }, uP2: { value: new THREE.Vector3() },
        uW: { value: 6 }, uPx: { value: 0.002 }, uLen: { value: 1 }, uTime: WFX_TIME, uSeed: { value: 0 },
        uCore: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() }, uArc: { value: new THREE.Color() }, uK: { value: new THREE.Vector3() },
      };
      const m = new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({
        uniforms: u, vertexShader: BEAM_VS, fragmentShader: BEAM_FS,
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide, forceSinglePass: true,
      }));
      m.frustumCulled = false;
      m.visible = false;
      m.renderOrder = 3;
      m.onBeforeRender = pxUniform(u.uPx);
      scene.add(m);
      this.beams.push({ m, u, life: 0, max: 1, owner: null, off: new THREE.Vector3() });
    }
  }

  /**
   * Objects for the renderer's shader prewarm: one mesh per given material (the plasma seekers' ion tails) plus a
   * beam, which is otherwise hidden and so skipped by compile(). Add the group to the scene while compiling, then remove it.
   */
  warmObjects(mats = []) {
    const g = new THREE.Group();
    this.warmGeo ||= new THREE.PlaneGeometry(1, 1); // position, normal and uv, as the tail shader expects
    for (const m of mats) { const o = new THREE.Mesh(this.warmGeo, m); o.frustumCulled = false; g.add(o); }
    const b = new THREE.Mesh(this.beams[0].m.geometry, this.beams[0].m.material);
    b.frustumCulled = false;
    g.add(b);
    return g;
  }

  makeBoltGeo(cap) {
    this.boltCap = cap;
    this.boltGeo = quadGeo(cap, [['iA', 4], ['iB', 4], ['iC', 3], ['iD', 3]]);
    return this.boltGeo;
  }

  // ---- flares ----
  flare(p, col, k, size, life, star = 0, ring = -1, grow = 0, muzzle = false) {
    let f;
    if (muzzle) { f = this.flares[this.mCursor]; this.mCursor = this.mCursor + 1 < MAX_FLARES ? this.mCursor + 1 : MUZZLE0; }
    else { f = this.flares[this.fCursor]; this.fCursor = (this.fCursor + 1) % MUZZLE0; }
    f.pos.copy(p); f.owner = null;
    f.col.copy(col).multiplyScalar(k);
    f.size = size; f.grow = grow; f.life = f.max = life; f.ring = ring; f.star = star;
    f.rot = Math.random() * Math.PI;
    return f;
  }
  /** short flash at a gun that rides along with the firing ship; dist: distance to the nearest viewer (skipped when far) */
  muzzle(p, owner, key, dist = 0) {
    if (dist > MUZZLE_FAR) return;
    const st = BOLT[key] || BOLT.ally, cap = owner.def?.capital;
    const own = owner.isPlayer && owner.pilot?.view === 'cockpit'; // keep the pilot's own guns from glaring
    const f = this.flare(p, st.halo, 0.9, (cap ? 5.5 : 2.6) * (own ? 0.55 : 1), 0.07, cap ? 0.7 : 0.5, -1, 0, true);
    f.owner = owner;
    // offset in the owner's local frame (like the beam emitter), so the flash stays on the gun while the ship rolls
    f.off.copy(p).sub(owner.pos);
    if (owner.quat) f.off.applyQuaternion(tQ.copy(owner.quat).invert());
  }
  /**
   * a bolt strikes: flash and sparks in the bolt's colour, on shields a splash ring.
   * ship: the ship that was hit (optional); hits on a player's own ship are toned down so they don't cover the view.
   */
  impact(p, key, shield, vel, ship = null) {
    const st = BOLT[key] || BOLT.ally, hi = this.hi, heavy = key.startsWith('turret');
    const own = !!ship?.isPlayer, cockpit = own && ship.pilot?.view === 'cockpit';
    const sc = own ? 0.45 : 1;
    this.flare(p, st.halo, 0.6, (heavy ? 9 : 6.5) * sc, 0.14, 0.9);
    // own ship: half-size ring in chase view, none from the cockpit
    if (shield && !cockpit) this.flare(p, SHIELD_COL, 0.55, 1, 0.3, 0, 0, (heavy ? 16 : 11) * (own ? 0.5 : 1));
    // sparks thrown back against the bolt's flight
    tV2.copy(vel).normalize();
    let n = shield ? (hi ? 5 : 2) : (hi ? 9 : 3);
    if (own) n = Math.ceil(n * 0.4);
    const c = shield ? SHIELD_COL : st.halo;
    for (let i = 0; i < n; i++) {
      tV.randomDirection().addScaledVector(tV2, -1.1).multiplyScalar(40 + Math.random() * 90);
      this.fx.particle(p.x, p.y, p.z, tV.x, tV.y, tV.z, c.r * 1.2, c.g * 1.2, c.b * 1.2, 1.4, 0.18 + Math.random() * 0.25, 2);
    }
  }
  /** this frame only: a glowing head (plasma seekers) */
  spot(p, col, size, rot, star = 0.8) {
    if (this.spots >= 32) return;
    const i = MAX_FLARES + this.spots;
    this.spots++;
    const g = this.flareMesh.geometry.attributes;
    g.iA.setXYZW(i, p.x, p.y, p.z, size);
    g.iB.setXYZW(i, col.r, col.g, col.b, -1);
    g.iC.setXY(i, rot, star);
  }

  // ---- neutron beam ----
  /** beam along a quadratic curve from -> ctrl -> end, fading over `life` seconds; its start stays on `owner`'s emitter */
  beam(from, ctrl, end, life, core, glow, arc, owner = null) {
    const B = this.beams.find((b) => b.life <= 0) || this.beams.reduce((a, b) => (a.life < b.life ? a : b));
    const u = B.u;
    u.uP0.value.copy(from); u.uP1.value.copy(ctrl); u.uP2.value.copy(end);
    u.uLen.value = from.distanceTo(end);
    u.uSeed.value = Math.random() * 100;
    u.uW.value = this.hi ? 6.5 : 5.5;
    u.uCore.value.copy(core); u.uGlow.value.copy(glow); u.uArc.value.copy(arc);
    B.life = B.max = life;
    B.owner = owner?.quat ? owner : null;
    if (B.owner) B.off.copy(from).sub(owner.pos).applyQuaternion(tQ.copy(owner.quat).invert());
    this.beamK(B);
    B.m.visible = true;
  }
  beamK(B) {
    const k = Math.max(0, B.life / B.max);
    B.u.uK.value.set(Math.min(1, k * 1.6), k * (0.85 + Math.random() * 0.3), k > 0.25 ? 0.9 : k * 3.6);
  }

  /** advance flares and beams and upload this frame's bolts (call once per simulated frame) */
  update(dt, bolts, speed) {
    this.time += dt;
    WFX_TIME.value = this.time % 1000;
    // bolts
    if (bolts.length > this.boltCap) {
      this.bolts.geometry.dispose();
      this.bolts.geometry = this.makeBoltGeo(Math.ceil(bolts.length / 256) * 256 * 2);
    }
    const ga = this.boltGeo.attributes, A = ga.iA.array, Bv = ga.iB.array, C = ga.iC.array, D = ga.iD.array;
    const n = bolts.length;
    for (let i = 0; i < n; i++) {
      const b = bolts[i], st = BOLT[b.key] || BOLT.ally, p = b.pos, v = b.vel;
      // the tail grows out of the muzzle, then trails at full length; the bolt fades in its last moments
      const len = Math.min(st.len, (b.life0 - b.life) * speed + 2), s = len / (v.length() || 1);
      const j = i * 4, k = i * 3;
      A[j] = p.x; A[j + 1] = p.y; A[j + 2] = p.z; A[j + 3] = st.w;
      Bv[j] = v.x * s; Bv[j + 1] = v.y * s; Bv[j + 2] = v.z * s; Bv[j + 3] = Math.min(1, b.life / 0.12);
      C[k] = st.halo.r; C[k + 1] = st.halo.g; C[k + 2] = st.halo.b;
      D[k] = st.core.r; D[k + 1] = st.core.g; D[k + 2] = st.core.b;
    }
    this.boltGeo.instanceCount = n;
    if (n) { touch(ga.iA, n); touch(ga.iB, n); touch(ga.iC, n); touch(ga.iD, n); }

    // flares: live ones packed to the front, then this frame's spots
    const fg = this.flareMesh.geometry.attributes, spots = this.spots;
    let m = 0;
    for (const f of this.flares) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) continue;
      if (f.owner) {
        f.pos.copy(f.off);
        if (f.owner.quat) f.pos.applyQuaternion(f.owner.quat);
        f.pos.add(f.owner.pos);
      }
      const t = f.life / f.max, a = f.ring >= 0 ? t : t * t;
      const size = f.ring >= 0 ? f.grow : f.size * (1.25 - 0.45 * t);
      fg.iA.setXYZW(m, f.pos.x, f.pos.y, f.pos.z, size);
      fg.iB.setXYZW(m, f.col.r * a, f.col.g * a, f.col.b * a, f.ring >= 0 ? 0.25 + 0.7 * (1 - t) : -1);
      fg.iC.setXY(m, f.rot, f.star);
      m++;
    }
    if (spots) {
      for (let a = 0; a < 3; a++) {
        const at = a === 0 ? fg.iA : a === 1 ? fg.iB : fg.iC;
        at.array.copyWithin(m * at.itemSize, MAX_FLARES * at.itemSize, (MAX_FLARES + spots) * at.itemSize);
      }
    }
    const total = m + spots;
    this.spots = 0;
    this.flareMesh.geometry.instanceCount = total;
    if (total) { touch(fg.iA, total); touch(fg.iB, total); touch(fg.iC, total); }

    for (const B of this.beams) {
      if (B.life <= 0) continue;
      B.life -= dt;
      if (B.life <= 0) { B.m.visible = false; continue; }
      this.beamK(B);
      if (B.owner?.alive) {
        // the ship flies on while the beam fades: move the emitter end (and the bend) along with it
        tV.copy(B.off).applyQuaternion(B.owner.quat).add(B.owner.pos).sub(B.u.uP0.value);
        B.u.uP0.value.add(tV); B.u.uP1.value.add(tV);
      }
    }
  }
}
