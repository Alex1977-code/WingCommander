/**
 * First-person cockpit of a well-used Union fighter.
 *  - curved wrap-around instrument console, rounded glare shield, bubble-canopy frame
 *  - live instruments: SYS / TGT / RAD displays, analog speed gauge, attitude indicator
 *  - annunciator panel + master caution that blink according to the fighter's state
 *  - flight stick and throttle that follow the pilot's inputs
 *  - procedural wear: scratches, chipped edges, grime, rivets, faded stencils, fingerprints, canopy smudges
 * Rendered as a second pass with its own camera (near plane 1 cm), lit by the real sun direction.
 */
import * as THREE from 'three';

const v = new THREE.Vector3(), v2 = new THREE.Vector3(), q = new THREE.Quaternion();
const DEG = Math.PI / 180;
const rnd = (a, b) => a + Math.random() * (b - a);
const FONT = "'Rajdhani', system-ui, sans-serif";

// ---------------------------------------------------------------------------
// procedural "used" surfaces
// ---------------------------------------------------------------------------
function wornTexture(base, { size = 512, stripes = false, labels = [], rivets = true, grime = 1 } = {}) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const r = document.createElement('canvas'); r.width = r.height = size; // roughness map
  const rg = r.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  rg.fillStyle = '#b4b4b4'; rg.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) {
    const a = Math.random() * 0.06;
    g.fillStyle = Math.random() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    g.fillRect(Math.random() * size, Math.random() * size, rnd(2, 14), rnd(1, 6));
  }
  g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 2;
  for (let i = 0; i < 4; i++) { const y = rnd(0, size); g.beginPath(); g.moveTo(0, y); g.lineTo(size, y); g.stroke(); }
  for (let i = 0; i < 3; i++) { const x = rnd(0, size); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, size); g.stroke(); }
  if (rivets) for (let i = 0; i < 70; i++) {
    const x = rnd(0, size), y = rnd(0, size);
    g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.arc(x + 1, y + 1, 2.4, 0, 6.283); g.fill();
    g.fillStyle = 'rgba(255,255,255,.22)'; g.beginPath(); g.arc(x, y, 2, 0, 6.283); g.fill();
  }
  if (stripes) {
    g.save(); g.beginPath(); g.rect(0, size * 0.84, size, size * 0.1); g.clip();
    for (let x = -size; x < size * 2; x += 28) { g.fillStyle = (x / 28) % 2 ? 'rgba(230,180,40,.75)' : 'rgba(20,20,20,.75)'; g.beginPath(); g.moveTo(x, size * 0.84); g.lineTo(x + 28, size * 0.84); g.lineTo(x + 78, size * 0.94); g.lineTo(x + 50, size * 0.94); g.fill(); }
    for (let i = 0; i < 260; i++) { g.fillStyle = base; g.globalAlpha = Math.random() * 0.8; g.fillRect(rnd(0, size), rnd(size * 0.84, size * 0.94), rnd(2, 12), rnd(1, 5)); }
    g.globalAlpha = 1; g.restore();
  }
  labels.forEach((t, i) => {
    g.save(); g.translate(rnd(30, size * 0.55), 40 + i * (size / (labels.length + 1))); g.rotate(rnd(-0.03, 0.03));
    g.font = `700 ${Math.round(size / 26)}px ${FONT}`; g.fillStyle = 'rgba(220,226,232,.55)'; g.fillText(t, 0, 0);
    for (let k = 0; k < 40; k++) { g.fillStyle = base; g.globalAlpha = Math.random() * 0.7; g.fillRect(rnd(0, 180), rnd(-16, 4), rnd(1, 6), rnd(1, 3)); }
    g.restore(); g.globalAlpha = 1;
  });
  for (let i = 0; i < 140; i++) {
    const x = rnd(0, size), y = rnd(0, size), a = rnd(0, 6.283), l = rnd(6, 60);
    g.strokeStyle = `rgba(230,235,240,${rnd(0.08, 0.32)})`; g.lineWidth = rnd(0.5, 1.4);
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + rnd(-4, 4), y + Math.sin(a) * l * 0.5 + rnd(-4, 4), x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    rg.strokeStyle = 'rgba(70,70,70,.7)'; rg.lineWidth = 1.5; rg.beginPath(); rg.moveTo(x, y); rg.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); rg.stroke();
  }
  for (let i = 0; i < 40; i++) {
    const x = rnd(0, size), y = Math.random() < 0.5 ? rnd(0, 20) : rnd(size - 20, size);
    g.fillStyle = `rgba(170,175,180,${rnd(0.25, 0.6)})`;
    g.beginPath(); g.ellipse(x, y, rnd(2, 10), rnd(1, 4), rnd(0, 3), 0, 6.283); g.fill();
  }
  for (let i = 0; i < 26 * grime; i++) {
    const x = rnd(0, size), y = rnd(size * 0.3, size), rr = rnd(15, 70);
    const gr = g.createRadialGradient(x, y, 0, x, y, rr);
    gr.addColorStop(0, `rgba(25,20,15,${rnd(0.15, 0.35)})`); gr.addColorStop(1, 'rgba(25,20,15,0)');
    g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    rg.fillStyle = 'rgba(255,255,255,.08)'; rg.beginPath(); rg.arc(x, y, rr * 0.6, 0, 6.283); rg.fill();
  }
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 4;
  const rough = new THREE.CanvasTexture(r); rough.wrapS = rough.wrapT = THREE.RepeatWrapping;
  return { map, rough };
}

function smudgeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 60; i++) { const x = rnd(0, 512), y = rnd(0, 512), rr = rnd(20, 90); const gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, `rgba(255,255,255,${rnd(0.04, 0.12)})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
  for (let i = 0; i < 90; i++) { const x = rnd(0, 512), y = rnd(0, 512), a = rnd(0, 6.283), l = rnd(20, 140); g.strokeStyle = `rgba(255,255,255,${rnd(0.05, 0.25)})`; g.lineWidth = rnd(0.5, 1.5); g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function roundedRect(w, h, r, depth, bevel = 0.004) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 8 });
  g.translate(0, 0, -depth);
  const uv = g.attributes.uv, p = g.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) * 3 + 0.5, p.getY(i) * 3 + 0.5);
  return g;
}

// ---------------------------------------------------------------------------
const LAMPS = [
  ['SCHILD', 'shield'], ['HÜLLE', 'hull'], ['RAKETE', 'missile'], ['NACHBR', 'boost'], ['FUNK', 'comm'],
  ['ZIEL', 'target'], ['LOCK', 'lock'], ['WAFFEN', 'guns'], ['MINE', 'mine'], ['AUTO', 'auto'],
];
const LAMP_RGB = { off: [40, 36, 30], green: [70, 255, 150], amber: [255, 190, 60], red: [255, 60, 70] };

export class Cockpit {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1.6, 0.01, 10);
    this.rig = new THREE.Group();
    this.scene.add(this.rig);
    this.sun = new THREE.DirectionalLight(0xfff1dd, 2.4);
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(new THREE.HemisphereLight(0x7a96b8, 0x2a2018, 0.9));
    this.screenLight = new THREE.PointLight(0x7fe0ff, 0.5, 1.0, 1.6);
    this.alarmLight = new THREE.PointLight(0xff2030, 0, 1.4, 1.4);
    this.scene.add(this.screenLight, this.alarmLight);

    const wp = wornTexture('#5b626b', { stripes: true, labels: ['88. GESCHW. · NACHTFALKEN', 'WARTUNG 2643-07 ✓', 'NICHT BETRETEN'] });
    const wd = wornTexture('#30353c', { grime: 1.5 });
    const wb = wornTexture('#4a5058', { rivets: false });
    this.metal = new THREE.MeshStandardMaterial({ color: 0xffffff, map: wp.map, roughnessMap: wp.rough, metalness: 0.55, roughness: 0.75 });
    this.dark = new THREE.MeshStandardMaterial({ color: 0xffffff, map: wd.map, roughnessMap: wd.rough, metalness: 0.35, roughness: 0.85, side: THREE.DoubleSide });
    this.bezel = new THREE.MeshStandardMaterial({ color: 0xffffff, map: wb.map, roughnessMap: wb.rough, metalness: 0.6, roughness: 0.7 });
    this.decals = [this.decal('88. GESCHWADER', 'NACHTFALKEN', '#c8581a'), this.decal('WARTUNG 2643-07', 'TECH. HAUPTFELDW. OKAFOR', '#d8d0b8'), this.decal('⚠ HOCHSPANNUNG', 'SCHILDBUS NICHT ÖFFNEN', '#e0b030')];
    this.rubber = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.95, metalness: 0 });
    this.chrome = new THREE.MeshStandardMaterial({ color: 0x9aa2ab, roughness: 0.3, metalness: 0.95 });
    this.trim = new THREE.MeshStandardMaterial({ color: 0xc8581a, roughness: 0.6, metalness: 0.3 });
    this.canopyMat = new THREE.MeshBasicMaterial({ map: smudgeTexture(), transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.cautionMat = new THREE.MeshStandardMaterial({ color: 0x401014, emissive: 0x000000, roughness: 0.4 });
    this.hudEdge = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.6, 0.8), toneMapped: false });

    const canvasMat = (w, h) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      return { c, g: c.getContext('2d'), tex, mat: new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }) };
    };
    this.mfds = ['SYS', 'TGT', 'RAD'].map((kind) => ({ kind, ...canvasMat(320, 240) }));
    this.gauges = ['SPEED', 'ATT'].map((kind) => ({ kind, ...canvasMat(256, 256) }));
    this.annun = canvasMat(640, 128);
    this.prints = this.fingerprints(320, 240);
    this.lampState = {};
    this.mfdT = 0; this.aspect = 0; this.shake = 0; this.radarAng = 0;
  }

  /** a worn sticker / maintenance plaque */
  decal(title, sub, color) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = color; g.fillRect(4, 4, 248, 88);
    g.fillStyle = 'rgba(15,15,15,.85)'; g.font = `800 26px ${FONT}`; g.fillText(title, 14, 40);
    g.font = `600 17px ${FONT}`; g.fillText(sub, 14, 70);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 160; i++) { g.globalAlpha = Math.random() * 0.8; g.fillRect(rnd(0, 256), Math.random() < 0.6 ? rnd(0, 18) : rnd(0, 96), rnd(1, 8), rnd(1, 4)); }
    for (let i = 0; i < 12; i++) { g.globalAlpha = 0.5; g.beginPath(); g.moveTo(rnd(0, 256), rnd(0, 96)); g.lineTo(rnd(0, 256), rnd(0, 96)); g.lineWidth = 1; g.stroke(); }
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.8, metalness: 0 });
  }

  fingerprints(w, h) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    for (let i = 0; i < 5; i++) {
      const x = rnd(20, w - 20), y = rnd(20, h - 20);
      g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = 1;
      for (let k = 1; k < 9; k++) { g.beginPath(); g.ellipse(x, y, k * 2.2, k * 3, rnd(0, 1), 0, 6.283); g.stroke(); }
    }
    for (let i = 0; i < 3; i++) { const x = rnd(0, w), y = rnd(0, h); const gr = g.createRadialGradient(x, y, 0, x, y, 60); gr.addColorStop(0, 'rgba(255,255,255,.06)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x - 60, y - 60, 120, 120); }
    return c;
  }

  /** Build geometry for the current screen shape (rebuilt when aspect or FOV changes). */
  build(aspect, fov) {
    if (Math.abs(aspect - this.aspect) < 0.01 && fov === this.fov) return;
    this.aspect = aspect; this.fov = fov;
    for (const c of [...this.rig.children]) { this.rig.remove(c); c.traverse((o) => o.geometry?.dispose()); }
    const th = Math.tan((fov * Math.PI) / 360);
    const S = (fx, fy, d) => new THREE.Vector3(fx * th * aspect * d, fy * th * d, -d);
    const tube = (pts, r, mat, parent = this.rig) => { const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, r, 10), mat); parent.add(m); return m; };

    // --- curved wrap-around console ---
    const R = 0.62, H = 0.32, lean = -0.16;
    const panel = new THREE.Group();
    const span = Math.min(170, 120 + aspect * 18) * DEG;
    panel.add(new THREE.Mesh(new THREE.CylinderGeometry(R, R * 1.04, H, 64, 1, true, Math.PI - span / 2, span), this.dark));
    const arc = (rad, y, a0, a1, n = 24) => Array.from({ length: n + 1 }, (_, i) => { const a = (a0 + (a1 - a0) * (i / n)) * DEG; return new THREE.Vector3(rad * Math.sin(a), y, -rad * Math.cos(a)); });
    const halfSpan = span / 2 / DEG;
    const hood = tube(arc(R + 0.03, H / 2 + 0.02, -halfSpan + 6, halfSpan - 6), 0.03, this.metal, panel);
    hood.scale.y = 0.5;
    tube(arc(R - 0.008, H / 2 - 0.004, -48, 48), 0.004, this.trim, panel);
    tube(arc(R * 1.02, -H / 2, -halfSpan + 4, halfSpan - 4), 0.02, this.rubber, panel);
    const place = (obj, deg, y, inset = 0.012) => { const a = deg * DEG, r = R - inset; obj.position.set(r * Math.sin(a), y, -r * Math.cos(a)); obj.rotation.y = -a; panel.add(obj); return obj; };
    // three MFDs with rounded, worn bezels and soft keys
    const mw = 0.15, mh = 0.115;
    [[-44, 0], [0, 1], [44, 2]].forEach(([deg, i]) => {
      place(new THREE.Mesh(roundedRect(mw * 1.22, mh * 1.3, 0.014, 0.01), this.bezel), deg, 0.0, 0.004);
      place(new THREE.Mesh(new THREE.PlaneGeometry(mw, mh), this.mfds[i].mat), deg, 0.0, 0.012);
      for (const side of [-1, 1]) for (let k = 0; k < 4; k++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.012, 0.006), this.rubber);
        place(b, deg + ((side * mw * 0.56) / R) / DEG, -mh * 0.38 + k * mh * 0.25, 0.011);
      }
    });
    // round instruments: speed and attitude
    [[-22, 0], [22, 1]].forEach(([deg, i]) => {
      place(new THREE.Mesh(new THREE.TorusGeometry(0.047, 0.007, 10, 40), this.chrome), deg, 0.01, 0.012);
      place(new THREE.Mesh(new THREE.CircleGeometry(0.045, 40), this.gauges[i].mat), deg, 0.01, 0.011);
    });
    // annunciator strip above the target display
    place(new THREE.Mesh(roundedRect(0.29, 0.068, 0.008, 0.006), this.bezel), 0, 0.108, 0.006);
    place(new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.054), this.annun.mat), 0, 0.108, 0.012);
    // stickers and maintenance plaques
    [[-32, -0.11, 0], [33, -0.105, 1], [-58, 0.08, 2]].forEach(([deg, y, i]) => { const d = place(new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.028), this.decals[i]), deg, y, 0.009); d.rotation.z = rnd(-0.06, 0.06); });
    // master caution push-button
    const mc = new THREE.Group();
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.017, 0.012, 24), this.cautionMat); cap.rotation.x = Math.PI / 2; mc.add(cap);
    mc.add(new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.003, 8, 24), this.chrome));
    place(mc, -19, 0.11, 0.014);
    // tilt the console back and drop it so its top edge sits 42 % below the centre
    panel.rotation.x = lean;
    const topLocal = new THREE.Vector3(0, H / 2, -R).applyAxisAngle(new THREE.Vector3(1, 0, 0), lean);
    const want = S(0, -0.33, -topLocal.z);
    panel.position.set(0, want.y - topLocal.y, 0);
    this.rig.add(panel);
    panel.updateMatrixWorld(true);
    mc.getWorldPosition(this.alarmLight.position); this.alarmLight.position.add(new THREE.Vector3(0, 0.06, 0.12));
    this.screenLight.position.set(0, panel.position.y + 0.05, -0.35);

    // --- canopy: curved bow, A-pillars, sill rails, hydraulic lines, smudged glass ---
    for (const sx of [-1, 1]) {
      tube([S(0.98 * sx, -0.46, 0.66), S(0.93 * sx, 0.05, 0.58), S(0.75 * sx, 0.62, 0.48), S(0.5 * sx, 1.12, 0.38)], 0.016, this.metal);
      tube([S(1.04 * sx, -0.5, 0.52), S(1.16 * sx, 0.15, 0.44), S(1.22 * sx, 0.85, 0.32)], 0.012, this.dark);
      tube([S(0.95 * sx, -0.44, 0.63), S(0.9 * sx, 0.1, 0.56), S(0.73 * sx, 0.6, 0.47)], 0.003, this.trim);
    }
    tube([S(-0.62, 1.04, 0.42), S(-0.3, 1.14, 0.4), S(0, 1.17, 0.4), S(0.3, 1.14, 0.4), S(0.62, 1.04, 0.42)], 0.014, this.metal);
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.9, 32, 16, Math.PI * 0.2, Math.PI * 0.6, Math.PI * 0.18, Math.PI * 0.45), this.canopyMat);
    glass.rotation.y = Math.PI; glass.position.y = -0.05;
    this.rig.add(glass);
    // HUD combiner frame
    const hc = S(0, -0.3, 0.58), hw = 0.075, hh = 0.05;
    for (const sx of [-1, 1]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, hh * 2.1, 6), this.chrome); post.position.copy(hc).add(new THREE.Vector3(sx * hw, hh * 0.9, 0)); post.rotation.x = -0.35; this.rig.add(post); }
    const edge = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, 0.0014, 0.0014), this.hudEdge); edge.position.copy(hc).add(new THREE.Vector3(0, hh * 1.85, -0.017)); edge.rotation.x = -0.35; this.rig.add(edge);

    // --- flight stick and throttle ---
    const stick = new THREE.Group();
    stick.add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.03, 0.05, 14), this.rubber));
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.007, 0.09, 10), this.chrome); shaft.position.y = 0.06; stick.add(shaft);
    const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.05, 6, 12), this.rubber); grip.position.set(0, 0.125, 0.004); grip.rotation.x = 0.25; stick.add(grip);
    const trig = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.016, 0.01), this.trim); trig.position.set(0, 0.13, -0.017); stick.add(trig);
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.006, 10), this.chrome); hat.position.set(0, 0.158, 0.004); stick.add(hat);
    stick.position.copy(S(0.62, -1.42, 0.34));
    this.rig.add(stick); this.stick = stick;
    const thr = new THREE.Group();
    const rail = new THREE.Mesh(roundedRect(0.05, 0.16, 0.012, 0.018), this.metal); rail.rotation.x = -Math.PI / 2; thr.add(rail);
    const lever = new THREE.Group();
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.06, 0.012), this.chrome); arm.position.y = 0.03; lever.add(arm);
    const knob = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.028, 0.034), this.rubber); knob.position.y = 0.068; lever.add(knob);
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.006, 10), this.trim); btn.rotation.z = Math.PI / 2; btn.position.set(0.027, 0.07, 0); lever.add(btn);
    thr.add(lever);
    thr.position.copy(S(-0.62, -1.18, 0.4));
    thr.rotation.y = 0.25;
    this.rig.add(thr); this.lever = lever;
  }

  // ---------------------------------------------------------------------------
  update(P, game, dt, camera) {
    this.camera.fov = camera.fov; this.camera.aspect = camera.aspect; this.camera.updateProjectionMatrix();
    this.build(camera.aspect, Math.round(camera.fov / 4) * 4);
    const p = P.ship;
    v.copy(game.env.sunDir).applyQuaternion(q.copy(camera.quaternion).invert());
    this.sun.position.copy(v); this.sun.target.position.set(0, 0, 0);
    // smudges on the canopy light up when flying towards the sun
    this.canopyMat.opacity = 0.05 + Math.max(0, -v.z) ** 3 * 0.55;
    this.shake = Math.max(this.shake * Math.exp(-dt * 6), P.shake * 0.4);
    const buzz = (P.boosting ? 0.0015 : 0.0003) + this.shake * 0.004;
    this.rig.position.set(rnd(-0.5, 0.5) * buzz, rnd(-0.5, 0.5) * buzz, 0);
    // stick and throttle follow the pilot's hands
    const cx = P.ctrl.x || 0, cy = (P.ctrl.y || 0) * (game.invert ? 1 : -1);
    this.stick.rotation.z += (-cx * 0.35 - this.stick.rotation.z) * Math.min(1, dt * 14);
    this.stick.rotation.x += (cy * 0.3 - this.stick.rotation.x) * Math.min(1, dt * 14);
    this.lever.position.z += ((0.05 - P.throttle * 0.1) - this.lever.position.z) * Math.min(1, dt * 10);
    this.lever.rotation.x = P.boosting ? -0.5 : -0.25 - P.throttle * 0.2;

    // ---- status lamps: '!' slow blink, '!!' fast blink ----
    const t = performance.now() / 1000;
    const L = this.lampState;
    const sk = p.shield / p.maxShield, hk = p.hp / p.maxHp;
    L.shield = sk < 0.15 ? 'red!' : sk < 0.5 ? 'amber' : 'off';
    L.hull = hk < 0.3 ? 'red!' : hk < 0.65 ? 'amber' : 'off';
    L.missile = P.missileWarn ? 'red!!' : 'off';
    L.boost = P.boostLock ? 'red' : P.boosting ? 'green' : P.energy < 0.3 ? 'amber' : 'off';
    L.comm = game.ui?.commActive?.() ? 'green!' : 'off';
    L.target = P.target?.alive ? 'green' : 'off';
    L.lock = P.aimLocked ? 'green!!' : 'off';
    L.guns = p.missiles <= 0 ? 'amber' : P.ctrl.firing ? 'green!' : 'green';
    let mineNear = false;
    for (const mn of game.mines || []) if (mn.alive && mn.pos.distanceTo(p.pos) < 380) { mineNear = true; break; }
    L.mine = mineNear ? 'amber!' : 'off';
    L.auto = game.autoAvailable?.() ? 'green' : 'off';
    const states = Object.values(L);
    const red = states.some((s) => s.startsWith('red'));
    const amber = !red && states.some((s) => s.startsWith('amber'));
    const flash = Math.sin(t * 9) > 0;
    if (red) this.cautionMat.emissive.setRGB(flash ? 3.2 : 0.15, flash ? 0.25 : 0.02, flash ? 0.25 : 0.02);
    else if (amber) this.cautionMat.emissive.setRGB(1.6, 0.9, 0.05);
    else this.cautionMat.emissive.setRGB(0.05, 0.01, 0.02);
    this.alarmLight.intensity = red && flash ? 0.9 : 0;
    this.screenLight.color.set(red ? 0xff9aa0 : 0x7fe0ff);

    this.mfdT -= dt;
    this.radarAng += dt * 2.2;
    this.drawAnnunciator(t);
    if (this.mfdT <= 0) {
      this.mfdT = 0.1;
      for (const m of this.mfds) { this.drawMFD(m, P, game); m.g.drawImage(this.prints, 0, 0); m.tex.needsUpdate = true; }
    }
    for (const gz of this.gauges) { this.drawGauge(gz, P); gz.tex.needsUpdate = true; }
  }

  drawAnnunciator(t) {
    const { g, c, tex } = this.annun, W = c.width, H = c.height;
    g.fillStyle = '#0b0c0e'; g.fillRect(0, 0, W, H);
    const cols = 5, cw = W / cols, ch = H / 2;
    LAMPS.forEach(([label, key], i) => {
      const s = this.lampState[key] || 'off';
      const base = s.replace(/!/g, '');
      const rate = s.endsWith('!!') ? 12 : s.endsWith('!') ? 4.5 : 0;
      const on = base !== 'off' && (!rate || Math.sin(t * rate) > -0.2);
      const [r, gg, b] = LAMP_RGB[on ? base : 'off'];
      const x = (i % cols) * cw + 6, y = Math.floor(i / cols) * ch + 6, w = cw - 12, h = ch - 12;
      g.fillStyle = `rgb(${r * 0.22},${gg * 0.22},${b * 0.22})`; g.fillRect(x, y, w, h);
      if (on) { const gr = g.createRadialGradient(x + w / 2, y + h / 2, 2, x + w / 2, y + h / 2, w * 0.7); gr.addColorStop(0, `rgba(${r},${gg},${b},.95)`); gr.addColorStop(1, `rgba(${r},${gg},${b},.35)`); g.fillStyle = gr; g.fillRect(x, y, w, h); }
      g.font = `700 ${Math.round(h * 0.5)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = on ? 'rgba(20,10,5,.85)' : 'rgba(175,175,165,.6)';
      g.fillText(label, x + w / 2, y + h / 2 + 1);
      g.strokeStyle = 'rgba(0,0,0,.8)'; g.lineWidth = 3; g.strokeRect(x, y, w, h);
    });
    g.textAlign = 'left';
    tex.needsUpdate = true;
  }

  drawGauge(gz, P) {
    const g = gz.g, W = 256, c = W / 2, p = P.ship;
    g.clearRect(0, 0, W, W);
    g.save(); g.beginPath(); g.arc(c, c, c - 2, 0, 6.283); g.clip();
    if (gz.kind === 'SPEED') {
      g.fillStyle = '#0c0e10'; g.fillRect(0, 0, W, W);
      const max = 500, a0 = 0.75 * Math.PI, a1 = 2.25 * Math.PI;
      g.strokeStyle = 'rgba(255,90,60,.8)'; g.lineWidth = 10;
      g.beginPath(); g.arc(c, c, c - 22, a0 + (a1 - a0) * (p.def.speed / max), a1); g.stroke();
      g.strokeStyle = '#d8dde2'; g.fillStyle = '#d8dde2'; g.font = `700 22px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (let s = 0; s <= max; s += 25) {
        const a = a0 + (a1 - a0) * (s / max), big = s % 100 === 0;
        g.lineWidth = big ? 4 : 2;
        g.beginPath(); g.moveTo(c + Math.cos(a) * (c - 14), c + Math.sin(a) * (c - 14)); g.lineTo(c + Math.cos(a) * (c - (big ? 34 : 26)), c + Math.sin(a) * (c - (big ? 34 : 26))); g.stroke();
        if (big) g.fillText(String(s / 100), c + Math.cos(a) * (c - 52), c + Math.sin(a) * (c - 52));
      }
      g.font = `600 16px ${FONT}`; g.fillText('M/S ×100', c, c + 44);
      const a = a0 + (a1 - a0) * Math.min(1, p.speed / max);
      g.strokeStyle = '#ffb020'; g.lineWidth = 5; g.beginPath(); g.moveTo(c - Math.cos(a) * 16, c - Math.sin(a) * 16); g.lineTo(c + Math.cos(a) * (c - 30), c + Math.sin(a) * (c - 30)); g.stroke();
      g.fillStyle = '#2a2d31'; g.beginPath(); g.arc(c, c, 12, 0, 6.283); g.fill();
    } else {
      // attitude indicator: pitch from the nose direction, roll from the bank
      v.set(0, 0, 1).applyQuaternion(p.quat);
      const pitch = Math.asin(Math.max(-1, Math.min(1, v.y)));
      g.translate(c, c); g.rotate(-(p.bank || 0) * 0.8);
      const off = (pitch / (Math.PI / 2)) * c * 1.6;
      g.fillStyle = '#2f6fb0'; g.fillRect(-W, -W * 2 + off, W * 2, W * 2);
      g.fillStyle = '#5a3a1c'; g.fillRect(-W, off, W * 2, W * 2);
      g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.moveTo(-W, off); g.lineTo(W, off); g.stroke();
      g.lineWidth = 2; g.fillStyle = '#fff'; g.font = `700 16px ${FONT}`; g.textAlign = 'left';
      for (let d = -60; d <= 60; d += 15) { if (!d) continue; const y = off - (d / 90) * c * 1.6; const w = d % 30 ? 20 : 36; g.beginPath(); g.moveTo(-w, y); g.lineTo(w, y); g.stroke(); if (!(d % 30)) g.fillText(String(Math.abs(d)), w + 4, y + 5); }
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.strokeStyle = '#ffb020'; g.lineWidth = 6;
      g.beginPath(); g.moveTo(c - 70, c); g.lineTo(c - 22, c); g.lineTo(c - 10, c + 14); g.moveTo(c + 70, c); g.lineTo(c + 22, c); g.lineTo(c + 10, c + 14); g.stroke();
      g.fillStyle = '#ffb020'; g.beginPath(); g.arc(c, c, 5, 0, 6.283); g.fill();
    }
    g.restore();
    const gl = g.createLinearGradient(0, 0, W, W);
    gl.addColorStop(0, 'rgba(255,255,255,.22)'); gl.addColorStop(0.35, 'rgba(255,255,255,0)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gl; g.beginPath(); g.arc(c, c, c - 2, 0, 6.283); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.8)'; g.lineWidth = 6; g.beginPath(); g.arc(c, c, c - 3, 0, 6.283); g.stroke();
  }

  drawMFD(m, P, game) {
    const g = m.g, W = 320, H = 240, p = P.ship;
    g.fillStyle = '#04110b'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(109,255,176,.16)'; g.lineWidth = 1;
    for (let y = 0; y < H; y += 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.font = `700 18px ${FONT}`; g.textBaseline = 'top'; g.textAlign = 'left';
    const G = '#6dffb0', A = '#ffc857', R = '#ff4d6d';
    g.fillStyle = G; g.fillText(m.kind, 10, 8);
    if (m.kind === 'SYS') {
      const sk = p.shield / p.maxShield, hk = p.hp / p.maxHp;
      g.strokeStyle = sk > 0.5 ? G : sk > 0.2 ? A : R; g.lineWidth = 3;
      g.beginPath(); g.ellipse(W * 0.3, H * 0.55, 62, 74, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.02, sk)); g.stroke();
      g.fillStyle = hk > 0.5 ? G : hk > 0.25 ? A : R;
      g.beginPath(); g.moveTo(W * 0.3, H * 0.3); g.lineTo(W * 0.3 + 34, H * 0.72); g.lineTo(W * 0.3, H * 0.64); g.lineTo(W * 0.3 - 34, H * 0.72); g.closePath(); g.fill();
      const bar = (y, label, k, col) => { g.fillStyle = G; g.fillText(label, W * 0.58, y); g.strokeStyle = G; g.strokeRect(W * 0.58, y + 22, W * 0.36, 12); g.fillStyle = col; g.fillRect(W * 0.58 + 2, y + 24, (W * 0.36 - 4) * Math.max(0, Math.min(1, k)), 8); };
      bar(36, `SCHILD ${Math.round(sk * 100)}%`, sk, sk > 0.2 ? G : R);
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
      const blip = (pos, col, sz) => { v2.copy(pos).sub(p.pos).applyQuaternion(inv); const d = Math.hypot(v2.x, v2.z); if (d > range) return; g.fillStyle = col; g.fillRect(cx - (v2.x / range) * R0 - sz / 2, cy - (v2.z / range) * R0 - sz / 2, sz, sz); };
      for (const o of game.ships) if (o.alive && o !== p) blip(o.pos, o === P.target ? '#ffffff' : o.team === 1 ? R : o.team === 3 ? '#9fe8ff' : G, o.def.capital ? 8 : 5);
      for (const mn of game.mines || []) if (mn.alive) blip(mn.pos, '#ff7a3a', 3);
      g.fillStyle = G; g.fillText('3 KM', W - 52, 8);
    } else {
      const tg = P.target;
      if (!tg || !tg.alive) { g.fillStyle = G; g.fillText('KEIN ZIEL', W / 2 - 40, H / 2 - 10); return; }
      const d = Math.round(tg.pos.distanceTo(p.pos));
      g.fillStyle = R; g.font = `700 22px ${FONT}`; g.fillText(tg.name.toUpperCase(), 10, 34);
      g.font = `700 18px ${FONT}`; g.fillStyle = G; g.fillText(`${d} M`, 10, 62);
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

  render(renderer) {
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = true;
  }

  dispose() {
    this.scene.traverse((o) => { o.geometry?.dispose(); });
    for (const m of [this.metal, this.dark, this.bezel, ...this.decals, this.rubber, this.chrome, this.trim, this.canopyMat, this.cautionMat, this.hudEdge]) { m.map?.dispose(); m.roughnessMap?.dispose(); m.dispose(); }
    for (const m of [...this.mfds, ...this.gauges, this.annun]) { m.tex.dispose(); m.mat.dispose(); }
  }
}
