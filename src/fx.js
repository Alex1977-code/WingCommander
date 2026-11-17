import * as THREE from 'three';

let glowTex = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,255,255,0.65)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

/** horizontal anamorphic lens streak (the 90s TV sci-fi flare) */
let streakTex = null;
function streakTexture() {
  if (streakTex) return streakTex;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 32;
  const g = c.getContext('2d');
  const img = g.createImageData(256, 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 256; x++) {
      const u = Math.abs(x - 127.5) / 128, v = Math.abs(y - 15.5) / 16;
      const a = Math.pow(1 - u, 2.2) * Math.exp(-v * v * 9) * (0.6 + 0.4 * Math.exp(-u * 18));
      const i = (y * 256 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  streakTex = new THREE.CanvasTexture(c);
  return streakTex;
}

/** soft, lumpy smoke puff (alpha only), built once from value noise */
let puffTex = null;
function puffTexture() {
  if (puffTex) return puffTex;
  const N = 64, c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  const L = 8, lat = new Float32Array(L * L * 3);
  for (let i = 0; i < lat.length; i++) lat[i] = Math.random();
  const vn = (x, y, o) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const at = (a, b) => lat[o * L * L + ((b & (L - 1)) * L + (a & (L - 1)))];
    return (at(xi, yi) * (1 - sx) + at(xi + 1, yi) * sx) * (1 - sy) + (at(xi, yi + 1) * (1 - sx) + at(xi + 1, yi + 1) * sx) * sy;
  };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N, v = (y + 0.5) / N;
      const r = Math.hypot(u - 0.5, v - 0.5) * 2;
      const n = 0.5 * vn(u * 4, v * 4, 0) + 0.3 * vn(u * 8, v * 8, 1) + 0.2 * vn(u * 8 + 3.3, v * 8 + 1.7, 2);
      const a = Math.max(0, Math.min(1, (1 - r) * 1.6 - 0.15)) * (0.35 + 0.9 * n);
      const i = (y * N + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.round(Math.min(1, a * a * 1.4) * 255);
    }
  }
  g.putImageData(img, 0, 0);
  puffTex = new THREE.CanvasTexture(c);
  return puffTex;
}

