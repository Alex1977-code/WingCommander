/**
 * First-person cockpit: canopy frame, instrument panel with three live MFDs, glare shield,
 * HUD combiner and side consoles. Rendered as a second pass over the world view with its own
 * camera (near plane 1 cm), lit by the real sun direction so the cockpit brightens and darkens
 * as the ship turns.
 */
import * as THREE from 'three';

const v = new THREE.Vector3(), q = new THREE.Quaternion();

function noiseTex(base, size = 256, specks = 400) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  for (let i = 0; i < specks; i++) { const a = Math.random() * 0.08; g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${a})`; g.fillRect(Math.random() * size, Math.random() * size, 2 + Math.random() * 6, 1 + Math.random() * 2); }
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2;
  for (let i = 0; i < 6; i++) { const y = Math.random() * size; g.beginPath(); g.moveTo(0, y); g.lineTo(size, y); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function buttonsTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#15191f'; g.fillRect(0, 0, 256, 128);
  const cols = ['#ff5a3a', '#ffc857', '#6dffb0', '#7fd6ff'];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) {
    g.fillStyle = '#0b0d11'; g.fillRect(10 + x * 30, 10 + y * 28, 22, 16);
    if (Math.random() < 0.6) { g.fillStyle = cols[(x + y * 3) % 4]; g.globalAlpha = 0.5 + Math.random() * 0.5; g.fillRect(14 + x * 30, 14 + y * 28, 14, 4); g.globalAlpha = 1; }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const MFD_W = 320, MFD_H = 240;

export class Cockpit {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1.6, 0.01, 10);
    this.rig = new THREE.Group();
    this.scene.add(this.rig);
    this.sun = new THREE.DirectionalLight(0xfff1dd, 2.6);
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(new THREE.HemisphereLight(0x7a96b8, 0x2a2018, 1.1));
    this.glow = new THREE.PointLight(0x7fd6ff, 0.6, 1.2, 1.5);
    this.scene.add(this.glow);
    this.metal = new THREE.MeshStandardMaterial({ color: 0x3b414b, metalness: 0.65, roughness: 0.5, map: noiseTex('#8a9099') });
    this.dark = new THREE.MeshStandardMaterial({ color: 0x2c323b, metalness: 0.45, roughness: 0.75, map: noiseTex('#6a7078') });
    this.trim = new THREE.MeshStandardMaterial({ color: 0xff6a12, metalness: 0.4, roughness: 0.5 });
    this.btn = new THREE.MeshStandardMaterial({ map: buttonsTex(), emissiveMap: null, emissive: 0x000000, roughness: 0.6 });
    this.btn.emissiveMap = this.btn.map; this.btn.emissive = new THREE.Color(0.9, 0.9, 0.9);
    this.mfds = ['SYS', 'RAD', 'TGT'].map((kind) => {
      const c = document.createElement('canvas'); c.width = MFD_W; c.height = MFD_H;
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      return { kind, c, g: c.getContext('2d'), tex, mat: new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }) };
    });
    this.glass = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1, 0.6), transparent: true, opacity: 0.035, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.glassEdge = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.6, 0.8), toneMapped: false });
    this.mfdT = 0; this.aspect = 0; this.shake = 0; this.radarAng = 0;
  }

  /** Build geometry for the current aspect so the frame sits at the edges of every screen shape. */
  build(aspect, fov) {
    if (Math.abs(aspect - this.aspect) < 0.01 && fov === this.fov) return;
    this.aspect = aspect; this.fov = fov;
    for (const c of [...this.rig.children]) { this.rig.remove(c); c.geometry?.dispose(); }
    const th = Math.tan((fov * Math.PI) / 360);
    // screen fraction (fx, fy in -1..1) at depth d → camera-space point
    const S = (fx, fy, d) => new THREE.Vector3(fx * th * aspect * d, fy * th * d, -d);
    const add = (geo, mat, pos, rotX = 0) => { const m = new THREE.Mesh(geo, mat); m.position.copy(pos); m.rotation.x = rotX; this.rig.add(m); return m; };
    const tube = (pts, r, mat) => this.rig.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, r, 10), mat));

    // instrument panel: a wide slab whose top edge sits at 42 % below the centre
    const d = 0.62, halfW = th * aspect * d * 1.15;
    const top = S(0, -0.42, d);
    const panelH = 0.42, tilt = -0.55;
    const panel = add(new THREE.BoxGeometry(halfW * 2, panelH, 0.06), this.dark, new THREE.Vector3(0, top.y - panelH / 2 * Math.cos(tilt), top.z + panelH / 2 * Math.sin(-tilt)), tilt);
    // glare shield over the panel
    const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, halfW * 1.5, 16, 1, false, 0, Math.PI), this.metal);
    shield.rotation.z = Math.PI / 2; shield.rotation.y = 0; shield.position.copy(top).add(new THREE.Vector3(0, -0.012, -0.02)); shield.scale.set(1, 1, 0.55);
    this.rig.add(shield);
    add(new THREE.BoxGeometry(halfW * 1.5, 0.006, 0.01), this.trim, top.clone().add(new THREE.Vector3(0, 0.002, 0.045)));
    // three MFDs set into the panel face
    // point on the panel's front surface, `down` metres below its top edge, pushed `out` along the face normal
    const n = new THREE.Vector3(0, -Math.sin(tilt), Math.cos(tilt));
    const face = (fx, out = 0.032, down = 0.13) => new THREE.Vector3(fx * halfW * 0.46, top.y - down * Math.cos(tilt), top.z + down * Math.sin(-tilt)).addScaledVector(n, out);
    const mw = Math.min(0.2, halfW * 0.38), mh = mw * 0.75;
    this.mfds.forEach((m, i) => {
      const fx = i === 0 ? -1 : i === 1 ? 1 : 0;
      add(new THREE.BoxGeometry(mw * 1.16, mh * 1.22, 0.012), this.metal, face(fx, 0.036), tilt);
      add(new THREE.PlaneGeometry(mw, mh), m.mat, face(fx, 0.044), tilt);
    });
    this.glow.position.copy(face(0, 0.15));
    // side consoles with switch banks
    for (const sx of [-1, 1]) {
      const c = add(new THREE.BoxGeometry(0.34, 0.08, 0.5), this.dark, new THREE.Vector3(sx * (halfW * 0.92), top.y - 0.12, -0.35), 0);
      c.rotation.z = sx * 0.35;
      const b = add(new THREE.PlaneGeometry(0.26, 0.13), this.btn, new THREE.Vector3(sx * (halfW * 0.9), top.y - 0.075, -0.35), -Math.PI / 2 + 0.2);
      b.rotation.order = 'YXZ'; b.rotation.y = 0; b.rotation.z = sx * 0.35;
    }
    // canopy frame: two A-pillars and the forward bow, curved like a bubble canopy
    for (const sx of [-1, 1]) {
      tube([S(0.98 * sx, -0.46, 0.66), S(0.9 * sx, 0.1, 0.55), S(0.68 * sx, 0.72, 0.46), S(0.5 * sx, 1.15, 0.36)], 0.014, this.metal);
      tube([S(1.05 * sx, -0.52, 0.5), S(1.2 * sx, 0.2, 0.42), S(1.25 * sx, 0.9, 0.3)], 0.011, this.metal);
    }
    tube([S(-0.6, 1.05, 0.42), S(-0.25, 1.12, 0.4), S(0, 1.14, 0.4), S(0.25, 1.12, 0.4), S(0.6, 1.05, 0.42)], 0.012, this.metal);
    // HUD combiner glass above the panel centre
    const hc = S(0, -0.3, 0.58);
    const hw = 0.075, hh = 0.05;
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.0018, hh * 2.1, 0.0018), this.metal, hc.clone().add(new THREE.Vector3(sx * hw, hh * 0.9, 0)), -0.35);
    add(new THREE.BoxGeometry(hw * 2, 0.0014, 0.0014), this.glassEdge, hc.clone().add(new THREE.Vector3(0, hh * 1.85, -0.017)), -0.35);
    this.panel = panel;
  }

  /** Called every frame for the pilot this cockpit belongs to. */
  update(P, game, dt, camera) {
    this.camera.fov = camera.fov; this.camera.aspect = camera.aspect; this.camera.updateProjectionMatrix();
    this.build(camera.aspect, Math.round(camera.fov / 4) * 4);
    // sun in cockpit space: light follows the real sun as the ship turns
    v.copy(game.env.sunDir).applyQuaternion(q.copy(camera.quaternion).invert());
    this.sun.position.copy(v); this.sun.target.position.set(0, 0, 0);
    // vibration under boost, jolt on hits
    this.shake = Math.max(this.shake * Math.exp(-dt * 6), P.shake * 0.4);
    const buzz = (P.boosting ? 0.0015 : 0.0003) + this.shake * 0.004;
    this.rig.position.set((Math.random() - 0.5) * buzz, (Math.random() - 0.5) * buzz, 0);
    // engine/alarm tint on the panel glow
    this.glow.color.set(P.ship.hp < P.ship.maxHp * 0.3 && Math.sin(performance.now() / 120) > 0 ? 0xff3040 : 0x7fd6ff);
    this.mfdT -= dt;
    this.radarAng += dt * 2.2;
    if (this.mfdT <= 0) { this.mfdT = 0.1; for (const m of this.mfds) { this.drawMFD(m, P, game); m.tex.needsUpdate = true; } }
  }

  drawMFD(m, P, game) {
    const g = m.g, W = MFD_W, H = MFD_H, p = P.ship;
    g.fillStyle = '#04110b'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(109,255,176,.18)'; g.lineWidth = 1;
    for (let y = 0; y < H; y += 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.font = "700 18px 'Rajdhani', system-ui, sans-serif"; g.textBaseline = 'top';
    const G = '#6dffb0', A = '#ffc857', R = '#ff4d6d';
    g.fillStyle = G; g.fillText(m.kind, 10, 8);
    if (m.kind === 'SYS') {
      // ship silhouette with shield bubble coloured by strength
      const sk = p.shield / p.maxShield, hk = p.hp / p.maxHp;
      g.strokeStyle = sk > 0.5 ? G : sk > 0.2 ? A : R; g.lineWidth = 3;
      g.beginPath(); g.ellipse(W * 0.3, H * 0.55, 62, 74, 0, 0, Math.PI * 2 * Math.max(0.02, sk)); g.stroke();
      g.fillStyle = hk > 0.5 ? G : hk > 0.25 ? A : R;
      g.beginPath(); g.moveTo(W * 0.3, H * 0.3); g.lineTo(W * 0.3 + 34, H * 0.72); g.lineTo(W * 0.3, H * 0.64); g.lineTo(W * 0.3 - 34, H * 0.72); g.closePath(); g.fill();
      const bar = (y, label, k, col) => {
        g.fillStyle = G; g.fillText(label, W * 0.58, y);
        g.strokeStyle = G; g.strokeRect(W * 0.58, y + 22, W * 0.36, 12);
        g.fillStyle = col; g.fillRect(W * 0.58 + 2, y + 24, (W * 0.36 - 4) * Math.max(0, Math.min(1, k)), 8);
      };
      bar(36, `SCHILD ${Math.round(sk * 100)}%`, sk, G);
      bar(84, `HÜLLE ${Math.round(hk * 100)}%`, hk, hk > 0.3 ? G : R);
      bar(132, 'NACHBRENNER', P.energy, A);
      g.fillStyle = A; g.fillText(`RAK ${p.missiles}   ${Math.round(p.speed)} M/S`, W * 0.58, 184);
    } else if (m.kind === 'RAD') {
      const cx = W / 2, cy = H / 2 + 8, R0 = H * 0.42, range = 3000;
      g.strokeStyle = 'rgba(109,255,176,.5)';
      for (const k of [1, 0.5]) { g.beginPath(); g.arc(cx, cy, R0 * k, 0, 6.283); g.stroke(); }
      g.beginPath(); g.moveTo(cx - R0, cy); g.lineTo(cx + R0, cy); g.moveTo(cx, cy - R0); g.lineTo(cx, cy + R0); g.stroke();
      const sweep = g.createConicGradient?.(this.radarAng, cx, cy);
      if (sweep) { sweep.addColorStop(0, 'rgba(109,255,176,.35)'); sweep.addColorStop(0.08, 'rgba(109,255,176,0)'); sweep.addColorStop(1, 'rgba(109,255,176,0)'); g.fillStyle = sweep; g.beginPath(); g.arc(cx, cy, R0, 0, 6.283); g.fill(); }
      const inv = q.copy(p.quat).invert();
      const blip = (pos, col, sz) => {
        v.copy(pos).sub(p.pos).applyQuaternion(inv);
        const d = Math.hypot(v.x, v.z); if (d > range) return;
        g.fillStyle = col; g.fillRect(cx - (v.x / range) * R0 - sz / 2, cy - (v.z / range) * R0 - sz / 2, sz, sz);
      };
      for (const o of game.ships) if (o.alive && o !== p) blip(o.pos, o === P.target ? '#ffffff' : o.team === 1 ? R : o.team === 3 ? '#9fe8ff' : G, o.def.capital ? 8 : 5);
      for (const mn of game.mines || []) if (mn.alive) blip(mn.pos, '#ff7a3a', 3);
      g.fillStyle = G; g.fillText('3 KM', W - 52, 8);
    } else {
      const tg = P.target;
      if (!tg || !tg.alive) {
        g.fillStyle = G; g.fillText('KEIN ZIEL', W / 2 - 40, H / 2 - 10);
      } else {
        const d = Math.round(tg.pos.distanceTo(p.pos));
        g.fillStyle = R; g.font = "700 22px 'Rajdhani', system-ui, sans-serif"; g.fillText(tg.name.toUpperCase(), 10, 34);
        g.font = "700 18px 'Rajdhani', system-ui, sans-serif"; g.fillStyle = G; g.fillText(`${d} M`, 10, 62);
        // spinning wireframe target box
        const a = performance.now() / 700, cx = W * 0.72, cy = H * 0.5, r = 42;
        g.strokeStyle = R; g.lineWidth = 2; g.beginPath();
        for (let i = 0; i < 4; i++) { const t0 = a + i * Math.PI / 2; g.moveTo(cx + Math.cos(t0) * r, cy + Math.sin(t0) * r * 0.4 - 18); g.lineTo(cx + Math.cos(t0 + Math.PI / 2) * r, cy + Math.sin(t0 + Math.PI / 2) * r * 0.4 - 18); g.moveTo(cx + Math.cos(t0) * r, cy + Math.sin(t0) * r * 0.4 - 18); g.lineTo(cx + Math.cos(t0) * r, cy + Math.sin(t0) * r * 0.4 + 30); }
        g.stroke();
        const bar = (y, label, k, col) => { g.fillStyle = G; g.fillText(label, 10, y); g.strokeStyle = G; g.strokeRect(10, y + 22, W * 0.42, 12); g.fillStyle = col; g.fillRect(12, y + 24, (W * 0.42 - 4) * Math.max(0, k), 8); };
        if (tg.maxShield > 0) bar(98, 'SCHILD', tg.shield / tg.maxShield, G);
        bar(146, 'HÜLLE', tg.hp / tg.maxHp, R);
        if (P.aimLocked) { g.fillStyle = Math.sin(performance.now() / 90) > 0 ? G : '#04110b'; g.fillText('LOCK', W * 0.62, H - 34); }
      }
    }
  }

  render(renderer) {
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = true;
  }

  dispose() {
    this.scene.traverse((o) => { o.geometry?.dispose(); });
    for (const m of [this.metal, this.dark, this.trim, this.btn, this.glass, this.glassEdge]) { m.map?.dispose(); m.dispose(); }
    for (const m of this.mfds) { m.tex.dispose(); m.mat.dispose(); }
  }
}
