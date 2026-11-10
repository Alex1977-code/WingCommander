/**
 * First-person cockpit of a well-used Union fighter.
 *  - curved wrap-around instrument console, rounded glare shield, bubble-canopy frame
 *  - live instruments: ship schematic (traced from the real 3D model), 3D radar scope, target display
 *  - annunciator panel + master caution that blink according to the fighter's state
 *  - yoke or stick and throttle held by gloved hands that follow the pilot's inputs
 *  - battle damage: displays drop out or flicker, buttons die, sparks fly, the canopy cracks
 *  - retrofit look: bolted-on stainless pods with seven-segment readouts, LED bars, keypad,
 *    guarded toggle switches, louvred ribs, display visors, hex bolts, cable bundles and conduit
 *  - procedural wear: scratches, chipped edges, grime, rivets, faded stencils, fingerprints, canopy smudges
 * Rendered as a second pass with its own camera (near plane 1 cm), lit by the real sun direction.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildShip } from './ships.js';
import { gripHandGeometry, throttleHandGeometry } from './hand.js';

const v = new THREE.Vector3(), v2 = new THREE.Vector3(), q = new THREE.Quaternion();
const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
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

/** brushed stainless steel with fine horizontal grain, a few scuffs and fingerprints */
function brushedTexture() {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#a7adb3'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const y = Math.random() * S, l = rnd(40, 400), x = rnd(-100, S);
    g.strokeStyle = Math.random() < 0.5 ? `rgba(255,255,255,${rnd(0.03, 0.12)})` : `rgba(40,45,50,${rnd(0.03, 0.12)})`;
    g.lineWidth = rnd(0.5, 1.5); g.beginPath(); g.moveTo(x, y); g.lineTo(x + l, y + rnd(-1, 1)); g.stroke();
  }
  for (let i = 0; i < 30; i++) { const x = rnd(0, S), y = rnd(0, S), rr = rnd(20, 60); const gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, 'rgba(60,55,50,.18)'); gr.addColorStop(1, 'rgba(60,55,50,0)'); g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
  for (let i = 0; i < 60; i++) { const x = rnd(0, S), y = rnd(0, S), a = rnd(0, 6.283), l = rnd(8, 50); g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 0.7; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

/** stripes along a cable or a corrugated conduit (u runs along the tube) */
function ribTexture(base, rib) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 8;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 64, 8);
  if (rib) for (let x = 0; x < 64; x += 8) { g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(x, 0, 2, 8); g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x + 3, 0, 2, 8); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// seven-segment glyphs: segments a b c d e f g
const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g', ' ': '', E: 'adefg', r: 'eg', o: 'cdeg' };
function seg7(g, ch, x, y, w, h, on, off) {
  const t = w * 0.2, segs = SEG[ch] ?? '';
  const H2 = h / 2;
  const bars = {
    a: [x + t * 0.6, y, w - t * 1.2, t, 1], d: [x + t * 0.6, y + h - t, w - t * 1.2, t, 1], g: [x + t * 0.6, y + H2 - t / 2, w - t * 1.2, t, 1],
    f: [x, y + t * 0.6, t, H2 - t * 0.9, 0], b: [x + w - t, y + t * 0.6, t, H2 - t * 0.9, 0],
    e: [x, y + H2 + t * 0.3, t, H2 - t * 0.9, 0], c: [x + w - t, y + H2 + t * 0.3, t, H2 - t * 0.9, 0],
  };
  for (const k of 'abcdefg') {
    const [bx, by, bw, bh, hor] = bars[k], lit = segs.includes(k);
    g.fillStyle = lit ? on : off;
    if (lit) { g.shadowColor = on; g.shadowBlur = 10; } else g.shadowBlur = 0;
    g.beginPath();
    if (hor) { g.moveTo(bx, by + bh / 2); g.lineTo(bx + bh / 2, by); g.lineTo(bx + bw - bh / 2, by); g.lineTo(bx + bw, by + bh / 2); g.lineTo(bx + bw - bh / 2, by + bh); g.lineTo(bx + bh / 2, by + bh); }
    else { g.moveTo(bx + bw / 2, by); g.lineTo(bx + bw, by + bw / 2); g.lineTo(bx + bw, by + bh - bw / 2); g.lineTo(bx + bw / 2, by + bh); g.lineTo(bx, by + bh - bw / 2); g.lineTo(bx, by + bw / 2); }
    g.closePath(); g.fill();
  }
  g.shadowBlur = 0;
}
function segText(g, str, x, y, w, h, on, off) {
  let cx = x;
  for (const ch of str) {
    if (ch === '.' || ch === ':') {
      g.fillStyle = on; g.shadowColor = on; g.shadowBlur = 8;
      if (ch === '.') g.fillRect(cx - w * 0.12, y + h - w * 0.2, w * 0.18, w * 0.18);
      else { g.fillRect(cx, y + h * 0.28, w * 0.18, w * 0.18); g.fillRect(cx, y + h * 0.65, w * 0.18, w * 0.18); cx += w * 0.4; }
      g.shadowBlur = 0; continue;
    }
    seg7(g, ch, cx, y, w, h, on, off); cx += w * 1.3;
  }
}
/** embossed label-maker tape */
function dymo(g, text, x, y, h, color = '#151515') {
  g.save(); g.translate(x, y); g.rotate(rnd(-0.025, 0.025));
  g.font = `700 ${Math.round(h * 0.7)}px ${FONT}`;
  const w = g.measureText(text).width + h * 0.8;
  g.fillStyle = color; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(0, 0, w, h * 0.18);
  g.fillStyle = 'rgba(240,240,240,.92)'; g.textBaseline = 'middle'; g.fillText(text, h * 0.4, h * 0.54);
  g.restore();
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

/**
 * Top-down schematic traced from the fighter's actual 3D model: filled silhouette,
 * glowing outline and faint panel lines, cached per ship type and tint.
 */
const OUTLINES = {};
function shipOutline(type) {
  if (OUTLINES[type]) return OUTLINES[type];
  const N = 256;
  const root = buildShip(type); root.updateMatrixWorld(true);
  const meshes = [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const p = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const pos = o.geometry.attributes.position;
    const pts = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      pts[i * 2] = p.x; pts[i * 2 + 1] = p.z;
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    meshes.push({ o, pts, index: o.geometry.index });
  });
  const midX = (minX + maxX) / 2, midZ = (minZ + maxZ) / 2;
  const k = (N * 0.9) / Math.max(maxX - minX, maxZ - minZ, 1e-3);
  // nose (+z) points up, ship's +x (port) is drawn on the left
  const map = (x, z) => [N / 2 - (x - midX) * k, N / 2 - (z - midZ) * k];
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = N; return c; };
  const mask = mk(), mg = mask.getContext('2d');
  mg.fillStyle = '#fff'; mg.strokeStyle = '#fff'; mg.lineWidth = 0.6; mg.lineJoin = 'round';
  for (const { pts, index } of meshes) {
    const n = index ? index.count : pts.length / 2;
    mg.beginPath();
    for (let t = 0; t + 2 < n; t += 3) {
      for (let j = 0; j < 3; j++) {
        const i = index ? index.getX(t + j) : t + j;
        const [X, Y] = map(pts[i * 2], pts[i * 2 + 1]);
        j ? mg.lineTo(X, Y) : mg.moveTo(X, Y);
      }
      mg.closePath();
    }
    mg.fill(); mg.stroke();
  }
  // outline ring = dilated mask minus mask
  const ring = mk(), rg = ring.getContext('2d');
  for (let a = 0; a < 8; a++) rg.drawImage(mask, Math.round(Math.cos(a * Math.PI / 4) * 2), Math.round(Math.sin(a * Math.PI / 4) * 2));
  rg.globalCompositeOperation = 'destination-out'; rg.drawImage(mask, 0, 0);
  // panel lines from sharp model edges, clipped to the silhouette
  const det = mk(), dg = det.getContext('2d');
  dg.strokeStyle = '#fff'; dg.lineWidth = 0.7;
  for (const { o } of meshes) {
    const eg = new THREE.EdgesGeometry(o.geometry, 32);
    const ep = eg.attributes.position;
    dg.beginPath();
    for (let i = 0; i + 1 < ep.count; i += 2) {
      p.fromBufferAttribute(ep, i).applyMatrix4(o.matrixWorld); const [x1, y1] = map(p.x, p.z);
      p.fromBufferAttribute(ep, i + 1).applyMatrix4(o.matrixWorld); const [x2, y2] = map(p.x, p.z);
      dg.moveTo(x1, y1); dg.lineTo(x2, y2);
    }
    dg.stroke(); eg.dispose();
  }
  dg.globalCompositeOperation = 'destination-in'; dg.drawImage(mask, 0, 0);
  const tints = {};
  const tint = (col) => {
    if (tints[col]) return tints[col];
    const c = mk(), g = c.getContext('2d');
    g.globalAlpha = 0.16; g.drawImage(mask, 0, 0);
    g.globalAlpha = 0.45; g.drawImage(det, 0, 0);
    g.globalAlpha = 1; g.drawImage(ring, 0, 0);
    g.globalCompositeOperation = 'source-in'; g.fillStyle = col; g.fillRect(0, 0, N, N);
    return (tints[col] = c);
  };
  return (OUTLINES[type] = { N, map, tint, halfW: ((maxX - minX) / 2) * k, halfL: ((maxZ - minZ) / 2) * k });
}