const VERT = `
  attribute vec4 pcolor; attribute float psize; uniform float uScale;
  varying vec4 vCol;
  void main(){
    vCol = pcolor;
    vec4 mv = modelViewMatrix * vec4(position,1.0);
    gl_PointSize = psize * uScale / max(1.0,-mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
// smoke puffs: each particle gets a fixed random rotation of the puff texture
const SMOKE_VERT = `
  attribute vec4 pcolor; attribute float psize; uniform float uScale;
  varying vec4 vCol; varying vec2 vRot;
  void main(){
    vCol = pcolor;
    float a = fract(sin(float(gl_VertexID) * 12.9898) * 43758.5453) * 6.2831853;
    vRot = vec2(cos(a), sin(a));
    vec4 mv = modelViewMatrix * vec4(position,1.0);
    gl_PointSize = psize * uScale / max(1.0,-mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const SMOKE_FRAG = `
  uniform sampler2D uTex; varying vec4 vCol; varying vec2 vRot;
  void main(){
    vec2 p = gl_PointCoord - 0.5;
    p = vec2(p.x * vRot.x - p.y * vRot.y, p.x * vRot.y + p.y * vRot.x);
    float a = texture2D(uTex, p + 0.5).a;
    gl_FragColor = vec4(vCol.rgb, a * vCol.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// cheap 3D value noise shared by the fireball shaders
const NOISE = `
  float hash3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vnoise(vec3 x){
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
  }`;

/**
 * A pool of point particles. additive = glowing fire/sparks, otherwise soft smoke (alpha blended).
 * Each particle: position, velocity, drag, size growth, colour ramp hot → cool.
 * Smoke can start lit from within (heat) and cool to its base shade.
 */
class Particles {
  constructor(scene, max, additive) {
    this.max = max; this.additive = additive;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.base = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.heat = new Float32Array(max);
    this.cursor = 0; this.live = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4));
    geo.setAttribute('psize', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uTex: { value: additive ? null : puffTexture() } },
      vertexShader: additive ? VERT : SMOKE_VERT,
      fragmentShader: additive
        ? `varying vec4 vCol; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = 1.0 - smoothstep(0.0, 1.0, d); gl_FragColor = vec4(vCol.rgb * a * a * vCol.a, 1.0); }`
        : SMOKE_FRAG,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: false,
      transparent: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 2 : 1;
    scene.add(this.points);
  }
  add(x, y, z, vx, vy, vz, r, g, b, size, life, drag = 1.2, grow = 0, alpha = 1, heat = 0) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const j = i * 3;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z;
    this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    this.base[j] = r; this.base[j + 1] = g; this.base[j + 2] = b;
    this.life[i] = life; this.maxLife[i] = life; this.size0[i] = size; this.drag[i] = drag; this.grow[i] = grow; this.alpha[i] = alpha; this.heat[i] = heat;
    this.live = this.max; // force an upload next frame
  }
  update(dt) {
    if (!this.live) return;
    const { pos, vel, life, maxLife, size, size0, col, base, drag, grow, alpha, heat, additive } = this;
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) { size[i] = 0; continue; }
      alive++;
      const k = life[i] / maxLife[i];
      const d = Math.max(0, 1 - drag[i] * dt);
      const j = i * 3;
      vel[j] *= d; vel[j + 1] *= d; vel[j + 2] *= d;
      pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
      const c = i * 4;
      if (additive) {
        size[i] = size0[i] * (0.4 + 0.6 * k) + grow[i] * (1 - k);
        // white-hot → orange → deep red
        col[c] = base[j]; col[c + 1] = base[j + 1] * (0.25 + 0.75 * k * k); col[c + 2] = base[j + 2] * k * k * k; col[c + 3] = k * alpha[i];
      } else {
        size[i] = size0[i] + grow[i] * (1 - k);
        // embers inside fresh explosion smoke: glow orange, cooling over the first half of its life
        let h = heat[i] * (k * 2 - 1);
        h = h > 0 ? h * h : 0;
        col[c] = base[j] + 2.4 * h; col[c + 1] = base[j + 1] + 0.75 * h; col[c + 2] = base[j + 2] + 0.15 * h;
        col[c + 3] = alpha[i] * Math.min(1, (1 - k) * 6) * k; // fade in, then out
      }
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.pcolor.needsUpdate = true;
    g.attributes.psize.needsUpdate = true;
    this.live = alive;
  }
}

/**
 * Glowing streaks (sparks, embers): one instanced draw call. Each instance is a camera-facing quad
 * from tail to head, where the tail trails the head by `len` seconds of its velocity (motion blur).
 */
const STREAK_VERT = `
  attribute vec3 iHead; attribute vec3 iTail; attribute vec4 iCol; attribute float iW;
  uniform float uMinW;
  varying vec4 vCol; varying vec2 vC;
  void main(){
    vec4 h = modelViewMatrix * vec4(iHead, 1.0), t = modelViewMatrix * vec4(iTail, 1.0);
    vec3 p = mix(t.xyz, h.xyz, position.x);
    vec3 d = h.xyz - t.xyz; float dl = length(d);
    vec3 dir = dl > 1e-4 ? d / dl : vec3(0.0, 1.0, 0.0);
    vec3 s = cross(dir, p); float sl = length(s);
    s = sl > 1e-5 ? s / sl : vec3(1.0, 0.0, 0.0);
    // at least ~1.5 px wide; thinner ones get dimmer instead (no shimmering sub-pixel lines)
    float w = max(iW, uMinW * max(1.0, -p.z));
    p += dir * w * (position.x * 2.0 - 1.0) + s * w * position.y;
    vCol = vec4(iCol.rgb, iCol.a * iW / w); vC = position.xy;
    gl_Position = projectionMatrix * vec4(p, 1.0);
  }`;
const STREAK_FRAG = `
  varying vec4 vCol; varying vec2 vC;
  void main(){
    float across = 1.0 - abs(vC.y);
    float a = across * across * (0.2 + 0.8 * vC.x * vC.x);
    gl_FragColor = vec4(vCol.rgb * a * vCol.a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

class Streaks {
  constructor(scene, max) {
    this.max = max; this.cursor = 0; this.live = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.base = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.len = new Float32Array(max);
    this.w0 = new Float32Array(max);
    this.cool = new Uint8Array(max);
    this.head = new Float32Array(max * 3);
    this.tail = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.w = new Float32Array(max);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0]), 3));
    geo.setIndex([0, 2, 1, 1, 2, 3]);
    const attr = (a, n) => new THREE.InstancedBufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iHead', attr(this.head, 3));
    geo.setAttribute('iTail', attr(this.tail, 3));
    geo.setAttribute('iCol', attr(this.col, 4));
    geo.setAttribute('iW', attr(this.w, 1));
    geo.instanceCount = max;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMinW: { value: 0.001 } },
      vertexShader: STREAK_VERT, fragmentShader: STREAK_FRAG,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide, forceSinglePass: true,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }
  /** cool: embers that fade white → orange → red; otherwise keep their colour and just fade */
  add(x, y, z, vx, vy, vz, r, g, b, w, life, drag, len, cool) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const j = i * 3;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z;
    this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    this.base[j] = r; this.base[j + 1] = g; this.base[j + 2] = b;
    this.life[i] = this.maxLife[i] = life; this.drag[i] = drag; this.len[i] = len; this.w0[i] = w; this.cool[i] = cool ? 1 : 0;
    this.live = this.max;
  }
  update(dt) {
    if (!this.live) return;
    const { pos, vel, base, life, maxLife, drag, len, w0, cool, head, tail, col, w } = this;
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) { w[i] = 0; col[i * 4 + 3] = 0; continue; }
      alive++;
      const k = life[i] / maxLife[i], j = i * 3, c = i * 4;
      const d = Math.max(0, 1 - drag[i] * dt);
      vel[j] *= d; vel[j + 1] *= d; vel[j + 2] *= d;
      pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
      head[j] = pos[j]; head[j + 1] = pos[j + 1]; head[j + 2] = pos[j + 2];
      const L = len[i];
      tail[j] = pos[j] - vel[j] * L; tail[j + 1] = pos[j + 1] - vel[j + 1] * L; tail[j + 2] = pos[j + 2] - vel[j + 2] * L;
      if (cool[i]) { col[c] = base[j]; col[c + 1] = base[j + 1] * (0.2 + 0.8 * k * k); col[c + 2] = base[j + 2] * k * k * k; }
      else { col[c] = base[j]; col[c + 1] = base[j + 1]; col[c + 2] = base[j + 2]; }
      col[c + 3] = Math.min(1, k * 2.5);
      w[i] = w0[i] * (0.5 + 0.5 * k);
    }
    const g = this.mesh.geometry.attributes;
    g.iHead.needsUpdate = g.iTail.needsUpdate = g.iCol.needsUpdate = g.iW.needsUpdate = true;
    this.live = alive;
    this.mesh.visible = alive > 0;
  }
}

