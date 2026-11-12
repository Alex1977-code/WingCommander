import * as THREE from 'three';
import { glowTexture } from './fx.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Gameplay stats. team 0 = Union, team 1 = Aszendenz. Forward axis of every model is +Z. */
export const SHIPS = {
  sperber: { name: 'Sperber', team: 0, hp: 90, shield: 90, speed: 210, boost: 430, turn: 1.55, dmg: 13, rof: 0.15, missiles: 4, radius: 8, guns: [[-4.2, -0.3, 5], [4.2, -0.3, 5]] },
  falke: { name: 'Falke', team: 0, hp: 130, shield: 120, speed: 225, boost: 450, turn: 1.5, dmg: 16, rof: 0.14, missiles: 6, radius: 9, guns: [[-5, -0.3, 5], [5, -0.3, 5], [0, -1, 8]] },
  greif: { name: 'Greif', team: 0, hp: 190, shield: 170, speed: 215, boost: 440, turn: 1.4, dmg: 19, rof: 0.13, missiles: 10, radius: 10, guns: [[-6, -0.3, 5], [6, -0.3, 5], [-2, -1, 8], [2, -1, 8]] },
  dorn: { name: 'Dorn', team: 1, hp: 34, shield: 24, speed: 190, turn: 1.25, dmg: 6, rof: 0.4, radius: 8, skill: 0.35, score: 100, guns: [[0, -0.5, 6]] },
  klinge: { name: 'Klinge', team: 1, hp: 62, shield: 52, speed: 215, turn: 1.5, dmg: 8, rof: 0.3, radius: 9, skill: 0.6, score: 220, missiles: 1, guns: [[-4, 0, 6], [4, 0, 6]] },
  hammer: { name: 'Hammer', team: 1, hp: 120, shield: 70, speed: 150, turn: 0.9, dmg: 9, rof: 0.5, radius: 11, skill: 0.4, score: 260, bomber: true, guns: [[-3, 0, 7], [3, 0, 7]] },
  archon: { name: 'Archon Veyl', team: 1, hp: 170, shield: 140, speed: 238, turn: 1.85, dmg: 10, rof: 0.22, radius: 9, skill: 0.9, score: 1500, missiles: 6, ace: true, guns: [[-4, 0, 6], [4, 0, 6]] },
  holt: { name: 'Holt', team: 1, hp: 150, shield: 120, speed: 232, turn: 1.75, dmg: 9, rof: 0.24, radius: 9, skill: 0.85, score: 1200, missiles: 4, guns: [[-4, 0, 6], [4, 0, 6]] },
  kurier: { name: 'Kurierschiff', team: 1, hp: 260, shield: 140, speed: 150, turn: 0.8, dmg: 0, rof: 99, radius: 11, skill: 0.2, score: 800, guns: [] },
  station: { name: 'Brutstätte', team: 1, capital: true, hp: 3000, speed: 0, radius: 200, box: [46, 46, 46], torus: [150, 17], dmg: 8, score: 3000, turrets: [[0, 50, 0], [0, -50, 0], [50, 0, 0], [-50, 0, 0], [0, 0, 50], [0, 0, -50], [150, 0, 0], [-150, 0, 0], [0, 150, 0], [0, -150, 0]] },
  gate: { name: 'Sprungtor', team: 3, capital: true, ghost: true, invulnerable: true, hp: 1e9, speed: 0, radius: 340, box: [1, 1, 1], turrets: [] },
  prison: { name: 'Ketten', team: 3, capital: true, invulnerable: true, hp: 1e9, speed: 22, radius: 55, box: [15, 13, 48], turrets: [] },
  valkyrie: { name: 'TUS Valkyrie', team: 3, capital: true, invulnerable: true, wreck: true, hp: 1e9, speed: 0, radius: 215, box: [34, 30, 205], turrets: [] },
  tanker: { name: 'Tanker', team: 0, capital: true, hp: 900, speed: 70, radius: 55, box: [15, 13, 48], dmg: 5, turrets: [[0, 14, 0]] },
  habitat: { name: 'Habitat Keth IV', team: 0, capital: true, hp: 3600, speed: 0, radius: 200, box: [46, 46, 46], torus: [150, 17], dmg: 6, turrets: [[0, 50, 0], [0, -50, 0], [150, 0, 0], [-150, 0, 0]] },
  relay: { name: 'Relaisstation', team: 1, capital: true, hp: 900, speed: 0, radius: 75, box: [14, 52, 14], dmg: 7, score: 900, turrets: [[0, 44, 12], [0, -30, 12], [12, 0, 0]] },
  aurora: { name: 'TUS Aurora', team: 0, capital: true, hp: 4200, speed: 12, radius: 230, box: [40, 17, 205], dmg: 7, turrets: [[14, 13.6, 90], [-14, 13.6, 90], [14, 16.6, -60], [-14, 16.6, -60], [0, 23.5, -20], [0, -30.2, 60]] },
  transport: { name: 'Samariter', team: 0, capital: true, hp: 1000, speed: 38, radius: 55, box: [15, 13, 48], dmg: 6, turrets: [[0, 14, 0]] },
  zerstoerer: { name: 'Zerstörer', team: 1, capital: true, hp: 2100, speed: 18, radius: 135, box: [24, 20, 125], dmg: 8, score: 2000, turrets: [[20, 14, 70], [-20, 14, 70], [0, 22, -20], [0, -18, 20], [0, 18, -90]] },
  dreadnought: { name: 'Apotheose', team: 1, capital: true, hp: 5200, speed: 9, radius: 260, box: [50, 40, 245], dmg: 9, score: 5000, turrets: [[44, 20, 150], [-44, 20, 150], [44, 20, 0], [-44, 20, 0], [0, 44, 60], [0, -40, 60], [0, 44, -120], [0, -40, -120]] },
};

