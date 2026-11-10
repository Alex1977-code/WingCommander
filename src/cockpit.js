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

// top-down outlines (right half, nose = +y), mirrored when drawn
const SIL = {
  sperber: [[0, 1], [0.1, 0.62], [0.16, 0.2], [0.62, -0.18], [0.66, -0.42], [0.2, -0.34], [0.14, -0.86], [0, -0.92]],
  falke: [[0, 1], [0.12, 0.6], [0.2, 0.15], [0.72, -0.22], [0.7, -0.48], [0.22, -0.4], [0.18, -0.9], [0, -0.95]],
  greif: [[0, 0.95], [0.1, 0.7], [0.3, 0.55], [0.34, 0.1], [0.78, -0.12], [0.8, -0.42], [0.36, -0.36], [0.32, -0.92], [0.1, -0.8], [0, -0.85]],
};
const IDLE_LINES = [
  'SCHILDGENERATOR · PHASE NOMINAL', 'KÜHLMITTELDRUCK 2,4 BAR', 'TRÄGHEITSDÄMPFER AKTIV', 'NAV-SYNC MIT TUS AURORA',
  'REAKTOR 1 · 98,2 %', 'REAKTOR 2 · 97,9 %', 'IFF-TRANSPONDER: NACHTFALKE', 'LEBENSERHALTUNG OK · O2 21 %', 'KALIBRIERE ZIELRECHNER…',
  'SENSORPAKET 3 · RAUSCHEN 0,4', 'KANZELDRUCK STABIL', 'KANONEN 1–4 · LADUNG 100 %', 'DATENBUS 4 · 1 PAKETVERLUST', 'TELEMETRIE → AURORA',
  'TRIEBWERKSTEMPERATUR 1180 K', 'FREQUENZSPRUNG KANAL 07', 'SELBSTTEST BESTANDEN', 'KOMPENSATOR DRIFT 0,02°',
];

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
    this.mfds = ['TGT', 'SCHIFF', 'RAD'].map((kind) => ({ kind, ...canvasMat(320, 240) }));
    this.logs = ['LOG', 'KOM'].map((kind) => ({ kind, ...canvasMat(256, 320), lines: [], next: 0 }));
    this.buttons = [];
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
    [[-44, 0, 0.15], [0, 1, 0.17], [44, 2, 0.15]].forEach(([deg, i, mw]) => {
      const mh = mw * 0.75;
      place(new THREE.Mesh(roundedRect(mw * 1.22, mh * 1.3, 0.014, 0.01), this.bezel), deg, 0.0, 0.004);
      place(new THREE.Mesh(new THREE.PlaneGeometry(mw, mh), this.mfds[i].mat), deg, 0.0, 0.012);
      for (const side of [-1, 1]) for (let k = 0; k < 4; k++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.012, 0.006), this.rubber);
        place(b, deg + ((side * mw * 0.56) / R) / DEG, -mh * 0.38 + k * mh * 0.25, 0.011);
      }
    });
    // narrow text screens with scrolling system messages
    [[-23, 0], [23, 1]].forEach(([deg, i]) => {
      place(new THREE.Mesh(roundedRect(0.074, 0.112, 0.01, 0.008), this.bezel), deg, 0.012, 0.005);
      place(new THREE.Mesh(new THREE.PlaneGeometry(0.064, 0.08), this.logs[i].mat), deg, 0.012, 0.012);
    });
    // banks of illuminated push-buttons under the displays
    this.buttons = [];
    const capGeo = new THREE.BoxGeometry(0.013, 0.009, 0.006);
    const bank = (deg, y, n, kinds) => {
      const step = 0.017;
      for (let k = 0; k < n; k++) {
        const mat = new THREE.MeshStandardMaterial({ color: 0x1d1f22, emissive: 0x000000, roughness: 0.5 });
        const b = new THREE.Mesh(capGeo, mat);
        place(b, deg + (((k - (n - 1) / 2) * step) / R) / DEG, y, 0.012);
        this.buttons.push({ mat, kind: kinds[k % kinds.length], idx: k, phase: Math.random() * 6 });
      }
    };
    bank(-44, -0.095, 7, ['shieldgen', 'idle', 'guns', 'idle', 'nav', 'idle', 'ecm']);
    bank(0, -0.095, 10, ['missile']);
    bank(44, -0.095, 7, ['boost', 'idle', 'comm', 'idle', 'auto', 'idle', 'hull']);
    bank(-23, -0.075, 4, ['idle', 'nav', 'idle', 'guns']);
    bank(23, -0.075, 4, ['comm', 'idle', 'ecm', 'idle']);
    // annunciator strip above the target display
    place(new THREE.Mesh(roundedRect(0.29, 0.068, 0.008, 0.006), this.bezel), 0, 0.12, 0.006);
    place(new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.054), this.annun.mat), 0, 0.12, 0.012);
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

    // --- flight controls: yoke or stick (setting), plus throttle ---
    this.yoke = this.buildYoke(S);
    this.rig.add(this.yoke);
    const stick = new THREE.Group();
    stick.add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.03, 0.05, 14), this.rubber));
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.007, 0.09, 10), this.chrome); shaft.position.y = 0.06; stick.add(shaft);
    const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.05, 6, 12), this.rubber); grip.position.set(0, 0.125, 0.004); grip.rotation.x = 0.25; stick.add(grip);
    const trig = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.016, 0.01), this.trim); trig.position.set(0, 0.13, -0.017); stick.add(trig);
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.006, 10), this.chrome); hat.position.set(0, 0.158, 0.004); stick.add(hat);
    stick.position.copy(S(0.62, -1.42, 0.34));
    this.rig.add(stick); this.stick = stick;
    this.applyStyle();
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

  /** Two-handed control yoke: centre column, curved horns with grips, thumb buttons. */
  buildYoke(S) {
    const y = new THREE.Group();
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.16, 12), this.chrome); col.rotation.x = 0.5; col.position.set(0, -0.05, 0.04); y.add(col);
    const hub = new THREE.Mesh(roundedRect(0.08, 0.05, 0.012, 0.03), this.metal); hub.position.set(0, 0.02, 0.012); y.add(hub);
    const wheel = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-0.17, 0.07, 0), new THREE.Vector3(-0.15, 0.0, 0), new THREE.Vector3(-0.06, -0.02, 0), new THREE.Vector3(0.06, -0.02, 0), new THREE.Vector3(0.15, 0.0, 0), new THREE.Vector3(0.17, 0.07, 0)]), 40, 0.011, 10), this.dark);
    wheel.add(bar);
    for (const sx of [-1, 1]) {
      const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.015, 0.06, 6, 12), this.rubber); grip.position.set(sx * 0.175, 0.105, 0); grip.rotation.z = -sx * 0.12; wheel.add(grip);
      const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.005, 12), sx < 0 ? this.trim : this.chrome); btn.rotation.x = Math.PI / 2; btn.position.set(sx * 0.17, 0.145, 0.012); wheel.add(btn);
    }
    wheel.position.set(0, 0.03, 0.03);
    y.add(wheel);
    y.scale.setScalar(0.82);
    y.position.copy(S(0, -1.28, 0.42));
    y.userData.wheel = wheel; y.userData.base = y.position.clone();
    return y;
  }

  setStyle(style) { this.style = style; this.applyStyle(); }
  applyStyle() { if (this.yoke) this.yoke.visible = this.style !== 'stick'; if (this.stick) this.stick.visible = this.style === 'stick'; }

  /** add a line to the scrolling message screens */
  log(text, color = '#6dffb0', screen = 0) {
    const L = this.logs[screen];
    L.lines.push({ text: text.toUpperCase().slice(0, 30), color, t: performance.now() });
    if (L.lines.length > 14) L.lines.shift();
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
    if (this.yoke?.visible) {
      const w = this.yoke.userData.wheel;
      w.rotation.z += (-cx * 0.6 - w.rotation.z) * Math.min(1, dt * 12);
      this.yoke.position.z += ((this.yoke.userData.base.z + cy * 0.035) - this.yoke.position.z) * Math.min(1, dt * 12);
    }
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
    this.updateButtons(P, game, t);
    for (const L of this.logs) {
      if (t > L.next) { L.next = t + rnd(0.6, 1.8); if (L.kind === 'LOG') this.log(IDLE_LINES[(Math.random() * IDLE_LINES.length) | 0], '#5fc79a', 0); else this.log(`CH ${String((Math.random() * 99) | 0).padStart(2, '0')} · ${(120 + Math.random() * 40).toFixed(2)} MHZ`, '#5fa8c7', 1); }
      this.drawLog(L, t); L.tex.needsUpdate = true;
    }
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

  updateButtons(P, game, t) {
    const p = P.ship, col = (mat, r, g, b) => mat.emissive.setRGB(r, g, b);
    const blink = (rate, ph = 0) => Math.sin(t * rate + ph) > 0;
    for (const B of this.buttons) {
      const m = B.mat;
      switch (B.kind) {
        case 'missile': B.idx < p.missiles ? col(m, 1.6, 0.9, 0.1) : col(m, 0.04, 0.02, 0); break;
        case 'shieldgen': p.shieldT > 0 && p.shield < p.maxShield ? (blink(8) ? col(m, 0.2, 0.9, 2) : col(m, 0.02, 0.1, 0.2)) : col(m, 0.1, 0.6, 1.4); break;
        case 'guns': P.ctrl.firing ? (blink(20, B.idx) ? col(m, 2, 0.3, 0.2) : col(m, 0.3, 0.05, 0.03)) : col(m, 0.9, 0.12, 0.1); break;
        case 'boost': P.boosting ? col(m, 0.3, 0.6, 2.4) : P.boostLock ? (blink(6) ? col(m, 2, 0.1, 0.1) : col(m, 0.1, 0, 0)) : col(m, 0.05, 0.12, 0.3); break;
        case 'comm': game.ui?.commActive?.() ? (blink(10, B.idx) ? col(m, 0.3, 1.8, 0.6) : col(m, 0.03, 0.2, 0.06)) : col(m, 0.03, 0.12, 0.04); break;
        case 'auto': game.autoAvailable?.() ? (blink(3) ? col(m, 0.3, 1.6, 0.5) : col(m, 0.05, 0.3, 0.1)) : col(m, 0.02, 0.06, 0.03); break;
        case 'hull': p.hp < p.maxHp * 0.3 ? (blink(7) ? col(m, 2.2, 0.15, 0.1) : col(m, 0.2, 0, 0)) : p.hp < p.maxHp * 0.65 ? col(m, 1.6, 0.8, 0.05) : col(m, 0.05, 0.2, 0.05); break;
        case 'nav': col(m, 0.1, 0.5, 0.9); break;
        case 'ecm': P.missileWarn ? (blink(14) ? col(m, 2, 1.2, 0.1) : col(m, 0.2, 0.1, 0)) : col(m, 0.15, 0.1, 0.02); break;
        default: blink(0.7 + (B.phase % 1.3), B.phase) ? col(m, 0.5, 0.45, 0.35) : col(m, 0.03, 0.03, 0.02);
      }
    }
  }

  /** scrolling, flickering text screen */
  drawLog(L, t) {
    const g = L.g, W = L.c.width, H = L.c.height;
    g.fillStyle = '#030a07'; g.fillRect(0, 0, W, H);
    g.font = `700 22px ${FONT}`; g.textBaseline = 'top';
    g.fillStyle = '#6dffb0'; g.globalAlpha = 0.8; g.fillText(L.kind, 8, 6); g.globalAlpha = 1;
    const lh = 27, n = L.lines.length;
    const newest = n ? L.lines[n - 1] : null;
    const slide = newest ? Math.max(0, 1 - (performance.now() - newest.t) / 220) * lh : 0;
    for (let i = 0; i < n; i++) {
      const ln = L.lines[i];
      const y = H - (n - i) * lh + slide - 4;
      if (y < 26) continue;
      const age = (performance.now() - ln.t) / 1000;
      // freshly arrived lines type in; everything flickers a little
      const shown = Math.min(ln.text.length, Math.floor(age * 60));
      g.globalAlpha = (0.55 + Math.random() * 0.45) * Math.max(0.35, 1 - age / 14);
      g.fillStyle = ln.color;
      const dx = Math.random() < 0.03 ? rnd(-6, 6) : 0;
      g.fillText(ln.text.slice(0, shown) + (shown < ln.text.length ? '▌' : ''), 8 + dx, y);
    }
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(0,0,0,.35)'; for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
    const sy = ((t * 70) % (H + 40)) - 20;
    g.fillStyle = 'rgba(120,255,190,.07)'; g.fillRect(0, sy, W, 18);
    g.drawImage(this.prints, -40, -20);
  }

  /** top-down schematic of the pilot's own fighter: outline, guns, missiles, shield sectors and hits */
  drawShip(g, W, H, P) {
    const p = P.ship, def = p.def, now = performance.now();
    const G = '#6dffb0', A = '#ffc857', R = '#ff4d6d';
    const cx = W * 0.5, cy = H * 0.54, sc = H * 0.33;
    const L = def.radius * 1.15;
    const toS = (x, z) => [cx - (x / L) * sc, cy - (z / L) * sc];
    // shield: four sectors that flash on the side that was hit
    const sk = p.shield / p.maxShield;
    const sectors = [['front', -Math.PI * 0.75, -Math.PI * 0.25], ['right', -Math.PI * 0.25, Math.PI * 0.25], ['back', Math.PI * 0.25, Math.PI * 0.75], ['left', Math.PI * 0.75, Math.PI * 1.25]];
    for (const [side, a0, a1] of sectors) {
      const hitAge = (now - (P.hitSide?.[side] || 0)) / 1000;
      const flash = hitAge < 0.6;
      g.strokeStyle = flash ? (Math.sin(now / 40) > 0 ? '#ffffff' : R) : sk > 0.5 ? G : sk > 0.15 ? A : R;
      g.globalAlpha = sk <= 0.01 && !flash ? 0.15 : 0.4 + sk * 0.6;
      g.lineWidth = flash ? 7 : 4;
      g.beginPath(); g.ellipse(cx, cy, sc * 0.95, sc * 1.25, 0, a0 + 0.06, a1 - 0.06); g.stroke();
    }
    g.globalAlpha = 1;
    // hull outline coloured by integrity
    const hk = p.hp / p.maxHp;
    const sil = SIL[p.type] || SIL.falke;
    const pts = [...sil, ...sil.slice(1, -1).reverse().map(([x, y]) => [-x, y])];
    g.beginPath();
    pts.forEach(([x, y], i) => { const X = cx + x * sc * 0.9, Y = cy - y * sc; i ? g.lineTo(X, Y) : g.moveTo(X, Y); });
    g.closePath();
    g.fillStyle = hk > 0.65 ? 'rgba(109,255,176,.12)' : hk > 0.3 ? 'rgba(255,200,87,.16)' : 'rgba(255,77,109,.2)';
    g.fill();
    g.strokeStyle = hk > 0.65 ? G : hk > 0.3 ? A : R; g.lineWidth = 2.5; g.stroke();
    g.strokeStyle = 'rgba(109,255,176,.35)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx, cy - sc * 0.9); g.lineTo(cx, cy + sc * 0.85); g.stroke();
    // engine glow
    const eg = Math.min(1, p.speed / def.boost);
    g.fillStyle = P.boosting ? '#7fd6ff' : `rgba(127,214,255,${0.3 + eg * 0.5})`;
    g.fillRect(cx - 6, cy + sc * 0.88, 12, 4 + eg * 10);
    // guns: hardpoints flash when firing
    const firing = (p.cool ?? 0) > def.rof * 0.5;
    for (const [x, , z] of def.guns) { const [X, Y] = toS(x, z); g.fillStyle = firing ? '#ffffff' : G; g.fillRect(X - 3, Y - 6, 6, 10); }
    // missile pylons
    const maxM = def.missiles || 0;
    for (let i = 0; i < maxM; i++) {
      const side = i % 2 ? 1 : -1, row = Math.floor(i / 2);
      const X = cx + side * sc * (0.28 + row * 0.07), Y = cy + sc * 0.05 + row * 4;
      g.fillStyle = i < p.missiles ? A : 'rgba(255,200,87,.15)';
      g.beginPath(); g.moveTo(X, Y - 6); g.lineTo(X + 3, Y + 4); g.lineTo(X - 3, Y + 4); g.closePath(); g.fill();
    }
    // persistent hull hit marks
    for (const mk of P.marks || []) {
      const [X, Y] = toS(mk.x, mk.z);
      const fresh = (now - mk.t) < 800;
      g.strokeStyle = fresh ? '#ffffff' : R; g.lineWidth = 2;
      g.beginPath(); g.moveTo(X - 5, Y - 5); g.lineTo(X + 5, Y + 5); g.moveTo(X + 5, Y - 5); g.lineTo(X - 5, Y + 5); g.stroke();
      g.fillStyle = 'rgba(255,77,109,.25)'; g.beginPath(); g.arc(X, Y, fresh ? 10 : 6, 0, 6.283); g.fill();
    }
    g.font = `700 16px ${FONT}`; g.textAlign = 'left';
    g.fillStyle = sk > 0.15 ? G : R; g.fillText(`SCHILD ${Math.round(sk * 100)}%`, 10, H - 22);
    g.fillStyle = hk > 0.3 ? G : R; g.textAlign = 'right'; g.fillText(`HÜLLE ${Math.round(hk * 100)}%`, W - 10, H - 22);
    g.fillStyle = A; g.fillText(`${p.name?.toUpperCase?.() || ''} · ${def.name.toUpperCase()}`, W - 10, 8);
    g.textAlign = 'left';
  }

  drawMFD(m, P, game) {
    const g = m.g, W = 320, H = 240, p = P.ship;
    g.fillStyle = '#04110b'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(109,255,176,.16)'; g.lineWidth = 1;
    for (let y = 0; y < H; y += 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.font = `700 18px ${FONT}`; g.textBaseline = 'top'; g.textAlign = 'left';
    const G = '#6dffb0', A = '#ffc857', R = '#ff4d6d';
    g.fillStyle = G; g.fillText(m.kind, 10, 8);
    if (m.kind === 'SCHIFF') {
      this.drawShip(g, W, H, P);
    } else if (m.kind === 'SYS') {
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
    for (const m of [...this.mfds, ...this.logs, this.annun]) { m.tex.dispose(); m.mat.dispose(); }
    for (const b of this.buttons) b.mat.dispose();
  }
}