/**
 * Turbulent fireball: a displaced sphere whose noise-driven temperature runs white-hot → yellow → orange
 * → deep red → dark smoke as it ages, eroding into wisps. Octave counts are fixed per quality at creation.
 */
function fireballMaterial(hi) {
  const OCT = hi ? 4 : 2;
  return new THREE.ShaderMaterial({
    uniforms: { uAge: { value: 0 }, uSeed: { value: new THREE.Vector3() }, uFade: { value: 1 }, uHot: { value: 1.05 } },
    vertexShader: `uniform float uAge; uniform vec3 uSeed;
      varying vec3 vP; varying vec3 vN; varying vec3 vV; varying float vIn;
      ${NOISE}
      void main(){
        vec3 q = position * 1.6 + uSeed + vec3(0.0, uAge * 1.3, 0.0);
        float n = ${hi ? 'vnoise(q) * 0.67 + vnoise(q * 2.3 - uSeed) * 0.33' : 'vnoise(q)'};
        vec3 p = position * (1.0 + (n - 0.5) * (0.45 + uAge * 0.35));
        vP = position;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * normal); vV = -mv.xyz;
        // 0 while the camera is clear of the ball, 1 once it is inside: back faces are drawn only then
        float cd = length(cameraPosition - modelMatrix[3].xyz) / length(modelMatrix[0].xyz);
        vIn = clamp((1.35 - cd) / 0.35, 0.0, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform float uAge; uniform vec3 uSeed; uniform float uFade; uniform float uHot;
      varying vec3 vP; varying vec3 vN; varying vec3 vV; varying float vIn;
      ${NOISE}
      float fbm(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < ${OCT}; i++){ s += a * vnoise(p); p = p * 2.07 + vec3(3.1, 1.7, 5.3); a *= 0.5; } return s / ${(1 - Math.pow(0.5, OCT)).toFixed(4)}; }
      vec3 ramp(float t){
        vec3 c = mix(vec3(0.03, 0.025, 0.022), vec3(0.36, 0.05, 0.012), smoothstep(0.05, 0.28, t));
        c = mix(c, vec3(1.0, 0.24, 0.035), smoothstep(0.28, 0.5, t));
        c = mix(c, vec3(1.6, 0.72, 0.15), smoothstep(0.5, 0.75, t));
        return mix(c, vec3(2.4, 1.95, 1.4), smoothstep(0.78, 1.05, t));
      }
      void main(){
        if (!gl_FrontFacing && vIn <= 0.0) discard; // seen from outside: skip the far side before any noise
        float face = clamp(dot(normalize(gl_FrontFacing ? vN : -vN), normalize(vV)), 0.0, 1.0);
        float n = fbm(vP * 2.1 + uSeed + vec3(0.0, -uAge * 1.8, uAge * 0.9));
        // hot where the shell is thick (facing us) and early on; cooler in the turbulent edges
        float t = uHot - pow(uAge, 0.7) * 1.25 + (n - 0.5) * 1.3 + face * 0.35;
        float a = smoothstep(uAge * 1.05 - 0.15, uAge * 1.05 + 0.2, n * 0.9 + face * 0.45) * smoothstep(0.0, 0.6, face + (n - 0.5) * 0.5) * uFade; // ragged silhouette
        if (!gl_FrontFacing) a *= 0.5 * vIn; // engulfed: a dimmer inner shell instead of nothing
        gl_FragColor = vec4(ramp(t), a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    // one pass for both sides (the default two-pass DoubleSide would double the draws)
    depthWrite: false, transparent: true, side: THREE.DoubleSide, forceSinglePass: true,
  });
}

/** Expanding ring with a crisp leading edge and soft inner falloff; billboard (shockwave) or oriented (plane). */
function ringMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uR: { value: 1 }, uK: { value: 1 }, uW: { value: 0.15 }, uBill: { value: 0 }, uColor: { value: new THREE.Color() }, uSeed: { value: 0 } },
    vertexShader: `uniform float uR; uniform float uBill; varying vec2 vUv;
      void main(){
        vUv = position.xy;
        vec4 o = modelViewMatrix * vec4(position.xy * uR, 0.0, 1.0);
        vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0) + vec4(position.xy * uR, 0.0, 0.0);
        gl_Position = projectionMatrix * mix(o, c, uBill);
      }`,
    fragmentShader: `uniform float uK; uniform float uW; uniform vec3 uColor; uniform float uSeed; varying vec2 vUv;
      void main(){
        float ang = atan(vUv.y, vUv.x + 1e-5); // never atan(0,0)
        float d = length(vUv) + (0.012 * sin(ang * 7.0 + uSeed) + 0.006 * sin(ang * 17.0 - uSeed * 2.3)) * (1.0 - uK);
        float x = clamp((1.0 - d) / uW, 0.0, 1.0);
        float band = (1.0 - smoothstep(0.985, 1.0, d)) * (1.0 - x) * (1.0 - x);
        vec3 col = uColor * band * 0.7 + vec3(0.6) * pow(band, 6.0) * uK; // kept modest: a bloomed ring fills in
        gl_FragColor = vec4(col * uK, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide, forceSinglePass: true,
  });
}

/**
 * Shield impact: faint fresnel bubble plus a hexagonal lattice in the tangent plane of the impact,
 * lit by a ripple that runs outward from the hit point and wraps around the bubble.
 */
function shieldMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0.5, 1.6, 3.2) }, uHit: { value: new THREE.Vector3(0, 0, 1) },
      uT: { value: new THREE.Vector3(1, 0, 0) }, uB: { value: new THREE.Vector3(0, 1, 0) }, uK: { value: 1 }, uAge: { value: 0 }, uScale: { value: 7 },
    },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vL;
      void main(){ vL = normalize(position); vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform vec3 uHit; uniform vec3 uT; uniform vec3 uB; uniform float uK; uniform float uAge; uniform float uScale;
      varying vec3 vN; varying vec3 vV; varying vec3 vL;
      const vec2 HS = vec2(1.0, 1.7320508);
      vec4 hexCoords(vec2 uv){
        vec4 hC = floor(vec4(uv, uv - vec2(0.5, 1.0)) / HS.xyxy) + 0.5;
        vec4 h = vec4(uv - hC.xy * HS, uv - (hC.zw + 0.5) * HS);
        return dot(h.xy, h.xy) < dot(h.zw, h.zw) ? vec4(h.xy, hC.xy) : vec4(h.zw, hC.zw + 9.7);
      }
      void main(){
        vec3 l = normalize(vL);
        float c = dot(l, uHit);
        float ang = acos(clamp(c, -1.0, 1.0));
        // azimuthal equidistant projection around the hit point → hex grid that radiates from the impact
        vec3 q = l - uHit * c; float ql = length(q);
        vec2 uv = (ql > 1e-4 ? vec2(dot(q, uT), dot(q, uB)) / ql : vec2(0.0)) * ang * uScale;
        vec4 hx = hexCoords(uv);
        vec2 hp = abs(hx.xy);
        float e = max(dot(hp, HS * 0.5), hp.x);
        float edge = smoothstep(0.40, 0.49, e);
        float cell = fract(sin(dot(hx.zw, vec2(12.9898, 78.233))) * 43758.5453);
        float front = uAge * 4.2;
        float rip = exp(-(ang - front) * (ang - front) * 22.0);
        float wake = step(ang, front) * exp(-(front - ang) * 3.0);
        float spot = exp(-ang * ang * 70.0);
        float rim = pow(1.0 - abs(dot(normalize(vN), vV)), 2.5);
        float I = rim * 0.3 + edge * (rip * 1.5 + wake * 0.3 + spot * 1.2) + rip * cell * 0.3 + wake * cell * 0.06 + spot * 1.1;
        I *= gl_FrontFacing ? 0.85 : 0.45;
        gl_FragColor = vec4(uColor * I * uK, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide, forceSinglePass: true,
  });
}