let TEX = null;
function canvasTex(size, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
/**
 * Battle and service wear painted over a hull texture: paint chipped down to bare metal along edges,
 * grime streaks running from seams and rivets, soot and scorch marks, replacement plates in a different
 * tone, scratches, oil stains. rough = the matching roughness map (worn = rougher, bare metal = smoother).
 */
function weather(g, s, rough, k = 1) {
  const rnd = (a, b) => a + Math.random() * (b - a);
  // replacement plates: a slightly different tone, fresh rivets
  for (let i = 0; i < 6 * k; i++) {
    const x = rnd(0, s), y = rnd(0, s), w = rnd(30, 90), h = rnd(20, 60);
    const v = Math.random() < 0.5 ? 'rgba(120,128,138,.35)' : 'rgba(205,200,185,.3)';
    g.fillStyle = v; g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(20,20,22,.6)'; g.lineWidth = 1.5; g.strokeRect(x, y, w, h);
    g.fillStyle = 'rgba(255,255,255,.4)'; for (let r = 4; r < w - 3; r += 7) { g.fillRect(x + r, y + 3, 1.5, 1.5); g.fillRect(x + r, y + h - 4, 1.5, 1.5); }
    rough.fillStyle = 'rgba(90,90,90,.6)'; rough.fillRect(x, y, w, h);
  }
  // grime streaks running down from seams and rivets
  for (let i = 0; i < 160 * k; i++) {
    const x = rnd(0, s), y = rnd(0, s), len = rnd(10, 70), w = rnd(1, 4);
    const gr = g.createLinearGradient(x, y, x, y + len);
    gr.addColorStop(0, `rgba(35,30,25,${rnd(0.15, 0.4)})`); gr.addColorStop(1, 'rgba(35,30,25,0)');
    g.fillStyle = gr; g.fillRect(x, y, w, len);
    rough.fillStyle = 'rgba(255,255,255,.12)'; rough.fillRect(x, y, w, len);
  }
  // soot and scorch marks (hits, exhaust wash)
  for (let i = 0; i < 9 * k; i++) {
    const x = rnd(0, s), y = rnd(0, s), r = rnd(14, 55);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(10,8,6,.75)'); gr.addColorStop(0.45, 'rgba(45,30,18,.45)'); gr.addColorStop(1, 'rgba(60,40,20,0)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r, r * rnd(0.5, 1), rnd(0, 3), 0, 6.283); g.fill();
    rough.fillStyle = 'rgba(255,255,255,.35)'; rough.beginPath(); rough.arc(x, y, r * 0.6, 0, 6.283); rough.fill();
  }
  // oil / coolant stains
  for (let i = 0; i < 12 * k; i++) {
    const x = rnd(0, s), y = rnd(0, s), r = rnd(6, 20);
    g.fillStyle = `rgba(30,24,40,${rnd(0.12, 0.3)})`; g.beginPath(); g.ellipse(x, y, r, r * 0.6, rnd(0, 3), 0, 6.283); g.fill();
  }
  // chipped paint: bright bare-metal flecks, clustered along plate edges
  for (let i = 0; i < 520 * k; i++) {
    const edge = Math.random() < 0.6;
    const x = rnd(0, s), y = edge ? Math.round(rnd(0, 8)) * (s / 8) + rnd(-4, 5) : rnd(0, s);
    const w = rnd(1, 6), h = rnd(1, 3.5);
    g.fillStyle = `rgba(225,228,232,${rnd(0.35, 0.85)})`; g.beginPath(); g.ellipse(x, y, w, h, rnd(0, 3), 0, 6.283); g.fill();
    rough.fillStyle = 'rgba(40,40,40,.8)'; rough.fillRect(x - w / 2, y - h / 2, w, h);
  }
  // scratches and scrapes
  for (let i = 0; i < 90 * k; i++) {
    const x = rnd(0, s), y = rnd(0, s), a = rnd(-0.6, 0.6), l = rnd(8, 60);
    g.strokeStyle = `rgba(235,235,235,${rnd(0.15, 0.45)})`; g.lineWidth = rnd(0.5, 1.4);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
}

function textures() {
  if (TEX) return TEX;
  const panelRough = document.createElement('canvas'); panelRough.width = panelRough.height = 512;
  { const r = panelRough.getContext('2d'); r.fillStyle = '#9a9a9a'; r.fillRect(0, 0, 512, 512); }
  const panel = canvasTex(512, (g, s) => {
    g.fillStyle = '#b4b4b4'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 150; i++) {
      const w = 16 + Math.random() * 90, h = 10 + Math.random() * 60;
      const v = 150 + Math.random() * 90 | 0;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(Math.random() * s, Math.random() * s, w, h);
    }
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1.5;
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * s | 0, y = Math.random() * s | 0;
      g.strokeRect(x, y, 20 + Math.random() * 110, 14 + Math.random() * 70);
    }
    g.fillStyle = 'rgba(0,0,0,.5)';
    for (let i = 0; i < 300; i++) g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    weather(g, s, panelRough.getContext('2d'), 1.2);
  });
  const windows = canvasTex(512, (g, s) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, s, s);
    for (let row = 0; row < 12; row++) {
      if (Math.random() < 0.35) continue;
      const y = 20 + row * 40 + Math.random() * 8;
      for (let x = 8; x < s - 8; x += 9) {
        if (Math.random() < 0.55) { g.fillStyle = Math.random() < 0.85 ? '#fff' : '#888'; g.fillRect(x, y, 4, 3); }
      }
    }
  });
  // fighter plating: rows of plates with dark seams, rivet lines, access hatches and grime; bump map from the seams
  const PLATE = 512, seed = [];
  for (let i = 0; i < 40; i++) seed.push([Math.random(), Math.random(), Math.random()]);
  const plates = (g, s, bump) => {
    g.fillStyle = bump ? '#808080' : '#bcbcbc'; g.fillRect(0, 0, s, s);
    const rows = 8;
    for (let r = 0; r < rows; r++) {
      let x = 0;
      const y = (r * s) / rows, h = s / rows;
      while (x < s) {
        const w = 40 + seed[(r * 7 + (x | 0)) % 40][0] * 110;
        const v = bump ? 128 + (seed[(r + (x | 0)) % 40][1] - 0.5) * 30 : 165 + seed[(r * 3 + (x | 0)) % 40][1] * 70;
        g.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`; g.fillRect(x + 1, y + 1, w - 2, h - 2);
        // seams
        g.fillStyle = bump ? '#202020' : 'rgba(20,22,26,.75)'; g.fillRect(x, y, 2, h); g.fillRect(x, y, w, 2);
        // rivet lines along the seams
        g.fillStyle = bump ? '#d0d0d0' : 'rgba(255,255,255,.35)';
        for (let k = 6; k < w - 4; k += 9) g.fillRect(x + k, y + 5, 2, 2);
        // occasional access hatch with a latch
        if (seed[(r * 5 + (x | 0)) % 40][2] > 0.72) {
          const hx = x + w * 0.25, hy = y + h * 0.3, hw = w * 0.45, hh = h * 0.45;
          g.strokeStyle = bump ? '#303030' : 'rgba(15,15,18,.7)'; g.lineWidth = 1.5; g.strokeRect(hx, hy, hw, hh);
          g.fillStyle = bump ? '#e0e0e0' : 'rgba(230,200,60,.55)'; g.fillRect(hx + hw - 6, hy + hh / 2 - 2, 4, 4);
        }
        x += w;
      }
    }
    if (!bump) {
      for (let i = 0; i < 40; i++) { const x = Math.random() * s, y = Math.random() * s, r = 10 + Math.random() * 40; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(40,35,30,.25)'); gr.addColorStop(1, 'rgba(40,35,30,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
      for (let i = 0; i < 120; i++) { g.strokeStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.15})`; g.lineWidth = 0.7; const x = Math.random() * s, y = Math.random() * s; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 8); g.stroke(); }
    }
  };
  const plateRoughC = document.createElement('canvas'); plateRoughC.width = plateRoughC.height = PLATE;
  const prg = plateRoughC.getContext('2d'); prg.fillStyle = '#8c8c8c'; prg.fillRect(0, 0, PLATE, PLATE);
  const plate = canvasTex(PLATE, (g, s) => { plates(g, s, false); weather(g, s, prg, 1.5); });
  const plateRough = new THREE.CanvasTexture(plateRoughC); plateRough.wrapS = plateRough.wrapT = THREE.RepeatWrapping; plateRough.repeat.set(2, 2);
  const panelRoughT = new THREE.CanvasTexture(panelRough); panelRoughT.wrapS = panelRoughT.wrapT = THREE.RepeatWrapping;
  const plateBump = canvasTex(PLATE, (g, s) => plates(g, s, true), false);
  for (const t of [plate, plateBump]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2); }
  // squadron codes / alien glyphs for the hull sides
  const decalTex = (draw) => { const c = document.createElement('canvas'); c.width = 256; c.height = 64; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const codeUnion = decalTex((g) => {
    g.fillStyle = 'rgba(200,88,26,.95)'; g.fillRect(0, 22, 18, 20); g.fillRect(22, 22, 8, 20);
    g.font = '700 44px Rajdhani, sans-serif'; g.textBaseline = 'middle'; g.fillStyle = 'rgba(235,238,240,.95)'; g.fillText('NF·07', 40, 34);
    // faded and chipped stencil
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 260; i++) { g.globalAlpha = Math.random() * 0.9; g.fillRect(Math.random() * 256, Math.random() * 64, 1 + Math.random() * 5, 1 + Math.random() * 3); }
    g.globalAlpha = 0.35; g.fillRect(0, 0, 256, 64);
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  });
  const glyphAsz = decalTex((g) => {
    g.strokeStyle = 'rgba(255,90,200,1)'; g.lineWidth = 4; g.lineCap = 'round';
    for (let i = 0; i < 6; i++) { const x = 20 + i * 38; g.beginPath(); g.moveTo(x, 12); g.lineTo(x + 14, 32); g.lineTo(x, 52); if (i % 2) { g.moveTo(x + 22, 14); g.lineTo(x + 22, 50); } g.stroke(); }
  });
  TEX = { panel, windows, plate, plateBump, plateRough, panelRough: panelRoughT, codeUnion, glyphAsz };
  return TEX;
}

