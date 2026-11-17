import * as THREE from 'three';
import { glowTexture } from './fx.js';
import { exhaust } from './trails.js';
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
  // the one-winged gunship: a single great curved wing carries the main gun at its tip
  schwinge: { name: 'Schwinge', team: 1, hp: 84, shield: 64, speed: 205, turn: 1.35, dmg: 9, rof: 0.34, radius: 10, skill: 0.55, score: 320, missiles: 1, guns: [[6, 6, 6], [0, -0.6, 6]] },
  holt: { name: 'Holt', team: 1, hp: 150, shield: 120, speed: 232, turn: 1.75, dmg: 9, rof: 0.24, radius: 9, skill: 0.85, score: 1200, missiles: 4, guns: [[-4, 0, 6], [4, 0, 6]] },
  kurier: { name: 'Kurierschiff', team: 1, hp: 260, shield: 140, speed: 150, turn: 0.8, dmg: 0, rof: 99, radius: 11, skill: 0.2, score: 800, guns: [] },
  station: { name: 'Brutstätte', team: 1, capital: true, hp: 3000, speed: 0, radius: 200, box: [46, 46, 46], torus: [150, 17], dmg: 8, score: 3000, turrets: [[0, 50, 0], [0, -50, 0], [50, 0, 0], [-50, 0, 0], [0, 0, 50], [0, 0, -50], [150, 0, 0], [-150, 0, 0], [0, 150, 0], [0, -150, 0]] },
  gate: { name: 'Sprungtor', team: 3, capital: true, ghost: true, invulnerable: true, hp: 1e9, speed: 0, radius: 340, box: [1, 1, 1], turrets: [] },
  prison: { name: 'Ketten', team: 3, capital: true, invulnerable: true, hp: 1e9, speed: 22, radius: 55, box: [15, 13, 48], turrets: [] },
  valkyrie: { name: 'TUS Valkyrie', team: 3, capital: true, invulnerable: true, wreck: true, hp: 1e9, speed: 0, radius: 240, box: [6, 4, 30], turrets: [] },
  tanker: { name: 'Versorger', team: 0, capital: true, hp: 900, speed: 70, radius: 55, box: [19, 9.5, 48], dmg: 5, turrets: [[0, 13.7, 0]] },
  habitat: { name: 'Habitat Keth IV', team: 0, capital: true, hp: 3600, speed: 0, radius: 200, box: [46, 46, 46], torus: [150, 17], dmg: 6, turrets: [[0, 50, 0], [0, -50, 0], [150, 0, 0], [-150, 0, 0]] },
  relay: { name: 'Relaisstation', team: 1, capital: true, hp: 900, speed: 0, radius: 75, box: [14, 52, 14], dmg: 7, score: 900, turrets: [[0, 44, 12], [0, -30, 12], [12, 0, 0]] },
  aurora: { name: 'TUS Aurora', team: 0, capital: true, hp: 4200, speed: 12, radius: 240, box: [6, 4, 30], dmg: 7, turrets: [[18, 21.5, 132], [-18, 21.5, 132], [18, 21.5, 70], [-18, 21.5, 70], [0, 20.8, 150], [0, -42.6, -40], [24.4, -22, -90], [-24.4, -22, -90]] },
  transport: { name: 'Samariter', team: 0, capital: true, hp: 1000, speed: 38, radius: 55, box: [17, 7.5, 50], dmg: 6, turrets: [[0, 13.3, 0]] },
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
  for (let i = 0; i < 3 * k; i++) {
    const x = rnd(0, s), y = rnd(0, s), w = rnd(30, 90), h = rnd(20, 60);
    const v = Math.random() < 0.5 ? 'rgba(120,128,138,.14)' : 'rgba(205,200,185,.12)';
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

/** seeded random numbers, so colour, bump and roughness maps of a texture line up */
function seeded(seed) { let t = seed >>> 0; return () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }
/** irregular aerospace panel layout: the square is split recursively into large and small plates (no brick rows) */
function panelLayout(s, seed, minSize) {
  const R = seeded(seed), out = [];
  const split = (x, y, w, h, d) => {
    if ((w < minSize * 2 && h < minSize * 2) || (d > 2 && R() < 0.22)) { out.push([x, y, w, h]); return; }
    const vert = w > h * 1.3 ? true : h > w * 1.3 ? false : R() < 0.5;
    if (vert && w >= minSize * 2) { const k = Math.round((0.3 + R() * 0.4) * w); split(x, y, k, h, d + 1); split(x + k, y, w - k, h, d + 1); }
    else if (!vert && h >= minSize * 2) { const k = Math.round((0.3 + R() * 0.4) * h); split(x, y, w, k, d + 1); split(x, y + k, w, h - k, d + 1); }
    else out.push([x, y, w, h]);
  };
  split(0, 0, s, s, 0);
  return out;
}
/**
 * Painted / coated hull metal: a base coat over brushed metal, large plates with fine seams and bevel
 * highlights, fastener rows on some seams, access hatches, grilles and service ports, stencil markings.
 * mode: 'color' | 'bump' | 'rough' - drawn from the same layout so the three maps match.
 */
function metalHull(g, s, mode, o) {
  const R = seeded(o.seed + 99), P = panelLayout(s, o.seed, o.min);
  const C = mode === 'color', Bm = mode === 'bump';
  g.fillStyle = C ? '#c6c9cd' : Bm ? '#808080' : '#7a7a7a'; g.fillRect(0, 0, s, s);
  if (C) {
    // brushed metal showing through a thin coat, and broad tonal mottling of the paint
    for (let i = 0; i < s * 1.6; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '255,255,255' : '0,0,0'},${0.015 + R() * 0.03})`; g.fillRect(R() * s, R() * s, 20 + R() * 160, 1); }
    for (let i = 0; i < 26; i++) { const x = R() * s, y = R() * s, r = s * (0.08 + R() * 0.2); const gr = g.createRadialGradient(x, y, 0, x, y, r); const d = R() < 0.5; gr.addColorStop(0, `rgba(${d ? '60,62,68' : '255,255,255'},.06)`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  }
  for (const [x, y, w, h] of P) {
    // plates differ only slightly in tone or height
    const t = (R() - 0.5);
    if (C) { g.fillStyle = t > 0 ? `rgba(255,255,255,${t * 0.07})` : `rgba(20,22,26,${-t * 0.08})`; g.fillRect(x, y, w, h); }
    else if (Bm) { g.fillStyle = `rgba(${t > 0 ? '255,255,255' : '0,0,0'},${Math.abs(t) * 0.12})`; g.fillRect(x, y, w, h); }
    else { g.fillStyle = `rgba(${t > 0 ? '255,255,255' : '0,0,0'},${Math.abs(t) * 0.1})`; g.fillRect(x, y, w, h); }
    // seam: a fine groove with a bevel highlight
    if (C) { g.fillStyle = 'rgba(18,20,24,.6)'; g.fillRect(x, y, w, 1.2); g.fillRect(x, y, 1.2, h); g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(x + 1.2, y + 1.2, w - 1.2, 1); g.fillRect(x + 1.2, y + 1.2, 1, h - 1.2); }
    else if (Bm) { g.fillStyle = '#2a2a2a'; g.fillRect(x, y, w, 2); g.fillRect(x, y, 2, h); }
    else { g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x, y, w, 2); g.fillRect(x, y, 2, h); }
    // fasteners along some seams
    if (R() < 0.45) {
      g.fillStyle = C ? 'rgba(235,238,242,.35)' : Bm ? '#c8c8c8' : 'rgba(0,0,0,.3)';
      for (let k = 6; k < w - 4; k += 11) g.fillRect(x + k, y + 4, 1.6, 1.6);
      if (R() < 0.5) for (let k = 6; k < h - 4; k += 11) g.fillRect(x + 4, y + k, 1.6, 1.6);
    }
    // one detail on the larger plates
    if (w > o.min * 1.4 && h > o.min * 1.2 && R() < 0.55) {
      const kind = R(), cx = x + w * (0.25 + R() * 0.5), cy = y + h * (0.25 + R() * 0.5);
      const ink = C ? 'rgba(20,22,26,.55)' : Bm ? '#3a3a3a' : 'rgba(255,255,255,.3)';
      g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = 1.2;
      if (kind < 0.35) { // access hatch with rounded corners and a latch
        const hw = Math.min(w * 0.5, 60), hh = Math.min(h * 0.45, 40);
        g.beginPath(); g.roundRect ? g.roundRect(cx - hw / 2, cy - hh / 2, hw, hh, 5) : g.rect(cx - hw / 2, cy - hh / 2, hw, hh); g.stroke();
        if (C) { g.fillStyle = 'rgba(214,160,40,.7)'; g.fillRect(cx + hw / 2 - 8, cy - 3, 5, 6); }
      } else if (kind < 0.6) { // vent grille
        const n = 5 + (R() * 5 | 0), gw = Math.min(w * 0.5, 54);
        for (let i = 0; i < n; i++) g.fillRect(cx - gw / 2, cy - n * 2.5 + i * 5, gw, 2);
      } else if (kind < 0.8) { // service port with bolts
        const r = Math.min(w, h) * 0.12 + 5; g.beginPath(); g.arc(cx, cy, r, 0, 6.283); g.stroke();
        for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.283; g.fillRect(cx + Math.cos(a) * (r - 3) - 1, cy + Math.sin(a) * (r - 3) - 1, 2, 2); }
      } else if (C) { // stencil marking: a coloured bar and lines of small print
        g.fillStyle = o.accent; g.fillRect(cx - 18, cy - 6, 6, 12);
        g.fillStyle = 'rgba(30,32,36,.55)'; for (let i = 0; i < 3; i++) g.fillRect(cx - 9, cy - 6 + i * 4.5, 18 + R() * 22, 2);
      }
    }
  }
  if (C) {
    // hazard chevrons on a couple of edges
    for (let i = 0; i < 2; i++) {
      const x = R() * s, y = R() * s, w = 40 + R() * 50;
      g.save(); g.beginPath(); g.rect(x, y, w, 8); g.clip();
      for (let k = -10; k < w + 10; k += 8) { g.fillStyle = (k / 8) % 2 ? 'rgba(25,25,28,.7)' : 'rgba(214,170,40,.75)'; g.beginPath(); g.moveTo(x + k, y + 8); g.lineTo(x + k + 6, y); g.lineTo(x + k + 10, y); g.lineTo(x + k + 4, y + 8); g.fill(); }
      g.restore();
    }
  }
}

function textures() {
  if (TEX) return TEX;
  // capital-ship hull: coated metal plates at a larger scale, with wear
  const PAN = 1024;
  // roughness maps at half resolution (drawn scaled from the same layout)
  const panelRough = document.createElement('canvas'); panelRough.width = panelRough.height = PAN / 2;
  const prc = panelRough.getContext('2d'); prc.scale(0.5, 0.5);
  metalHull(prc, PAN, 'rough', { seed: 11, min: 44 });
  const panel = canvasTex(PAN, (g, s) => { metalHull(g, s, 'color', { seed: 11, min: 44, accent: 'rgba(214,96,30,.8)' }); weather(g, s, prc, 1.4); });
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
  // fighter hull: the same coated metal at fighter scale (larger plates per tile), bump + roughness maps
  const PLATE = 1024;
  const plateRoughC = document.createElement('canvas'); plateRoughC.width = plateRoughC.height = PLATE / 2;
  const plc = plateRoughC.getContext('2d'); plc.scale(0.5, 0.5);
  metalHull(plc, PLATE, 'rough', { seed: 5, min: 70 });
  const plate = canvasTex(PLATE, (g, s) => { metalHull(g, s, 'color', { seed: 5, min: 70, accent: 'rgba(214,96,30,.85)' }); weather(g, s, plc, 1.3); });
  const plateRough = new THREE.CanvasTexture(plateRoughC); plateRough.wrapS = plateRough.wrapT = THREE.RepeatWrapping;
  const panelRoughT = new THREE.CanvasTexture(panelRough); panelRoughT.wrapS = panelRoughT.wrapT = THREE.RepeatWrapping;
  const plateBump = canvasTex(512, (g, s) => { g.scale(0.5, 0.5); metalHull(g, PLATE, 'bump', { seed: 5, min: 70 }); }, false);
  for (const t of [plate, plateBump, plateRough]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1.4, 1.4); }
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
/** white strobes / beacons: modest HDR, so they don't outshine the ship in chase view */
const STROBE = new THREE.Color(1.6, 1.6, 1.6);
/**
 * nozzle throat: the drive colour, dimmer than the hull glow so the exhaust core reads as the hot
 * spot. Fighters reuse their dimmed 'line' material (set by craft()), so no extra draw call; their
 * glowing disc is small (sooty ring round it), the plume's glow billboard carries the hot spot.
 */
const THROAT = new Map();
let craftThroat = null;
function throat(color) {
  if (craftThroat) return craftThroat;
  const k = `${color.r},${color.g},${color.b}`;
  if (!THROAT.has(k)) THROAT.set(k, new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(0.45) }));
  return THROAT.get(k);
}
function engine(group, engines, x, y, z, r, glowMat, darkMat, color) {
  const sootBand = new THREE.CylinderGeometry(r * 1.06, r * 1.0, r * 0.7, 14, 1, true); sootBand.rotateX(Math.PI / 2);
  mk(group, sootBand, SOOT, x, y, z - r * 0.75);
  const n = new THREE.CylinderGeometry(r, r * 0.8, r * 2.2, 12, 1, true);
  n.rotateX(Math.PI / 2);
  mk(group, n, darkMat, x, y, z);
  const small = !!craftThroat, dr = small ? r * 0.6 : r * 0.85;
  const disc = new THREE.CircleGeometry(dr, 12);
  disc.rotateY(Math.PI);
  mk(group, disc, throat(color), x, y, z - r * 0.9);
  if (small) { // SOOT is already on every fighter (soot bands): merged, no extra draw call
    const ring = new THREE.RingGeometry(dr, r * 0.85, 12, 1);
    ring.rotateY(Math.PI);
    mk(group, ring, SOOT, x, y, z - r * 0.9);
  }
  // nozzle lip and inner vanes
  mk(group, new THREE.TorusGeometry(r * 1.0, r * 0.09, 6, 18), darkMat, x, y, z - r * 1.1);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2, vane = mk(group, new THREE.BoxGeometry(r * 0.08, r * 0.55, r * 0.9), darkMat, x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, z - r * 0.5);
    vane.rotation.z = a + Math.PI / 2;
  }
  // plasma core, halo and plume at the nozzle exit (scaled with the drive output by the game)
  const e = exhaust(color, r);
  e.position.set(x, y, z - r * 1.1);
  group.add(e);
  engines.push(e);
}

// hull materials with clearcoat / iridescence: switched off on the 'low' quality setting (phones)
const PHYS = [];
let shipDetail = 'high';
function phys(m) { m.userData.cc ??= m.clearcoat; m.userData.ir ??= m.iridescence; PHYS.push(m); applyDetail(m); return m; }
function applyDetail(m) {
  const lo = shipDetail !== 'high';
  const cc = lo ? 0 : m.userData.cc, ir = lo ? 0 : m.userData.ir;
  if (m.clearcoat !== cc || m.iridescence !== ir) { m.clearcoat = cc; m.iridescence = ir; m.needsUpdate = true; }
}
export function setShipDetail(q) { shipDetail = q; PHYS.forEach(applyDetail); }

const PAL = {
  union: { hull: 0x98a2ae, dark: 0x2c333d, accent: 0xff6a12, glow: new THREE.Color(0.5, 1.6, 4), canopy: 0x0a1626 },
  asz: { hull: 0x2d2438, dark: 0x120f18, accent: 0x6a1038, glow: new THREE.Color(4, 0.35, 1.3), canopy: 0x30040f },
  ace: { hull: 0x4a3a16, dark: 0x16110a, accent: 0xb07a12, glow: new THREE.Color(4, 1.6, 0.3), canopy: 0x30040f },
};
function mats(p) {
  const t = textures();
  return {
    // Union: painted, clear-coated metal; Aszendenz: dark chitin with an oily, iridescent sheen
    hull: phys(p === PAL.union
      ? new THREE.MeshPhysicalMaterial({ color: p.hull, map: t.plate, bumpMap: t.plateBump, bumpScale: 0.9, roughnessMap: t.plateRough, metalness: 0.62, roughness: 0.5, clearcoat: 0.55, clearcoatRoughness: 0.3 })
      : new THREE.MeshPhysicalMaterial({ color: p.hull, map: t.plate, bumpMap: t.plateBump, bumpScale: 0.6, roughnessMap: t.plateRough, metalness: 0.7, roughness: 0.38, iridescence: 0.75, iridescenceIOR: 1.35, iridescenceThicknessRange: [180, 520], clearcoat: 0.4, clearcoatRoughness: 0.2 })),
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
  blinker(g, 0, tailY, tailZ, STROBE, 0.8, 0.25, 2.2);
}
function decals(g, m, x, y, z, len, h) {
  for (const sx of [-1, 1]) { const d = mk(g, new THREE.PlaneGeometry(len, h), m.decal, sx * x, y, z); d.rotation.y = sx * Math.PI / 2; }
}
function craft(pal, build) {
  const root = new THREE.Group(), g = new THREE.Group();
  root.add(g);
  const m = mats(pal), engines = [];
  craftThroat = m.line;
  try { build(g, m, engines); } finally { craftThroat = null; }
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
/**
 * Schwinge: the Aszendenz one-winged gunship - a pod with a single great sail-like wing swept up and
 * out to starboard, the main gun at its tip, balanced by a small drive pod to port.
 */
function schwinge() {
  const P = PAL.asz;
  return craft(P, (g, m, engines) => {
    ell(g, m.hull, 0, 0, 0, 1.5, 1.2, 5.6, 18);
    ell(g, m.canopy, -0.2, 0.75, 2.4, 0.65, 0.45, 1.4, 12);
    const nose = new THREE.ConeGeometry(0.55, 3.2, 8); nose.rotateX(Math.PI / 2); mk(g, nose, m.dark, 0, 0, 6.8);
    // the wing: a thin, curved crescent sail from the pod's right shoulder up and out
    const sail = new THREE.Shape();
    sail.moveTo(0, -3.5); sail.quadraticCurveTo(3.5, -1.5, 8.4, 4.8); sail.lineTo(8.9, 6.6); sail.quadraticCurveTo(4.2, 2.6, 0.2, 2.8); sail.closePath();
    const sg = new THREE.ExtrudeGeometry(sail, { depth: 0.45, bevelEnabled: true, bevelThickness: 0.15, bevelSize: 0.2, bevelSegments: 2, curveSegments: 10 });
    sg.rotateX(Math.PI / 2); sg.translate(0, 0.22, 0); sg.rotateZ(0.95); scaleUV(sg, 0.12);
    const sailMat = m.hull.clone(); sailMat.color.set(0x6a5a82); sailMat.metalness = 0.15; phys(sailMat); // the sail catches the light
    mk(g, sg, sailMat, 0.8, 0.4, 0);
    // glowing veins along both edges of the sail (same transform as the sail: x-z plane, tilted up by 0.95 rad)
    // one vein on each face of the sail, so the glowing edges show from above and below
    const W = (T, x, y) => new THREE.Vector3(x * Math.cos(0.95) - T * Math.sin(0.95) + 0.8, x * Math.sin(0.95) + T * Math.cos(0.95) + 0.4, y);
    for (const T of [0.62, -0.63]) for (const [p0, c, p1] of [[[0, -3.5], [3.5, -1.5], [8.4, 4.8]], [[0.2, 2.8], [4.2, 2.6], [8.9, 6.6]]]) {
      const cv = new THREE.QuadraticBezierCurve3(W(T, ...p0), W(T, ...c), W(T, ...p1));
      mk(g, new THREE.TubeGeometry(cv, 16, 0.2, 6, false), m.line);
    }
    // tip: gun housing and a spike
    gunPod(g, m, 6, 6, 4.6, 1.4);
    ell(g, m.dark, 6, 6, 4.4, 0.55, 0.55, 1.4, 10);
    const sp = new THREE.ConeGeometry(0.3, 2.6, 6); sp.rotateX(-Math.PI / 2); mk(g, sp, m.dark, 6.2, 6.4, 2);
    // counterweight drive pod to port on a short strut
    beam(g, m.dark, -1.2, -0.2, -2.2, -3.4, -0.9, -2.6, 0.3, 2.2);
    tube(g, m.hull, -3.6, -0.9, -2.4, 0.6, 0.75, 4.6);
    engine(g, engines, -3.6, -0.9, -4.9, 0.6, m.glow, m.dark, P.glow);
    engine(g, engines, 0.3, 0, -6.2, 0.85, m.glow, m.dark, P.glow);
    tube(g, m.dark, 0, -0.6, 4.6, 0.12, 0.18, 2.4, 6);                               // chin gun
    for (let i = 0; i < 3; i++) { const c = new THREE.ConeGeometry(0.22, 1.5 - i * 0.3, 5); mk(g, c, m.dark, -0.3, 1.1, 0.5 - i * 1.6).rotation.x = -0.6; }
    decals(g, m, 1.52, 0, -0.5, 2.4, 0.9);
    blinker(g, 6.5, 6.8, 4, new THREE.Color(0.2, 3, 0.6), 1.1, 0.5, 1.8);
    blinker(g, -4.3, -0.9, -2.4, new THREE.Color(3, 0.25, 0.2), 1.1, 0, 1.8);
    blinker(g, 0, 1.4, -5.6, STROBE, 0.8, 0.25, 2.2);
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

function registryTexture(name = 'TUS AURORA', sub = 'CV-07 · TERRANISCHE UNION') {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 160;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 1024, 160);
  g.fillStyle = 'rgba(232,236,240,.92)'; g.font = '700 92px Rajdhani, sans-serif'; g.textBaseline = 'middle';
  g.fillText(name, 150, 70);
  g.font = '700 44px Rajdhani, sans-serif'; g.fillStyle = 'rgba(232,120,40,.95)'; g.fillText(sub, 152, 132);
  // union emblem: ring with a stylised star
  g.strokeStyle = 'rgba(232,120,40,.95)'; g.lineWidth = 9; g.beginPath(); g.arc(70, 80, 52, 0, 6.283); g.stroke();
  g.fillStyle = 'rgba(232,236,240,.92)'; g.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 16 : 40; g.lineTo(70 + Math.cos(a) * r, 80 + Math.sin(a) * r); }
  g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function carrier(g, engines, M, o = {}) {
  const { hull, dark, strip, accent, pal } = M;
  const W = !!o.wreck; // the TUS Valkyrie: a gutted sister ship
  const glow = W ? strip : M.glow;
  // drives: glowing on a live ship, cold sooty nozzles on the wreck
  const drv = (x, y, z, r) => {
    SHIPS[o.type || 'aurora'].manualBoxes.push([x, y, z - r * 0.5, r * 1.1, r * 1.1, r * 1.3]); // nozzles are hit too
    if (!W) return engine(g, engines, x, y, z, r, glow, dark, pal.glow);
    tube(g, dark, x, y, z, r, r * 0.8, r * 2.2); tube(g, SOOT, x, y, z - r * 1.1, r * 0.95, r * 0.95, r * 0.6);
  };
  const lamp = (...a) => { if (!W) blinker(g, ...a); };
  const coilMat = W ? dark : new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.85, 1.7) });
  const intakeMat = W ? SOOT : new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.9, 0.35) }); // warm glow of the field intakes
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
  // saucer UVs: u runs round the disc, v follows ln(r) (conformal), so plates keep their shape instead of pinching at the hub
  const sg = lathe(SAUCER, 72, 10, 3);
  { const uv = sg.attributes.uv, pos = sg.attributes.position, k = 10 / (2 * Math.PI), rim = Math.log(110);
    for (let i = 0; i < uv.count; i++) {
      const r = Math.max(14, Math.hypot(pos.getX(i), pos.getZ(i))), top = pos.getY(i) > -0.4;
      uv.setY(i, k * (top ? Math.log(r) : 2 * rim - Math.log(r)));
    } }
  const sauc = mk(g, sg, hull, SC.x, SC.y, SC.z); sauc.scale.z = SC.k;
  const rim = mk(g, new THREE.TorusGeometry(109, 1.1, 6, 96), dark, SC.x, SC.y - 0.4, SC.z); rim.rotation.x = Math.PI / 2; rim.scale.y = SC.k;
  const rimGlow = mk(g, new THREE.TorusGeometry(103, 0.35, 4, 96), strip, SC.x, SC.y + 2.1, SC.z); rimGlow.rotation.x = Math.PI / 2; rimGlow.scale.y = SC.k;
  // a disc's bounding box would leave solid empty corners: the saucer is hit-tested with stacked boxes instead
  for (const o of [sauc, rim, rimGlow]) o.userData.noBox = true;
  const DEF = SHIPS[o.type || 'aurora'], mbx = (DEF.manualBoxes = []);
  DEF.disc = { c: [SC.x, SC.y, SC.z], R: 110, k: SC.k, top: (r) => sy(r, true), bot: (r) => sy(r, false) }; // exact saucer shape for hits
  for (const r of [42, 74]) { const ring = mk(g, new THREE.TorusGeometry(r, 0.3, 4, 72), dark, SC.x, SC.y + sy(r, true) + 0.2, SC.z); ring.rotation.x = Math.PI / 2; ring.scale.y = SC.k; }
  // command deck: a low dome with a window band and a sensor mast
  const dome = mk(g, new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2), hull, SC.x, SC.y + 10.8, SC.z); dome.scale.set(15, 4.2, 15 * SC.k);
  const band = mk(g, new THREE.TorusGeometry(13.4, 0.35, 4, 40), strip, SC.x, SC.y + 12.6, SC.z); band.rotation.x = Math.PI / 2; band.scale.y = SC.k;
  mk(g, new THREE.CylinderGeometry(0.4, 0.7, 9, 6), dark, SC.x, SC.y + 19, SC.z - 4);
  mk(g, new THREE.CylinderGeometry(4.5, 4.5, 0.8, 16), dark, SC.x, SC.y + 15.2, SC.z - 4);
  // sensor array and impulse deck at the saucer's rear edge
  const sen = mk(g, new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), dark, SC.x, SC.y - 8.4, SC.z + 40); sen.scale.set(9, 3, 9); sen.rotation.x = Math.PI;
  mk(g, uvBox(40, 6.5, 14), dark, 0, SC.y + 3.5, SC.z - SC.k * 104 + 9);
  for (const ex of [-11, 11]) drv(ex, SC.y + 3.5, SC.z - SC.k * 104 + 1.6, 3.2);
  mk(g, uvBox(34, 1.2, 1.2), strip, 0, SC.y + 6.9, SC.z - SC.k * 104 + 3);
  // registry across the saucer's top and on both flanks of the drive hull
  const regMat = new THREE.MeshStandardMaterial({ map: W ? registryTexture('TUS VALKYRIE', 'CV-03 · TERRANISCHE UNION') : registryTexture(), transparent: true, roughness: 0.6, metalness: 0.2, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
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
  const drive = mk(g, dg, M.hullRot || hull, 0, HY, 0); drive.scale.y = HS;
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
  if (!W) { // the live ship's launch lights, energy field and clamps (shared materials driven by the game)
    [BAY_LIGHTS.red, BAY_LIGHTS.amber, BAY_LIGHTS.green].forEach((m, i) => mk(g, uvBox(2.2, 1.2, 0.6), m, (i - 1) * 3.2, by + hh - 1.6, mouth - 2));
    mk(g, new THREE.PlaneGeometry(hw * 2 - 1, hh * 2 - 1), BAY_LIGHTS.field, 0, by, mouth - 0.5);
    for (const z of [back + 16, back + 52]) for (const sx of [-1, 1]) {                        // parking spots with magnetic clamps
      mk(g, uvBox(2.4, 1.2, 5), dark, sx * 2.6, by - hh + 0.6, z);
      mk(g, uvBox(2.0, 0.25, 4.2), BAY_LIGHTS.clamp, sx * 2.6, by - hh + 1.25, z);
    }
  }
  // drive hull detail: dorsal and ventral rails, flank glow strips, stern drives
  mk(g, uvBox(6, 3, 200), dark, 0, HY + 24 * HS + 0.6, -40);
  mk(g, uvBox(8, 3, 160), dark, 0, HY - 24 * HS - 0.6, -10);
  for (const sx of [-1, 1]) mk(g, uvBox(0.6, 1.0, 230), coilMat, sx * 24.1, HY + 4, -20);
  mk(g, uvBox(24, 17, 12), dark, 0, HY, -172);
  for (const ex of [-6.5, 6.5]) drv(ex, HY, -180, 5.2);
  // --- warp nacelles on swept pylons, high and outboard at the stern
  const NAC = [[0.01, -98], [5.5, -98], [8.4, -94], [9.2, -80], [9.2, 70], [8.4, 84], [6.5, 92], [0.01, 95]];
  const nacGeo = lathe(NAC, 28, 3, 8); nacGeo.rotateX(Math.PI / 2);
  for (const sx of [-1, 1]) {
    const nx = sx * 64, ny = 16, nz = -102;
    const first = g.children.length, torn = W && sx > 0;
    mk(g, nacGeo, M.hullRot || hull, nx, ny, nz);
    const intake = mk(g, new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), intakeMat, nx, ny, nz + 89); intake.scale.set(7.4, 6.2, 7.4); intake.rotation.x = Math.PI / 2;
    mk(g, new THREE.TorusGeometry(8.9, 0.8, 6, 28), dark, nx, ny, nz + 88.5);
    mk(g, uvBox(1.2, 5.2, 140), coilMat, nx - sx * 9.05, ny, nz - 6);          // coil grilles facing inboard
    mk(g, uvBox(1.2, 5.2, 140), coilMat, nx, ny - 9.05, nz - 6).rotation.z = Math.PI / 2;
    mk(g, uvBox(3, 1.4, 150), dark, nx, ny + 9.2, nz);
    // pylon: from the drive hull's shoulder up and out to the nacelle
    const pl = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(56, 0), new THREE.Vector2(44, 24), new THREE.Vector2(16, 24)]);
    const pg = new THREE.ExtrudeGeometry(pl, { depth: 4, bevelEnabled: true, bevelThickness: 1, bevelSize: 1, bevelSegments: 1 });
    scaleUV(pg, 1 / 50); pg.rotateY(-Math.PI / 2); pg.translate(2, 0, -28);
    drv(nx, ny, nz - 98, 6);
    if (torn) mbx.pop(); // that nozzle tumbles away with its nacelle (the chain boxes cover it)
    lamp(nx + sx * 9.5, ny, nz + 60, sx < 0 ? new THREE.Color(3, 0.25, 0.2) : new THREE.Color(0.2, 3, 0.6), 0.9, sx < 0 ? 0 : 0.5, 6);
    if (torn) {
      // ripped off its pylon: drifting beside the hull, tumbled, with a scorched stump left behind
      const piv = new THREE.Vector3(nx, ny, nz), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, 0.35, 1.1)), off = new THREE.Vector3(55, -48, -40);
      for (const c of g.children.slice(first)) { c.position.sub(piv).applyQuaternion(q).add(piv).add(off); c.quaternion.premultiply(q); c.userData.noBox = true; }
      // its axis-aligned bounding boxes would be mostly empty: a chain of small boxes along the tumbled axis instead
      const mb = SHIPS[o.type].manualBoxes, ax = new THREE.Vector3(0, 0, 1).applyQuaternion(q), ctr = piv.clone().add(off);
      for (let k = -104; k <= 92; k += 10) { const h = Math.abs(k) > 80 ? 6.5 : 8.5, c = ctr.clone().addScaledVector(ax, k); mb.push([c.x, c.y, c.z, h, h, h]); }
    }
    const pylon = mk(g, pg, hull, 0, 0, 0);
    _a.set(sx * 16, HY + 8, nz); _b.set(nx, ny, nz);
    pylon.position.copy(_a); pylon.scale.y = (_a.distanceTo(_b) / 24) * (torn ? 0.42 : 1);
    pylon.rotation.z = -Math.atan2(_b.x - _a.x, _b.y - _a.y);
    // the pylon is a slanted plate: hit-test it as a few boxes along its length, not one big empty block
    pylon.updateMatrix(); pylon.userData.noBox = true;
    for (let si = 0, N = torn ? 4 : 9; si < N; si++) {
      const bb = new THREE.Box3(), v = new THREE.Vector3();
      for (const f of [si / N, (si + 1) / N]) for (const xs of [-3, 3]) for (const zs of [16 * f - 29, 29 - 12 * f]) bb.expandByPoint(v.set(xs, f * 24, zs).applyMatrix4(pylon.matrix));
      const c = bb.getCenter(new THREE.Vector3()), h = bb.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      mbx.push([c.x, c.y, c.z, h.x, h.y, h.z]);
    }
    if (torn) for (let i = 0; i < 5; i++) { // jagged ends of the stump
      const e = mk(g, uvBox(1.5 + i % 3, 2 + (i * 7) % 5, 6 + (i * 13) % 14), dark, _a.x + (_b.x - _a.x) * 0.42, _a.y + (_b.y - _a.y) * 0.42 + 2, nz - 20 + i * 10);
      e.rotation.set(i * 0.7, i * 1.3, i * 0.4); meshBox(mbx, e);
    }
  }
  // white strobes on the saucer's rim and the stern, red beacon on the mast
  lamp(0, SC.y, SC.z + 110 * SC.k, STROBE, 1.1, 0.1, 7);
  lamp(0, SC.y + 24, SC.z - 4, new THREE.Color(3, 0.3, 0.25), 0.6, 0.3, 6);
  lamp(0, HY + 10, -180, STROBE, 1.1, 0.6, 7);
  for (const sx of [-1, 1]) lamp(sx * 110, SC.y - 0.4, SC.z, sx < 0 ? new THREE.Color(3, 0.25, 0.2) : new THREE.Color(0.2, 3, 0.6), 0.9, sx < 0 ? 0 : 0.5, 6);
  // lit windows: rows round the saucer rim (top and bottom) and along the drive hull's flanks
  const winPos = [], winCol = [];
  const cA = W ? new THREE.Color(0.9, 0.32, 0.1) : new THREE.Color(2.4, 1.9, 1.15), cB = W ? new THREE.Color(0.5, 0.08, 0.05) : new THREE.Color(1.2, 1.9, 2.6);
  const gone = W ? 0.86 : 0.3; // share of dark windows
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
      if (Math.random() < gone) continue;
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
    if (Math.random() < gone) continue;
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
  // the windows sit on surfaces other hit boxes already cover: their bounding box would be a huge phantom block
  mk(g, wg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }), 0, 0, 0).userData.noBox = true;
  if (W) wreckDamage(g, dark, SC, sy, mbx);
}

/** battle damage on the Valkyrie: a burnt breach in the saucer, torn plating, embers and drifting debris */
function wreckDamage(g, dark, SC, sy, mbx) {
  const burn = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.9, 0.2) });
  const ember = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.35, 0.08) });
  const hole = new THREE.MeshBasicMaterial({ color: 0x050403 });
  let seed = 7; const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // the breach: a blackened, glowing-edged crater through the saucer's port side
  const a0 = 1.9, rr = 72, hx = SC.x + Math.sin(a0) * rr, hz = SC.z + Math.cos(a0) * rr * SC.k;
  const first = g.children.length;
  // jagged outline: a circle whose rim radius varies per vertex, laid onto the sloping deck
  const jag = (rad, jit, lift, top, mat) => {
    const c = new THREE.RingGeometry(0.001, 1, 32, 6); const p = c.attributes.position;
    const jk = []; for (let i = 0; i <= 32; i++) jk.push(1 + (R() - 0.5) * jit); jk[32] = jk[0];
    for (let i = 0; i < p.count; i++) { const rr = Math.hypot(p.getX(i), p.getY(i)), ai = Math.round(((Math.atan2(p.getY(i), p.getX(i)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 32), k = 1 + (jk[ai] - 1) * rr; p.setXY(i, p.getX(i) * k, p.getY(i) * k); }
    c.rotateX(top ? -Math.PI / 2 : Math.PI / 2);
    for (let i = 0; i < p.count; i++) {
      let wx = hx + p.getX(i) * rad.x, wz = hz + p.getZ(i) * rad.z;
      const rx = wx - SC.x, rz = (wz - SC.z) / SC.k, r0 = Math.hypot(rx, rz);
      if (r0 > 106) { wx = SC.x + (rx / r0) * 106; wz = SC.z + (rz / r0) * 106 * SC.k; } // stays inside the rim
      p.setXYZ(i, wx - hx, SC.y + sy(Math.min(r0, 106), top) + (top ? lift : -lift), wz - hz);
    }
    c.computeVertexNormals();
    return mk(g, c, mat, hx, 0, hz);
  };
  for (const top of [true, false]) {
    jag({ x: 40, z: 30 }, 0.5, 0.25, top, SOOT);
    jag({ x: 28, z: 20 }, 0.6, 0.45, top, ember);
    jag({ x: 25, z: 17 }, 0.55, 0.6, top, hole);
  }
  for (let i = 0; i < 26; i++) { // bent plates round the breach and along the hull
    const a = a0 + (R() - 0.5) * 0.7, r = rr + (R() - 0.5) * 40;
    const p = mk(g, uvBox(3 + R() * 9, 0.8 + R() * 1.5, 3 + R() * 10), dark, SC.x + Math.sin(a) * r, SC.y + (R() - 0.3) * 14, SC.z + Math.cos(a) * r * SC.k);
    p.rotation.set(R() * 2.5, R() * 3, R() * 2.5);
  }
  for (let i = 0; i < 14; i++) { // embers still glowing in the wreckage
    const a = a0 + (R() - 0.5) * 0.6, r = rr + (R() - 0.5) * 30;
    mk(g, uvBox(1 + R() * 2, 1 + R() * 2, 1 + R() * 2), i % 3 ? ember : burn, SC.x + Math.sin(a) * r, SC.y + (R() - 0.5) * 10, SC.z + Math.cos(a) * r * SC.k);
  }
  for (let i = 0; i < 12; i++) mk(g, uvBox(1 + R() * 2, 1 + R() * 2, 1 + R() * 2), ember, (R() - 0.5) * 40, -22 + (R() - 0.5) * 30, -150 + R() * 280);
  for (let i = 0; i < 18; i++) { // debris drifting round the wreck
    const w = 2 + R() * 10, h = 1 + R() * 4, l = 3 + R() * 16;
    const d = mk(g, uvBox(w, h, l), dark, (R() - 0.5) * 300, (R() - 0.5) * 120, (R() - 0.5) * 420);
    d.rotation.set(R() * 3, R() * 3, R() * 3);
    if (l > 6 || w > 6) chainBoxes(mbx, d, w, h, l); // bigger slabs can be hit (and bumped into)
  }
  for (const c of g.children.slice(first)) c.userData.noBox = true; // damage and small debris: no generated boxes
}

/** a torus-segment mesh as an analytic hit shape (def.arcs, see Game.hullDist); the mesh gets no box */
function addArc(def, mesh, R, tube, arc) {
  mesh.updateMatrix(); mesh.userData.noBox = true;
  const mat = mesh.matrix.clone(), sc = mesh.scale;
  const sxy = (sc.x + sc.y) / 2;
  (def.arcs ||= []).push({ mat, inv: mat.clone().invert(), R, arc, sxy, sz: sc.z, tA: tube * sxy, tB: tube * sc.z,
    cx: mesh.position.x, cy: mesh.position.y, cz: mesh.position.z, bound: R * Math.max(sc.x, sc.y, sc.z) + tube });
}
/** axis-aligned box of a mesh in the ship frame, as a manual hit box */
function meshBox(list, mesh) {
  mesh.updateMatrix(); mesh.geometry.computeBoundingBox();
  const bb = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrix), c = bb.getCenter(new THREE.Vector3()), h = bb.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  list.push([c.x, c.y, c.z, h.x, h.y, h.z]);
  mesh.userData.noBox = true;
}
/** a long slab (box mesh, length along its local z) as a chain of small cubes */
function chainBoxes(list, mesh, w, h, len) {
  mesh.updateMatrix(); mesh.userData.noBox = true;
  const hc = Math.max(Math.min(w, h) / 2, 1.5), n = Math.max(1, Math.ceil(len / (2 * hc))), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) { v.set(0, 0, -len / 2 + (i + 0.5) * (len / n)).applyMatrix4(mesh.matrix); list.push([v.x, v.y, v.z, hc, hc, hc]); }
}

/** organic Aszendenz capital ship: ellipsoid hull (half-axes a, b, c), rib cage, curved blades, spines, veins */
function asz(g, M, engines, o) {
  const { hull, dark, strip, glow, pal } = M;
  const { a, b, c } = o;
  // ribs and blades are arcs: their bounding boxes would be mostly empty, so they get a chain of small boxes
  const def = SHIPS[o.type];
  // hull, ventral carapace and stern drive cluster as exact ellipsoids [cx, cy, cz, a, b, c]
  def.ell = [[0, 0, 0, a, b, c], [0, -b * 0.35, -c * 0.05, a * 0.8, b * 0.75, c * 0.9], [0, 0, -c * 0.95, a * 0.55, b * 0.55, c * 0.12]]; def.arcs = []; const mb = (def.manualBoxes = []); // hull: an exact ellipsoid; ribs and blades: arcs
  const arcBoxes = (mesh, R, tube, arc) => addArc(def, mesh, R, tube, arc);
  ell(g, hull, 0, 0, 0, a, b, c, 40);
  ell(g, dark, 0, -b * 0.35, -c * 0.05, a * 0.8, b * 0.75, c * 0.9, 28).userData.noBox = true; // darker ventral carapace (def.ell)
  if (o.prow > 0) {
    const prow = new THREE.ConeGeometry(a * 0.32, o.prow * 2, 12); prow.rotateX(Math.PI / 2);
    mk(g, prow, dark, 0, 0, c * 0.86 + o.prow).userData.noBox = true;
    // the lance prow as stepped boxes that narrow toward the tip (its bounding box would be mostly empty)
    const L = o.prow * 2, z0 = c * 0.86;
    for (let i = 0; i < 6; i++) { const rr = a * 0.32 * (1 - i / 6); mb.push([0, 0, z0 + (i + 0.5) * (L / 6), rr, rr, L / 12]); }
  }
  ell(g, glow, 0, b * 0.1, c * 0.9, a * 0.18, b * 0.16, c * 0.05, 12);              // the glowing "eye" at the bow
  // ribs: chitin arches over the back, tilted to sweep aft
  for (const z of o.ribs) {
    const k = Math.sqrt(Math.max(0.1, 1 - (z / c) ** 2));
    const rr = o.ribR * k + a * 0.15;
    const rib = mk(g, new THREE.TorusGeometry(rr, a * 0.07, 6, 28, Math.PI * 1.15), dark, 0, -b * 0.15, z);
    rib.rotation.set(-0.35, 0, -Math.PI * 0.075);
    rib.scale.set(1.15, 1, 1);
    arcBoxes(rib, rr, a * 0.07, Math.PI * 1.15);
    const vein = mk(g, new THREE.TorusGeometry(rr, a * 0.018, 4, 28, Math.PI * 1.15), strip, 0, -b * 0.15 + a * 0.05, z + a * 0.04);
    vein.rotation.copy(rib.rotation); vein.scale.copy(rib.scale); vein.userData.noBox = true;
  }
  // curved blades: crescents sweeping back from the flanks
  for (const sx of [-1, 1]) {
    const t = new THREE.TorusGeometry(o.blade, a * 0.12, 6, 32, Math.PI * 0.55);
    const bl = mk(g, t, dark, sx * a * 0.4, 0, -c * 0.1);
    bl.rotation.set(Math.PI / 2, 0, sx > 0 ? -Math.PI * 0.05 : Math.PI * 0.5); // mirrored: one sweeps to each side
    bl.scale.set(1, 1, 0.3);
    arcBoxes(bl, o.blade, a * 0.12, Math.PI * 0.55);
    const fv = mk(g, new THREE.BoxGeometry(a * 0.04, b * 0.08, c * 1.2), strip, sx * a * 0.92, b * 0.15, -c * 0.05);   // flank vein
    meshBox(mb, fv); // axis-aligned strip: its own box is exact
  }
  // dorsal spines
  for (let i = 0; i < o.spines; i++) {
    const z = c * 0.55 - (i / Math.max(1, o.spines - 1)) * c * 1.2, k = Math.sqrt(Math.max(0.05, 1 - (z / c) ** 2));
    const sp = new THREE.ConeGeometry(a * 0.07, b * (0.55 + (i % 2) * 0.35), 6);
    const spm = mk(g, sp, dark, 0, b * k * 0.98 + b * 0.2, z); spm.rotation.x = -0.5;
    meshBox(mb, spm);
  }
  if (o.crown) for (const z of [c * 0.25, -c * 0.35]) {
    const cr = mk(g, new THREE.TorusGeometry(a * 1.9, a * 0.09, 6, 48), dark, 0, 0, z); cr.scale.set(1, 0.75, 1);
    arcBoxes(cr, a * 1.9, a * 0.09, Math.PI * 2);
    const cv = mk(g, new THREE.TorusGeometry(a * 1.9, a * 0.025, 4, 48), strip, 0, 0, z + a * 0.1); cv.scale.set(1, 0.75, 1); cv.userData.noBox = true;
    for (const ang of [0.6, 2.5, 3.8, 5.6]) beam(g, dark, Math.cos(ang) * a * 0.8, Math.sin(ang) * b * 0.8, z, Math.cos(ang) * a * 1.9, Math.sin(ang) * a * 1.42, z, a * 0.06, a * 0.12);
  }
  // drive cluster at the stern
  ell(g, dark, 0, 0, -c * 0.95, a * 0.55, b * 0.55, c * 0.12, 20).userData.noBox = true; // drive cluster (def.ell)
  for (const [ex, ey] of o.eng) engine(g, engines, ex, ey, -c * 1.05, o.engR, glow, dark, pal.glow);
}

/** small Union nacelle for freighters (no warp coils, a plain drive) */
function freightNacelle(g, M, engines, x, y, z, r, len) {
  const { dark, glow, pal, strip } = M;
  tube(g, M.tank, x, y, z, r * 0.9, r, len, 16);
  ell(g, dark, x, y, z + len / 2, r * 0.9, r * 0.9, r * 0.7, 14);
  mk(g, new THREE.TorusGeometry(r * 0.95, r * 0.12, 6, 18), strip, x, y, z + len / 2 - r * 0.3);
  engine(g, engines, x, y, z - len / 2 - r * 0.3, r * 0.85, glow, dark, pal.glow);
}
/** Samariter: medical transport - a rounded command section, two long ward modules, a drive section with nacelles */
function samariter(g, engines, M) {
  const { hull, dark, strip, accent } = M;
  ell(g, hull, 0, 3, 34, 13, 7.5, 17, 28);                                          // command section
  ell(g, M.bridge, 0, 5.4, 49.6, 4.2, 1.1, 1.4, 24);                                 // bridge windows
  tube(g, dark, 0, 0, 0, 4.5, 5, 80, 16);                                           // spine
  for (const sx of [-1, 1]) {
    tube(g, M.hullRot, sx * 10.5, 0, -2, 6.2, 6.2, 58, 20);                        // ward modules
    ell(g, hull, sx * 10.5, 0, 27, 6.2, 6.2, 4, 18); ell(g, dark, sx * 10.5, 0, -31, 6, 6, 3, 18);
    for (const z of [-24, -6, 12]) { const rg = mk(g, new THREE.TorusGeometry(6.4, 0.45, 6, 24), dark, sx * 10.5, 0, z); rg.scale.set(1, 1, 1.5); }
    for (const yy of [3.6, -3.0]) mk(g, uvBox(0.4, 0.6, 50), M.ward, sx * (10.5 + 5.6), yy, -2);   // lit ward windows, clear of the name
    const band = mk(g, uvBox(0.5, 3.6, 10), accent, sx * (10.5 + 6.1), 0, 18);    // livery band
    beam(g, dark, sx * 4, 0, 12, sx * 5.5, 0, 12, 1.4, 6); beam(g, dark, sx * 4, 0, -20, sx * 5.5, 0, -20, 1.4, 6);
    freightNacelle(g, M, engines, sx * 15, 8, -42, 3.4, 26);
    beam(g, hull, sx * 4, 3, -40, sx * 13, 7.5, -42, 1.4, 10);
  }
  mk(g, uvBox(8, 4, 40), hull, 0, 11.2, 4);                                         // dorsal deck (turret mount)
  mk(g, uvBox(18, 14, 14), dark, 0, 0, -44);                                        // drive section
  for (const ex of [-5, 5]) engine(g, engines, ex, 0, -52, 3.4, M.glow, dark, M.pal.glow);
  // medical emblem and name on both flanks of the wards
  const reg = new THREE.MeshStandardMaterial({ map: registryTexture('SAMARITER', 'MED-04 · LAZARETTSCHIFF'), transparent: true, roughness: 0.6, metalness: 0.2, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const sx of [-1, 1]) { const d = mk(g, new THREE.PlaneGeometry(16, 2.5), reg, sx * (10.5 + 6.3), 0.2, 3); d.rotation.y = sx * Math.PI / 2; }
  for (const sx of [-1, 1]) blinker(g, sx * 17, 0, 0, sx < 0 ? new THREE.Color(3, 0.25, 0.2) : new THREE.Color(0.2, 3, 0.6), 0.9, sx < 0 ? 0 : 0.5, 3);
  blinker(g, 0, 14, 4, STROBE, 1.1, 0.2, 3.5);
}
/** fuel tanker: a command module, a truss spine carrying six pressure tanks, a drive section with nacelles */
function tankerShip(g, engines, M) {
  const { hull, dark, strip, accent } = M;
  ell(g, hull, 0, 3, 44, 9, 7, 10, 24);
  ell(g, M.bridge, 0, 5.4, 52.6, 3.4, 1.0, 1.4, 10);
  mk(g, uvBox(5, 5, 96), dark, 0, 0, 0);                                             // truss spine
  for (let z = -40; z <= 36; z += 8) for (const sx of [-1, 1]) { const st = mk(g, uvBox(0.5, 0.5, 7), dark, sx * 2.6, 2.6 * (z % 16 ? 1 : -1), z); st.rotation.x = 0.7; }
  for (const z of [26, 4, -18]) for (const sx of [-1, 1]) {
    ell(g, M.tank, sx * 9.6, 0, z, 9, 9, 9.6, 22).rotation.y = z * 0.37 + sx;    // pressure tank (no windows; turned to break the repeat)
    const b = mk(g, new THREE.TorusGeometry(9.05, 0.4, 6, 32), dark, sx * 9.6, 0, z); b.rotation.y = Math.PI / 2;
    const h = mk(g, new THREE.TorusGeometry(9.1, 0.25, 4, 32), accent, sx * 9.6, 0, z); h.rotation.x = Math.PI / 2;  // hazard ring
    tube(g, dark, sx * 4, 6, z, 0.6, 0.6, 18, 8);                                    // fuel line
  }
  mk(g, uvBox(8, 4, 50), hull, 0, 11.6, 4);                                         // dorsal walkway (turret mount)
  for (const sx of [-1, 1]) mk(g, uvBox(0.3, 0.4, 88), M.ward, sx * 2.55, 0, 0);  // light strip along the truss
  mk(g, uvBox(18, 14, 14), dark, 0, 0, -44);
  for (const sx of [-1, 1]) { freightNacelle(g, M, engines, sx * 14, 7, -42, 3, 22); beam(g, hull, sx * 4, 3, -42, sx * 12, 6.5, -42, 1.2, 8); }
  for (const ex of [-5, 5]) engine(g, engines, ex, 0, -52, 3.4, M.glow, dark, M.pal.glow);
  const reg = new THREE.MeshStandardMaterial({ map: registryTexture('VERSORGER', 'DV-11 · DEUTERIUMTRANSPORT'), transparent: true, roughness: 0.6, metalness: 0.2, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const sx of [-1, 1]) { const d = mk(g, new THREE.PlaneGeometry(16, 2.5), reg, sx * 4.05, 11.6, 4); d.rotation.y = sx * Math.PI / 2; }
  for (const sx of [-1, 1]) blinker(g, sx * 19, 0, 4, sx < 0 ? new THREE.Color(3, 0.25, 0.2) : new THREE.Color(0.2, 3, 0.6), 0.9, sx < 0 ? 0 : 0.5, 3);
  blinker(g, 0, 14.5, 4, STROBE, 1.1, 0.2, 3.5);
}
/** Ketten: glowing prisoner cells along the flanks, chain links, the bow maw a fighter can launch from */
function prisonDetail(g, M) {
  const { dark, strip } = M;
  const cell = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.25, 0.7) });
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const z = 30 - i * 9, k = Math.sqrt(Math.max(0.1, 1 - (z / 46) ** 2));
      ell(g, dark, sx * 13.5 * k, -2, z, 2.4, 3.2, 3.2, 12);
      ell(g, cell, sx * (13.5 * k + 2.2), -2, z, 0.45, 2.1, 2.1, 12);                 // the lit cell window, proud of the pod
    }
    for (let i = 0; i < 7; i++) {                                                    // chain links along the back, on the hull
      const z = 26 - i * 8, hs = 12 * Math.sqrt(Math.max(0, 1 - (6 / 14) ** 2 - (z / 46) ** 2));
      const link = mk(g, new THREE.TorusGeometry(1.4, 0.35, 6, 14), dark, sx * 6, hs + (i % 2 ? 0.8 : 0.3), z);
      link.rotation.set(Math.PI / 2, i % 2 ? Math.PI / 2 : 0, 0); link.scale.set(1, 1.6, 1);
    }
  }
  // docking maw: a dark opening ringed by veins (a fighter launches from here in the rescue scene)
  const A = 14, B = 12, C = 46, MX = 7.4, MY = 3.6, MCY = -1.2;
  const onHull = (x, y, lift) => C * Math.sqrt(Math.max(0, 1 - (x / A) ** 2 - (y / B) ** 2)) + lift;
  const mg = new THREE.RingGeometry(0.001, 1, 32, 8), mp = mg.attributes.position; // interior rings: follows the curve
  for (let i = 0; i < mp.count; i++) { const x = mp.getX(i) * MX, y = MCY + mp.getY(i) * MY; mp.setXYZ(i, x, y, onHull(x, y, 0.12)); }
  mg.computeVertexNormals();
  const maw = mk(g, mg, new THREE.MeshBasicMaterial({ color: 0x030204, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
  maw.userData.noBox = true;
  const lipPts = [];
  for (let i = 0; i < 40; i++) { const t = (i / 40) * Math.PI * 2, x = Math.cos(t) * MX * 1.05, y = MCY + Math.sin(t) * MY * 1.08; lipPts.push(new THREE.Vector3(x, y, onHull(x, y, 0.2))); }
  const lip = mk(g, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(lipPts, true), 60, 0.4, 6, true), strip); lip.userData.noBox = true;
}

function capital(type) {
  const root = new THREE.Group();
  const g = new THREE.Group();
  root.add(g);
  const t = textures();
  const wreck = !!SHIPS[type].wreck;
  const union = SHIPS[type].team === 0 || wreck;
  const pal = union ? PAL.union : PAL.asz;
  // Union: clear-coated hull metal; Aszendenz: iridescent chitin; the wreck: burnt, dull plating
  const hull = new THREE.MeshPhysicalMaterial({
    color: union ? 0x8f98a4 : 0x3a2f48, map: t.panel, roughnessMap: t.panelRough, metalness: union ? 0.6 : 0.7, roughness: union ? 0.5 : 0.4,
    clearcoat: union ? 0.45 : 0.35, clearcoatRoughness: 0.3,
    iridescence: union ? 0 : 0.7, iridescenceIOR: 1.35, iridescenceThicknessRange: [180, 520],
    emissiveMap: t.windows, emissive: wreck ? new THREE.Color(0.35, 0.18, 0.08) : union ? new THREE.Color(1.8, 1.5, 0.9) : new THREE.Color(2.4, 0.3, 0.8),
  });
  if (wreck) { hull.color.set(0x6a6e74); hull.metalness = 0.35; hull.roughness = 0.85; hull.clearcoat = 0; }
  phys(hull);
  // tubes and lathes run their u round the circumference: the window map rotated so rows run along the hull
  const winRot = t.windows.clone(); winRot.center.set(0.5, 0.5); winRot.rotation = Math.PI / 2; winRot.repeat.set(1, 3);
  const hullRot = phys(hull.clone()); hullRot.emissiveMap = winRot;
  // pressure tanks and nacelles: hull metal without cabin windows
  const tank = phys(hull.clone()); tank.emissiveMap = null; tank.emissive.set(0);
  const bridge = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 1.0, 0.6) });
  const ward = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.8, 1.3) });
  const dark = new THREE.MeshStandardMaterial({ color: union ? 0x30363f : 0x15111c, map: t.panel, roughnessMap: t.panelRough, metalness: 0.75, roughness: 0.7 });
  const glow = new THREE.MeshBasicMaterial({ color: pal.glow });
  const accent = new THREE.MeshStandardMaterial({ color: pal.accent, metalness: 0.4, roughness: 0.5 });
  const strip = new THREE.MeshBasicMaterial({ color: wreck ? new THREE.Color(0.25, 0.08, 0.04) : union ? new THREE.Color(0.6, 1.8, 3) : new THREE.Color(3, 0.3, 0.9) });
  const engines = [];
  const B = (w, h, d, mat, x, y, z) => mk(g, uvBox(w, h, d), mat, x, y, z);
  const turretGeo = new THREE.SphereGeometry(3.2, 10, 6, 0, 6.3, 0, 1.6);

  if (type === 'aurora') {
    carrier(g, engines, { hull, hullRot, dark, glow, strip, accent, pal });
  } else if (type === 'valkyrie') {
    // the TUS Valkyrie: a sister ship of the Aurora, gutted in the war
    carrier(g, engines, { hull, hullRot, dark, glow, strip, accent, pal }, { wreck: true, type });
  } else if (type === 'transport') {
    samariter(g, engines, { hull, hullRot, tank, bridge, ward, dark, glow, strip, accent, pal });
  } else if (type === 'tanker') {
    tankerShip(g, engines, { hull, hullRot, tank, bridge, ward, dark, glow, strip, accent, pal });
  } else if (type === 'prison') {
    // Aszendenz prison transport: an organic hull, glowing cell pods, chain-link ribs, a docking maw in the bow
    asz(g, { hull, dark, strip, glow, pal }, engines, { type, a: 14, b: 12, c: 46, prow: 0, ribs: [26, 8, -10, -28], ribR: 16, blade: 32, spines: 5, eng: [[-5, 0], [5, 0]], engR: 3.6 });
    prisonDetail(g, { hull, dark, strip, glow });
  } else if (type === 'zerstoerer') {
    // Aszendenz destroyer: an organic hull in a cage of chitin ribs, a lance-like prow, glowing veins
    asz(g, { hull, dark, strip, glow, pal }, engines, { type, a: 22, b: 18, c: 120, prow: 46, ribs: [70, 25, -20, -65], ribR: 27, blade: 62, spines: 6, eng: [[-9, 0], [9, 0], [0, 8]], engR: 7 });
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
    asz(g, { hull, dark, strip, glow, pal }, engines, { type, a: 48, b: 38, c: 240, prow: 110, ribs: [150, 80, 10, -60, -130], ribR: 56, blade: 130, spines: 9, crown: true, eng: [[-22, 12], [22, 12], [-22, -12], [22, -12], [0, 0]], engR: 11 });
  }
  // surface detail on the warships and freighters: equipment blocks, vents, sensor domes, antennas, window strips
  const det = {
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
    case 'schwinge': return schwinge();
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
    if (!o.isMesh || !o.geometry || o.userData.plume) return; // exhaust plumes are not hull
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