const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmp3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0), RIGHT = new THREE.Vector3(1, 0, 0), AXIS_Z = new THREE.Vector3(0, 0, 1);
const EMBER = { r: 2.4, g: 0.9, b: 0.3 };
const C_FLASH = new THREE.Color(3.2, 2.4, 1.6), C_LENS = new THREE.Color(1.5, 1.05, 0.75), C_SHOCK = new THREE.Color(1.0, 0.68, 0.45);
const C_PRAXIS = new THREE.Color(1.0, 1.6, 3.0), C_LIGHT = new THREE.Color(1, 0.86, 0.66), C_COOL = new THREE.Color(1, 0.38, 0.1);
// shield tint per team: allies blue, Aszendenz rose-magenta, neutrals green
const SHIELD_COL = [new THREE.Color(0.45, 1.5, 3.2), new THREE.Color(3.0, 0.55, 1.6), new THREE.Color(0.6, 2.6, 1.4)];
const SHIELD_LIFE = 0.6;

/** Particle, flash, debris, light and shockwave effects. */
/** gl_PointSize is in framebuffer pixels: scale with the viewport so particles look the same at any resolution / pixel ratio (600 at 1080 px) */
export function setParticleScale(fx, viewportPx) {
  const k = Math.max(200, viewportPx * 0.555);
  for (const p of [fx?.fire, fx?.smokeP]) if (p) p.points.material.uniforms.uScale.value = k;
  if (fx?.streaks) fx.streaks.mat.uniforms.uMinW.value = 0.9 / Math.max(200, viewportPx);
}

