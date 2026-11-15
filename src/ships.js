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
  aurora: { name: 'TUS Aurora', team: 0, capital: true, hp: 4200, speed: 12, radius: 240, box: [6, 4, 30], dmg: 7, turrets: [[18, 21.5, 132], [-18, 21.5, 132], [18, 21.5, 70], [-18, 21.5, 70], [0, 20.8, 150], [0, -42.6, -40], [24.4, -22, -90], [-24.4, -22, -90]] },
  transport: { name: 'Samariter', team: 0, capital: true, hp: 1000, speed: 38, radius: 55, box: [15, 13, 48], dmg: 6, turrets: [[0, 14, 0]] },
  zerstoerer: { name: 'Zerstörer', team: 1, capital: true, hp: 2100, speed: 18, radius: 135, box: [24, 20, 125], dmg: 8, score: 2000, turrets: [[20, 14, 70], [-20, 14, 70], [0, 22, -20], [0, -18, 20], [0, 18, -90]] },
  dreadnought: { name: 'Apotheose', team: 1, capital: true, hp: 5200, speed: 9, radius: 260, box: [50, 40, 245], dmg: 9, score: 5000, turrets: [[44, 20, 150], [-44, 20, 150], [44, 20, 0], [-44, 20, 0], [0, 44, 60], [0, -40, 60], [0, 44, -120], [0, -40, -120]] },
};

let TEX = null;
// the organic Aszendenz capitals: put their turrets on the curved hull surface
for (const [t, ax] of [['zerstoerer', [22, 18, 120]], ['dreadnought', [48, 38, 240]]]) {
  SHIPS[t].turrets = SHIPS[t].turrets.map(([x, y, z]) => { const k = 1 / Math.hypot(x / ax[0], y / ax[1], z / ax[2]); return [x * k, y * k, z * k]; });
}

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

// ---------------------------------------------------------------------------
// Fighters: every type has its own silhouette. Union craft are compact little starships (a crew
// hull with engine nacelles on pylons, no aircraft wings); Aszendenz craft are organic: crescents,
// thorns and hammerheads in dark chitin with glowing veins.
// ---------------------------------------------------------------------------
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _m4 = new THREE.Matrix4(), _zUp = new THREE.Vector3(0, 0, 1), _yUp = new THREE.Vector3(0, 1, 0);
function scaleUV(geo, k) { const uv = geo.attributes.uv; if (uv) for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k); return geo; }
/** ellipsoid */
function ell(g, mat, x, y, z, sx, sy, sz, seg = 16) { const e = mk(g, new THREE.SphereGeometry(1, seg, Math.max(6, seg >> 1)), mat, x, y, z); e.scale.set(sx, sy, sz); return e; }
/** tapered tube along z */
function tube(g, mat, x, y, z, rF, rB, len, seg = 12) { const c = new THREE.CylinderGeometry(rF, rB, len, seg, 2); c.rotateX(Math.PI / 2); return mk(g, c, mat, x, y, z); }
/** box from point a to point b; w across, h along the "up" hint (chord for pylons) */
function beam(g, mat, ax, ay, az, bx, by, bz, w, h, up = _zUp) {
  _a.set(ax, ay, az); _b.set(bx, by, bz);
  const len = _a.distanceTo(_b);
  const m = mk(g, new THREE.BoxGeometry(w, h, len), mat, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  _m4.lookAt(_b, _a, up); m.quaternion.setFromRotationMatrix(_m4);
  return m;
}
/** flat plate from a polygon in the x-z plane (x, z pairs), thickness centred on y */
function slab(g, mat, pts, thick, y = 0, bevel = 0.25) {
  const sh = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z)));
  const geo = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2 });
  geo.rotateX(Math.PI / 2); geo.translate(0, thick / 2, 0);
  return mk(g, scaleUV(geo, 0.07), mat, 0, y, 0);
}
/** cockpit canopy with frame arches */
function canopy(g, m, x, y, z, w, h, l) {
  ell(g, m.canopy, x, y, z, w, h, l, 14);
  for (const dz of [-0.45, 0, 0.45]) {
    const k = 1 - Math.abs(dz) * 0.9;
    const a = mk(g, new THREE.TorusGeometry(1, 0.05, 4, 16, Math.PI), m.dark, x, y, z + dz * l);
    a.scale.set(w * k, h * k, 1);
  }
}
/** wing-tip / nacelle gun pod: barrel, sooty muzzle; registers the muzzle for the wing guns */
function gunPod(g, m, x, y, z, len = 2.2) {
  tube(g, m.dark, x, y, z + len / 2, 0.11, 0.14, len, 8);
  tube(g, SOOT, x, y, z + len, 0.19, 0.19, 0.25, 8);
  (g.userData.pods ||= []).push([x, y, z + len]);
}
function navLights(g, xl, y, z, tailY, tailZ) {
  blinker(g, xl, y, z, new THREE.Color(3, 0.25, 0.2), 1.1, 0, 1.8);
  blinker(g, -xl, y, z, new THREE.Color(0.2, 3, 0.6), 1.1, 0.5, 1.8);
  blinker(g, 0, tailY, tailZ, new THREE.Color(3, 3, 3), 0.8, 0.25, 2.2);
}
function decals(g, m, x, y, z, len, h) {
  for (const sx of [-1, 1]) { const d = mk(g, new THREE.PlaneGeometry(len, h), m.decal, sx * x, y, z); d.rotation.y = sx * Math.PI / 2; }
}
function craft(pal, build) {
  const root = new THREE.Group(), g = new THREE.Group();
  root.add(g);
  const m = mats(pal), engines = [];
  build(g, m, engines);
  g.name = 'body';
  root.userData = {};
  return root;
}
/** Union engine nacelle: hull tube with a glowing intake ring at the front, coil strips and a drive at the back */
function nacelle(g, m, engines, pal, x, y, z, r, len, inner = 1) {
  tube(g, m.hull, x, y, z, r * 0.92, r, len);
  ell(g, m.dark, x, y, z + len / 2, r * 0.92, r * 0.92, r * 0.8, 12);
  mk(g, new THREE.TorusGeometry(r * 0.95, r * 0.14, 6, 16), m.glow, x, y, z + len / 2 - r * 0.25);
  mk(g, new THREE.BoxGeometry(0.08, r * 0.5, len * 0.62), m.line, x - inner * r * 0.98, y, z - len * 0.06); // coil strip
  mk(g, new THREE.BoxGeometry(r * 0.5, 0.1, len * 0.7), m.dark, x, y + r * 0.98, z);                        // dorsal rail
  engine(g, engines, x, y, z - len / 2 - r * 0.4, r * 0.85, m.glow, m.dark, pal.glow);
}

