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

const VERT = `
  attribute vec4 pcolor; attribute float psize; uniform float uScale;
  varying vec4 vCol;
  void main(){
    vCol = pcolor;
    vec4 mv = modelViewMatrix * vec4(position,1.0);
    gl_PointSize = psize * uScale / max(1.0,-mv.z);
    gl_Position = projectionMatrix * mv;
  }`;

/**
 * A pool of point particles. additive = glowing fire/sparks, otherwise soft smoke (alpha blended).
 * Each particle: position, velocity, drag, size growth, colour ramp hot → cool.
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
    this.cursor = 0; this.live = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4));
    geo.setAttribute('psize', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: VERT,
      fragmentShader: additive
        ? `varying vec4 vCol; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d); gl_FragColor = vec4(vCol.rgb * a * a * vCol.a, 1.0); }`
        : `varying vec4 vCol; void main(){ vec2 p = gl_PointCoord - 0.5; float d = length(p) * 2.0;
             float n = fract(sin(dot(floor(gl_PointCoord * 6.0), vec2(12.9898, 78.233))) * 43758.5453);
             float a = smoothstep(1.0, 0.2, d) * (0.75 + 0.25 * n);
             gl_FragColor = vec4(vCol.rgb, a * vCol.a); }`,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: false,
      transparent: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 2 : 1;
    scene.add(this.points);
  }
  add(x, y, z, vx, vy, vz, r, g, b, size, life, drag = 1.2, grow = 0, alpha = 1) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const j = i * 3;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z;
    this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    this.base[j] = r; this.base[j + 1] = g; this.base[j + 2] = b;
    this.life[i] = life; this.maxLife[i] = life; this.size0[i] = size; this.drag[i] = drag; this.grow[i] = grow; this.alpha[i] = alpha;
    this.live = this.max; // force an upload next frame
  }
  update(dt) {
    if (!this.live) return;
    const { pos, vel, life, maxLife, size, size0, col, base, drag, grow, alpha, additive } = this;
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
        col[c] = base[j]; col[c + 1] = base[j + 1]; col[c + 2] = base[j + 2];
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

/** Fresnel energy bubble shown when a shield absorbs a hit. */
function shieldMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0.5, 1.6, 3.2) }, uHit: { value: new THREE.Vector3(0, 0, 1) }, uK: { value: 1 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vL;
      void main(){ vL = normalize(position); vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform vec3 uHit; uniform float uK; varying vec3 vN; varying vec3 vV; varying vec3 vL;
      void main(){
        float rim = pow(1.0 - abs(dot(vN, vV)), 2.5);
        float spot = pow(max(0.0, dot(vL, uHit)), 10.0) * 2.5;
        float hex = 0.6 + 0.4 * step(0.5, fract(vL.x * 9.0 + vL.y * 5.2) + fract(vL.y * 9.0 - vL.z * 5.2) * 0.4);
        gl_FragColor = vec4(uColor * (rim * 0.8 + spot) * hex * uK, 1.0);
      }`,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide,
  });
}

const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

/** Particle, flash, debris, light and shockwave effects. */
export class Fx {
  constructor(scene, quality = 'high') {
    this.scene = scene;
    this.hi = quality === 'high';
    this.fire = new Particles(scene, this.hi ? 4200 : 2200, true);
    this.smokeP = new Particles(scene, this.hi ? 1400 : 500, false);

    this.flashes = [];
    for (let i = 0; i < 28; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.visible = false;
      scene.add(s);
      this.flashes.push({ s, life: 0, max: 1, size: 1 });
    }
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.86, 1, 48);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide }));
      m.visible = false;
      scene.add(m);
      this.rings.push({ m, life: 0, max: 1, size: 1 });
    }
    // real light from explosions (a fixed number, so shaders never recompile)
    this.lights = [];
    for (let i = 0; i < (this.hi ? 4 : 2); i++) {
      const l = new THREE.PointLight(0xffa860, 0, 900, 1.6);
      scene.add(l);
      this.lights.push({ l, life: 0, max: 1, peak: 0 });
    }
    // tumbling hull fragments
    this.debris = [];
    const dGeos = [new THREE.TetrahedronGeometry(1, 0), new THREE.BoxGeometry(1.6, 0.4, 1), new THREE.OctahedronGeometry(0.9, 0)];
    const dMat = new THREE.MeshStandardMaterial({ color: 0x3a3a40, metalness: 0.8, roughness: 0.45, emissive: new THREE.Color(0.9, 0.3, 0.05), emissiveIntensity: 1 });
    for (let i = 0; i < (this.hi ? 70 : 30); i++) {
      const m = new THREE.Mesh(dGeos[i % 3], dMat.clone());
      m.visible = false;
      scene.add(m);
      this.debris.push({ m, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, max: 1 });
    }
    this.dCursor = 0;
    this.shields = [];
    const sGeo = new THREE.IcosahedronGeometry(1, 3);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(sGeo, shieldMaterial());
      m.visible = false;
      scene.add(m);
      this.shields.push({ m, life: 0, ship: null });
    }
  }

  // ---- primitives ----
  particle(x, y, z, vx, vy, vz, r, g, b, size, life, drag = 1.2) { this.fire.add(x, y, z, vx, vy, vz, r, g, b, size, life, drag); }
  smoke(p, size, life, vel = null, shade = 0.18, alpha = 0.55) {
    const v = vel || tmp2.set(0, 0, 0);
    this.smokeP.add(p.x, p.y, p.z, v.x + (Math.random() - 0.5) * 8, v.y + (Math.random() - 0.5) * 8, v.z + (Math.random() - 0.5) * 8,
      shade, shade * 0.95, shade * 0.92, size, life, 0.6, size * 2.2, alpha);
  }
  /** engine exhaust / missile trail point */
  trail(p, color, size = 2, life = 0.3) { this.fire.add(p.x, p.y, p.z, 0, 0, 0, color.r, color.g, color.b, size, life, 0); }

  flash(p, size, color, life = 0.35) {
    const f = this.flashes.find((f) => f.life <= 0) || this.flashes[0];
    f.s.position.copy(p);
    f.s.material.color.copy(color);
    f.life = f.max = life; f.size = size;
    f.s.visible = true;
  }
  ring(p, size, color, life = 0.7) {
    const r = this.rings.find((r) => r.life <= 0) || this.rings[0];
    r.m.position.copy(p);
    r.m.quaternion.random();
    r.m.material.color.copy(color);
    r.life = r.max = life; r.size = size;
    r.m.visible = true;
  }
  light(p, peak, life = 0.5, color = 0xffa860) {
    const L = this.lights.find((x) => x.life <= 0) || this.lights.reduce((a, b) => (a.life < b.life ? a : b));
    L.l.position.copy(p); L.l.color.set(color);
    L.life = L.max = life; L.peak = peak;
    L.l.intensity = peak;
  }
  fragments(p, n, speed, size) {
    for (let i = 0; i < n; i++) {
      const d = this.debris[this.dCursor]; this.dCursor = (this.dCursor + 1) % this.debris.length;
      d.m.position.copy(p);
      d.m.scale.setScalar(size * (0.4 + Math.random()));
      d.vel.randomDirection().multiplyScalar(speed * (0.3 + Math.random()));
      d.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(8);
      d.life = d.max = 1.6 + Math.random() * 1.6;
      d.m.material.emissiveIntensity = 1;
      d.m.visible = true;
    }
  }
  /** energy bubble around a ship, brightest where the shot landed */
  shield(ship, point) {
    const sh = this.shields.find((x) => x.life <= 0) || this.shields[0];
    sh.ship = ship; sh.life = 0.35;
    sh.m.scale.setScalar(ship.radius * (ship.def.capital ? 1.0 : 1.35));
    sh.m.position.copy(ship.pos);
    sh.m.material.uniforms.uHit.value.copy(point).sub(ship.pos).normalize();
    sh.m.visible = true;
  }

  // ---- composites ----
  explode(p, size = 1, hot = null) {
    const hi = this.hi;
    // 1. white flash + real light
    this.flash(p, 70 * size, hot || new THREE.Color(3.2, 2.4, 1.6), 0.4);
    this.light(p, Math.min(60000, 2500 * size * size), 0.55 + size * 0.1);
    // 2. fireball: slow, billowing, growing particles
    const n = Math.min(hi ? 140 : 60, Math.floor(30 + size * 22));
    for (let i = 0; i < n; i++) {
      tmp.randomDirection();
      const sp = (12 + Math.random() * 55) * (0.6 + size * 0.35);
      this.fire.add(p.x, p.y, p.z, tmp.x * sp, tmp.y * sp, tmp.z * sp,
        2.8, 1.2 + Math.random() * 0.9, 0.35 + Math.random() * 0.4, (4 + Math.random() * 7) * (0.7 + size * 0.3), 0.45 + Math.random() * 0.9, 2.2, 6 * size);
    }
    // 3. fast sparks
    for (let i = 0; i < n / 3; i++) {
      tmp.randomDirection();
      const sp = (110 + Math.random() * 200) * (0.6 + size * 0.3);
      this.fire.add(p.x, p.y, p.z, tmp.x * sp, tmp.y * sp, tmp.z * sp, 3, 2.4, 1.6, 1.3, 0.6 + Math.random() * 1.1, 0.4);
    }
    // 4. smoke that lingers after the fire is gone
    const sm = Math.min(hi ? 26 : 10, Math.floor(6 + size * 6));
    for (let i = 0; i < sm; i++) {
      tmp.randomDirection().multiplyScalar(4 + size * 6).add(p);
      tmp2.randomDirection().multiplyScalar(8 + Math.random() * 18 * size);
      this.smoke(tmp, (5 + Math.random() * 6) * size, 1.8 + Math.random() * 2.2, tmp2, 0.1 + Math.random() * 0.1, 0.6);
    }
    // 5. debris and shockwave
    this.fragments(p, Math.min(hi ? 14 : 6, Math.floor(3 + size * 3)), 60 + size * 30, 0.8 + size * 0.5);
    this.ring(p, 55 * size, new THREE.Color(1.6, 1.0, 0.6), 0.8);
  }
  sparks(p, color, n = 8, speed = 60) {
    for (let i = 0; i < n; i++) {
      tmp.randomDirection();
      const sp = speed * (0.3 + Math.random());
      this.fire.add(p.x, p.y, p.z, tmp.x * sp, tmp.y * sp, tmp.z * sp, color.r, color.g, color.b, 1.6, 0.25 + Math.random() * 0.3, 1);
    }
  }
  /** hull breach: sparks plus a puff of dark smoke */
  hullHit(p, color) {
    this.sparks(p, color, 10, 80);
    this.smoke(p, 3, 1.2, null, 0.12, 0.5);
  }

  update(dt) {
    this.fire.update(dt);
    this.smokeP.update(dt);
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) { f.s.visible = false; continue; }
      const k = f.life / f.max;
      f.s.scale.setScalar(f.size * (1.6 - k * 0.8));
      f.s.material.opacity = k;
    }
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) { r.m.visible = false; continue; }
      const k = r.life / r.max;
      r.m.scale.setScalar(r.size * (1 - k) * 2 + 1);
      r.m.material.opacity = k * 0.8;
    }
    for (const L of this.lights) {
      if (L.life <= 0) continue;
      L.life -= dt;
      const k = Math.max(0, L.life / L.max);
      L.l.intensity = L.peak * k * k;
    }
    for (const d of this.debris) {
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) { d.m.visible = false; continue; }
      d.m.position.addScaledVector(d.vel, dt);
      d.vel.multiplyScalar(Math.max(0, 1 - 0.25 * dt));
      d.m.rotation.x += d.spin.x * dt; d.m.rotation.y += d.spin.y * dt; d.m.rotation.z += d.spin.z * dt;
      const heat = Math.max(0, (d.life / d.max) * 1.4 - 0.4);
      d.m.material.emissiveIntensity = heat;
      if (heat > 0.25 && Math.random() < dt * 30) this.trail(d.m.position, { r: 2.4, g: 0.9, b: 0.3 }, 1.6, 0.35);
    }
    for (const sh of this.shields) {
      if (sh.life <= 0) continue;
      sh.life -= dt;
      if (sh.life <= 0 || !sh.ship?.alive) { sh.m.visible = false; sh.life = 0; continue; }
      sh.m.position.copy(sh.ship.pos);
      sh.m.material.uniforms.uK.value = (sh.life / 0.35) * 0.55;
    }
  }
}