export class Fx {
  constructor(scene, quality = 'high') {
    this.scene = scene;
    const hi = this.hi = quality === 'high';
    this.fire = new Particles(scene, hi ? 4200 : 2200, true);
    this.smokeP = new Particles(scene, hi ? 1400 : 500, false);
    this.streaks = new Streaks(scene, hi ? 420 : 160);

    this.flashes = [];
    for (let i = 0; i < 28; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.visible = false;
      scene.add(s);
      this.flashes.push({ s, life: 0, max: 1, size: 1 });
    }
    this.lenses = [];
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: streakTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.visible = false;
      scene.add(s);
      this.lenses.push({ s, life: 0, max: 1, size: 1 });
    }
    this.rings = [];
    const ringGeo = new THREE.PlaneGeometry(2, 2);
    for (let i = 0; i < (hi ? 12 : 8); i++) {
      const m = new THREE.Mesh(ringGeo, ringMaterial());
      m.visible = false; m.frustumCulled = false; m.renderOrder = 2;
      scene.add(m);
      this.rings.push({ m, life: 0, max: 1, size: 1 });
    }
    this.fireballs = [];
    const fbGeo = new THREE.IcosahedronGeometry(1, hi ? 3 : 2);
    fbGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.5); // room for the displacement
    for (let i = 0; i < (hi ? 32 : 12); i++) {
      const m = new THREE.Mesh(fbGeo, fireballMaterial(hi));
      m.visible = false; m.renderOrder = 1.5;
      scene.add(m);
      this.fireballs.push({ m, on: false, t: 0, life: 1, r: 1, spin: 0 });
    }
    // real light from explosions (a fixed number, so shaders never recompile)
    this.lights = [];
    for (let i = 0; i < (hi ? 4 : 2); i++) {
      const l = new THREE.PointLight(0xffa860, 0, 900, 1.6);
      scene.add(l);
      this.lights.push({ l, life: 0, max: 1, peak: 0, cool: false, c0: new THREE.Color() });
    }
    // tumbling hull fragments
    this.debris = [];
    const dGeos = [new THREE.TetrahedronGeometry(1, 0), new THREE.BoxGeometry(1.6, 0.4, 1), new THREE.OctahedronGeometry(0.9, 0)];
    const dMat = new THREE.MeshStandardMaterial({ color: 0x3a3a40, metalness: 0.8, roughness: 0.45, emissive: new THREE.Color(1, 0.33, 0.06), emissiveIntensity: 1 });
    for (let i = 0; i < (hi ? 70 : 30); i++) {
      const m = new THREE.Mesh(dGeos[i % 3], dMat.clone());
      m.visible = false;
      scene.add(m);
      this.debris.push({ m, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, max: 1 });
    }
    this.dCursor = 0;
    this.shields = [];
    const sGeo = new THREE.IcosahedronGeometry(1, hi ? 4 : 3);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(sGeo, shieldMaterial());
      m.visible = false;
      scene.add(m);
      this.shields.push({ m, life: 0, ship: null, k0: 0 });
    }
    // delayed secondary blasts of a dying capital ship
    this.pending = [];
    for (let i = 0; i < 16; i++) this.pending.push({ p: new THREE.Vector3(), size: 1, t: 0, on: false });
    // no warm-up needed: renderer.compile() gathers materials of hidden objects too (the pooled lights stay visible)
  }

  // ---- primitives ----
  particle(x, y, z, vx, vy, vz, r, g, b, size, life, drag = 1.2) { this.fire.add(x, y, z, vx, vy, vz, r, g, b, size, life, drag); }
  smoke(p, size, life, vel = null, shade = 0.18, alpha = 0.55, heat = 0) {
    const v = vel || tmp2.set(0, 0, 0);
    this.smokeP.add(p.x, p.y, p.z, v.x + (Math.random() - 0.5) * 8, v.y + (Math.random() - 0.5) * 8, v.z + (Math.random() - 0.5) * 8,
      shade, shade * 0.95, shade * 0.92, size, life, 0.6, size * 2.2, alpha, heat);
  }
  /** engine exhaust / missile trail point */
  trail(p, color, size = 2, life = 0.3) { this.fire.add(p.x, p.y, p.z, 0, 0, 0, color.r, color.g, color.b, size, life, 0); }

  flash(p, size, color, life = 0.35) {
    let f = this.flashes[0];
    for (const x of this.flashes) if (x.life <= 0) { f = x; break; }
    f.s.position.copy(p);
    f.s.material.color.copy(color);
    f.life = f.max = life; f.size = size;
    f.s.visible = true;
  }
  /** horizontal anamorphic flare across a big flash */
  lens(p, size, color, life = 0.45) {
    let f = this.lenses[0];
    for (const x of this.lenses) if (x.life <= 0) { f = x; break; }
    f.s.position.copy(p);
    f.s.material.color.copy(color);
    f.life = f.max = life; f.size = size;
    f.s.visible = true;
  }
  /** expanding ring; bill = camera-facing shockwave, otherwise a randomly oriented plane (or the plane normal to `axis`) */
  ring(p, size, color, life = 0.7, bill = false, width = 0.18, axis = null) {
    let r = this.rings[0];
    for (const x of this.rings) if (x.life <= 0) { r = x; break; }
    r.m.position.copy(p);
    if (axis) r.m.quaternion.setFromUnitVectors(AXIS_Z, axis); else r.m.quaternion.random();
    const u = r.m.material.uniforms;
    u.uColor.value.copy(color); u.uBill.value = bill ? 1 : 0; u.uW.value = width; u.uSeed.value = Math.random() * 6.28; u.uK.value = 1; u.uR.value = 1;
    r.life = r.max = life; r.size = size;
    r.m.visible = true;
  }
  /** color: hex or THREE.Color; cool = fade towards deep orange (explosions) */
  light(p, peak, life = 0.5, color = 0xffa860, cool = false) {
    let L = this.lights[0];
    for (const x of this.lights) if (x.life < L.life) L = x;
    L.l.position.copy(p); L.l.color.set(color); L.c0.copy(L.l.color); L.cool = cool;
    L.life = L.max = life; L.peak = peak;
    L.l.intensity = peak;
  }
  /** one turbulent fireball of radius r, starting after `delay` seconds; hot = starting temperature */
  fireball(p, r, life, delay = 0, hot = 1.05) {
    let f = this.fireballs[0], best = -Infinity;
    for (const x of this.fireballs) {
      if (!x.on) { f = x; break; }
      // otherwise recycle the most burnt-out one, sparing balls much bigger than the new one (a vanishing big one pops)
      const a = x.t / x.life - (x.r > r * 1.5 ? 0.6 : 0);
      if (a > best) { best = a; f = x; }
    }
    f.on = true; f.t = -delay; f.life = life; f.r = r; f.spin = (Math.random() - 0.5) * 0.8;
    f.m.position.copy(p);
    f.m.rotation.set(Math.random() * 6.28, Math.random() * 6.28, 0);
    f.m.scale.setScalar(r * 0.2);
    f.m.visible = delay <= 0;
    const u = f.m.material.uniforms;
    u.uSeed.value.set(Math.random() * 50, Math.random() * 50, Math.random() * 50);
    u.uAge.value = 0; u.uFade.value = 1; u.uHot.value = hot;
  }
  /** glowing embers / sparks with motion-blur trails */
  embers(p, n, speed, color, w = 0.5, life = 1.2, drag = 0.7, len = 0.05, cool = true) {
    for (let i = 0; i < n; i++) {
      tmp.randomDirection();
      const sp = speed * (0.25 + Math.random() * 0.75);
      this.streaks.add(p.x, p.y, p.z, tmp.x * sp, tmp.y * sp, tmp.z * sp, color.r, color.g, color.b,
        w * (0.6 + Math.random() * 0.6), life * (0.5 + Math.random() * 0.8), drag, len, cool);
    }
  }
  fragments(p, n, speed, size) {
    for (let i = 0; i < n; i++) {
      const d = this.debris[this.dCursor]; this.dCursor = (this.dCursor + 1) % this.debris.length;
      d.m.position.copy(p);
      d.m.scale.setScalar(size * (0.4 + Math.random()));
      d.vel.randomDirection().multiplyScalar(speed * (0.3 + Math.random()));
      d.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(8);
      d.life = d.max = 1.6 + Math.random() * 1.6;
      d.m.material.emissiveIntensity = 3;
      d.m.visible = true;
    }
  }
  /** hexagonal energy ripple on a ship's bubble, centred where the shot landed, in the ship's team colour */
  shield(ship, point) {
    // at most 2 slots per ship: re-aim its newest ripple if that one is still fresh, else a second one, else its older one
    let own = null, own2 = null;
    for (const x of this.shields) {
      if (x.life <= 0 || x.ship !== ship) continue;
      if (!own || x.life > own.life) { own2 = own; own = x; } else own2 = x;
    }
    let sh = null;
    if (own && (own2 || SHIELD_LIFE - own.life < 0.2)) sh = own2 && SHIELD_LIFE - own.life >= 0.2 ? own2 : own;
    if (!sh) {
      sh = this.shields[0];
      for (const x of this.shields) if (x.life <= 0) { sh = x; break; } else if (x.life < sh.life) sh = x;
    }
    // a re-aimed ripple starts from its current brightness instead of blinking out for the fade-in
    sh.k0 = sh.life > 0 && sh.ship === ship ? Math.min(1, sh.m.material.uniforms.uK.value) : 0;
    sh.ship = ship; sh.life = SHIELD_LIFE;
    sh.m.scale.setScalar(ship.radius * (ship.def.capital ? 1.0 : 1.35));
    sh.m.position.copy(ship.pos);
    const u = sh.m.material.uniforms;
    const h = u.uHit.value.copy(point).sub(ship.pos);
    if (h.lengthSq() < 1e-6) h.set(0, 0, 1);
    h.normalize();
    u.uT.value.crossVectors(Math.abs(h.y) < 0.9 ? UP : RIGHT, h).normalize();
    u.uB.value.crossVectors(h, u.uT.value);
    u.uColor.value.copy(SHIELD_COL[ship.team === 0 ? 0 : ship.team === 1 ? 1 : 2]);
    u.uScale.value = ship.def.capital ? 11 : 6;
    u.uAge.value = 0; u.uK.value = 1;
    sh.m.visible = true;
  }

  // ---- composites ----
  explode(p, size = 1, hot = null) {
    const hi = this.hi, big = size >= 3;
    const R = 6 + 9 * size, life = Math.min(3.4, 1.3 + 0.24 * size);
    // 1. white flash, lens streak and a short, strong light that cools to orange
    // sizes capped: a capital kill must not white out the screen (its fireball and rings carry the scale)
    const fs = Math.min(size, 4);
    this.flash(p, 45 * fs, hot || C_FLASH, 0.22);
    this.lens(p, 110 * fs, C_LENS, 0.3 + fs * 0.04);
    this.light(p, Math.min(60000, 3200 * size * size), 0.5 + size * 0.1, C_LIGHT, true);
    // 2. the fireball, plus lobes so it is not a perfect sphere
    this.fireball(p, R, life, 0, size >= 6 ? 0.85 : 1.05); // the huge one starts orange-hot, not white
    // (the 0.13 s pops of a dying capital ship stay single-lobed so the pool is not churned)
    const lobes = size >= 6 ? (hi ? 4 : 1) : size >= 1.5 ? 0 : (hi ? 2 : 0);
    for (let i = 0; i < lobes; i++) {
      tmp.randomDirection().multiplyScalar(R * (0.45 + Math.random() * 0.3)).add(p);
      this.fireball(tmp, R * (0.4 + Math.random() * 0.25), life * (0.65 + Math.random() * 0.25), Math.random() * (big ? 0.25 : 0.08));
    }
    // 3. flame tongues licking out of the fireball
    const n = Math.min(hi ? 50 : 16, Math.floor((hi ? 10 : 5) + size * (hi ? 6 : 3)));
    for (let i = 0; i < n; i++) {
      tmp.randomDirection();
      const sp = (30 + Math.random() * 60) * (0.6 + size * 0.35), o = R * 0.3;
      this.fire.add(p.x + tmp.x * o, p.y + tmp.y * o, p.z + tmp.z * o, tmp.x * sp, tmp.y * sp, tmp.z * sp,
        1.9, 0.75 + Math.random() * 0.5, 0.2 + Math.random() * 0.2, (3 + Math.random() * 5) * (0.7 + size * 0.3), 0.3 + Math.random() * 0.5, 2.4, 3 * size);
    }
    // 4. glowing embers with short trails
    const ne = Math.min(hi ? 80 : 22, Math.floor((hi ? 18 : 8) + size * (hi ? 8 : 3)));
    this.embers(p, ne, (140 + 120 * Math.random()) * (0.6 + size * 0.3), C_FLASH, 0.35 + size * 0.08, 1.4 + size * 0.1, 0.5, 0.06, true);
    // 5. smoke, lit orange from inside at first, lingering after the fire is gone
    const sm = Math.min(hi ? 26 : 8, Math.floor((hi ? 6 : 4) + size * (hi ? 6 : 2)));
    for (let i = 0; i < sm; i++) {
      tmp.randomDirection().multiplyScalar(R * 0.35).add(p);
      tmp2.randomDirection().multiplyScalar(8 + Math.random() * 18 * size);
      this.smoke(tmp, (5 + Math.random() * 6) * size, 2.2 + Math.random() * 2.4, tmp2, 0.07 + Math.random() * 0.06, 0.65, 0.5 + Math.random() * 0.5);
    }
    // 6. hull debris and a crisp shockwave; a capital kill also throws a flat plasma ring
    this.fragments(p, Math.min(hi ? 14 : 5, Math.floor(3 + size * 3)), 60 + size * 30, 0.8 + size * 0.5);
    // (a dying capital ship pops every 0.13 s: only some of those blasts get a shockwave)
    if (size < 1.5 || size >= 6 || Math.random() < 0.35) this.ring(p, 34 * size, C_SHOCK, 0.45 + size * 0.05, true, 0.09);
    if (size >= 6) {
      tmp.set((Math.random() - 0.5) * 1.6, 1, (Math.random() - 0.5) * 1.6).normalize(); // tilted, rarely edge-on
      this.ring(p, 120 * size, C_PRAXIS, 1.6, false, 0.3, tmp);
    }
    // 7. secondary blasts ripple through the wreck
    if (size >= 6) {
      const ns = hi ? 7 : 3;
      for (let i = 0; i < ns; i++) {
        let q = null;
        for (const x of this.pending) if (!x.on) { q = x; break; }
        if (!q) break;
        q.on = true; q.t = 0.12 + Math.random() * 1.1; q.size = size * (0.22 + Math.random() * 0.15);
        q.p.copy(tmp3.randomDirection().multiplyScalar(R * (0.4 + Math.random() * 0.9))).add(p);
      }
    }
  }
  sparks(p, color, n = 8, speed = 60) {
    for (let i = 0; i < n; i++) {
      tmp.randomDirection();
      const sp = speed * (0.3 + Math.random());
      this.streaks.add(p.x, p.y, p.z, tmp.x * sp, tmp.y * sp, tmp.z * sp, color.r, color.g, color.b, 0.22, 0.25 + Math.random() * 0.3, 1, 0.045, false);
    }
  }
  /** hull breach: sparks plus a puff of dark smoke */
  hullHit(p, color) {
    this.sparks(p, color, 10, 80);
    this.smoke(p, 3, 1.2, null, 0.12, 0.5, 0.6);
  }

  update(dt) {
    this.fire.update(dt);
    this.smokeP.update(dt);
    this.streaks.update(dt);
    for (const q of this.pending) {
      if (!q.on) continue;
      q.t -= dt;
      if (q.t <= 0) { q.on = false; this.explode(q.p, q.size); }
    }
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) { f.s.visible = false; continue; }
      const k = f.life / f.max;
      f.s.scale.setScalar(f.size * (1.6 - k * 0.8));
      f.s.material.opacity = k;
    }
    for (const f of this.lenses) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) { f.s.visible = false; continue; }
      const k = f.life / f.max;
      f.s.scale.set(f.size * (1.3 - k * 0.3), f.size * 0.07 * k, 1);
      f.s.material.opacity = k * k;
    }
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) { r.m.visible = false; continue; }
      const k = r.life / r.max, q = 1 - k;
      const u = r.m.material.uniforms;
      u.uR.value = r.size * 2 * (1 - (1 - q) * (1 - q) * (1 - q)) + 1; // fast, then slowing
      u.uK.value = k * (0.6 + 0.4 * k);
    }
    for (const f of this.fireballs) {
      if (!f.on) continue;
      f.t += dt;
      if (f.t < 0) continue;
      const q = f.t / f.life;
      if (q >= 1) { f.on = false; f.m.visible = false; continue; }
      f.m.visible = true;
      const e = Math.min(1, q * 1.8);
      f.m.scale.setScalar(f.r * (0.2 + 0.8 * (1 - (1 - e) * (1 - e) * (1 - e)) + 0.25 * q));
      f.m.rotation.y += f.spin * dt;
      const u = f.m.material.uniforms;
      u.uAge.value = q;
      u.uFade.value = Math.min(1, (1 - q) * 5);
    }
    for (const L of this.lights) {
      if (L.life <= 0) continue;
      L.life -= dt;
      const k = Math.max(0, L.life / L.max);
      L.l.intensity = L.peak * k * k;
      if (L.cool) L.l.color.copy(L.c0).lerp(C_COOL, 1 - k);
    }
    for (const d of this.debris) {
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) { d.m.visible = false; continue; }
      d.m.position.addScaledVector(d.vel, dt);
      d.vel.multiplyScalar(Math.max(0, 1 - 0.25 * dt));
      d.m.rotation.x += d.spin.x * dt; d.m.rotation.y += d.spin.y * dt; d.m.rotation.z += d.spin.z * dt;
      const heat = Math.max(0, (d.life / d.max) * 1.4 - 0.4);
      d.m.material.emissiveIntensity = heat * 3;
      if (heat > 0.25 && Math.random() < dt * 30) this.trail(d.m.position, EMBER, 1.6, 0.35);
    }
    for (const sh of this.shields) {
      if (sh.life <= 0) continue;
      sh.life -= dt;
      if (sh.life <= 0 || !sh.ship?.alive) { sh.m.visible = false; sh.life = 0; continue; }
      sh.m.position.copy(sh.ship.pos);
      const age = SHIELD_LIFE - sh.life, k = sh.life / SHIELD_LIFE;
      const u = sh.m.material.uniforms;
      u.uAge.value = age;
      const fin = Math.min(1, age * 25);
      u.uK.value = (sh.k0 + (1 - sh.k0) * fin) * k * (0.4 + 0.6 * k);
    }
  }
}