function mk(parent, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function wingGeo(span, root, tip, sweep, thick = 0.4) {
  const g = new THREE.BoxGeometry(span, thick, root, 4, 1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + span / 2, t = x / span;
    p.setXYZ(i, x, p.getY(i) * (1 - 0.65 * t), p.getZ(i) * (1 + (tip / root - 1) * t) - sweep * t);
  }
  g.computeVertexNormals();
  return g;
}
function fuselageGeo(noseR, bodyR, len, seg = 12) {
  const g = new THREE.CylinderGeometry(noseR, bodyR, len, seg, 3);
  g.rotateX(Math.PI / 2);
  return g;
}
/** blackened, burnt metal round nozzles and gun muzzles */
const SOOT = new THREE.MeshStandardMaterial({ color: 0x17130f, roughness: 0.95, metalness: 0.3 });
function engine(group, engines, x, y, z, r, glowMat, darkMat, color) {
  const sootBand = new THREE.CylinderGeometry(r * 1.06, r * 1.0, r * 0.7, 14, 1, true); sootBand.rotateX(Math.PI / 2);
  mk(group, sootBand, SOOT, x, y, z - r * 0.75);
  const n = new THREE.CylinderGeometry(r, r * 0.8, r * 2.2, 12, 1, true);
  n.rotateX(Math.PI / 2);
  mk(group, n, darkMat, x, y, z);
  const disc = new THREE.CircleGeometry(r * 0.85, 12);
  disc.rotateY(Math.PI);
  mk(group, disc, glowMat, x, y, z - r * 0.9);
  // nozzle lip and inner vanes
  mk(group, new THREE.TorusGeometry(r * 1.0, r * 0.09, 6, 18), darkMat, x, y, z - r * 1.1);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2, vane = mk(group, new THREE.BoxGeometry(r * 0.08, r * 0.55, r * 0.9), darkMat, x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, z - r * 0.5);
    vane.rotation.z = a + Math.PI / 2;
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: color.clone().multiplyScalar(0.45), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.position.set(x, y, z - r * 1.3);
  s.scale.setScalar(r * 4);
  s.userData.base = r * 4;
  s.userData.engine = true;
  group.add(s);
  engines.push(s);
}

const PAL = {
  union: { hull: 0x98a2ae, dark: 0x2c333d, accent: 0xff6a12, glow: new THREE.Color(0.5, 1.6, 4), canopy: 0x0a1626 },
  asz: { hull: 0x2d2438, dark: 0x120f18, accent: 0x6a1038, glow: new THREE.Color(4, 0.35, 1.3), canopy: 0x30040f },
  ace: { hull: 0x4a3a16, dark: 0x16110a, accent: 0xb07a12, glow: new THREE.Color(4, 1.6, 0.3), canopy: 0x30040f },
};
function mats(p) {
  const t = textures();
  return {
    hull: new THREE.MeshStandardMaterial({ color: p.hull, map: t.plate, bumpMap: t.plateBump, bumpScale: 1.4, roughnessMap: t.plateRough, metalness: 0.68, roughness: 0.62 }),
    decal: new THREE.MeshStandardMaterial({ map: p === PAL.union ? t.codeUnion : t.glyphAsz, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 0.6, metalness: 0.2, emissive: p === PAL.union ? 0x000000 : 0xffffff, emissiveMap: p === PAL.union ? null : t.glyphAsz, emissiveIntensity: 0.8 }),
    dark: new THREE.MeshStandardMaterial({ color: p.dark, map: t.plate, roughnessMap: t.plateRough, metalness: 0.75, roughness: 0.68 }),
    accent: new THREE.MeshStandardMaterial({ color: p.accent, metalness: 0.5, roughness: 0.4 }),
    canopy: new THREE.MeshStandardMaterial({ color: p.canopy, metalness: 1, roughness: 0.05 }),
    glow: new THREE.MeshBasicMaterial({ color: p.glow }),
    line: new THREE.MeshBasicMaterial({ color: p.glow.clone().multiplyScalar(0.6) }),
  };
}

function fighter(o) {
  const root = new THREE.Group();
  const g = new THREE.Group();
  root.add(g);
  const m = mats(o.pal);
  const engines = [];
  const L = o.len;

  const hulls = o.twin ? [-o.twin, o.twin] : [0];
  for (const hx of hulls) {
    // stubby armoured forward hull with a blunt sensor nose instead of a jet's needle
    const f = mk(g, fuselageGeo(Math.max(o.noseR, o.bodyR * 0.5), o.bodyR, L * 0.5), m.hull, hx, 0, L * 0.13);
    f.scale.set(o.wide, o.flat, 1);
    const capR = Math.max(o.noseR, o.bodyR * 0.5);
    const cap = new THREE.CylinderGeometry(capR * 0.72, capR, L * 0.08, 6); cap.rotateX(Math.PI / 2);
    const nc = mk(g, cap, m.dark, hx, 0, L * 0.42); nc.scale.set(o.wide, o.flat, 1);
    const ring = new THREE.TorusGeometry(capR * 0.8, 0.07, 6, 6);
    mk(g, ring, m.line, hx, 0, L * 0.462).scale.set(o.wide, o.flat, 1);
    const tipG = new THREE.CylinderGeometry(0.12, 0.2, L * 0.05, 8); tipG.rotateX(Math.PI / 2);
    mk(g, tipG, m.dark, hx, 0, L * 0.485);
    // chin sensor / intake block and side armour cheeks
    mk(g, new THREE.BoxGeometry(o.bodyR * o.wide * 1.05, o.bodyR * o.flat * 0.4, L * 0.24), m.dark, hx, -o.bodyR * o.flat * 0.75, L * 0.16);
    for (const sx of [-1, 1]) {
      const ch = mk(g, new THREE.BoxGeometry(0.25, o.bodyR * o.flat * 0.8, L * 0.2), m.hull, hx + sx * o.bodyR * o.wide * 0.92, 0, L * 0.2);
      ch.rotation.y = sx * 0.12;
    }
    const r = mk(g, fuselageGeo(o.bodyR, o.bodyR * 0.78, L * 0.38), m.hull, hx, 0, -L * 0.31);
    r.scale.set(o.wide, o.flat, 1);
    const c = mk(g, new THREE.IcosahedronGeometry(1, 1), m.canopy, hx, o.bodyR * o.flat * 0.6, L * 0.12);
    c.scale.set(o.bodyR * 0.46, o.bodyR * 0.42, L * 0.13);
    mk(g, new THREE.BoxGeometry(o.bodyR * 0.95, 0.12, 0.12), m.dark, hx, o.bodyR * o.flat * 0.95, L * 0.12);
  }
  if (o.twin) mk(g, new THREE.BoxGeometry(o.twin * 2, o.bodyR * 0.7, L * 0.35), m.dark, 0, 0, -L * 0.1);

  // wings
  o = { ...o, span: o.span * 0.74, tip: o.tip * 1.5, sweep: o.sweep * 0.8 };
  const wg = wingGeo(o.span, o.root, o.tip, o.sweep, 0.95);
  const wx = (o.twin || 0) + o.bodyR * o.wide * 0.6;
  for (const sgn of [1, -1]) {
    const w = mk(g, wg, m.hull, sgn * wx, o.wingY || 0, o.wingZ);
    w.scale.x = sgn;
    w.rotation.z = sgn * (o.dihedral || 0);
    // accent stripe + gun pod at tip
    const tipX = sgn * (wx + o.span * Math.cos(o.dihedral || 0));
    const tipY = (o.wingY || 0) + o.span * Math.sin(o.dihedral || 0);
    const pod = new THREE.CylinderGeometry(0.32, 0.4, o.root * 0.9, 8);
    pod.rotateX(Math.PI / 2);
    mk(g, pod, m.dark, tipX, tipY, o.wingZ - o.sweep + o.root * 0.2);
    // muzzle at the front of the wing-tip pod: wing guns in SHIPS are snapped here in buildShip()
    (g.userData.pods ||= []).push([tipX, tipY, o.wingZ - o.sweep + o.root * 0.65]);
    const st = mk(g, new THREE.BoxGeometry(o.span * 0.5, 0.06, o.root * 0.16), o.pal === PAL.union ? m.accent : m.line,
      sgn * (wx + o.span * 0.45), (o.wingY || 0) + 0.2 + o.span * 0.45 * Math.sin(o.dihedral || 0), o.wingZ - o.sweep * 0.45);
    st.rotation.z = sgn * (o.dihedral || 0);
  }
  // fins
  const fg = wingGeo(o.fin, o.root * 0.6, o.root * 0.25, o.root * 0.5, 0.3);
  for (const a of o.fins) {
    const f = mk(g, fg, m.hull, 0, 0, -L * 0.36);
    f.rotation.z = a;
    f.position.x = Math.cos(a) * o.bodyR * 0.5 + (o.twin ? Math.sign(Math.cos(a)) * o.twin : 0);
    f.position.y = Math.sin(a) * o.bodyR * o.flat * 0.5;
  }
  // engines
  for (const [ex, ey] of o.engines) engine(g, engines, ex, ey, -L * 0.5, o.engR, m.glow, m.dark, o.pal.glow);

  // --- spacecraft hardware: engine block, nacelles, armour, sensors, thrusters, radiators ---
  const union = o.pal === PAL.union;
  const bw = (o.twin ? o.twin * 2 : 0) + o.bodyR * o.wide * 2.3, bh = o.bodyR * o.flat * 1.7;
  mk(g, new THREE.BoxGeometry(bw, bh, L * 0.3), m.dark, 0, 0, -L * 0.33);
  mk(g, new THREE.BoxGeometry(bw * 1.08, bh * 0.25, L * 0.06), m.hull, 0, bh * 0.45, -L * 0.22);
  for (let i = 0; i < 5; i++) mk(g, new THREE.BoxGeometry(bw * 0.18, bh * 0.15, L * 0.05), m.hull, (i - 2) * bw * 0.2, -bh * 0.55, -L * 0.3 - (i % 2) * L * 0.05);
  // dorsal armour plates behind the canopy
  for (let i = 0; i < 3; i++) {
    const pl = mk(g, new THREE.BoxGeometry(o.bodyR * o.wide * (1.3 - i * 0.18), 0.22, L * 0.09), i % 2 ? m.dark : m.hull, 0, o.bodyR * o.flat * 0.95 - i * 0.05, -L * 0.02 - i * L * 0.09);
    pl.rotation.x = -0.08;
  }
  // sensor mast and dish
  mk(g, new THREE.CylinderGeometry(0.06, 0.08, 1.6, 6), m.dark, o.bodyR * 0.4, o.bodyR * o.flat + 0.9, -L * 0.26);
  mk(g, new THREE.SphereGeometry(0.22, 8, 6), union ? m.accent : m.line, o.bodyR * 0.4, o.bodyR * o.flat + 1.7, -L * 0.26);
  // RCS thruster blocks at the wing tips
  for (const sgn of [1, -1]) {
    const tipX = sgn * (wx + o.span * Math.cos(o.dihedral || 0));
    const tipY = (o.wingY || 0) + o.span * Math.sin(o.dihedral || 0);
    mk(g, new THREE.BoxGeometry(0.7, 0.5, 0.9), m.dark, tipX + sgn * 0.2, tipY, o.wingZ - o.sweep - o.root * 0.25);
    mk(g, new THREE.BoxGeometry(0.12, 0.16, 0.16), m.glow, tipX + sgn * 0.58, tipY, o.wingZ - o.sweep - o.root * 0.25);
  }
  if (union) {
    // twin engine nacelles under the wing roots
    for (const sgn of [1, -1]) {
      const nx = sgn * (wx + o.span * 0.32), ny = -o.bodyR * o.flat * 0.35, nz = -L * 0.2;
      const nac = new THREE.CylinderGeometry(o.engR * 1.15, o.engR * 1.3, L * 0.42, 10);
      nac.rotateX(Math.PI / 2);
      mk(g, nac, m.hull, nx, ny, nz);
      const ring = new THREE.TorusGeometry(o.engR * 1.15, 0.12, 6, 14);
      mk(g, ring, m.dark, nx, ny, nz + L * 0.21);
      mk(g, new THREE.BoxGeometry(0.06, o.engR * 0.9, L * 0.3), m.accent, nx + sgn * o.engR * 1.25, ny, nz);
      engine(g, engines, nx, ny, nz - L * 0.21 - o.engR * 0.6, o.engR * 0.9, m.glow, m.dark, o.pal.glow);
    }
    // radiator panels on the flanks with a glowing coolant strip
    for (const sgn of [1, -1]) {
      mk(g, new THREE.BoxGeometry(0.12, bh * 0.7, L * 0.18), m.dark, sgn * bw * 0.52, 0, -L * 0.33);
      mk(g, new THREE.BoxGeometry(0.05, bh * 0.08, L * 0.16), m.line, sgn * bw * 0.555, bh * 0.2, -L * 0.33);
    }
  } else {
    // Aszendenz: chitinous spines and glowing veins
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.ConeGeometry(0.28, 2.2 - i * 0.3, 5);
      const c = mk(g, sp, m.dark, 0, o.bodyR * o.flat * 0.9 + 0.6, L * 0.1 - i * L * 0.12);
      c.rotation.x = -0.6;
    }
    for (const sgn of [1, -1]) {
      mk(g, new THREE.BoxGeometry(0.1, 0.1, L * 0.55), m.line, sgn * o.bodyR * o.wide * 0.85, 0, -L * 0.05);
      const claw = new THREE.ConeGeometry(0.35, 3, 5); claw.rotateX(Math.PI / 2);
      mk(g, claw, m.dark, sgn * o.bodyR * o.wide * 0.7, -o.bodyR * 0.4, L * 0.42);
    }
  }
  // intake / detail
  mk(g, new THREE.BoxGeometry(o.bodyR * o.wide * 1.5, o.bodyR * 0.35, L * 0.2), m.dark, 0, -o.bodyR * o.flat * 0.75, 0);
  if (o.pal !== PAL.union) {
    mk(g, new THREE.BoxGeometry(0.18, 0.18, L * 0.5), m.line, 0, o.bodyR * o.flat * 1.0, -L * 0.2);
  }

  // --- finer detail: gun barrels, canopy frame, vents, antennas, decals, navigation lights ---
  for (const [px, py, pz] of g.userData.pods || []) {
    const bl = new THREE.CylinderGeometry(0.11, 0.13, Math.min(2.6, o.root * 0.35), 8); bl.rotateX(Math.PI / 2);
    mk(g, bl, m.dark, px, py, pz + Math.min(1.3, o.root * 0.17));
    const mz = new THREE.CylinderGeometry(0.19, 0.19, 0.25, 8); mz.rotateX(Math.PI / 2);
    mk(g, mz, SOOT, px, py, pz + Math.min(2.6, o.root * 0.35));
    mk(g, new THREE.BoxGeometry(0.42, 0.08, o.root * 0.45), m.hull, px, py + 0.32, pz);      // cooling fin
  }
  for (const hx of hulls) {
    const cy = o.bodyR * o.flat * 0.6, cz = L * 0.12, rx = o.bodyR * 0.48, ry = o.bodyR * 0.44;
    for (const dz of [-0.055, 0.02, 0.085]) {
      const arch = mk(g, new THREE.TorusGeometry(1, 0.05, 4, 16, Math.PI), m.dark, hx, cy, cz + dz * L * (1 - Math.abs(dz) * 3));
      arch.scale.set(rx * (1 - Math.abs(dz) * 3), ry * (1 - Math.abs(dz) * 3.5), 1);
    }
    mk(g, new THREE.BoxGeometry(0.1, 0.08, L * 0.24), m.dark, hx, cy + ry * 0.98, cz);       // centre strut
    // hull decals on both flanks of the forward fuselage
    for (const sx of [-1, 1]) {
      const d = mk(g, new THREE.PlaneGeometry(L * 0.2, L * 0.05), m.decal, hx + sx * (o.bodyR * o.wide * 0.98 + 0.27), 0.1, L * 0.2);
      d.rotation.y = sx * Math.PI / 2;
    }
  }
  // vents: louvres on both sides of the engine block
  for (const sx of [-1, 1]) for (let i = 0; i < 6; i++) {
    const lv = mk(g, new THREE.BoxGeometry(0.08, bh * 0.08, L * 0.16), m.dark, sx * (bw / 2 + 0.04), bh * 0.3 - i * bh * 0.11, -L * 0.33);
    lv.rotation.z = sx * 0.4;
  }
  // whip antennas
  for (const sx of [-1, 1]) {
    const an = mk(g, new THREE.CylinderGeometry(0.025, 0.04, 2.2, 4), m.dark, sx * bw * 0.32, bh * 0.5 + 1, -L * 0.42);
    an.rotation.x = -0.5;
  }
  // navigation lights: red port (+x), green starboard, white tail strobe
  for (const sgn of [1, -1]) {
    const tipX = sgn * (wx + o.span * Math.cos(o.dihedral || 0) + 0.7);
    const tipY = (o.wingY || 0) + o.span * Math.sin(o.dihedral || 0);
    blinker(g, tipX, tipY, o.wingZ - o.sweep - o.root * 0.1, sgn > 0 ? new THREE.Color(3, 0.25, 0.2) : new THREE.Color(0.2, 3, 0.6), 1.1, sgn > 0 ? 0 : 0.5, 1.8);
  }
  blinker(g, 0, bh * 0.6, -L * 0.5, new THREE.Color(3, 3, 3), 0.8, 0.25, 2.2);
  g.name = 'body';
  root.userData = {};
  return root;
}