/** canvas of radial glass cracks that accumulate on heavy hits */
function crackCanvas() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 640;
  return c;
}
function addCrack(c) {
  const g = c.getContext('2d');
  const x = rnd(c.width * 0.12, c.width * 0.88), y = rnd(c.height * 0.1, c.height * 0.75);
  g.lineCap = 'round';
  const arms = 6 + ((Math.random() * 6) | 0);
  for (let a = 0; a < arms; a++) {
    let px = x, py = y, ang = (a / arms) * 6.283 + rnd(-0.3, 0.3);
    const len = rnd(60, 200);
    g.beginPath(); g.moveTo(px, py);
    for (let d = 0; d < len; d += rnd(10, 26)) { ang += rnd(-0.35, 0.35); px += Math.cos(ang) * 16; py += Math.sin(ang) * 16; g.lineTo(px, py); }
    g.strokeStyle = `rgba(235,245,255,${rnd(0.22, 0.5)})`; g.lineWidth = rnd(0.8, 2); g.stroke();
  }
  for (let r = 1; r < 4; r++) {
    g.beginPath();
    for (let a = 0; a <= arms; a++) { const ang = (a / arms) * 6.283, rr = r * rnd(12, 22); a ? g.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr) : g.moveTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr); }
    g.strokeStyle = 'rgba(235,245,255,.35)'; g.lineWidth = 0.8; g.stroke();
  }
  const gr = g.createRadialGradient(x, y, 0, x, y, 26); gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(x - 26, y - 26, 52, 52);
}

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
    // the pilot's bare hands (skin with a soft sheen standing in for subsurface scattering), nails, flight-suit sleeves
    this.skin = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.58, metalness: 0, sheen: 0.25, sheenColor: new THREE.Color(0.8, 0.35, 0.28), sheenRoughness: 0.6, envMapIntensity: 0.35, side: THREE.DoubleSide });
    this.nail = new THREE.MeshStandardMaterial({ color: 0xd8a898, roughness: 0.3, metalness: 0, envMapIntensity: 0.5, side: THREE.DoubleSide });
    this.cuffMat = new THREE.MeshStandardMaterial({ color: 0x23271f, roughness: 0.9, metalness: 0 });
    const ws = wornTexture('#3b3a2e', { rivets: false, grime: 1.2 });
    this.sleeve = new THREE.MeshStandardMaterial({ color: 0xffffff, map: ws.map, roughnessMap: ws.rough, roughness: 0.95, metalness: 0, envMapIntensity: 0.2 });
    // stainless retrofit hardware, cables and conduit
    const bt = brushedTexture();
    this.steel = new THREE.MeshStandardMaterial({ color: 0xffffff, map: bt, metalness: 0.75, roughness: 0.34 });
    this.steelDark = new THREE.MeshStandardMaterial({ color: 0x6d737a, map: bt, metalness: 0.8, roughness: 0.4 });
    this.redCover = new THREE.MeshStandardMaterial({ color: 0xc0201a, roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.85 });
    this.cableMats = ['#7a1a14', '#a8801a', '#1d1e20', '#1f3f7a'].map((c) => new THREE.MeshStandardMaterial({ color: 0xffffff, map: ribTexture(c, false), roughness: 0.55, metalness: 0.05 }));
    this.conduit = new THREE.MeshStandardMaterial({ color: 0xffffff, map: ribTexture('#4a4d52', true), roughness: 0.45, metalness: 0.6 });
    this.toggles = []; this.keys = [];
    this.missionT = 0;
    this.crack = crackCanvas();
    this.crackTex = new THREE.CanvasTexture(this.crack); this.crackTex.colorSpace = THREE.SRGBColorSpace;
    this.crackMat = new THREE.MeshBasicMaterial({ map: this.crackTex, transparent: true, depthWrite: false, toneMapped: false });
    this.cracks = 0;
    // sparks from failing electronics
    this.sparks = Array.from({ length: 60 }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0 }));
    this.sparkGeo = new THREE.BufferGeometry();
    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(60 * 3), 3));
    this.sparkMat = new THREE.PointsMaterial({ color: new THREE.Color(3, 1.8, 0.6), size: 0.006, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.sparkPts = new THREE.Points(this.sparkGeo, this.sparkMat); this.sparkPts.frustumCulled = false;
    this.scene.add(this.sparkPts);
    this.fail = {}; // element key -> 'flicker' | 'dead'
    this.elems = {};

    const canvasMat = (w, h) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      return { c, g: c.getContext('2d'), tex, mat: new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }) };
    };
    this.mfds = ['SCHIFF', 'RAD', 'TGT'].map((kind) => ({ kind, ...canvasMat(320, 240) }));
    this.logs = ['LOG', 'KOM'].map((kind) => ({ kind, ...canvasMat(256, 320), lines: [], next: 0 }));
    this.buttons = [];
    this.annun = canvasMat(640, 128);
    this.segPanel = canvasMat(512, 224);
    this.barPanel = canvasMat(256, 224);
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
    for (const c of [...this.rig.children]) { this.rig.remove(c); c.traverse((o) => { if (!o.geometry?.userData.shared) o.geometry?.dispose(); }); }
    const th = Math.tan((fov * Math.PI) / 360);
    const S = (fx, fy, d) => new THREE.Vector3(fx * th * aspect * d, fy * th * d, -d);
    const tube = (pts, r, mat, parent = this.rig) => { const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, r, 10), mat); parent.add(m); return m; };

    // --- curved wrap-around console ---
    const R = 0.62, H = 0.32, lean = -0.21;
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
    [[-40, 0, 0.155, 0], [0, 1, 0.2, -0.012], [40, 2, 0.155, 0]].forEach(([deg, i, mw, my]) => {
      const mh = mw * 0.75;
      place(new THREE.Mesh(roundedRect(mw * 1.22, mh * 1.3, 0.014, 0.01), this.bezel), deg, my, 0.004);
      this.elems[`mfd${i}`] = place(new THREE.Mesh(new THREE.PlaneGeometry(mw, mh), this.mfds[i].mat), deg, my, 0.012);
      // sun visor over the display, with side cheeks
      const vz = place(new THREE.Group(), deg, my + mh * 0.65 + 0.004, 0.006);
      vz.rotation.order = 'YXZ';
      const lid = new THREE.Mesh(roundedRect(mw * 1.3, 0.042, 0.006, 0.004, 0.002), this.steelDark);
      lid.rotation.x = -1.25; lid.position.z = 0.019; vz.add(lid);
      for (const sx of [-1, 1]) { const ck = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.03, 0.036), this.steelDark); ck.position.set(sx * mw * 0.64, -0.012, 0.016); ck.rotation.x = 0.45; vz.add(ck); }
      for (const side of [-1, 1]) for (let k = 0; k < 4; k++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.012, 0.006), this.rubber);
        place(b, deg + ((side * mw * 0.56) / R) / DEG, my - mh * 0.38 + k * mh * 0.25, 0.011);
      }
    });
    // narrow text screens with scrolling system messages
    [[-23, 0], [23, 1]].forEach(([deg, i]) => {
      place(new THREE.Mesh(roundedRect(0.074, 0.112, 0.01, 0.008), this.bezel), deg, 0.012, 0.005);
      this.elems[`log${i}`] = place(new THREE.Mesh(new THREE.PlaneGeometry(0.064, 0.08), this.logs[i].mat), deg, 0.012, 0.012);
    });
    // banks of illuminated push-buttons under the displays
    this.buttons = [];
    const capGeo = new THREE.BoxGeometry(0.013, 0.009, 0.006);
    let bankNo = 0;
    const bank = (deg, y, n, kinds) => {
      const step = 0.017, id = `bank${bankNo++}`;
      for (let k = 0; k < n; k++) {
        const mat = new THREE.MeshStandardMaterial({ color: 0x1d1f22, emissive: 0x000000, roughness: 0.5 });
        const b = new THREE.Mesh(capGeo, mat);
        place(b, deg + (((k - (n - 1) / 2) * step) / R) / DEG, y, 0.012);
        if (k === (n >> 1)) this.elems[id] = b;
        this.buttons.push({ mat, kind: kinds[k % kinds.length], idx: k, phase: Math.random() * 6, bank: id });
      }
    };
    bank(-40, -0.1, 7, ['shieldgen', 'idle', 'guns', 'idle', 'nav', 'idle', 'ecm']);
    bank(0, -0.128, 10, ['missile']);
    bank(40, -0.1, 7, ['boost', 'idle', 'comm', 'idle', 'auto', 'idle', 'hull']);
    bank(-23, -0.075, 4, ['idle', 'nav', 'idle', 'guns']);
    bank(23, -0.075, 4, ['comm', 'idle', 'ecm', 'idle']);
    // annunciator strip above the target display
    place(new THREE.Mesh(roundedRect(0.29, 0.068, 0.008, 0.006), this.bezel), 0, 0.128, 0.006);
    this.elems.annun = place(new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.054), this.annun.mat), 0, 0.128, 0.012);
    // stickers and maintenance plaques
    [[-15.5, -0.135, 0], [16, -0.14, 1], [-58, 0.08, 2]].forEach(([deg, y, i]) => { const d = place(new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.028), this.decals[i]), deg, y, 0.009); d.rotation.z = rnd(-0.06, 0.06); });
    // master caution push-button
    const mc = new THREE.Group();
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.017, 0.012, 24), this.cautionMat); cap.rotation.x = Math.PI / 2; mc.add(cap);
    mc.add(new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.003, 8, 24), this.chrome));
    place(mc, -19, 0.11, 0.014);
    this.buildRetrofit(panel, place, R, H);
    // tilt the console back and drop it so its top edge sits 42 % below the centre
    panel.rotation.x = lean;
    const topLocal = new THREE.Vector3(0, H / 2, -R).applyAxisAngle(new THREE.Vector3(1, 0, 0), lean);
    const want = S(0, -0.33, -topLocal.z);
    panel.position.set(0, want.y - topLocal.y, 0);
    this.rig.add(panel);
    panel.updateMatrixWorld(true);
    mc.getWorldPosition(this.alarmLight.position); this.alarmLight.position.add(new THREE.Vector3(0, 0.06, 0.12));
    this.screenLight.position.set(0, panel.position.y + 0.05, -0.35);
    this.buildCables(S, tube);

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
    // cracks in the canopy glass (canvas grows with heavy hits)
    {
      const d = 0.5, a = S(-1, 1, d), b = S(1, -0.28, d);
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(b.x - a.x, a.y - b.y), this.crackMat);
      pl.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, -d); pl.renderOrder = 5;
      this.rig.add(pl);
    }
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
    const gf = new THREE.Group(); gf.position.set(0, 0.125, 0.004); gf.rotation.x = 0.25; stick.add(gf);
    gf.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.017, 0.06, 6, 12), this.rubber));
    const trig = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.016, 0.01), this.trim); trig.position.set(0, 0.012, -0.019); gf.add(trig);
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.006, 10), this.chrome); hat.position.set(0, 0.048, 0); gf.add(hat);
    this.stickHand = this.gripHand(0.017, 1); gf.add(this.stickHand);
    stick.position.copy(S(0.44, -1.5, 0.3));
    this.rig.add(stick); this.stick = stick;
    const thr = new THREE.Group();
    const rail = new THREE.Mesh(roundedRect(0.05, 0.16, 0.012, 0.018), this.metal); rail.rotation.x = -Math.PI / 2; thr.add(rail);
    const lever = new THREE.Group();
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.06, 0.012), this.chrome); arm.position.y = 0.03; lever.add(arm);
    const knob = new THREE.Mesh(roundedRect(0.066, 0.034, 0.008, 0.028, 0.003), this.rubber); knob.rotation.x = -Math.PI / 2; knob.position.set(0, 0.068 + 0.015, 0); lever.add(knob);
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.006, 10), this.trim); btn.rotation.z = Math.PI / 2; btn.position.set(0.034, 0.07, -0.01); lever.add(btn);
    this.thrHand = this.throttleHand(); this.thrHand.position.y = 0.068; lever.add(this.thrHand);
    thr.add(lever);
    thr.position.copy(S(-0.5, -1.48, 0.32));
    thr.rotation.y = 0.25;
    this.rig.add(thr); this.lever = lever;
    // forearms: from each wrist back to an elbow below the field of view
    this.arms = {};
    const armGeo = new THREE.CylinderGeometry(0.028, 0.038, 1, 16, 1, true); armGeo.translate(0, 0.5 + 0.035, 0);
    const cuffGeo = new THREE.CylinderGeometry(0.026, 0.031, 0.026, 18); cuffGeo.translate(0, 0.024, 0);
    for (const k of ['stick', 'thr', 'yokeL', 'yokeR']) {
      const m = new THREE.Mesh(armGeo, this.sleeve); m.frustumCulled = false; this.rig.add(m);
      const c = new THREE.Mesh(cuffGeo, this.cuffMat); m.userData.cuff = c; this.rig.add(c);
      this.arms[k] = m;
    }
    this.elbows = { stick: S(1.5, -2.3, 0.2), thr: S(-1.6, -2.2, 0.2), yokeL: S(-1.4, -2.4, 0.22), yokeR: S(1.4, -2.4, 0.22) };
    this.applyStyle();
  }

  /**
   * Bare hand wrapped round a vertical grip of radius r (grip axis = local y):
   * three bones per finger curling round the grip, knuckles standing off, nails,
   * back of the hand, palm and thumb ball, thumb lying over the top of the grip.
   * side 1 = right hand (knuckles outboard on +x), -1 = mirrored left hand.
   */
  gripHand(r, side) {
    const h = new THREE.Group();
    const { geometry, wrist } = gripHandGeometry();
    if (r !== 0.017) h.scale.setScalar(r / 0.017 * 0.5 + 0.5);
    h.add(new THREE.Mesh(geometry, this.skin));
    const w = new THREE.Object3D(); w.position.copy(wrist); h.add(w);
    h.userData.wrist = w;
    if (side < 0) h.scale.x = -1;
    return h;
  }

  /** left hand resting on the throttle knob: palm on top, fingers curled over the front edge, thumb along the side, pilot's watch */
  throttleHand() {
    const h = new THREE.Group(), V = THREE.Vector3;
    const { geometry, wrist: W1 } = throttleHandGeometry();
    h.add(new THREE.Mesh(geometry, this.skin));
    // chunky pilot's watch on the left wrist
    const watch = new THREE.Group(); watch.position.copy(W1).add(new V(0, 0.001, -0.008));
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.0225, 0.0045, 6, 24), this.cuffMat); strap.scale.set(1.05, 0.9, 2.2); watch.add(strap);
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.012, 0.006, 24), this.steel); face.position.y = 0.021; watch.add(face);
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.0015, 20), new THREE.MeshStandardMaterial({ color: 0x101214, emissive: 0x0c2a1c, roughness: 0.08, metalness: 0.2 })); glass.position.y = 0.0245; watch.add(glass);
    this.watchMat = glass.material;
    h.add(watch);
    const wrist = new THREE.Object3D(); wrist.position.copy(W1); h.add(wrist);
    h.userData.wrist = wrist;
    return h;
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
      const hand = this.gripHand(0.015, sx); hand.position.copy(grip.position); hand.rotation.z = grip.rotation.z; wheel.add(hand);
      y.userData[sx < 0 ? 'handL' : 'handR'] = hand;
      const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.005, 12), sx < 0 ? this.trim : this.chrome); btn.rotation.x = Math.PI / 2; btn.position.set(sx * 0.17, 0.145, 0.012); wheel.add(btn);
    }
    wheel.position.set(0, 0.03, 0.03);
    y.add(wheel);
    y.scale.setScalar(0.82);
    y.position.copy(S(0, -1.4, 0.42));
    y.userData.wheel = wheel; y.userData.base = y.position.clone();
    return y;
  }

  setStyle(style) { this.style = style; this.applyStyle(); }
  applyStyle() {
    const st = this.style === 'stick';
    if (this.yoke) this.yoke.visible = !st;
    if (this.stick) this.stick.visible = st;
    if (this.arms) { this.arms.stick.visible = st; this.arms.yokeL.visible = this.arms.yokeR.visible = !st; }
  }

  /**
   * Retrofit hardware bolted onto the console: stainless instrument pods with
   * seven-segment readouts and LED bars, guarded toggle switches, a keypad,
   * louvred ribs between the instrument groups and hex bolts everywhere.
   */
  buildRetrofit(panel, place, R, H) {
    const bolts = [], M = new THREE.Matrix4(), BR = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const bolt = (obj, x, y, z) => { obj.updateMatrix(); bolts.push(new THREE.Matrix4().multiplyMatrices(obj.matrix, M.makeTranslation(x, y, z)).multiply(BR)); };
    // louvred ribs between log screens and side displays
    for (const deg of [-29, 29]) {
      const rib = place(new THREE.Group(), deg, 0, 0.016);
      rib.add(new THREE.Mesh(roundedRect(0.034, H * 0.92, 0.006, 0.03, 0.003), this.steelDark));
      for (let k = 0; k < 9; k++) {
        const sl = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.0035, 0.016), this.steel);
        sl.position.set(0, -H * 0.36 + k * H * 0.09, 0.006); sl.rotation.x = 0.7; rib.add(sl);
      }
      for (const y of [-H * 0.43, H * 0.43]) bolt(rib, 0, y, 0.005);
    }
    // bezel bolts on the displays
    for (const [deg, w, h, y] of [[-40, 0.189, 0.151, 0], [0, 0.244, 0.195, -0.012], [40, 0.189, 0.151, 0]]) {
      const d = place(new THREE.Object3D(), deg, y, 0.004);
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) bolt(d, sx * (w / 2 - 0.008), sy * (h / 2 - 0.008), 0.006);
    }
    // instrument pods standing on the glare shield, faces tilted up towards the pilot
    const pod = (deg, w, h, d) => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(roundedRect(w, h, 0.01, d, 0.005), this.steel));
      // chunky side cheeks and a top visor give it a bolted-on silhouette
      for (const sx of [-1, 1]) { const ck = new THREE.Mesh(roundedRect(0.012, h * 1.15, 0.004, d * 1.1, 0.003), this.steelDark); ck.position.set(sx * (w / 2 + 0.004), -h * 0.05, 0.004); g.add(ck); }
      const lid = new THREE.Mesh(new THREE.BoxGeometry(w * 1.04, 0.006, 0.03), this.steelDark); lid.position.set(0, h / 2 + 0.002, 0.008); lid.rotation.x = 0.25; g.add(lid);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 0.02, d * 0.8), this.dark); foot.position.set(0, -h / 2 - 0.008, -d / 2); g.add(foot);
      const a = deg * DEG, r = R - 0.004;
      g.position.set(r * Math.sin(a), H / 2 + h / 2 + 0.012, -r * Math.cos(a));
      g.rotation.order = 'YXZ'; g.rotation.y = -a; g.rotation.x = -0.32;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) bolt(g, sx * (w / 2 - 0.007), sy * (h / 2 - 0.007), 0.006);
      panel.add(g);
      return g;
    };
    // left pod: three rows of seven-segment readouts
    const pl = pod(-34, 0.17, 0.074, 0.05);
    this.elems.seg = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.06), this.segPanel.mat); this.elems.seg.position.z = 0.0065; pl.add(this.elems.seg);
    this.podL = pl;
    // right pod: LED bar graphs, keypad and guarded toggle switches on top
    const pr = pod(34, 0.17, 0.074, 0.05);
    this.elems.bar = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.06), this.barPanel.mat); this.elems.bar.position.set(-0.042, 0, 0.0065); pr.add(this.elems.bar);
    this.keys = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, emissive: 0x000000, roughness: 0.6 });
      const k = new THREE.Mesh(roundedRect(0.016, 0.011, 0.002, 0.004, 0.0015), mat);
      k.position.set(0.02 + c * 0.021, 0.022 - r * 0.0145, 0.009); pr.add(k);
      this.keys.push({ mat, phase: Math.random() * 10 });
    }
    // big rotary selector knob on the right cheek
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.014, 18), this.rubber); knob.rotation.x = Math.PI / 2; knob.position.set(0.076, -0.02, 0.012); pr.add(knob);
    const kp = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.012, 0.003), this.steel); kp.position.set(0.076, -0.016, 0.02); pr.add(kp);
    this.podR = pr;
    this.toggles = [];
    ['NB', 'AUTO', 'WAFFE', 'ECM'].forEach((key, i) => {
      const base = new THREE.Group(); base.position.set(-0.06 + i * 0.04, 0.037 + 0.006, 0.012); pr.add(base);
      const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.004, 6), this.steel); base.add(nut);
      const lever = new THREE.Group(); base.add(lever);
      const bat = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0024, 0.018, 8), this.chrome); bat.position.y = 0.009; lever.add(bat);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.0028, 8, 6), this.chrome); tip.position.y = 0.018; lever.add(tip);
      const hinge = new THREE.Group(); hinge.position.set(0, 0.002, -0.011); base.add(hinge);
      const cover = new THREE.Mesh(new THREE.BoxGeometry(0.013, 0.022, 0.02), this.redCover); cover.position.set(0, 0.011, 0.01); hinge.add(cover);
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 8, 6), new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0x000000 })); led.position.set(0.009, 0.001, 0.008); base.add(led);
      this.toggles.push({ key, lever, hinge, led: led.material });
    });
    const bg = new THREE.CylinderGeometry(0.0035, 0.0035, 0.003, 6);
    const im = new THREE.InstancedMesh(bg, this.steel, bolts.length);
    bolts.forEach((m, i) => im.setMatrixAt(i, m));
    panel.add(im);
  }

  /** cable bundles and a corrugated conduit from the pods up the canopy pillars */
  buildCables(S, tube) {
    const loc = (obj, x, y, z) => this.rig.worldToLocal(obj.localToWorld(new THREE.Vector3(x, y, z)));
    for (const [pod, sx] of [[this.podL, -1], [this.podR, 1]]) {
      const start = loc(pod, sx * 0.09, -0.01, -0.03);
      const base = S(0.97 * sx, -0.47, 0.64), up1 = S(0.93 * sx, 0.05, 0.57), up2 = S(0.76 * sx, 0.62, 0.47);
      for (let k = 0; k < 4; k++) {
        const off = new THREE.Vector3(-sx * (0.004 + k * 0.006), (k - 1.5) * 0.004, 0.003 * k);
        const sag = start.clone().lerp(base, 0.5).add(new THREE.Vector3(0, -0.05 - k * 0.012, 0.02));
        const pts = [start.clone().add(off), sag, base.clone().add(off), up1.clone().add(off), up2.clone().add(off)];
        const m = tube(pts, k === 3 ? 0.0055 : 0.0035, this.cableMats[k]);
        m.material.map.repeat.set(1, 1);
      }
      // conduit along the sill, ribbed
      const cd = tube([S(0.99 * sx, -0.62, 0.62), base.clone().add(new THREE.Vector3(sx * 0.012, 0, 0)), up1.clone().add(new THREE.Vector3(sx * 0.014, 0, 0.004)), up2.clone().add(new THREE.Vector3(sx * 0.012, 0, 0.004))], 0.009, this.conduit);
      cd.material.map.repeat.set(90, 1);
      // cable clamps and zip ties
      for (const tpos of [0.25, 0.5, 0.75]) {
        const c = new THREE.CatmullRomCurve3([base, up1, up2]).getPoint(tpos);
        const cl = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.014), this.steelDark);
        cl.position.copy(c).add(new THREE.Vector3(-sx * 0.006, 0, 0)); cl.lookAt(0, c.y, 0); this.rig.add(cl);
      }
    }
  }

  /** point a forearm from the wrist marker to its elbow */
  aimArm(arm, wrist, elbow) {
    wrist.getWorldPosition(v); this.rig.worldToLocal(v);
    v2.copy(elbow).sub(v);
    const len = v2.length();
    arm.position.copy(v);
    arm.quaternion.setFromUnitVectors(UP, v2.multiplyScalar(1 / len));
    arm.scale.set(1, len, 1);
    const c = arm.userData.cuff;
    if (c) { c.position.copy(v); c.quaternion.copy(arm.quaternion); c.visible = arm.visible; }
  }

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
      this.yoke.position.z += ((this.yoke.userData.base.z + cy * 0.022) - this.yoke.position.z) * Math.min(1, dt * 12);
    }
    this.lever.position.z += ((0.05 - P.throttle * 0.1) - this.lever.position.z) * Math.min(1, dt * 10);
    this.lever.rotation.x = P.boosting ? -0.5 : -0.25 - P.throttle * 0.2;
    // trigger finger / thumb squeeze while firing, then the forearms follow the hands
    const squeeze = P.ctrl.firing ? 0.95 : 1;
    this.stickHand.scale.set(squeeze, 1, squeeze);
    this.rig.updateMatrixWorld(true);
    if (this.stick.visible) this.aimArm(this.arms.stick, this.stickHand.userData.wrist, this.elbows.stick);
    else { this.aimArm(this.arms.yokeL, this.yoke.userData.handL.userData.wrist, this.elbows.yokeL); this.aimArm(this.arms.yokeR, this.yoke.userData.handR.userData.wrist, this.elbows.yokeR); }
    this.aimArm(this.arms.thr, this.thrHand.userData.wrist, this.elbows.thr);
    this.updateSparks(dt);

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
    this.drawAnnunciator(t, this.fail.annun);
    if (this.mfdT <= 0) {
      this.mfdT = 0.1;
      this.mfds.forEach((m, i) => {
        const f = this.fail[`mfd${i}`];
        if (f === 'dead' || (f === 'flicker' && Math.random() < 0.35)) this.drawStatic(m.g, 320, 240, f === 'dead');
        else { this.drawMFD(m, P, game); if (f === 'flicker') this.tear(m.g, 320, 240); }
        m.g.drawImage(this.prints, 0, 0); m.tex.needsUpdate = true;
      });
    }
    this.updateButtons(P, game, t);
    this.updateRetrofit(P, game, t, dt);
    for (const L of this.logs) {
      if (t > L.next) { L.next = t + rnd(0.6, 1.8); if (L.kind === 'LOG') this.log(IDLE_LINES[(Math.random() * IDLE_LINES.length) | 0], '#5fc79a', 0); else this.log(`CH ${String((Math.random() * 99) | 0).padStart(2, '0')} · ${(120 + Math.random() * 40).toFixed(2)} MHZ`, '#5fa8c7', 1); }
      const f = this.fail[`log${this.logs.indexOf(L)}`];
      if (f === 'dead' || (f === 'flicker' && Math.random() < 0.3)) this.drawStatic(L.g, L.c.width, L.c.height, f === 'dead');
      else this.drawLog(L, t);
      L.tex.needsUpdate = true;
    }
    // failing electronics keep spitting the odd spark
    for (const k in this.fail) if (Math.random() < dt * (this.fail[k] === 'dead' ? 0.8 : 0.4)) this.sparkAt(k, 4);
  }

  /** seven-segment readouts, LED bars, toggle switches and keypad on the bolted-on pods */
  updateRetrofit(P, game, t, dt) {
    const p = P.ship;
    this.missionT += dt;
    const fs = this.fail.seg, fb = this.fail.bar;
    if (this.mfdT >= 0.099 || this.mfdT <= 0) {
      // left pod: NAV distance (red), speed (green), mission clock (amber)
      const { g, c, tex } = this.segPanel, W = c.width, H = c.height;
      if (fs === 'dead' || (fs === 'flicker' && Math.random() < 0.35)) this.drawStatic(g, W, H, fs === 'dead');
      else {
        g.fillStyle = '#0a0606'; g.fillRect(0, 0, W, H);
        const nav = game.navPos?.();
        const km = nav ? Math.min(999.9, nav.distanceTo(p.pos) / 1000) : null;
        const mm = Math.floor(this.missionT / 60) % 100, ss = Math.floor(this.missionT) % 60;
        const rows = [
          ['NAV-DIST KM', km == null ? '---.-' : km.toFixed(1).padStart(5, ' '), '#ff3a2a', 'rgba(255,58,42,.09)'],
          ['GESCHW. M/S', String(Math.round(p.speed)).padStart(4, '0'), '#3aff6a', 'rgba(58,255,106,.08)'],
          ['EINSATZZEIT', `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`, '#ffb42a', 'rgba(255,180,42,.09)'],
        ];
        rows.forEach(([label, val, on, off], i) => {
          const y = 8 + i * 72;
          g.fillStyle = '#140c0c'; g.fillRect(150, y, 350, 62);
          g.strokeStyle = 'rgba(120,120,120,.5)'; g.lineWidth = 2; g.strokeRect(150, y, 350, 62);
          dymo(g, label, 8, y + 18, 28, i === 0 ? '#2a0c0a' : i === 1 ? '#0c2412' : '#2a1d06');
          segText(g, val, 170, y + 8, 34, 46, on, off);
        });
        g.fillStyle = 'rgba(255,255,255,.04)'; g.fillRect(0, 0, W, H * 0.35);
      }
      tex.needsUpdate = true;
      // right pod: two LED bar graphs (shield, afterburner charge)
      const B = this.barPanel, bg = B.g, BW = B.c.width, BH = B.c.height;
      if (fb === 'dead' || (fb === 'flicker' && Math.random() < 0.35)) this.drawStatic(bg, BW, BH, fb === 'dead');
      else {
        bg.fillStyle = '#080808'; bg.fillRect(0, 0, BW, BH);
        const cols = [['SCHILD', p.shield / p.maxShield], ['NB', P.energy]];
        cols.forEach(([label, k], ci) => {
          const x = 30 + ci * 112, n = 12;
          for (let i = 0; i < n; i++) {
            const lit = i < Math.round(k * n);
            const colr = i >= 9 ? [255, 70, 60] : i >= 6 ? [255, 190, 60] : [70, 255, 120];
            const blink = ci === 1 && P.boostLock && Math.sin(t * 12) < 0;
            bg.fillStyle = lit && !blink ? `rgb(${colr})` : `rgba(${colr},.1)`;
            if (lit) { bg.shadowColor = `rgb(${colr})`; bg.shadowBlur = 8; }
            bg.fillRect(x, 168 - i * 13.5, 80, 10); bg.shadowBlur = 0;
          }
          dymo(bg, label, x, 186, 26);
        });
      }
      B.tex.needsUpdate = true;
    }
    // guarded toggles flip with the systems they control; the covers swing open when armed
    const st = { NB: P.boosting, AUTO: !!game.autoAvailable?.(), WAFFE: !!P.ctrl.firing || !!P.aimLocked, ECM: !!P.missileWarn };
    for (const T of this.toggles) {
      const on = st[T.key];
      T.lever.rotation.x += ((on ? 0.55 : -0.55) - T.lever.rotation.x) * Math.min(1, dt * 18);
      T.hinge.rotation.x += ((on ? -1.6 : 0) - T.hinge.rotation.x) * Math.min(1, dt * 10);
      T.led.emissive.setRGB(on ? 2.4 : 0.05, on ? 0.15 : 0, 0);
    }
    for (const K of this.keys) { const lit = Math.sin(t * 0.7 + K.phase) > 0.96; K.mat.emissive.setRGB(lit ? 0.8 : 0.02, lit ? 0.7 : 0.02, lit ? 0.4 : 0.02); }
  }

  /** hull hit: the worse the damage, the likelier a panel drops out (and sparks), heavy hits crack the canopy */
  hit(dmg, hk) {
    if (hk < 0.45 && this.cracks < 4 && Math.random() < 0.18 + dmg * 0.01) { addCrack(this.crack); this.crackTex.needsUpdate = true; this.cracks++; }
    if (hk > 0.72 || Math.random() > Math.min(0.65, (0.75 - hk) * 0.9 + dmg * 0.01)) return null;
    const keys = Object.keys(this.elems).filter((k) => this.fail[k] !== 'dead');
    if (!keys.length) return null;
    const k = keys[(Math.random() * keys.length) | 0];
    this.fail[k] = this.fail[k] ? 'dead' : hk > 0.35 || Math.random() < 0.5 ? 'flicker' : 'dead';
    this.sparkAt(k, 18);
    const name = { mfd0: 'SCHIFFSDISPLAY', mfd1: 'RADAR', mfd2: 'ZIELDISPLAY', log0: 'LOG-SCHIRM', log1: 'KOM-SCHIRM', annun: 'WARNTAFEL', seg: 'NAV-RECHNER', bar: 'ENERGIEANZEIGE' }[k] || 'SCHALTKREIS';
    this.log(`STÖRUNG · ${name}${this.fail[k] === 'dead' ? ' AUSGEFALLEN' : ''}`, '#ff4d6d');
    return k;
  }

  /** repaired / fresh ship */
  repair() {
    this.fail = {}; this.cracks = 0;
    this.crack.getContext('2d').clearRect(0, 0, this.crack.width, this.crack.height); this.crackTex.needsUpdate = true;
  }

  sparkAt(key, n) {
    const el = this.elems[key];
    if (!el) return;
    el.getWorldPosition(v);
    for (const sp of this.sparks) {
      if (sp.life > 0) continue;
      sp.p.copy(v).add(v2.set(rnd(-0.03, 0.03), rnd(-0.02, 0.02), 0.01));
      sp.v.set(rnd(-0.25, 0.25), rnd(-0.05, 0.3), rnd(0.05, 0.35));
      sp.life = rnd(0.25, 0.7);
      if (--n <= 0) break;
    }
  }

  updateSparks(dt) {
    const a = this.sparkGeo.attributes.position;
    this.sparks.forEach((sp, i) => {
      if (sp.life > 0) { sp.life -= dt; sp.p.addScaledVector(sp.v, dt); sp.v.y -= dt * 0.25; sp.v.multiplyScalar(1 - dt * 1.5); }
      if (sp.life > 0) a.setXYZ(i, sp.p.x, sp.p.y, sp.p.z); else a.setXYZ(i, 0, -50, 0);
    });
    a.needsUpdate = true;
    this.sparkMat.opacity = 0.7 + Math.random() * 0.3;
  }

  /** picture lost: snow, rolling bars and an intermittent message */
  drawStatic(g, W, H, dead) {
    g.fillStyle = dead ? '#020403' : '#06100b'; g.fillRect(0, 0, W, H);
    const n = dead ? 260 : 900;
    for (let i = 0; i < n; i++) { const c = (Math.random() * (dead ? 70 : 190)) | 0; g.fillStyle = `rgb(${c},${c + 10},${c})`; g.fillRect(Math.random() * W, Math.random() * H, rnd(1, 4), rnd(1, 2)); }
    const by = (performance.now() / 4) % H;
    g.fillStyle = 'rgba(160,255,200,.08)'; g.fillRect(0, by, W, H * 0.12);
    if (Math.sin(performance.now() / 260) > -0.3) {
      g.font = `700 ${Math.round(W / 14)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = dead ? 'rgba(255,77,109,.85)' : 'rgba(255,200,87,.85)';
      g.fillText(dead ? 'SIGNAL VERLOREN' : 'STÖRUNG', W / 2, H / 2);
      g.textAlign = 'left'; g.textBaseline = 'top';
    }
  }

  /** a flickering display: horizontal tearing and colour loss */
  tear(g, W, H) {
    for (let i = 0; i < 3; i++) {
      const y = rnd(0, H), h = rnd(4, 22), dx = rnd(-30, 30);
      g.drawImage(g.canvas, 0, y, W, h, dx, y, W, h);
    }
    g.fillStyle = `rgba(0,0,0,${rnd(0, 0.45)})`; g.fillRect(0, 0, W, H);
  }

  drawAnnunciator(t, fail) {
    const { g, c, tex } = this.annun, W = c.width, H = c.height;
    g.fillStyle = '#0b0c0e'; g.fillRect(0, 0, W, H);
    const cols = 5, cw = W / cols, ch = H / 2;
    LAMPS.forEach(([label, key], i) => {
      const s = this.lampState[key] || 'off';
      const base = s.replace(/!/g, '');
      const rate = s.endsWith('!!') ? 12 : s.endsWith('!') ? 4.5 : 0;
      let on = base !== 'off' && (!rate || Math.sin(t * rate) > -0.2);
      if (fail === 'dead') on = Math.random() < 0.02;
      else if (fail === 'flicker' && Math.random() < 0.3) on = !on;
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
      const f = this.fail[B.bank];
      if (f === 'dead') { Math.random() < 0.01 ? col(m, 2, 1.4, 0.6) : col(m, 0, 0, 0); continue; }
      if (f === 'flicker' && Math.random() < 0.4) { col(m, 0, 0, 0); continue; }
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
    const ol = shipOutline(p.type), D = H * 0.74, ok = D / ol.N;
    const toS = (x, z) => { const [u, w] = ol.map(x, z); return [cx + (u - ol.N / 2) * ok, cy + (w - ol.N / 2) * ok]; };
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
    g.drawImage(ol.tint(hk > 0.65 ? G : hk > 0.3 ? A : R), cx - D / 2, cy - D / 2, D, D);
    // damage: the hull outline flickers red where it is weakest
    if (hk < 0.3 && Math.sin(now / 120) > 0) { g.globalAlpha = 0.5; g.drawImage(ol.tint('#ffffff'), cx - D / 2, cy - D / 2, D, D); g.globalAlpha = 1; }
    // engine glow
    const eg = Math.min(1, p.speed / def.boost);
    g.fillStyle = P.boosting ? '#7fd6ff' : `rgba(127,214,255,${0.3 + eg * 0.5})`;
    g.fillRect(cx - 6, cy + ol.halfL * ok + 2, 12, 4 + eg * 10);
    // guns: hardpoints flash when firing
    const firing = (p.cool ?? 0) > def.rof * 0.5;
    for (const [x, , z] of def.guns) { const [X, Y] = toS(x, z); g.fillStyle = firing ? '#ffffff' : G; g.fillRect(X - 3, Y - 6, 6, 10); }
    // missile pylons
    const maxM = def.missiles || 0;
    for (let i = 0; i < maxM; i++) {
      const side = i % 2 ? 1 : -1, row = Math.floor(i / 2);
      const X = cx + side * ol.halfW * ok * (0.38 + row * 0.1), Y = cy + sc * 0.1 + row * 5;
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

  /**
   * 3D radar scope: an inclined disc around the own ship, contacts stand on height stalks
   * (above / below the flight plane). Friends = green triangles, foes = red diamonds,
   * capital ships larger, mines orange, nav point cyan; the current target is bracketed.
   */
  drawRadar(g, W, H, P, game) {
    const p = P.ship, G = '#6dffb0', R = '#ff4d6d';
    const cx = W / 2, cy = H * 0.58, RX = W * 0.44, RY = RX * 0.42, range = 3000;
    const now = performance.now();
    // disc, range rings, forward cone
    g.fillStyle = 'rgba(30,120,80,.12)'; g.beginPath(); g.ellipse(cx, cy, RX, RY, 0, 0, 6.283); g.fill();
    g.strokeStyle = 'rgba(109,255,176,.55)'; g.lineWidth = 1.5;
    for (const k of [1, 0.66, 0.33]) { g.beginPath(); g.ellipse(cx, cy, RX * k, RY * k, 0, 0, 6.283); g.stroke(); }
    g.strokeStyle = 'rgba(109,255,176,.3)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx - RX, cy); g.lineTo(cx + RX, cy); g.moveTo(cx, cy - RY); g.lineTo(cx, cy + RY);
    g.moveTo(cx, cy); g.lineTo(cx - RX * 0.7, cy - RY * 0.7); g.moveTo(cx, cy); g.lineTo(cx + RX * 0.7, cy - RY * 0.7); g.stroke();
    const sw = this.radarAng % 6.283;
    for (let i = 0; i < 14; i++) {
      const a0 = sw - i * 0.05;
      g.strokeStyle = `rgba(109,255,176,${0.4 * (1 - i / 14)})`; g.lineWidth = 2;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a0) * RX, cy + Math.sin(a0) * RY); g.stroke();
    }
    // own ship
    g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(cx, cy - 7); g.lineTo(cx + 5, cy + 5); g.lineTo(cx - 5, cy + 5); g.closePath(); g.fill();
    const inv = q.copy(p.quat).invert();
    let friends = 0, foes = 0;
    const contacts = [];
    const add = (pos, kind, o) => {
      v2.copy(pos).sub(p.pos).applyQuaternion(inv);
      const d = v2.length();
      let k = d / range, edge = false;
      if (k > 1) { k = 1; edge = true; }
      const hd = Math.hypot(v2.x, v2.z) || 1;
      const X = cx - (v2.x / hd) * k * RX * (hd / d), Y = cy - (v2.z / hd) * k * RY * (hd / d);
      const hgt = edge ? 0 : (v2.y / range) * RX * 0.7;
      contacts.push({ X, Y, hgt, kind, o, edge, depth: Y });
    };
    for (const o of game.ships) {
      if (!o.alive || o === p) continue;
      const kind = o.team === 1 ? 'foe' : o.team === 3 ? 'neutral' : 'friend';
      if (kind === 'foe') foes++; else if (kind === 'friend') friends++;
      add(o.pos, kind, o);
    }
    for (const mn of game.mines || []) if (mn.alive && mn.pos.distanceTo(p.pos) < range) add(mn.pos, 'mine', null);
    const nav = game.navPos?.();
    if (nav) add(nav, 'nav', null);
    contacts.sort((a, b) => a.depth - b.depth);
    for (const c of contacts) {
      const col = c.kind === 'foe' ? R : c.kind === 'friend' ? G : c.kind === 'mine' ? '#ff9a3a' : c.kind === 'nav' ? '#7fd6ff' : '#9fe8ff';
      const big = c.o?.def?.capital;
      const sz = big ? 7 : c.kind === 'mine' ? 2.5 : 4.5;
      const bx = c.X, by = c.Y - c.hgt;
      if (c.edge) {
        g.fillStyle = col; g.globalAlpha = 0.7;
        g.beginPath(); g.arc(c.X, c.Y, 2.5, 0, 6.283); g.fill(); g.globalAlpha = 1;
        continue;
      }
      // stalk + foot
      g.strokeStyle = col; g.globalAlpha = 0.6; g.lineWidth = 1;
      g.beginPath(); g.moveTo(c.X, c.Y); g.lineTo(bx, by); g.stroke();
      g.beginPath(); g.ellipse(c.X, c.Y, 3, 1.4, 0, 0, 6.283); g.stroke();
      g.globalAlpha = 1; g.fillStyle = col;
      g.beginPath();
      if (c.kind === 'foe') { g.moveTo(bx, by - sz); g.lineTo(bx + sz, by); g.lineTo(bx, by + sz); g.lineTo(bx - sz, by); }
      else if (c.kind === 'friend' || c.kind === 'neutral') { g.moveTo(bx, by - sz); g.lineTo(bx + sz, by + sz * 0.8); g.lineTo(bx - sz, by + sz * 0.8); }
      else if (c.kind === 'nav') { g.rect(bx - 1, by - 6, 2, 12); g.rect(bx - 6, by - 1, 12, 2); }
      else g.arc(bx, by, sz, 0, 6.283);
      g.closePath(); g.fill();
      if (big) { g.strokeStyle = col; g.lineWidth = 1.5; g.strokeRect(bx - sz - 3, by - sz - 3, (sz + 3) * 2, (sz + 3) * 2); }
      if (c.o && c.o === P.target) {
        const r = 10 + Math.sin(now / 120) * 1.5;
        g.strokeStyle = '#ffffff'; g.lineWidth = 1.5; g.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { g.moveTo(bx + sx * r, by + sy * (r - 5)); g.lineTo(bx + sx * r, by + sy * r); g.lineTo(bx + sx * (r - 5), by + sy * r); }
        g.stroke();
        g.font = `700 13px ${FONT}`; g.fillStyle = '#ffffff'; g.fillText(c.o.name.toUpperCase().slice(0, 12), Math.min(W - 70, bx + 12), by - 16);
      }
    }
    g.font = `700 16px ${FONT}`; g.textBaseline = 'top';
    g.fillStyle = G; g.textAlign = 'right'; g.fillText('3 KM', W - 10, 8);
    g.textAlign = 'left';
    g.fillStyle = G; g.fillText(`▲ FREUND ${friends}`, 10, H - 24);
    g.fillStyle = R; g.textAlign = 'right'; g.fillText(`FEIND ${foes} ◆`, W - 10, H - 24);
    g.textAlign = 'left';
  }

  drawMFD(m, P, game) {
    const g = m.g, W = 320, H = 240, p = P.ship;
    g.fillStyle = '#04110b'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(109,255,176,.07)'; g.lineWidth = 1;
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
      this.drawRadar(g, W, H, P, game);
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
    // soft studio reflections so brushed steel and chrome read as metal
    if (!this.scene.environment) {
      const pm = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      this.envRT = pm.fromScene(room, 0.04);
      room.dispose?.();
      this.scene.environment = this.envRT.texture; this.scene.environmentIntensity = 0.3;
      pm.dispose();
    }
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = true;
  }

  dispose() {
    this.scene.traverse((o) => { if (!o.geometry?.userData.shared) o.geometry?.dispose(); });
    for (const m of [this.metal, this.dark, this.bezel, ...this.decals, this.rubber, this.chrome, this.trim, this.canopyMat, this.cautionMat, this.hudEdge, this.skin, this.nail, this.cuffMat, this.sleeve, this.crackMat, this.sparkMat, this.steel, this.steelDark, this.redCover, ...this.cableMats, this.conduit, ...(this.watchMat ? [this.watchMat] : []), ...this.keys.map((k) => k.mat), ...this.toggles.map((x) => x.led)]) { m.map?.dispose(); m.roughnessMap?.dispose(); m.dispose(); }
    this.envRT?.dispose();
    for (const m of [...this.mfds, ...this.logs, this.annun, this.segPanel, this.barPanel]) { m.tex.dispose(); m.mat.dispose(); }
    for (const b of this.buttons) b.mat.dispose();
  }
}