/** Sperber: light interceptor - an armoured wedge with two drive pods on short struts */
function sperber() {
  const P = PAL.union;
  return craft(P, (g, m, engines) => {
    slab(g, m.hull, [[0, 7.4], [1.4, 6.2], [2.4, 3.2], [3.1, -3.6], [2.6, -6.4], [-2.6, -6.4], [-3.1, -3.6], [-2.4, 3.2], [-1.4, 6.2]], 1.2, 0);
    slab(g, m.dark, [[0, 4.8], [1.7, 2.4], [2.1, -5.6], [-2.1, -5.6], [-1.7, 2.4]], 0.7, 0.85, 0.15);
    ell(g, m.dark, 0, -0.75, 0.5, 1.6, 0.55, 4.2, 12);                        // ventral keel
    canopy(g, m, 0, 1.25, 2.4, 0.95, 0.62, 1.9);
    for (const sx of [-1, 1]) {
      beam(g, m.hull, sx * 2.4, 0, -2.4, sx * 4.4, -0.3, -2.8, 0.35, 3.2);
      nacelle(g, m, engines, P, sx * 4.6, -0.3, -2.2, 0.72, 7.6, sx);
      gunPod(g, m, sx * 4.6, -0.95, 1.4, 1.6);
      mk(g, new THREE.BoxGeometry(0.06, 0.18, 5.2), m.accent, sx * 2.75, 0.62, -0.6).rotation.y = sx * 0.13;
    }
    const fin = mk(g, wingGeo(1.8, 3.2, 1.2, 1.5, 0.22), m.hull, 0, 1.05, -4.6); fin.rotation.z = Math.PI / 2;
    engine(g, engines, 0, 0.1, -6.8, 0.75, m.glow, m.dark, P.glow);
    mk(g, new THREE.SphereGeometry(0.2, 8, 6), m.accent, 0.9, 1.25, -3.6);
    decals(g, m, 3.0, 0.15, -1.2, 3.2, 0.8);
    navLights(g, 5.5, -0.3, -2.4, 1.6, -6.2);
  });
}
/** Falke: multirole fighter - a small starship: crew hull, two nacelles on swept pylons, chin gun */
function falke() {
  const P = PAL.union;
  return craft(P, (g, m, engines) => {
    ell(g, m.hull, 0, 0, 0.8, 1.75, 1.0, 7.2, 18);
    slab(g, m.dark, [[0, 6.6], [1.5, 3.2], [1.8, -4.6], [-1.8, -4.6], [-1.5, 3.2]], 0.5, 0.75, 0.12);
    ell(g, m.dark, 0, 0, 7.6, 0.7, 0.55, 0.9, 10);                           // sensor nose
    mk(g, new THREE.TorusGeometry(0.62, 0.06, 6, 14), m.line, 0, 0, 7.15);
    canopy(g, m, 0, 0.95, 3.4, 0.85, 0.55, 1.7);
    tube(g, m.dark, 0, -0.95, 4.4, 0.32, 0.42, 5);                             // chin gun housing
    tube(g, m.dark, 0, -1.0, 7.6, 0.12, 0.14, 1.6, 8); tube(g, SOOT, 0, -1.0, 8.4, 0.18, 0.18, 0.25, 8);
    for (const sx of [-1, 1]) {
      beam(g, m.hull, sx * 1.4, 0.1, -2.6, sx * 5.1, 1.1, -3.8, 0.3, 4.6);
      beam(g, m.dark, sx * 1.4, -0.2, -1.4, sx * 5.1, 0.6, -2.2, 0.18, 1.2);
      nacelle(g, m, engines, P, sx * 5.2, 1.1, -2.6, 0.85, 10.5, sx);
      gunPod(g, m, sx * 5.2, 0.2, 2.5, 1.8);
      mk(g, new THREE.BoxGeometry(0.06, 0.12, 3.6), m.accent, sx * 3.3, 0.85, -3.2).rotation.y = sx * 0.3;
    }
    engine(g, engines, 0, 0, -6.6, 0.7, m.glow, m.dark, P.glow);
    mk(g, new THREE.CylinderGeometry(0.05, 0.07, 1.4, 5), m.dark, 0.4, 1.6, -2.6);
    decals(g, m, 1.62, 0.1, 0.6, 3.4, 0.8);
    navLights(g, 6.2, 1.1, -3, 1.4, -6.4);
  });
}
/** Greif: heavy strike craft - a broad manta-shaped lifting body, four drives, underslung weapon pods */
function greif() {
  const P = PAL.union;
  return craft(P, (g, m, engines) => {
    slab(g, m.hull, [[0, 9.2], [2.2, 7.2], [5.2, 0.5], [8.6, -5.4], [8.2, -8.2], [-8.2, -8.2], [-8.6, -5.4], [-5.2, 0.5], [-2.2, 7.2]], 1.5, 0);
    ell(g, m.hull, 0, 0.6, 0.6, 2.2, 1.35, 7.4, 18);                          // raised crew spine
    slab(g, m.dark, [[0, 3.5], [4.8, -3], [6.6, -7.6], [-6.6, -7.6], [-4.8, -3]], 0.5, 1.05, 0.12);
    canopy(g, m, 0, 1.75, 3.6, 1.0, 0.62, 2.0);
    for (const sx of [-1, 1]) {
      tube(g, m.dark, sx * 6, -1.35, -0.6, 0.5, 0.62, 7.2);                   // weapon pod
      beam(g, m.dark, sx * 6, -0.9, -0.6, sx * 6, -0.2, -0.6, 0.3, 3.2);
      gunPod(g, m, sx * 6, -1.35, 3.0, 1.6);
      tube(g, m.dark, sx * 2, -0.95, 6.4, 0.18, 0.24, 2.6, 8); tube(g, SOOT, sx * 2, -0.95, 7.8, 0.17, 0.17, 0.25, 8);
      const fin = mk(g, wingGeo(2.6, 3.6, 1.4, 1.6, 0.25), m.hull, sx * 6.2, 0.7, -6.4); fin.rotation.z = sx > 0 ? 1.15 : Math.PI - 1.15;
      mk(g, new THREE.BoxGeometry(4.2, 0.07, 0.25), m.accent, sx * 5.4, 0.78, -2.4).rotation.y = sx * -0.55;
      engine(g, engines, sx * 2.4, 0.2, -8.7, 0.85, m.glow, m.dark, P.glow);
      engine(g, engines, sx * 5.6, 0, -8.6, 0.75, m.glow, m.dark, P.glow);
      for (let i = 0; i < 4; i++) mk(g, new THREE.BoxGeometry(0.9, 0.08, 0.12), m.dark, sx * (3.5 + i * 0.3), 0.8, -5 + i * 0.4);
    }
    decals(g, m, 2.2, 0.6, 0.4, 3.4, 0.8);
    navLights(g, 8.9, 0, -5.8, 1.9, -7.8);
  });
}
/** Dorn: Aszendenz drone - a glowing core in a thorned chitin shell */
function dorn() {
  const P = PAL.asz;
  return craft(P, (g, m, engines) => {
    ell(g, m.hull, 0, 0, 0, 1.8, 1.5, 2.8, 16);
    ell(g, m.glow, 0, 0, 2.3, 0.65, 0.55, 0.6, 10);                          // eye
    for (const [x, y, len] of [[0, 1.1, 6.2], [1.2, -0.8, 5.2], [-1.2, -0.8, 5.2]]) {
      const c = new THREE.ConeGeometry(0.45, len, 6); c.rotateX(Math.PI / 2);
      const t = mk(g, c, m.dark, x, y, 1.6 + len / 2);
      t.rotation.set(-y * 0.05, x * 0.05, 0);
    }
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2, c = new THREE.ConeGeometry(0.3, 3.2, 5);
      const s = mk(g, c, m.dark, Math.cos(a) * 1.5, Math.sin(a) * 1.3, -1.6);
      s.rotation.set(Math.sin(a) * 0.9 - Math.PI / 2 * 0, 0, 0);
      s.lookAt(Math.cos(a) * 4, Math.sin(a) * 3.6, -4.5); s.rotateX(Math.PI / 2);
    }
    for (const sx of [-1, 1]) mk(g, new THREE.TorusGeometry(1.75, 0.06, 4, 20, Math.PI * 0.8), m.line, 0, 0, sx * 0.7).rotation.set(0, Math.PI / 2, sx * 0.4);
    tube(g, m.dark, 0, -0.5, 4.6, 0.12, 0.2, 2.6, 6);
    engine(g, engines, 0, 0, -3.2, 0.8, m.glow, m.dark, P.glow);
    navLights(g, 2.2, 0, -0.6, 1.8, -2.2);
  });
}
/** crescent blade helper (Klinge, Holt): arc bulging backwards, tips forward */
function crescent(g, mat, R, tube, y = 0, flat = 0.35, arc = Math.PI) {
  const t = new THREE.TorusGeometry(R, tube, 8, 28, arc);
  t.rotateZ((Math.PI - arc) / 2);
  t.rotateX(-Math.PI / 2);
  const c = mk(g, t, mat, 0, y, R); c.scale.y = flat; return c;
}
/** Klinge: Aszendenz fighter - a sickle-shaped blade around a slim pod */
function klinge(pal = PAL.asz, holt = false) {
  return craft(pal, (g, m, engines) => {
    crescent(g, m.hull, 6.4, 0.75, 0);
    crescent(g, m.line, 6.4, 0.12, 0.28, 1);
    if (holt) { crescent(g, m.dark, 4.6, 0.45, 1.1, 0.4, Math.PI * 0.8); crescent(g, m.dark, 4.6, 0.45, -1.1, 0.4, Math.PI * 0.8); }
    ell(g, m.hull, 0, 0, -0.4, 1.3, 0.95, 4, 16);
    ell(g, m.canopy, 0, 0.55, 1.4, 0.6, 0.4, 1.3, 12);
    const spine = new THREE.ConeGeometry(0.35, 3.4, 5); spine.rotateX(-Math.PI / 2);
    mk(g, spine, m.dark, 0, 0.9, -2.6);
    for (const sx of [-1, 1]) {
      const tip = new THREE.ConeGeometry(0.45, 2.4, 6); tip.rotateX(Math.PI / 2);
      mk(g, tip, m.dark, sx * 6.4, 0, 7.2);
      gunPod(g, m, sx * 6.4, -0.35, 6.2, 1.2);
      beam(g, m.dark, sx * 1.1, 0, -0.6, sx * 5.4, 0, -2.6, 0.25, 0.9);
      engine(g, engines, sx * 0.75, 0, -4.4, 0.62, m.glow, m.dark, pal.glow);
    }
    decals(g, m, 1.32, 0, -0.6, 2.4, 0.9);
    navLights(g, 7.3, 0, 6, 1.2, -3.8);
  });
}
/** Hammer: Aszendenz bomber - a broad hammerhead on a long spine, twin drives, fusion-charge pod */
function hammer() {
  const P = PAL.asz;
  return craft(P, (g, m, engines) => {
    ell(g, m.hull, 0, 0, 6.2, 5.6, 1.35, 2.2, 18);                          // hammerhead
    ell(g, m.line, 0, 0, 7.9, 4.2, 0.25, 0.3, 12);                           // glowing brow
    ell(g, m.hull, 0, 0, -1.2, 1.7, 1.5, 7.2, 16);                           // spine
    ell(g, m.dark, 0, -1.45, 0.6, 1.1, 0.9, 3.6, 12);                         // fusion-charge pod
    ell(g, m.glow, 0, -1.9, 0.6, 0.4, 0.3, 2.2, 8);
    ell(g, m.canopy, 0, 1.1, 4.8, 0.8, 0.45, 1.1, 12);
    for (const sx of [-1, 1]) {
      ell(g, m.dark, sx * 5.4, 0, 6.6, 0.9, 0.9, 1.2, 10);
      gunPod(g, m, sx * 5.2, -0.3, 7.4, 1.4);
      tube(g, m.hull, sx * 2.7, 0, -5.4, 0.85, 1.05, 5.5);
      beam(g, m.dark, sx * 1.2, 0, -4.2, sx * 2.4, 0, -4.8, 0.3, 2.6);
      engine(g, engines, sx * 2.7, 0, -8.6, 0.95, m.glow, m.dark, P.glow);
      for (let i = 0; i < 3; i++) { const c = new THREE.ConeGeometry(0.25, 1.8 - i * 0.3, 5); const s = mk(g, c, m.dark, sx * (1.5 + i * 1.1), 1.0, 6.6 - i * 0.2); s.rotation.set(-0.5, 0, -sx * 0.4); }
    }
    for (let i = 0; i < 4; i++) { const c = new THREE.ConeGeometry(0.28, 2 - i * 0.3, 5); mk(g, c, m.dark, 0, 1.6, 1.5 - i * 2.2).rotation.x = -0.6; }
    navLights(g, 6.4, 0, 6, 1.8, -8);
  });
}
/** Archon: the ace's craft - a gilded trident with swept fins and three drives */
function archon() {
  const P = PAL.ace;
  return craft(P, (g, m, engines) => {
    ell(g, m.hull, 0, 0, 0, 1.4, 1.0, 6.6, 18);
    const blade = new THREE.ConeGeometry(0.7, 7, 6); blade.rotateX(Math.PI / 2);
    mk(g, blade, m.dark, 0, 0, 9.4);
    ell(g, m.canopy, 0, 0.75, 2.6, 0.7, 0.45, 1.5, 12);
    for (const sx of [-1, 1]) {
      const prong = new THREE.ConeGeometry(0.5, 6.4, 6); prong.rotateX(Math.PI / 2);
      mk(g, prong, m.dark, sx * 4.2, 0, 6.6);
      beam(g, m.hull, sx * 1.2, 0, 1.2, sx * 4.2, 0, 3.4, 0.35, 2.2);
      gunPod(g, m, sx * 4.2, -0.4, 4.4, 1.2);
      const fin = mk(g, wingGeo(5.2, 4.6, 1.2, 4.2, 0.3), m.hull, sx * 1.1, 0, -3.4); fin.scale.x = sx; fin.rotation.z = sx * -0.25;
      mk(g, new THREE.BoxGeometry(4, 0.08, 0.3), m.accent, sx * 3.4, 0.25, -4.6).rotation.y = sx * -0.7;
      engine(g, engines, sx * 1.05, 0, -6.8, 0.6, m.glow, m.dark, P.glow);
    }
    mk(g, new THREE.TorusGeometry(1.5, 0.12, 6, 20), m.accent, 0, 0, -1).scale.set(1, 0.7, 1);
    const crest = mk(g, wingGeo(2.4, 3.6, 0.8, 2.4, 0.25), m.accent, 0, 0.8, -3.6); crest.rotation.z = Math.PI / 2;
    engine(g, engines, 0, 0.5, -7, 0.7, m.glow, m.dark, P.glow);
    decals(g, m, 1.42, 0, 0, 2.6, 0.9);
    navLights(g, 6.4, 0, -6.8, 2.6, -5.6);
  });
}
/** Kurier: a fast, unarmed courier - a long capsule with a stabiliser ring and two big drives */
function kurier() {
  const P = PAL.asz;
  return craft(P, (g, m, engines) => {
    ell(g, m.hull, 0, 0, 0, 2.6, 2.2, 11, 20);
    ell(g, m.canopy, 0, 1.1, 7.4, 1.1, 0.8, 2.2, 12);
    mk(g, new THREE.TorusGeometry(4.2, 0.45, 8, 28), m.dark, 0, 0, -3.5);
    mk(g, new THREE.TorusGeometry(4.2, 0.1, 4, 28), m.line, 0, 0, -3.1);
    for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) beam(g, m.dark, Math.cos(a) * 2.2, Math.sin(a) * 1.9, -3.5, Math.cos(a) * 4, Math.sin(a) * 4, -3.5, 0.35, 1.4);
    for (const sx of [-1, 1]) engine(g, engines, sx * 1.5, 0, -11.4, 1.25, m.glow, m.dark, P.glow);
    decals(g, m, 2.62, 0, 1, 4, 1.2);
    navLights(g, 4.6, 0, -3.5, 2.4, -10);
  });
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
// TUS Aurora: an explorer-style fleet carrier - a broad saucer on a swept neck above a long drive
// hull whose bow holds the flyable hangar, two warp nacelles on pylons, hundreds of lit windows,
// registry and blinking navigation lights (sprites with userData.blink, animated by the game).
// ---------------------------------------------------------------------------
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
  const coilMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.85, 1.7) });
  const intakeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.9, 0.35) }); // warm glow of the field intakes
  const lathe = (pts, seg, uvU, uvV) => {
    const geo = new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), seg);
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvU, uv.getY(i) * uvV);
    return geo;
  };
  // --- primary hull: a broad saucer with a raised command deck, carried well above the hangar's approach lane
  const SC = { x: 0, y: 12, z: 100, k: 1.08 };
  const SAUCER = [[0.01, 11], [14, 10.8], [30, 9.8], [50, 8], [75, 5.6], [96, 3], [106, 1.2], [110, -0.4], [107, -2.2], [92, -3.8], [66, -5.6], [38, -7.2], [16, -8.2], [0.01, -8.6]];
  const sy = (r, top) => { // saucer surface height at radius r (top or bottom side)
    const P = top ? SAUCER.slice(0, 8) : SAUCER.slice(7).reverse();
    for (let i = 1; i < P.length; i++) if (r <= P[i][0]) { const [r0, y0] = P[i - 1], [r1, y1] = P[i]; return y0 + (y1 - y0) * ((r - r0) / (r1 - r0)); }
    return P[P.length - 1][1];
  };
  const sauc = mk(g, lathe(SAUCER, 72, 10, 3), hull, SC.x, SC.y, SC.z); sauc.scale.z = SC.k;
  const rim = mk(g, new THREE.TorusGeometry(109, 1.1, 6, 96), dark, SC.x, SC.y - 0.4, SC.z); rim.rotation.x = Math.PI / 2; rim.scale.y = SC.k;
  const rimGlow = mk(g, new THREE.TorusGeometry(103, 0.35, 4, 96), strip, SC.x, SC.y + 2.1, SC.z); rimGlow.rotation.x = Math.PI / 2; rimGlow.scale.y = SC.k;
  // a disc's bounding box would leave solid empty corners: the saucer is hit-tested with stacked boxes instead
  for (const o of [sauc, rim, rimGlow]) o.userData.noBox = true;
  SHIPS.aurora.manualBoxes = [[0, 13, 100, 108, 7, 50], [0, 13, 100, 90, 8, 82], [0, 14, 100, 58, 9, 108], [0, 15, 100, 26, 10, 117]];
  for (const r of [42, 74]) { const ring = mk(g, new THREE.TorusGeometry(r, 0.3, 4, 72), dark, SC.x, SC.y + sy(r, true) + 0.2, SC.z); ring.rotation.x = Math.PI / 2; ring.scale.y = SC.k; }
  // command deck: a low dome with a window band and a sensor mast
  const dome = mk(g, new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2), hull, SC.x, SC.y + 10.8, SC.z); dome.scale.set(15, 4.2, 15 * SC.k);
  const band = mk(g, new THREE.TorusGeometry(13.4, 0.35, 4, 40), strip, SC.x, SC.y + 12.6, SC.z); band.rotation.x = Math.PI / 2; band.scale.y = SC.k;
  mk(g, new THREE.CylinderGeometry(0.4, 0.7, 9, 6), dark, SC.x, SC.y + 19, SC.z - 4);
  mk(g, new THREE.CylinderGeometry(4.5, 4.5, 0.8, 16), dark, SC.x, SC.y + 15.2, SC.z - 4);
  // sensor array and impulse deck at the saucer's rear edge
  const sen = mk(g, new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), dark, SC.x, SC.y - 8.4, SC.z + 40); sen.scale.set(9, 3, 9); sen.rotation.x = Math.PI;
  mk(g, uvBox(40, 6.5, 14), dark, 0, SC.y + 3.5, SC.z - SC.k * 104 + 9);
  for (const ex of [-11, 11]) engine(g, engines, ex, SC.y + 3.5, SC.z - SC.k * 104 + 1.6, 3.2, glow, dark, pal.glow);
  mk(g, uvBox(34, 1.2, 1.2), strip, 0, SC.y + 6.9, SC.z - SC.k * 104 + 3);
  // registry across the saucer's top and on both flanks of the drive hull
  const regMat = new THREE.MeshStandardMaterial({ map: registryTexture(), transparent: true, roughness: 0.6, metalness: 0.2, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const sz of [1, -1]) {
    const r0 = 62, slope = Math.atan2(sy(r0 - 15, true) - sy(r0 + 15, true), 30);
    const top = mk(g, new THREE.PlaneGeometry(76, 12), regMat, 0, SC.y + sy(r0, true) + 0.35, SC.z + sz * r0 * SC.k);
    top.rotation.set(-Math.PI / 2 + sz * slope, 0, sz > 0 ? 0 : Math.PI);
  }
  // --- neck: a swept fin joining the saucer to the drive hull
  const neck = new THREE.Shape([new THREE.Vector2(-40, -2), new THREE.Vector2(78, -2), new THREE.Vector2(58, 8), new THREE.Vector2(6, 8)]);
  const ng = new THREE.ExtrudeGeometry(neck, { depth: 14, bevelEnabled: true, bevelThickness: 1.5, bevelSize: 1.5, bevelSegments: 2 });
  scaleUV(ng, 1 / 60); ng.rotateY(-Math.PI / 2); ng.translate(7, -1, 0);
  mk(g, ng, hull, 0, 0, 0);
  for (const sx of [-1, 1]) mk(g, uvBox(0.4, 1, 60), strip, sx * 8.7, 3, 20);
  // --- drive hull: a long, rounded body; the hangar opens in its bow (see BAY), so it is open at the front
  const HY = -22, HS = 0.85; // centre height and vertical squash of its cross-section
  const DRIVE = [[0.01, -176], [9, -174], [15, -165], [20, -150], [23.5, -120], [24, -60], [24, 60], [23.4, 118], [22.2, 142]];
  const hullR = (z) => { for (let i = 1; i < DRIVE.length; i++) if (z <= DRIVE[i][1]) { const [r0, z0] = DRIVE[i - 1], [r1, z1] = DRIVE[i]; return r0 + (r1 - r0) * ((z - z0) / (z1 - z0)); } return 22.2; };
  const dg = lathe(DRIVE, 48, 4, 10); dg.rotateX(Math.PI / 2);
  const drive = mk(g, dg, hull, 0, HY, 0); drive.scale.y = HS;
  // bow plate round the hangar mouth
  const { y: by, back, mouth, hw, hh } = BAY, len = mouth - back, mid = (mouth + back) / 2;
  const bow = new THREE.Shape(); bow.absellipse(0, 0, 22.4, 22.4 * HS, 0, Math.PI * 2, false, 0);
  const hole = new THREE.Path(); const hy = by - HY;
  hole.moveTo(-hw - 1, hy - hh - 1); hole.lineTo(hw + 1, hy - hh - 1); hole.lineTo(hw + 1, hy + hh + 1); hole.lineTo(-hw - 1, hy + hh + 1); hole.closePath();
  bow.holes.push(hole);
  const bg = new THREE.ExtrudeGeometry(bow, { depth: 3, bevelEnabled: true, bevelThickness: 1.2, bevelSize: 1.2, bevelSegments: 2, curveSegments: 32 });
  scaleUV(bg, 1 / 50);
  mk(g, bg, dark, 0, HY, mouth - 3);
  const bowRing = mk(g, new THREE.TorusGeometry(22.6, 0.8, 6, 48), accent, 0, HY, mouth + 0.6); bowRing.scale.y = HS;
  const bowGlow = mk(g, new THREE.TorusGeometry(19, 0.35, 4, 48), strip, 0, HY, mouth + 0.9); bowGlow.scale.y = HS;
  // hangar tunnel: a real, flyable launch/landing bay
  const bayGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.15, 1.05, 0.9) });
  mk(g, uvBox(hw * 2 + 10, 2, len), dark, 0, by - hh - 1, mid);          // floor
  mk(g, uvBox(hw * 2 + 10, 2, len), dark, 0, by + hh + 1, mid);          // ceiling
  for (const sx of [-1, 1]) mk(g, uvBox(5, hh * 2 + 4, len), hull, sx * (hw + 2.5), by, mid); // walls
  mk(g, uvBox(hw * 2, hh * 2, 2), dark, 0, by, back);                     // back wall
  for (let z = back + 8; z < mouth - 4; z += 10) mk(g, uvBox(7, 0.3, 2.6), bayGlow, 0, by + hh - 0.2, z); // ceiling lamps
  for (let z = back + 6; z < mouth; z += 6) for (const sx of [-1, 1]) mk(g, uvBox(0.8, 0.25, 2.2), strip, sx * 6, by - hh + 0.15, z); // floor guide lights
  const bandMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.15, 0.5, 0.85) });
  for (const sx of [-1, 1]) mk(g, uvBox(0.3, 0.5, len - 4), bandMat, sx * (hw - 0.05), by + 1.5, mid); // wall light bands
  mk(g, uvBox(hw * 2, 0.7, 0.7), glow, 0, by + hh - 0.4, mouth); mk(g, uvBox(hw * 2, 0.7, 0.7), glow, 0, by - hh + 0.4, mouth);
  for (const sx of [-1, 1]) mk(g, uvBox(0.7, hh * 2, 0.7), glow, sx * (hw - 0.4), by, mouth);
  [BAY_LIGHTS.red, BAY_LIGHTS.amber, BAY_LIGHTS.green].forEach((m, i) => mk(g, uvBox(2.2, 1.2, 0.6), m, (i - 1) * 3.2, by + hh - 1.6, mouth - 2));
  mk(g, new THREE.PlaneGeometry(hw * 2 - 1, hh * 2 - 1), BAY_LIGHTS.field, 0, by, mouth - 0.5);
  for (const z of [back + 16, back + 52]) for (const sx of [-1, 1]) {                          // parking spots with magnetic clamps
    mk(g, uvBox(2.4, 1.2, 5), dark, sx * 2.6, by - hh + 0.6, z);
    mk(g, uvBox(2.0, 0.25, 4.2), BAY_LIGHTS.clamp, sx * 2.6, by - hh + 1.25, z);
  }
  // drive hull detail: dorsal and ventral rails, flank glow strips, stern drives
  mk(g, uvBox(6, 3, 200), dark, 0, HY + 24 * HS + 0.6, -40);
  mk(g, uvBox(8, 3, 160), dark, 0, HY - 24 * HS - 0.6, -10);
  for (const sx of [-1, 1]) mk(g, uvBox(0.6, 1.0, 230), coilMat, sx * 24.1, HY + 4, -20);
  mk(g, uvBox(24, 17, 12), dark, 0, HY, -172);
  for (const ex of [-6.5, 6.5]) engine(g, engines, ex, HY, -180, 5.2, glow, dark, pal.glow);
  // --- warp nacelles on swept pylons, high and outboard at the stern
  const NAC = [[0.01, -98], [5.5, -98], [8.4, -94], [9.2, -80], [9.2, 70], [8.4, 84], [6.5, 92], [0.01, 95]];
  const nacGeo = lathe(NAC, 28, 3, 8); nacGeo.rotateX(Math.PI / 2);
  for (const sx of [-1, 1]) {
    const nx = sx * 64, ny = 16, nz = -102;
    mk(g, nacGeo, hull, nx, ny, nz);
    const intake = mk(g, new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), intakeMat, nx, ny, nz + 89); intake.scale.set(7.4, 6.2, 7.4); intake.rotation.x = Math.PI / 2;
    mk(g, new THREE.TorusGeometry(8.9, 0.8, 6, 28), dark, nx, ny, nz + 88.5);
    mk(g, uvBox(1.2, 5.2, 140), coilMat, nx - sx * 9.05, ny, nz - 6);          // coil grilles facing inboard
    mk(g, uvBox(1.2, 5.2, 140), coilMat, nx, ny - 9.05, nz - 6).rotation.z = Math.PI / 2;
    mk(g, uvBox(3, 1.4, 150), dark, nx, ny + 9.2, nz);
    // pylon: from the drive hull's shoulder up and out to the nacelle
    const pl = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(56, 0), new THREE.Vector2(44, 24), new THREE.Vector2(16, 24)]);
    const pg = new THREE.ExtrudeGeometry(pl, { depth: 4, bevelEnabled: true, bevelThickness: 1, bevelSize: 1, bevelSegments: 1 });
    scaleUV(pg, 1 / 50); pg.rotateY(-Math.PI / 2); pg.translate(2, 0, -28);
    const pylon = mk(g, pg, hull, 0, 0, 0);
    _a.set(sx * 16, HY + 8, nz); _b.set(nx, ny, nz);
    pylon.position.copy(_a); pylon.scale.y = _a.distanceTo(_b) / 24;
    pylon.rotation.z = -Math.atan2(_b.x - _a.x, _b.y - _a.y);
    engine(g, engines, nx, ny, nz - 98, 6, glow, dark, pal.glow);
    blinker(g, nx + sx * 9.5, ny, nz + 60, sx < 0 ? new THREE.Color(3, 0.25, 0.2) : new THREE.Color(0.2, 3, 0.6), 0.9, sx < 0 ? 0 : 0.5, 6);
  }
  // white strobes on the saucer's rim and the stern, red beacon on the mast
  blinker(g, 0, SC.y, SC.z + 110 * SC.k, new THREE.Color(3, 3, 3), 1.1, 0.1, 7);
  blinker(g, 0, SC.y + 24, SC.z - 4, new THREE.Color(3, 0.3, 0.25), 0.6, 0.3, 6);
  blinker(g, 0, HY + 10, -180, new THREE.Color(3, 3, 3), 1.1, 0.6, 7);
  for (const sx of [-1, 1]) blinker(g, sx * 110, SC.y - 0.4, SC.z, sx < 0 ? new THREE.Color(3, 0.25, 0.2) : new THREE.Color(0.2, 3, 0.6), 0.9, sx < 0 ? 0 : 0.5, 6);
  // lit windows: rows round the saucer rim (top and bottom) and along the drive hull's flanks
  const winPos = [], winCol = [], cA = new THREE.Color(2.4, 1.9, 1.15), cB = new THREE.Color(1.2, 1.9, 2.6);
  const P0 = new THREE.Vector3(), N = new THREE.Vector3(), T = new THREE.Vector3(), Bt = new THREE.Vector3();
  const quad = (w, h) => {
    Bt.crossVectors(N, T).normalize();
    const c = Math.random() < 0.15 ? cB : cA, dim = 0.55 + Math.random() * 0.45;
    const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => P0.clone().addScaledVector(T, a * w).addScaledVector(Bt, b * h).addScaledVector(N, 0.18));
    for (const i of [0, 1, 2, 0, 2, 3]) { winPos.push(q[i].x, q[i].y, q[i].z); winCol.push(c.r * dim, c.g * dim, c.b * dim); }
  };
  for (const [r, top] of [[100, true], [93, true], [86, true], [102, false], [94, false], [80, false], [56, false]]) {
    const n = Math.round(r * 1.6);
    for (let i = 0; i < n; i++) {
      if (Math.random() < 0.3) continue;
      const a = (i / n) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      if (!top && r > 90 && Math.abs(sa * r) < 20 && ca < 0) continue; // over the neck
      P0.set(SC.x + sa * r, SC.y + sy(r, top), SC.z + ca * r * SC.k);
      const dy = (sy(r + 2, top) - sy(r - 2, top)) / 4;
      N.set(sa * -dy * (top ? 1 : -1), top ? 1 : -1, ca * -dy * (top ? 1 : -1)).normalize();
      N.set(sa * 0.55, top ? 0.85 : -0.85, ca * 0.55).normalize();
      T.set(ca, 0, -sa);
      quad(1.0, 0.45);
    }
  }
  for (const th of [0.35, 0.6, -0.15, -0.4, 2.8, 2.55, 3.3, 3.55]) for (let z = -150; z < 128; z += 3.6) {
    if (Math.random() < 0.3) continue;
    const r = hullR(z) + 0.15, cx = Math.cos(th), cy = Math.sin(th);
    P0.set(cx * r, HY + cy * r * HS, z);
    N.set(cx, cy / HS, 0).normalize();
    T.set(0, 0, 1);
    quad(0.55, 0.4);
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(winPos, 3));
  wg.setAttribute('color', new THREE.Float32BufferAttribute(winCol, 3));
  wg.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(winPos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  wg.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((winPos.length / 3) * 2).fill(0), 2));
  mk(g, wg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }), 0, 0, 0);
}