function uvBox(w, h, d, scale = 60) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, uv.getX(k) * dims[f][0] / scale, uv.getY(k) * dims[f][1] / scale);
  }
  return g;
}

// ---------------------------------------------------------------------------
// TUS Aurora: a long, streamlined fleet carrier with a swept arrowhead prow, outboard engine
// nacelles on pylons, a recessed flight deck, hundreds of lit windows, hull registry and
// blinking navigation lights (sprites with userData.blink, animated by the game).
// ---------------------------------------------------------------------------
const AURORA_PROFILE = [[-205, 16], [-190, 25], [-150, 29], [-100, 30.5], [-20, 30.5], [40, 29], [90, 25.6], [130, 20], [158, 11], [172, 3]];
function auroraR(z) {
  const P = AURORA_PROFILE;
  if (z <= P[0][0]) return P[0][1];
  for (let i = 1; i < P.length; i++) if (z <= P[i][0]) { const [z0, r0] = P[i - 1], [z1, r1] = P[i]; return r0 + (r1 - r0) * ((z - z0) / (z1 - z0)); }
  return P[P.length - 1][1];
}
const AW = 1.3, AH = 0.62; // hull cross-section: wide and flat
/** launch / landing tunnel of the TUS Aurora in carrier coordinates (centre line, half width/height) */
export const BAY = { y: -23.5, back: 30, mouth: 142, hw: 12, hh: 4.5 };
/** the bay's signal lamps (shared materials, driven by the game during launch) */
export const BAY_LIGHTS = {
  red: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.02, 0.02) }),
  amber: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.15, 0.02) }),
  green: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.02, 0.25, 0.06) }),
  // atmosphere-retaining energy field across the bay mouth (switched off to fly through)
  field: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.7, 1.4), transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  // magnetic hold-down clamps under the parked fighters
  clamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.1, 0.2) }),
};
for (const m of Object.values(BAY_LIGHTS)) m.userData.keep = true;

