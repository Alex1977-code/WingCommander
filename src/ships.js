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
  aurora: { name: 'TUS Aurora', team: 0, capital: true, hp: 4200, speed: 12, radius: 215, box: [34, 30, 205], dmg: 7, turrets: [[30, 20, 120], [-30, 20, 120], [30, 20, -60], [-30, 20, -60], [0, 34, 0], [0, -26, 60]] },
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
function textures() {
  if (TEX) return TEX;
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
  TEX = { panel, windows };
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
function engine(group, engines, x, y, z, r, glowMat, darkMat, color) {
  const n = new THREE.CylinderGeometry(r, r * 0.8, r * 2.2, 12, 1, true);
  n.rotateX(Math.PI / 2);
  mk(group, n, darkMat, x, y, z);
  const disc = new THREE.CircleGeometry(r * 0.85, 12);
  disc.rotateY(Math.PI);
  mk(group, disc, glowMat, x, y, z - r * 0.9);
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
    hull: new THREE.MeshStandardMaterial({ color: p.hull, map: t.panel, metalness: 0.75, roughness: 0.38 }),
    dark: new THREE.MeshStandardMaterial({ color: p.dark, metalness: 0.8, roughness: 0.5 }),
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
    const f = mk(g, fuselageGeo(o.noseR, o.bodyR, L * 0.62), m.hull, hx, 0, L * 0.19);
    f.scale.set(o.wide, o.flat, 1);
    const r = mk(g, fuselageGeo(o.bodyR, o.bodyR * 0.78, L * 0.38), m.hull, hx, 0, -L * 0.31);
    r.scale.set(o.wide, o.flat, 1);
    const c = mk(g, new THREE.SphereGeometry(1, 16, 10), m.canopy, hx, o.bodyR * o.flat * 0.62, L * 0.1);
    c.scale.set(o.bodyR * 0.52, o.bodyR * 0.5, L * 0.17);
  }
  if (o.twin) mk(g, new THREE.BoxGeometry(o.twin * 2, o.bodyR * 0.7, L * 0.35), m.dark, 0, 0, -L * 0.1);

  // wings
  const wg = wingGeo(o.span, o.root, o.tip, o.sweep);
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
  // intake / detail
  mk(g, new THREE.BoxGeometry(o.bodyR * o.wide * 1.5, o.bodyR * 0.35, L * 0.2), m.dark, 0, -o.bodyR * o.flat * 0.75, 0);
  if (o.pal !== PAL.union) {
    mk(g, new THREE.BoxGeometry(0.18, 0.18, L * 0.5), m.line, 0, o.bodyR * o.flat * 1.0, -L * 0.2);
  }
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

function capital(type) {
  const root = new THREE.Group();
  const g = new THREE.Group();
  root.add(g);
  const t = textures();
  const wreck = !!SHIPS[type].wreck;
  const union = SHIPS[type].team === 0 || wreck;
  const pal = union ? PAL.union : PAL.asz;
  const hull = new THREE.MeshStandardMaterial({
    color: union ? 0x8a94a0 : 0x3a2f48, map: t.panel, metalness: 0.7, roughness: 0.5,
    emissiveMap: t.windows, emissive: wreck ? new THREE.Color(0.35, 0.18, 0.08) : union ? new THREE.Color(1.8, 1.5, 0.9) : new THREE.Color(2.4, 0.3, 0.8),
  });
  if (wreck) { hull.color.set(0x4a4f57); hull.roughness = 0.85; }
  const dark = new THREE.MeshStandardMaterial({ color: union ? 0x30363f : 0x15111c, map: t.panel, metalness: 0.8, roughness: 0.55 });
  const glow = new THREE.MeshBasicMaterial({ color: pal.glow });
  const accent = new THREE.MeshStandardMaterial({ color: pal.accent, metalness: 0.4, roughness: 0.5 });
  const strip = new THREE.MeshBasicMaterial({ color: wreck ? new THREE.Color(0.25, 0.08, 0.04) : union ? new THREE.Color(0.6, 1.8, 3) : new THREE.Color(3, 0.3, 0.9) });
  const engines = [];
  const B = (w, h, d, mat, x, y, z) => mk(g, uvBox(w, h, d), mat, x, y, z);
  const turretGeo = new THREE.SphereGeometry(3.2, 10, 6, 0, 6.3, 0, 1.6);

  if (type === 'aurora' || type === 'valkyrie') {
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
  } else if (type === 'transport' || type === 'prison') {
    B(22, 20, 70, hull, 0, 0, 5);
    const bow = B(22, 20, 22, hull, 0, 0, 48); bow.scale.set(0.6, 0.6, 1);
    B(26, 6, 40, accent, 0, 0, 5);
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
  } else if (type === 'station' || type === 'gate') {
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
    if (gate) {
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
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
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

const TEMPLATES = {};
export function buildShip(type) {
  if (!TEMPLATES[type]) {
    const t = makeShip(type);
    mergeByMaterial(t.getObjectByName('body'));
    t.traverse((o) => {
      if (o.geometry) o.geometry.userData.shared = true;
      if (o.material) o.material.userData.shared = true;
    });
    TEMPLATES[type] = t;
  }
  const root = TEMPLATES[type].clone();
  const engines = [];
  root.traverse((o) => { if (o.userData.engine) engines.push(o); });
  root.userData = { body: root.getObjectByName('body'), engines };
  return root;
}