/** organic Aszendenz capital ship: ellipsoid hull (half-axes a, b, c), rib cage, curved blades, spines, veins */
function asz(g, M, engines, o) {
  const { hull, dark, strip, glow, pal } = M;
  const { a, b, c } = o;
  ell(g, hull, 0, 0, 0, a, b, c, 40);
  ell(g, dark, 0, -b * 0.35, -c * 0.05, a * 0.8, b * 0.75, c * 0.9, 28);          // darker ventral carapace
  const prow = new THREE.ConeGeometry(a * 0.32, o.prow * 2, 12); prow.rotateX(Math.PI / 2);
  mk(g, prow, dark, 0, 0, c * 0.86 + o.prow);
  ell(g, glow, 0, b * 0.1, c * 0.9, a * 0.18, b * 0.16, c * 0.05, 12);              // the glowing "eye" at the bow
  // ribs: chitin arches over the back, tilted to sweep aft
  for (const z of o.ribs) {
    const k = Math.sqrt(Math.max(0.1, 1 - (z / c) ** 2));
    const rib = mk(g, new THREE.TorusGeometry(o.ribR * k + a * 0.15, a * 0.07, 6, 28, Math.PI * 1.15), dark, 0, -b * 0.15, z);
    rib.rotation.set(-0.35, 0, -Math.PI * 0.075);
    rib.scale.set(1.15, 1, 1);
    const vein = mk(g, new THREE.TorusGeometry(o.ribR * k + a * 0.15, a * 0.018, 4, 28, Math.PI * 1.15), strip, 0, -b * 0.15 + a * 0.05, z + a * 0.04);
    vein.rotation.copy(rib.rotation); vein.scale.copy(rib.scale);
  }
  // curved blades: crescents sweeping back from the flanks
  for (const sx of [-1, 1]) {
    const t = new THREE.TorusGeometry(o.blade, a * 0.12, 6, 32, Math.PI * 0.55);
    const bl = mk(g, t, dark, sx * a * 0.4, 0, -c * 0.1);
    bl.rotation.set(Math.PI / 2, 0, sx > 0 ? Math.PI * 0.95 : Math.PI * 0.5);
    bl.scale.set(1, 1, 0.3);
    mk(g, new THREE.BoxGeometry(a * 0.04, b * 0.08, c * 1.2), strip, sx * a * 0.92, b * 0.15, -c * 0.05);   // flank vein
  }
  // dorsal spines
  for (let i = 0; i < o.spines; i++) {
    const z = c * 0.55 - (i / Math.max(1, o.spines - 1)) * c * 1.2, k = Math.sqrt(Math.max(0.05, 1 - (z / c) ** 2));
    const sp = new THREE.ConeGeometry(a * 0.07, b * (0.55 + (i % 2) * 0.35), 6);
    mk(g, sp, dark, 0, b * k * 0.98 + b * 0.2, z).rotation.x = -0.5;
  }
  if (o.crown) for (const z of [c * 0.25, -c * 0.35]) {
    const cr = mk(g, new THREE.TorusGeometry(a * 1.9, a * 0.09, 6, 48), dark, 0, 0, z); cr.scale.set(1, 0.75, 1);
    const cv = mk(g, new THREE.TorusGeometry(a * 1.9, a * 0.025, 4, 48), strip, 0, 0, z + a * 0.1); cv.scale.set(1, 0.75, 1);
    for (const ang of [0.6, 2.5, 3.8, 5.6]) beam(g, dark, Math.cos(ang) * a * 0.8, Math.sin(ang) * b * 0.8, z, Math.cos(ang) * a * 1.9, Math.sin(ang) * a * 1.42, z, a * 0.06, a * 0.12);
  }
  // drive cluster at the stern
  ell(g, dark, 0, 0, -c * 0.95, a * 0.55, b * 0.55, c * 0.12, 20);
  for (const [ex, ey] of o.eng) engine(g, engines, ex, ey, -c * 1.05, o.engR, glow, dark, pal.glow);
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
    // Aszendenz destroyer: an organic hull in a cage of chitin ribs, a lance-like prow, glowing veins
    asz(g, { hull, dark, strip, glow, pal }, engines, { a: 22, b: 18, c: 120, prow: 46, ribs: [70, 25, -20, -65], ribR: 27, blade: 62, spines: 6, eng: [[-9, 0], [9, 0], [0, 8]], engR: 7 });
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
    // Apotheose: the command ship - a vast organic spire, crowned by arcs, ribbed and veined
    asz(g, { hull, dark, strip, glow, pal }, engines, { a: 48, b: 38, c: 240, prow: 110, ribs: [150, 80, 10, -60, -130], ribR: 56, blade: 130, spines: 9, crown: true, eng: [[-22, 12], [22, 12], [-22, -12], [22, -12], [0, 0]], engR: 11 });
  }
  // surface detail on the warships and freighters: equipment blocks, vents, sensor domes, antennas, window strips
  const det = {
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
  switch (type) {
    case 'sperber': return sperber();
    case 'falke': return falke();
    case 'greif': return greif();
    case 'dorn': return dorn();
    case 'kurier': return kurier();
    case 'klinge': return klinge();
    case 'holt': return klinge(PAL.asz, true);
    case 'archon': return archon();
    case 'hammer': return hammer();
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
    if (o.userData.noBox) return; // covered by hand-made boxes (def.manualBoxes)
    if (def.capital && b && (bb.max.x > b[0] + 4 || bb.min.x < -b[0] - 4 || bb.max.y > b[1] + 4 || bb.min.y < -b[1] - 4 || bb.max.z > b[2] + 4 || bb.min.z < -b[2] - 4)) {
      const c = bb.getCenter(v.set(0, 0, 0)), h = bb.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      if (h.x * h.y * h.z > 8) extra.push([c.x, c.y, c.z, h.x, h.y, h.z]);
    }
  });
  if (extra.length && !def.torus) def.boxes = extra.sort((p, q) => q[3] * q[4] * q[5] - p[3] * p[4] * p[5]).slice(0, 16);
  if (def.manualBoxes) def.boxes = [...def.manualBoxes, ...(def.boxes || [])];
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