function blinker(group, x, y, z, color, rate, phase, size = 5) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.position.set(x, y, z); s.scale.setScalar(size);
  s.userData.blink = { rate, phase };
  group.add(s);
}

function registryTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 160;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 1024, 160);
  g.fillStyle = 'rgba(232,236,240,.92)'; g.font = '700 92px Rajdhani, sans-serif'; g.textBaseline = 'middle';
  g.fillText('TUS AURORA', 150, 70);
  g.font = '700 44px Rajdhani, sans-serif'; g.fillStyle = 'rgba(232,120,40,.95)'; g.fillText('CV-07 · TERRANISCHE UNION', 152, 132);
  // union emblem: ring with a stylised star
  g.strokeStyle = 'rgba(232,120,40,.95)'; g.lineWidth = 9; g.beginPath(); g.arc(70, 80, 52, 0, 6.283); g.stroke();
  g.fillStyle = 'rgba(232,236,240,.92)'; g.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 16 : 40; g.lineTo(70 + Math.cos(a) * r, 80 + Math.sin(a) * r); }
  g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function carrier(g, engines, M) {
  const { hull, dark, glow, strip, accent, pal } = M;
  // main hull: smooth lathe profile, flattened into a wide elliptical cross-section
  const prof = AURORA_PROFILE.map(([z, r]) => new THREE.Vector2(r, z));
  prof.unshift(new THREE.Vector2(0.01, -205)); prof.push(new THREE.Vector2(0.01, 172));
  const lathe = new THREE.LatheGeometry(prof, 40);
  lathe.rotateX(Math.PI / 2); lathe.rotateZ(Math.PI / 2);
  // lathe UVs: u around the hull, v along it; stretch so the panel texture keeps its scale
  const uv = lathe.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4, uv.getY(i) * 12);
  const main = mk(g, lathe, hull, 0, 0, 0); main.scale.set(AW, AH, 1);
  // swept arrowhead prow on top of the forward hull
  const sh = new THREE.Shape();
  sh.moveTo(0, 228); sh.lineTo(14, 176); sh.lineTo(27, 118); sh.lineTo(30, 74); sh.lineTo(20, 36); sh.lineTo(-20, 36); sh.lineTo(-30, 74); sh.lineTo(-27, 118); sh.lineTo(-14, 176); sh.closePath();
  const prow = new THREE.ExtrudeGeometry(sh, { depth: 7, bevelEnabled: true, bevelThickness: 3, bevelSize: 3.5, bevelSegments: 3, curveSegments: 4 });
  prow.rotateX(Math.PI / 2);
  const puv = prow.attributes.uv; for (let i = 0; i < puv.count; i++) puv.setXY(i, puv.getX(i) / 60, puv.getY(i) / 60);
  mk(g, prow, hull, 0, 9, 0);
  // registry on the prow top and both flanks, livery band
  const regMat = new THREE.MeshStandardMaterial({ map: registryTexture(), transparent: true, roughness: 0.6, metalness: 0.2, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const top = mk(g, new THREE.PlaneGeometry(56, 9), regMat, 0, 12.6, 120); top.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
  for (const sx of [-1, 1]) {
    const side = mk(g, new THREE.PlaneGeometry(80, 12.5), regMat, sx * (auroraR(10) * AW + 0.4), 2, 10);
    side.rotation.y = sx * Math.PI / 2;
    mk(g, uvBox(1.2, 2.4, 260), accent, sx * (auroraR(-40) * AW - 0.2), -6, -30).rotation.z = sx * 0.1;
  }
  // dorsal spine with sensor fins, low bridge dome with a window band
  mk(g, uvBox(5, 9, 170), dark, 0, 19, -60);
  const fin = mk(g, wingGeo(22, 40, 14, 24, 1.4), dark, 0, 22, -120); fin.rotation.z = Math.PI / 2;
  const dome = mk(g, new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), hull, 0, 17.5, 40); dome.scale.set(15, 7.5, 24);
  const band = mk(g, new THREE.TorusGeometry(1, 0.045, 6, 40), strip, 0, 20.5, 40); band.scale.set(13.6, 21.8, 1); band.rotation.x = Math.PI / 2;
  mk(g, new THREE.CylinderGeometry(0.5, 0.8, 18, 6), dark, 0, 31, 30);
  mk(g, new THREE.CylinderGeometry(0.4, 0.6, 12, 6), dark, 4, 28, 22);
  // flight deck: a ventral hangar module with a real, flyable launch/landing tunnel (see BAY)
  const { y: by, back, mouth, hw, hh } = BAY, len = mouth - back, mid = (mouth + back) / 2;
  const bayGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.15, 1.05, 0.9) });
  mk(g, uvBox(hw * 2 + 10, 2, len), dark, 0, by - hh - 1, mid);          // floor
  mk(g, uvBox(hw * 2 + 10, 2, len), dark, 0, by + hh + 1, mid);          // ceiling
  for (const sx of [-1, 1]) mk(g, uvBox(5, hh * 2 + 4, len), hull, sx * (hw + 2.5), by, mid); // walls
  mk(g, uvBox(hw * 2, hh * 2, 2), dark, 0, by, back);                     // back wall
  mk(g, uvBox(hw * 2 + 10, 8, 56), hull, 0, by + hh + 5, mouth - 28);   // fairing up to the hull
  for (let z = back + 8; z < mouth - 4; z += 10) mk(g, uvBox(7, 0.3, 2.6), bayGlow, 0, by + hh - 0.2, z); // ceiling lamps
  for (let z = back + 6; z < mouth; z += 6) for (const sx of [-1, 1]) mk(g, uvBox(0.8, 0.25, 2.2), strip, sx * 6, by - hh + 0.15, z); // floor guide lights
  const bandMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.15, 0.5, 0.85) });
  for (const sx of [-1, 1]) mk(g, uvBox(0.3, 0.5, len - 4), bandMat, sx * (hw - 0.05), by + 1.5, mid); // wall light bands
  // glowing frame round the mouth and the three-lamp launch signal above it
  mk(g, uvBox(hw * 2, 0.7, 0.7), glow, 0, by + hh - 0.4, mouth); mk(g, uvBox(hw * 2, 0.7, 0.7), glow, 0, by - hh + 0.4, mouth);
  for (const sx of [-1, 1]) mk(g, uvBox(0.7, hh * 2, 0.7), glow, sx * (hw - 0.4), by, mouth);
  [BAY_LIGHTS.red, BAY_LIGHTS.amber, BAY_LIGHTS.green].forEach((m, i) => mk(g, uvBox(2.2, 1.2, 0.6), m, (i - 1) * 3.2, by + hh - 1.6, mouth - 2));
  mk(g, new THREE.PlaneGeometry(hw * 2 - 1, hh * 2 - 1), BAY_LIGHTS.field, 0, by, mouth - 0.5);
  // two parking spots with magnetic clamps (one per pilot)
  for (const z of [back + 16, back + 52]) for (const sx of [-1, 1]) {
    mk(g, uvBox(2.4, 1.2, 5), dark, sx * 2.6, by - hh + 0.6, z);
    mk(g, uvBox(2.0, 0.25, 4.2), BAY_LIGHTS.clamp, sx * 2.6, by - hh + 1.25, z);
  }
  for (let z = back + 4; z < mouth; z += 9) for (const sx of [-1, 1]) mk(g, uvBox(1.4, 0.4, 3), strip, sx * 13, by - hh - 2.1, z); // deck lights underneath
  // outboard engine nacelles on swept pylons
  const nacProf = [[-86, 0.01], [-86, 6], [-80, 9.5], [-40, 10.5], [40, 10.5], [70, 9], [86, 5], [90, 0.01]].map(([z, r]) => new THREE.Vector2(r, z));
  const nac = new THREE.LatheGeometry(nacProf, 24); nac.rotateX(Math.PI / 2);
  for (const sx of [-1, 1]) {
    const nx = sx * 64, ny = -12, nz = -110;
    const n = mk(g, nac, hull, nx, ny, nz); n.scale.set(1, 0.85, 1);
    mk(g, uvBox(1.4, 3, 150), strip, nx - sx * 10.2, ny, nz + 4);            // inner glow strip
    mk(g, uvBox(3, 1.2, 140), dark, nx, ny + 9.2, nz);                        // top rail
    const ring = mk(g, new THREE.TorusGeometry(8.6, 1.3, 8, 28), glow, nx, ny, nz + 84); ring.scale.y = 0.85;
    const pylon = mk(g, wingGeo(32, 52, 26, 30, 3), hull, sx * 30, -5, -92);
    pylon.scale.x = sx; pylon.rotation.z = sx * -0.24;
    engine(g, engines, nx, ny, nz - 90, 7.5, glow, dark, pal.glow);
    // running lights: red port, green starboard on the nacelle tips
    blinker(g, nx + sx * 9, ny, nz + 70, sx < 0 ? new THREE.Color(3, 0.25, 0.2) : new THREE.Color(0.2, 3, 0.6), 0.9, sx < 0 ? 0 : 0.5, 6);
  }
  // main engines in the stern
  mk(g, uvBox(46, 22, 26), dark, 0, 0, -196);
  for (const [ex, ey] of [[-13, 5], [13, 5], [-13, -6], [13, -6]]) engine(g, engines, ex, ey, -212, 7, glow, dark, pal.glow);
  // white strobes on the prow tip, bridge mast and stern
  blinker(g, 0, 11, 230, new THREE.Color(3, 3, 3), 1.1, 0.1, 7);
  blinker(g, 0, 40.5, 30, new THREE.Color(3, 0.3, 0.25), 0.6, 0.3, 6);
  blinker(g, 0, 12, -210, new THREE.Color(3, 3, 3), 1.1, 0.6, 7);
  // lit windows: rows of small quads following the hull surface (one merged geometry)
  const winPos = [], winCol = [], cA = new THREE.Color(2.4, 1.9, 1.15), cB = new THREE.Color(1.2, 1.9, 2.6);
  const rows = [0.5, 0.72, 0.95, 1.18, -0.35, -0.6, 2.2, 2.42, 2.65, 2.85];
  for (const th of rows) for (let z = -176; z < 150; z += 3.4) {
    if (Math.random() < 0.28) continue;
    if (Math.abs(Math.sin(th)) > 0.92 && z > 25 && z < 60) continue; // under the bridge dome
    const r = auroraR(z) + 0.25;
    const cx = Math.cos(th), cy = Math.sin(th);
    const px = cx * r * AW, py = cy * r * AH;
    const nrm = new THREE.Vector3(cx / AW, cy / AH, 0).normalize();
    const tan = new THREE.Vector3(-nrm.y, nrm.x, 0); // around the hull
    const w = 1.1, h = 0.55, c = Math.random() < 0.15 ? cB : cA, dim = 0.55 + Math.random() * 0.45;
    const P0 = new THREE.Vector3(px, py, z);
    const corner = (a, b) => P0.clone().addScaledVector(tan, a * h).add(new THREE.Vector3(0, 0, b * w)).addScaledVector(nrm, 0.15);
    const q = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    for (const i of [0, 1, 2, 0, 2, 3]) { winPos.push(q[i].x, q[i].y, q[i].z); winCol.push(c.r * dim, c.g * dim, c.b * dim); }
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(winPos, 3));
  wg.setAttribute('color', new THREE.Float32BufferAttribute(winCol, 3));
  wg.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(winPos.length).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
  wg.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((winPos.length / 3) * 2).fill(0), 2));
  mk(g, wg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }), 0, 0, 0);
}

