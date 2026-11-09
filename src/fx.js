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

const MAX = 2600;

/** Particle, flash and shockwave effects. */
export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 4);
    this.size = new Float32Array(MAX);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.size0 = new Float32Array(MAX);
    this.base = new Float32Array(MAX * 3);
    this.drag = new Float32Array(MAX);
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4));
    geo.setAttribute('psize', new THREE.BufferAttribute(this.size, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: `
        attribute vec4 pcolor; attribute float psize; uniform float uScale;
        varying vec4 vCol;
        void main(){
          vCol = pcolor;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = psize * uScale / max(1.0,-mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec4 vCol;
        void main(){
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.0, d);
          gl_FragColor = vec4(vCol.rgb * a * a * vCol.a, 1.0);
        }`,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);

    this.flashes = [];
    for (let i = 0; i < 28; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
      }));
      s.visible = false;
      scene.add(s);
      this.flashes.push({ s, life: 0, max: 1, size: 1 });
    }
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.86, 1, 48);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide,
      }));
      m.visible = false;
      scene.add(m);
      this.rings.push({ m, life: 0, max: 1, size: 1 });
    }
  }

  particle(x, y, z, vx, vy, vz, r, g, b, size, life, drag = 1.2) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.base[i * 3] = r; this.base[i * 3 + 1] = g; this.base[i * 3 + 2] = b;
    this.life[i] = life; this.maxLife[i] = life; this.size0[i] = size; this.drag[i] = drag;
  }

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

  explode(p, size = 1, hot = null) {
    const n = Math.min(160, Math.floor(40 + size * 26));
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * 6.283, s = Math.sqrt(1 - u * u);
      const sp = (20 + Math.random() * 90) * (0.6 + size * 0.35);
      const w = Math.random();
      this.particle(p.x, p.y, p.z, s * Math.cos(th) * sp, u * sp, s * Math.sin(th) * sp,
        2.6, 0.9 + w * 1.2, 0.25 + w * 0.5, (2.5 + Math.random() * 6) * (0.7 + size * 0.3), 0.5 + Math.random() * 1.1, 1.6);
    }
    // debris sparks
    for (let i = 0; i < n / 3; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * 6.283, s = Math.sqrt(1 - u * u);
      const sp = (90 + Math.random() * 160) * (0.6 + size * 0.3);
      this.particle(p.x, p.y, p.z, s * Math.cos(th) * sp, u * sp, s * Math.sin(th) * sp,
        3, 2.4, 1.6, 1.4, 0.8 + Math.random() * 1.2, 0.5);
    }
    this.flash(p, 60 * size, hot || new THREE.Color(3, 2.2, 1.4), 0.45);
    this.ring(p, 55 * size, new THREE.Color(1.6, 1.0, 0.6), 0.8);
  }

  sparks(p, color, n = 8, speed = 60) {
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * 6.283, s = Math.sqrt(1 - u * u);
      const sp = speed * (0.3 + Math.random());
      this.particle(p.x, p.y, p.z, s * Math.cos(th) * sp, u * sp, s * Math.sin(th) * sp,
        color.r, color.g, color.b, 1.6, 0.25 + Math.random() * 0.3, 1);
    }
  }

  update(dt) {
    const { pos, vel, life, maxLife, size, size0, col, base, drag } = this;
    for (let i = 0; i < MAX; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) { size[i] = 0; continue; }
      const k = life[i] / maxLife[i];
      const d = Math.max(0, 1 - drag[i] * dt);
      const j = i * 3;
      vel[j] *= d; vel[j + 1] *= d; vel[j + 2] *= d;
      pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
      size[i] = size0[i] * (0.4 + 0.6 * k);
      const c = i * 4;
      col[c] = base[j]; col[c + 1] = base[j + 1] * (0.3 + 0.7 * k); col[c + 2] = base[j + 2] * k; col[c + 3] = k;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.pcolor.needsUpdate = true;
    g.attributes.psize.needsUpdate = true;

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
  }
}