function capital(type) {
  const root = new THREE.Group();
  const g = new THREE.Group();
  root.add(g);
  const t = textures();
  const wreck = !!SHIPS[type].wreck;
  const union = SHIPS[type].team === 0 || wreck;
  const pal = union ? PAL.union : PAL.asz;
  const hull = new THREE.MeshStandardMaterial({
    color: union ? 0x8a94a0 : 0x3a2f48, map: t.panel, roughnessMap: t.panelRough, metalness: 0.66, roughness: 0.66,
    emissiveMap: t.windows, emissive: wreck ? new THREE.Color(0.35, 0.18, 0.08) : union ? new THREE.Color(1.8, 1.5, 0.9) : new THREE.Color(2.4, 0.3, 0.8),
  });
  if (wreck) { hull.color.set(0x4a4f57); hull.roughness = 0.85; }
  const dark = new THREE.MeshStandardMaterial({ color: union ? 0x30363f : 0x15111c, map: t.panel, roughnessMap: t.panelRough, metalness: 0.75, roughness: 0.7 });
  const glow = new THREE.MeshBasicMaterial({ color: pal.glow });
  const accent = new THREE.MeshStandardMaterial({ color: pal.accent, metalness: 0.4, roughness: 0.5 });
  const strip = new THREE.MeshBasicMaterial({ color: wreck ? new THREE.Color(0.25, 0.08, 0.04) : union ? new THREE.Color(0.6, 1.8, 3) : new THREE.Color(3, 0.3, 0.9) });
  const engines = [];
  const B = (w, h, d, mat, x, y, z) => mk(g, uvBox(w, h, d), mat, x, y, z);
  const turretGeo = new THREE.SphereGeometry(3.2, 10, 6, 0, 6.3, 0, 1.6);

  if (type === 'aurora') {
    carrier(g, engines, { hull, dark, glow, strip, accent, pal });
  } else if (type === 'valkyrie') {
    B(56, 36, 300, hull, 0, 0, -20);
    const bow = mk(g, uvBox(56, 36, 90), hull, 0, 0, 160); bow.scale.set(0.62, 0.7, 1);
    B(68, 10, 330, dark, 0, -20, -10);          // keel / flight deck
    B(40, 3, 250, strip, 0, -25.6, 0).scale.set(0.02, 0.3, 1); // deck centerline lights
    for (const sx of [-1, 1]) {
      B(8, 14, 210, dark, sx * 34, -8, -10);    // hangar pods
      B(0.8, 6, 150, strip, sx * 38.2, -8, 0);  // hangar glow
      B(10, 10, 120, hull, sx * 30, 14, -90);
      B(60, 2.5, 6, accent, 0, 18.4, 150 * sx * 0 + 110);
    }
    B(22, 26, 40, hull, 0, 30, -70);            // bridge tower
    B(26, 5, 24, dark, 0, 44, -66);
    B(26.4, 1.6, 20, strip, 0, 41, -64);
    B(3, 22, 3, dark, 0, 58, -74);
    B(70, 44, 50, dark, 0, 0, -190);            // engine block
    if (!wreck) for (const [ex, ey] of [[-20, 10], [20, 10], [-20, -10], [20, -10]]) engine(g, engines, ex, ey, -216, 9, glow, dark, pal.glow);
    if (wreck) {
      // torn plating and a broken spine
      g.rotation.z = 0.25;
      for (let i = 0; i < 14; i++) {
        const d = B(6 + Math.random() * 14, 2 + Math.random() * 5, 8 + Math.random() * 30, dark, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 50, (Math.random() - 0.5) * 380);
        d.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      }
      const burn = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.9, 0.2) });
      for (let i = 0; i < 6; i++) B(2, 2, 2, burn, (Math.random() - 0.5) * 50, 18 + Math.random() * 6, (Math.random() - 0.5) * 300);
    }
  } else if (type === 'transport' || type === 'prison' || type === 'tanker') {
    B(22, 20, 70, hull, 0, 0, 5);
    const bow = B(22, 20, 22, hull, 0, 0, 48); bow.scale.set(0.6, 0.6, 1);
    if (type === 'tanker') { for (const sx of [-1, 1]) mk(g, new THREE.CylinderGeometry(7, 7, 52, 14), hull, sx * 9, 11, 2).rotation.x = Math.PI / 2; }
    else B(26, 6, 40, accent, 0, 0, 5);
    for (const sx of [-1, 1]) B(8, 12, 50, dark, sx * 15, 0, -5);
    B(10, 6, 14, dark, 0, 13, 30);
    B(24, 22, 14, dark, 0, 0, -36);
    for (const ex of [-7, 7]) engine(g, engines, ex, 0, -44, 5, glow, dark, pal.glow);
  } else if (type === 'zerstoerer') {
    const spine = B(26, 22, 220, hull, 0, 0, 0);
    const prow = B(26, 22, 70, hull, 0, 0, 110); prow.scale.set(0.25, 0.5, 1); prow.position.z = 128;
    for (const sx of [-1, 1]) {
      const blade = mk(g, wingGeo(46, 120, 30, -50, 5), dark, sx * 12, 0, -10);
      blade.scale.x = sx;
      B(1, 2, 150, strip, sx * 13.4, 4, 10);
    }
    B(14, 16, 40, hull, 0, 18, -40);
    B(14.4, 1.2, 30, strip, 0, 22, -36);
    B(36, 30, 36, dark, 0, 0, -118);
    for (const [ex, ey] of [[-10, 0], [10, 0], [0, 9]]) engine(g, engines, ex, ey, -136, 7, glow, dark, pal.glow);
  } else if (type === 'relay') {
    B(22, 104, 22, hull, 0, 0, 0);
    B(30, 8, 30, dark, 0, -50, 0);
    const dish = mk(g, new THREE.ConeGeometry(30, 14, 16, 1, true), dark, 0, 60, 0);
    dish.rotation.x = Math.PI;
    mk(g, new THREE.TorusGeometry(26, 1.4, 6, 40), strip, 0, 20, 0).rotation.x = Math.PI / 2;
    mk(g, new THREE.TorusGeometry(26, 1.4, 6, 40), strip, 0, -20, 0).rotation.x = Math.PI / 2;
    mk(g, new THREE.SphereGeometry(6, 12, 8), glow, 0, 70, 0);
    for (const a of [0, 2.1, 4.2]) mk(g, new THREE.BoxGeometry(4, 4, 46), dark, Math.cos(a) * 16, 0, Math.sin(a) * 16).rotation.y = -a;
  } else if (type === 'station' || type === 'gate' || type === 'habitat') {
    const gate = type === 'gate';
    const R = gate ? 300 : 150;
    mk(g, new THREE.TorusGeometry(R, gate ? 24 : 16, 14, 72), dark);
    mk(g, new THREE.TorusGeometry(R + (gate ? 26 : 18), 1.6, 6, 96), strip);
    mk(g, new THREE.TorusGeometry(R - (gate ? 26 : 18), 1.6, 6, 96), strip);
    for (let i = 0; i < (gate ? 8 : 4); i++) {
      const a = (i / (gate ? 8 : 4)) * Math.PI * 2;
      if (gate) {
        const pylon = B(30, 30, 60, hull, Math.cos(a) * R, Math.sin(a) * R, 0);
        pylon.rotation.z = a;
        mk(g, new THREE.SphereGeometry(7, 10, 8), glow, Math.cos(a) * (R - 30), Math.sin(a) * (R - 30), 0);
      } else {
        const spoke = mk(g, new THREE.CylinderGeometry(4, 4, R - 40, 6), dark, Math.cos(a) * R / 2, Math.sin(a) * R / 2, 0);
        spoke.rotation.z = a - Math.PI / 2;
      }
    }
    if (type === 'habitat') {
      mk(g, new THREE.CylinderGeometry(30, 30, 90, 20), hull);
      for (const sy of [-1, 1]) mk(g, new THREE.CylinderGeometry(46, 46, 10, 24), dark, 0, sy * 50, 0);
    } else if (gate) {
      const field = new THREE.Mesh(new THREE.CircleGeometry(R - 24, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.2, 2.4), transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      g.add(field);
    } else {
      mk(g, new THREE.IcosahedronGeometry(50, 1), hull);
      mk(g, new THREE.IcosahedronGeometry(30, 0), glow).scale.setScalar(1.15);
      for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const spike = new THREE.ConeGeometry(9, 60, 6);
        const m = mk(g, spike, dark, d[0] * 70, d[1] * 70, d[2] * 70);
        m.lookAt(new THREE.Vector3(d[0] * 200, d[1] * 200, d[2] * 200)); m.rotateX(Math.PI / 2);
      }
    }
  } else {
    B(70, 56, 380, hull, 0, 0, -30);
    const prow = B(70, 56, 130, hull, 0, 0, 200); prow.scale.set(0.3, 0.4, 1);
    for (const sx of [-1, 1]) {
      const blade = mk(g, wingGeo(90, 300, 60, -120, 10), dark, sx * 34, 0, -40);
      blade.scale.x = sx;
      const v = mk(g, wingGeo(70, 220, 50, -60, 8), dark, 0, sx * 26, -60);
      v.rotation.z = sx * Math.PI / 2;
      B(1.2, 3, 300, strip, sx * 35.8, 10, -10);
      B(1.2, 3, 300, strip, sx * 35.8, -10, -10);
    }
    B(30, 30, 80, hull, 0, 40, -80);
    B(30.6, 2, 60, strip, 0, 50, -74);
    B(90, 70, 60, dark, 0, 0, -240);
    for (const [ex, ey] of [[-26, 16], [26, 16], [-26, -16], [26, -16], [0, 0]]) engine(g, engines, ex, ey, -270, 12, glow, dark, pal.glow);
  }
  // surface detail on the warships and freighters: equipment blocks, vents, sensor domes, antennas, window strips
  const det = {
    zerstoerer: [[0, 11, -12, 12, -95, 100, 34, 13.2]],
    dreadnought: [[0, 28, -34, 34, -200, 150, 70, 35.2], [0, -28, -34, 34, -200, 150, 40, 35.2]],
    transport: [[0, 10, -10, 10, -25, 35, 14, 11.2]], tanker: [[0, 18, -6, 6, -22, 26, 8, 11.2]], prison: [[0, 10, -10, 10, -25, 35, 14, 11.2]],
  }[type];
  if (det) {
    const winMat = new THREE.MeshBasicMaterial({ color: union ? new THREE.Color(2.2, 1.8, 1.1) : new THREE.Color(2.4, 0.4, 1.4) });
    for (const [, yTop, x0, x1, z0, z1, n, hw] of det) {
      const up = Math.sign(yTop);
      for (let i = 0; i < n; i++) {
        const w = 1.5 + Math.random() * 5, h = 0.8 + Math.random() * 3, d = 2 + Math.random() * 9;
        const x = x0 + Math.random() * (x1 - x0), z = z0 + Math.random() * (z1 - z0);
        const r = Math.random();
        if (r < 0.62) B(w, h, d, Math.random() < 0.5 ? dark : hull, x, yTop + up * h / 2, z);
        else if (r < 0.78) { const dm = mk(g, new THREE.SphereGeometry(1.2 + Math.random() * 1.8, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), hull, x, yTop, z); if (up < 0) dm.rotation.x = Math.PI; }
        else if (r < 0.9) mk(g, new THREE.CylinderGeometry(0.15, 0.25, 4 + Math.random() * 8, 5), dark, x, yTop + up * 3, z);
        else for (let k = 0; k < 4; k++) B(w, 0.3, 0.6, dark, x, yTop + up * 0.6, z + k * 1.2); // vent grille
      }
      // lit window strips along the flanks
      for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) B(0.4, 0.5, (z1 - z0) * (0.3 + Math.random() * 0.4), winMat, sx * hw, yTop - up * (3 + k * 3), z0 + (z1 - z0) * (0.2 + Math.random() * 0.3));
    }
  }
  for (const [x, y, z] of SHIPS[type].turrets) {
    const tm = mk(g, turretGeo, dark, x, y, z);
    if (y < 0) tm.rotation.x = Math.PI;
    else if (Math.abs(x) > Math.abs(y)) tm.rotation.z = -Math.sign(x) * Math.PI / 2;
  }
  g.name = 'body';
  root.userData = {};
  return root;
}

function makeShip(type) {
  const U = PAL.union, A = PAL.asz;
  switch (type) {
    case 'sperber': return fighter({ pal: U, len: 15, noseR: 0.25, bodyR: 1.25, wide: 1.25, flat: 0.8, span: 5.2, root: 5.5, tip: 1.6, sweep: 3.2, wingZ: -2.2, dihedral: -0.06, fin: 2.6, fins: [Math.PI / 2 - 0.35, Math.PI / 2 + 0.35], engines: [[0, 0]], engR: 0.95 });
    case 'falke': return fighter({ pal: U, len: 17, noseR: 0.3, bodyR: 1.45, wide: 1.35, flat: 0.78, span: 6.2, root: 7, tip: 1.8, sweep: 4.4, wingZ: -2.6, dihedral: 0.08, fin: 3, fins: [Math.PI / 2 - 0.5, Math.PI / 2 + 0.5], engines: [[-1.1, 0], [1.1, 0]], engR: 0.85 });
    case 'greif': return fighter({ pal: U, len: 19, noseR: 0.35, bodyR: 1.5, wide: 1.2, flat: 0.85, twin: 1.9, span: 6.6, root: 8, tip: 2.6, sweep: 3.4, wingZ: -3, dihedral: -0.1, fin: 3.4, fins: [Math.PI / 2 - 0.3, Math.PI / 2 + 0.3], engines: [[-1.9, 0], [1.9, 0], [0, 0.2]], engR: 0.95 });
    case 'dorn': return fighter({ pal: A, len: 14, noseR: 0.08, bodyR: 1.1, wide: 0.9, flat: 0.9, span: 4.6, root: 5, tip: 0.5, sweep: -4.5, wingZ: -3.4, dihedral: 0.5, fin: 3.6, fins: [-Math.PI / 2], engines: [[0, 0]], engR: 0.9 });
    case 'kurier': return fighter({ pal: A, len: 24, noseR: 0.9, bodyR: 2.6, wide: 1.3, flat: 0.8, span: 3.4, root: 9, tip: 3, sweep: -1, wingZ: -4, dihedral: 0, fin: 3, fins: [Math.PI / 2], engines: [[-1.5, 0], [1.5, 0]], engR: 1.3 });
    case 'holt':
    case 'klinge': return fighter({ pal: A, len: 16, noseR: 0.1, bodyR: 1.25, wide: 1.5, flat: 0.6, span: 7, root: 6.5, tip: 0.6, sweep: -7.5, wingZ: -3.6, dihedral: -0.15, fin: 2.8, fins: [Math.PI / 2, -Math.PI / 2], engines: [[-1, 0], [1, 0]], engR: 0.8 });
    case 'archon': return fighter({ pal: PAL.ace, len: 17, noseR: 0.1, bodyR: 1.3, wide: 1.5, flat: 0.6, span: 8, root: 7, tip: 0.6, sweep: -8.5, wingZ: -3.8, dihedral: -0.2, fin: 3.4, fins: [Math.PI / 2, -Math.PI / 2, Math.PI / 2 - 0.9, Math.PI / 2 + 0.9], engines: [[-1.1, 0], [1.1, 0]], engR: 0.9 });
    case 'hammer': return fighter({ pal: A, len: 18, noseR: 0.6, bodyR: 1.7, wide: 1.1, flat: 1, twin: 2.6, span: 4.5, root: 9, tip: 4, sweep: -1.5, wingZ: -2, dihedral: 0, fin: 3, fins: [Math.PI / 2, -Math.PI / 2], engines: [[-2.6, 0], [2.6, 0]], engR: 1.2 });
    default: return capital(type);
  }
}

// ---------------------------------------------------------------------------
// Templates: every ship type is built once, merged per material, then cloned.
// Clones share geometry and materials, so spawning costs no GPU memory and a
// fighter needs ~6 draw calls instead of ~20.
// ---------------------------------------------------------------------------

function flipWinding(geo) {
  for (const attr of Object.values(geo.attributes)) {
    const a = attr.array, n = attr.itemSize;
    for (let t = 0; t < attr.count; t += 3) {
      for (let k = 0; k < n; k++) {
        const i1 = (t + 1) * n + k, i2 = (t + 2) * n + k;
        const tmp = a[i1]; a[i1] = a[i2]; a[i2] = tmp;
      }
    }
  }
}

function mergeByMaterial(group) {
  const buckets = new Map();
  for (const c of [...group.children]) {
    if (!c.isMesh) continue;
    c.updateMatrix();
    const geo = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
    const keep = c.material.vertexColors ? ['position', 'normal', 'uv', 'color'] : ['position', 'normal', 'uv'];
    for (const k of Object.keys(geo.attributes)) if (!keep.includes(k)) geo.deleteAttribute(k);
    if (!geo.attributes.uv || !geo.attributes.normal) continue;
    geo.applyMatrix4(c.matrix);
    if (c.matrix.determinant() < 0) flipWinding(geo);
    if (!buckets.has(c.material)) buckets.set(c.material, []);
    buckets.get(c.material).push(geo);
    group.remove(c);
    c.geometry.dispose();
  }
  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    geos.forEach((x) => x.dispose());
    if (merged) group.add(new THREE.Mesh(merged, mat));
  }
}

/**
 * Align the stats with the generated model (once per type):
 *  - wing guns fire from the wing-tip pods instead of empty space beside the hull
 *  - capital ships get extra hit boxes for parts sticking out of their main box (blades, towers, prows)
 *  - modelR = farthest point of the model, used for hit tests
 */
function fitStats(type, t) {
  const def = SHIPS[type], body = t.getObjectByName('body');
  t.updateMatrixWorld(true);
  const pods = body.userData.pods;
  if (pods && def.guns) def.guns = def.guns.map((gun) => {
    if (Math.abs(gun[0]) < 3) return gun;
    const pod = pods.find((p) => Math.sign(p[0]) === Math.sign(gun[0]));
    return pod ? [pod[0], pod[1], pod[2]] : gun;
  });
  const bb = new THREE.Box3(), all = new THREE.Box3(), extra = [];
  const b = def.box, v = new THREE.Vector3();
  body.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    o.geometry.computeBoundingBox();
    bb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    all.union(bb);
    if (def.capital && b && (bb.max.x > b[0] + 4 || bb.min.x < -b[0] - 4 || bb.max.y > b[1] + 4 || bb.min.y < -b[1] - 4 || bb.max.z > b[2] + 4 || bb.min.z < -b[2] - 4)) {
      const c = bb.getCenter(v.set(0, 0, 0)), h = bb.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      if (h.x * h.y * h.z > 8) extra.push([c.x, c.y, c.z, h.x, h.y, h.z]);
    }
  });
  if (extra.length && !def.torus) def.boxes = extra.sort((p, q) => q[3] * q[4] * q[5] - p[3] * p[4] * p[5]).slice(0, 16);
  def.modelR = Math.max(Math.abs(all.min.x), all.max.x, Math.abs(all.min.y), all.max.y, Math.abs(all.min.z), all.max.z);
}

const TEMPLATES = {};
export function buildShip(type) {
  if (!TEMPLATES[type]) {
    const t = makeShip(type);
    if (SHIPS[type]) fitStats(type, t);
    mergeByMaterial(t.getObjectByName('body'));
    t.traverse((o) => {
      if (o.geometry) o.geometry.userData.shared = true;
      if (o.material) o.material.userData.shared = true;
    });
    TEMPLATES[type] = t;
  }
  const root = TEMPLATES[type].clone();
  const engines = [], blinkers = [];
  root.traverse((o) => { if (o.userData.engine) engines.push(o); if (o.userData.blink) blinkers.push(o); });
  root.userData = { body: root.getObjectByName('body'), engines, blinkers };
  return root;
}
