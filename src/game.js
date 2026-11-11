import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildShip, SHIPS, BAY, BAY_LIGHTS } from './ships.js';
import { createEnvironment, createAsteroids } from './env.js';
import { Fx, glowTexture, setParticleScale } from './fx.js';
import { drawHud } from './hud.js';
import { CHARS } from './campaign.js';
import { installCutscenes, passes } from './cutscene.js';
import { Cockpit } from './cockpit.js';

const BOLT_SPEED = 950, BOLT_LIFE = 1.15;
const t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), t3 = new THREE.Vector3(), t4 = new THREE.Vector3(), tBox = new THREE.Vector3(), tBump = new THREE.Vector3(), tSeg = new THREE.Vector3();
/** squared distance from point c to the segment a-b */
function segDist2(a, b, c) {
  tSeg.subVectors(b, a);
  const l2 = tSeg.lengthSq();
  const k = l2 > 0 ? THREE.MathUtils.clamp(tSeg.dot(tBox.subVectors(c, a)) / l2, 0, 1) : 0;
  return tBox.copy(a).addScaledVector(tSeg, k).distanceToSquared(c);
}
const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), q3 = new THREE.Quaternion();
const t5 = new THREE.Vector3();
const m1 = new THREE.Matrix4();
const ZERO = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), FWD = new THREE.Vector3(0, 0, 1);
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);
// pilot eye position inside each fighter (ship space, +Z forward)
const EYE = { sperber: [0, 1.15, 1.6], falke: [0, 1.25, 1.8], greif: [0, 1.4, 2.0] };
const FLIP = new THREE.Quaternion().setFromAxisAngle(AY, Math.PI);
const rnd = (a, b) => a + Math.random() * (b - a);

const COL = {
  ally: new THREE.Color(0.5, 2.2, 4.5), foe: new THREE.Color(4.5, 0.5, 1.2), turret: new THREE.Color(1.2, 4, 1.0), turretFoe: new THREE.Color(4.5, 1.6, 0.3),
  shield: new THREE.Color(0.6, 1.6, 3), spark: new THREE.Color(3, 1.8, 0.6),
};
export const PILOT_COLORS = ['#7fd6ff', '#ffb347'];
const TRAIL_ALLY = { r: 0.35, g: 0.9, b: 2.2 }, TRAIL_FOE = { r: 2.2, g: 0.25, b: 0.7 };

/** Free GPU resources of a removed object (geometries + materials; textures are shared caches). */
function disposeObj(o) {
  o.traverse?.((c) => {
    if (c.geometry && !c.geometry.userData?.shared) c.geometry.dispose();
    const m = c.material;
    if (m && !m.userData?.shared) (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
  });
}
let MISSILE = null, MINE = null;
function missileRes() {
  if (MISSILE) return MISSILE;
  const mk = (len) => { const g = new THREE.CylinderGeometry(0.35, 0.35, len, 6); g.rotateX(Math.PI / 2); g.userData.shared = true; return g; };
  const sprite = (c) => { const m = new THREE.SpriteMaterial({ map: glowTexture(), color: c, blending: THREE.AdditiveBlending, depthWrite: false }); m.userData.shared = true; return m; };
  const mat = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.6, roughness: 0.4 });
  mat.userData.shared = true;
  MISSILE = { body: mk(4.5), torp: mk(7), mat, glowAlly: sprite(new THREE.Color(3, 2.4, 1.2)), glowFoe: sprite(new THREE.Color(4, 0.6, 0.6)) };
  return MISSILE;
}
function disposeComposer(c) {
  if (!c) return;
  c.passes.forEach((p) => p.dispose?.());
  c.dispose();
}

const ENEMY_TOUGH = 1.7;
const MSL_CONE = Math.cos((22 * Math.PI) / 180);

export class Game {
  constructor(canvas, hudCanvas, audio, ui) {
    this.audio = audio; this.ui = ui;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.camera = new THREE.PerspectiveCamera(62, 1, 2, 90000);
    this.hudCanvas = hudCanvas;
    this.hud = hudCanvas.getContext('2d');
    this.quality = 'high';
    this.invert = false;
    this.mode = 'idle';
    this.paused = false;
    this.pilots = [];
    this.ships = []; this.bolts = []; this.missiles = []; this.asteroids = []; this.dying = [];
    this.boltPool = [];
    this.boltGeo = new THREE.BoxGeometry(0.55, 0.55, 18);
    this.boltGeo.userData.shared = true;
    this.boltMats = {};
    for (const k of ['ally', 'foe', 'turret', 'turretFoe']) { this.boltMats[k] = new THREE.MeshBasicMaterial({ color: COL[k] }); this.boltMats[k].userData.shared = true; }
    this.safeL = 0; this.safeR = 0;
    this.last = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    requestAnimationFrame((t) => this.loop(t));
  }

  /** First pilot's ship (single-player convenience). */
  get player() { return this.pilots[0]?.ship || null; }

  // ---------- setup ----------
  makeComposer(camera) {
    const c = new EffectComposer(this.renderer);
    c.addPass(new RenderPass(this.scene, camera));
    c.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.55, 0.9));
    c.addPass(new OutputPass());
    return c;
  }

  resize() {
    this.pausedDrawn = false;
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 2 : 1.25) * (this.pilots.length > 1 ? 0.85 : 1);
    this.pr = pr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.hudCanvas.width = w * pr; this.hudCanvas.height = h * pr;
    this.hud.setTransform(pr, 0, 0, pr, 0, 0);
    this.w = w; this.h = h;
    const cpr = Math.min(pr, 1.5);
    if (this.composer) { this.composer.setPixelRatio(cpr); this.composer.setSize(w, h); }
    const n = this.pilots.length;
    this.pilots.forEach((P, i) => {
      // split vertically stacked on landscape screens, side by side on portrait
      const stack = w >= h;
      P.vx = stack ? 0 : (w / n) * i; P.vy = stack ? (h / n) * i : 0;
      P.vw = stack ? w : w / n; P.vh = stack ? h / n : h;
      P.camera.aspect = P.vw / P.vh;
      P.baseFov = n > 1 && stack ? 50 : 60;
      P.camera.updateProjectionMatrix();
      if (P.composer) { P.composer.setPixelRatio(cpr); P.composer.setSize(P.vw, P.vh); }
    });
    const cs = getComputedStyle(document.documentElement);
    this.safeL = parseFloat(cs.getPropertyValue('--sal')) || 0;
    this.safeR = parseFloat(cs.getPropertyValue('--sar')) || 0;
    this.safeB = parseFloat(cs.getPropertyValue('--sab')) || 0;
  }

  setQuality(q) {
    this.quality = q;
    for (const P of this.pilots) {
      if (q === 'high' && !P.composer) P.composer = this.makeComposer(P.camera);
      if (q !== 'high' && P.composer) { disposeComposer(P.composer); P.composer = null; }
    }
    this.resize();
  }

  loadScene(sky) {
    if (this.scene) {
      for (const c of [...this.scene.children]) if (!c.userData?.keep) disposeObj(c);
      this.env?.dispose();
    }
    disposeComposer(this.composer);
    this.pilots.forEach((P) => { disposeComposer(P.composer); P.cockpit?.dispose(); });
    this.pilots = [];
    this.scene = new THREE.Scene();
    this.env = createEnvironment(this.scene, this.renderer, sky);
    this.fx = new Fx(this.scene, this.quality);
    this.ships = []; this.bolts = []; this.missiles = []; this.asteroids = []; this.dying = []; this.boltPool = []; this.mines = [];
    this.composer = this.makeComposer(this.camera);
    this.resize();
  }

  startAttract() {
    this.loadScene({ a: '#2456ff', b: '#b03cff', seed: 2.2, planet: ['#27475f', '#d1a877'], planetDir: [-0.75, -0.15, 0.4] });
    this.mode = 'attract';
    this.target = null; this.mission = null;
    this.spawn('aurora', new THREE.Vector3(0, 0, 0), FWD).speed = 0;
    this.spawn('sperber', new THREE.Vector3(70, 22, 120), FWD).speed = 0;
    this.spawn('falke', new THREE.Vector3(92, 16, 96), FWD).speed = 0;
    this.spawn('greif', new THREE.Vector3(112, 10, 70), FWD).speed = 0;
    this.attractT = 0;
    this.camera.fov = 62; this.camera.updateProjectionMatrix();
    this.hud.clearRect(0, 0, this.w, this.h);
  }

  /** controllers: one per human pilot. names: callsigns. */
  startMission(def, controllers, names, opts = {}) {
    this.flags = opts.flags || {};
    this.loadScene(def.sky);
    this.mode = 'flight';
    this.paused = false; this.frozen = false; this.ended = false; this.failT = 0;
    this.def = def;
    this.coop = controllers.length > 1;
    this.stats = { kills: 0, shots: 0, hits: 0, time: 0, score: 0, per: controllers.map(() => 0) };
    this.carrier = this.spawn('aurora', new THREE.Vector3(0, 0, 0), FWD);
    controllers.forEach((ctrl, i) => {
      const ship = this.spawn(def.ship, new THREE.Vector3(70 + i * 34, -4 - i * 6, 300 - i * 20), FWD);
      ship.isPlayer = true; ship.speed = 160;
      ship.name = names[i];
      const camera = new THREE.PerspectiveCamera(60, 1, 2, 90000);
      const P = {
        idx: i, ship, ctrl, camera, camQ: ship.quat.clone(), invQ: new THREE.Quaternion(),
        target: null, energy: 1, boosting: false, throttle: 0.75,
        aimPoint: new THREE.Vector3(), leadPoint: new THREE.Vector3(), aimLocked: false, mslLock: 0, mslTgt: null, lockToneT: 0,
        shake: 0, hurt: 0, bumpT: 0, deadT: 0, missileWarn: false, warnT: 0,
        color: PILOT_COLORS[i], label: `P${i + 1}`, baseFov: 60, targetT: 0, view: this.view || 'cockpit', cockpit: new Cockpit(), hitSide: {}, marks: [],
      };
      ship.pilot = P;
      ctrl.reset();
      this.pilots.push(P);
    });
    for (const P of this.pilots) { if (this.quality === 'high') P.composer = this.makeComposer(P.camera); P.cockpit.setStyle(this.controlStyle || 'yoke'); P.cockpit.log(`START · ${def.title}`, '#ffc857'); }
    this.wingman = null;
    if (def.wingman) {
      const who = opts.wingman || def.wingman;
      this.wingman = this.spawn(def.ship, new THREE.Vector3(40, -8, 270), FWD, { wingman: true, who, skill: opts.wingSkill ?? 0.75 });
      this.wingman.name = CHARS[who]?.call || 'Flügelmann';
    }
    this.protect = null;
    if (def.protect === 'carrier') this.protect = this.carrier;
    for (const n of def.navs) {
      n._pos = new THREE.Vector3(...n.pos);
      if (n.asteroids) this.asteroids.push(...createAsteroids(this.scene, n._pos, n.asteroids));
      if (n.field) this.asteroids.push(...createAsteroids(this.scene, new THREE.Vector3(...n.field.at), n.field.n, n.field.spread));
      if (n.wreck) this.spawn('valkyrie', n._pos.clone(), new THREE.Vector3(0.25, -0.12, 1).normalize());
      if ((def.protect === 'transport' || def.protect === 'habitat') && n.anchor) {
        this.protect = this.spawn(def.protect, n._pos.clone(), new THREE.Vector3(0.3, 0, 1).normalize());
      }
      if (n.mines) this.layMines(n.mines.at ? new THREE.Vector3(...n.mines.at) : n._pos, n.mines.n, n.mines.spread);
    }
    this.mission = { navIdx: 0, phase: 'travel', wave: 0, waveT: null, timer: null, prog: 0 };
    this.pickups = []; this.failReason = null; this.failT = 0;
    this.banner = null; this.bannerT = 0; this.objT = performance.now(); this.lastObj = '';
    this.resize();
    this.activateNav(0);
    this.audio.startEngine();
    this.seq = null;
    this.useBay = !!opts.launch;
    if (this.useBay) this.startLaunch();
    else this.ui.comm('flug', this.coop ? 'Startfreigabe für beide Maschinen. Guten Flug, Nachtfalken!' : 'Startfreigabe erteilt. Guten Flug, {cs}!');
  }

  // ---------- launch from and landing in the carrier's flight deck ----------
  /** carrier-local point -> world (the carrier keeps moving during both sequences) */
  bayToWorld(out, x, y, z) { return out.set(x, y, z).applyQuaternion(this.carrier.quat).add(this.carrier.pos); }
  setBayLights(r, a, gr) {
    BAY_LIGHTS.red.color.setRGB(r ? 3 : 0.25, r ? 0.15 : 0.02, r ? 0.1 : 0.02);
    BAY_LIGHTS.amber.color.setRGB(a ? 3 : 0.25, a ? 1.8 : 0.15, a ? 0.1 : 0.02);
    BAY_LIGHTS.green.color.setRGB(gr ? 0.2 : 0.02, gr ? 3 : 0.25, gr ? 0.6 : 0.06);
  }

  startLaunch() {
    this.seq = { kind: 'launch', t: 0, light: 0 };
    this.pilots.forEach((P, i) => {
      const s = P.ship;
      s.seqHold = true; s.speed = 0;
      // the chase camera would sit inside the back wall: launch is always seen from the cockpit
      P.viewSaved = P.view; P.view = 'cockpit';
      P.seqZ = BAY.back + 16 + (this.pilots.length - 1 - i) * 36; P.seqV = 0;
      this.bayToWorld(s.pos, 0, BAY.y - 0.5, P.seqZ); s.quat.copy(this.carrier.quat); P.camQ.copy(s.quat);
    });
    this.setBayLights(true, false, false);
    this.ui.comm('flug', this.coop ? 'Katapult eins und zwei, Nachtfalken. Triebwerke hochfahren.' : 'Katapult eins, {cs}. Triebwerke hochfahren, Startsequenz läuft.');
  }

  startLanding() {
    this.seq = { kind: 'land', t: 0, doneT: 0 };
    const inv = q3.copy(this.carrier.quat).invert();
    this.alivePilots().forEach((P, i) => {
      P.ship.seqHold = true; P.landStage = 0; P.landStop = BAY.back + 18 + i * 36; P.boosting = false;
      // waypoints in carrier space: swing wide round the hull if needed, then line up ahead of the bow
      const L = t4.copy(P.ship.pos).sub(this.carrier.pos).applyQuaternion(inv);
      const A = new THREE.Vector3(0, BAY.y - 0.5, BAY.mouth + 480 + i * 60);
      const sx = Math.sign(L.x) || 1;
      P.landWps = L.z > BAY.mouth + 250 && Math.abs(L.x) < 400 ? [A] : [new THREE.Vector3(sx * (320 + i * 40), -90, 200), A];
    });
    this.setBayLights(false, false, true);
    this.ui.comm('flug', 'Landefreigabe erteilt, {cs}. Leitstrahl Bucht eins aktiv – Autopilot übernimmt.');
    this.setBanner('LANDEANFLUG');
    this.audio.beep(900, 0.18);
  }

  /** runs after ships moved: scripted motion relative to the moving carrier */
  updateSeq(dt) {
    const q = this.seq;
    if (!q) return;
    q.t += dt;
    const c = this.carrier;
    if (q.kind === 'launch') {
      const GO = 2.6;
      if (q.light === 0 && q.t > 1.2) { q.light = 1; this.setBayLights(false, true, false); this.audio.beep(700, 0.16); }
      if (q.light === 1 && q.t > GO) { q.light = 2; this.setBayLights(false, false, true); this.audio.warp(); this.audio.beep(1300, 0.2); }
      let out = 0;
      for (const P of this.pilots) {
        const s = P.ship;
        if (!s.seqHold) { out++; continue; }
        if (q.t > GO) { P.seqV = Math.min(430, P.seqV + 280 * dt); P.seqZ += P.seqV * dt; P.shake = Math.max(P.shake, 0.35); P.boosting = true; }
        else P.shake = Math.max(P.shake, 0.06 + q.t * 0.03); // engines spooling up
        this.bayToWorld(s.pos, 0, BAY.y - 0.5, P.seqZ); s.quat.copy(c.quat);
        s.speed = P.seqV; P.aimPoint.copy(s.pos).addScaledVector(this.fwd(s, t1), 900);
        if (P.seqZ > BAY.mouth + 30) { s.seqHold = false; s.speed = c.speed + P.seqV * 0.55; P.throttle = 0.75; P.boosting = false; if (P.viewSaved !== P.view) { P.view = P.viewSaved; this.ui.viewChanged?.(P); } }
      }
      if (out === this.pilots.length) {
        this.seq = null; this.setBayLights(false, false, false);
        this.ui.comm('flug', this.coop ? 'Beide Maschinen frei. Gute Jagd, Nachtfalken!' : 'Maschine frei. Gute Jagd, {cs}!');
      }
      return;
    }
    // landing: line up in front of the bow, then fly into the bay against the carrier's motion
    const inv = q3.copy(c.quat).invert();
    let parked = 0, flying = 0;
    for (const P of this.alivePilots()) {
      const s = P.ship;
      if (!s.seqHold) continue;
      flying++;
      const L = t4.copy(s.pos).sub(c.pos).applyQuaternion(inv);
      if (P.landStage === 0) {
        // next waypoint (the last one is the approach point ahead of the bow, on the bay's centre line)
        const A = P.landWps[0];
        const d = L.distanceTo(A);
        t2.copy(A).sub(L).normalize().applyQuaternion(c.quat);
        m1.lookAt(t2, ZERO, t3.set(0, 1, 0).applyQuaternion(c.quat));
        q1.setFromRotationMatrix(m1);
        s.quat.rotateTowards(q1, 1.6 * dt);
        s.speed = Math.min(260, Math.max(90, d * 0.4));
        s.pos.addScaledVector(this.fwd(s, t1), s.speed * dt);
        // reached, or flown past (never circle a waypoint)
        if (d < 45 || (d < 220 && this.fwd(s, t1).dot(t2) < 0)) { P.landWps.shift(); if (!P.landWps.length) P.landStage = 1; }
      } else if (P.landStage === 1) {
        // final approach, nose first: chase a point on the bay's centre line a little ahead, slowing towards the stop mark
        const T = t5.set(0, BAY.y - 0.5, Math.max(P.landStop, L.z - 70));
        t2.copy(T).sub(L);
        const dz = L.z - P.landStop;
        if (t2.lengthSq() > 1) {
          t2.normalize().applyQuaternion(c.quat);
          m1.lookAt(t2, ZERO, t3.set(0, 1, 0).applyQuaternion(c.quat));
          s.quat.rotateTowards(q1.setFromRotationMatrix(m1), 2.4 * dt);
        }
        const align = this.fwd(s, t1).dot(t2);
        const v = THREE.MathUtils.clamp(18 + dz * 0.45, 18, 150) * (0.35 + 0.65 * Math.max(0, align));
        s.speed = v;
        s.pos.addScaledVector(t1, v * dt);
        // inside the tube the guidance beam holds the ship on the centre line
        if (dz < BAY.mouth - P.landStop + 40) {
          const Lc = t4.copy(s.pos).sub(c.pos).applyQuaternion(inv);
          Lc.x += -Lc.x * Math.min(1, dt * 4); Lc.y += (BAY.y - 0.5 - Lc.y) * Math.min(1, dt * 4);
          s.pos.copy(Lc).applyQuaternion(c.quat).add(c.pos);
          s.quat.rotateTowards(q2.copy(c.quat).multiply(q3.setFromAxisAngle(AY, Math.PI)), 3 * dt);
          q3.copy(c.quat).invert(); // restore the shared inverse used above
        }
        const Lz = t4.copy(s.pos).sub(c.pos).applyQuaternion(q3.copy(c.quat).invert()).z;
        if (Lz <= P.landStop) { P.landStage = 2; this.audio.hit(true); P.shake = 0.4; }
      } else {
        parked++; s.speed = 0;
        s.pos.copy(L.set(0, BAY.y - 0.5, P.landStop)).applyQuaternion(c.quat).add(c.pos);
      }
      P.aimPoint.copy(s.pos).addScaledVector(this.fwd(s, t1), 900);
    }
    if (flying && parked === flying) {
      if (!q.doneT) { q.doneT = q.t; this.setBanner('LANDUNG BESTÄTIGT'); this.ui.comm('flug', 'Aufgesetzt. Willkommen zurück an Bord, {cs}.'); this.audio.stopEngine(); }
      else if (q.t - q.doneT > 2.2) { this.seq = null; this.setBayLights(false, false, false); this.end(true); }
    }
  }

  stop() { this.mode = 'idle'; this.audio.stopEngine(); }

  // ---------- helpers ----------
  alivePilots() { return this.pilots.filter((P) => P.ship.alive); }
  /** Distance from a point to the nearest living pilot (used for audio + spawn logic). */
  ear(pos) {
    if (this.mode === 'cut') return this.camera.position.distanceTo(pos);
    let d = Infinity;
    for (const P of this.pilots) if (P.ship.alive) d = Math.min(d, P.ship.pos.distanceTo(pos));
    return d === Infinity && this.pilots[0] ? this.pilots[0].ship.pos.distanceTo(pos) : d;
  }
  leadPilot() { return this.alivePilots()[0] || this.pilots[0]; }

  // ---------- entities ----------
  spawn(type, pos, dir, opts = {}) {
    const def = SHIPS[type];
    const mesh = buildShip(type);
    mesh.position.copy(pos);
    m1.lookAt(dir, ZERO, UP);
    mesh.quaternion.setFromRotationMatrix(m1);
    this.scene.add(mesh);
    const s = {
      type, def, mesh, team: def.team, pos: mesh.position, quat: mesh.quaternion,
      speed: def.speed * 0.8, hp: def.hp, maxHp: def.hp, shield: def.shield || 0, maxShield: def.shield || 0,
      shieldT: 0, cool: Math.random() * 0.5, alive: true, name: def.name, radius: def.radius,
      missiles: def.missiles || 0, mslCool: rnd(4, 9), skill: def.skill ?? 0.5,
      ai: { target: null, mode: 'attack', t: 0, retarget: 0, dir: new THREE.Vector3(), evadeT: 0, evade: new THREE.Vector3() },
      turretCool: (def.turrets || []).map(() => Math.random() * 2), bank: 0, torpCool: rnd(3, 6),
      ...opts,
    };
    // longer dogfights: enemy fighters take more punishment
    if (def.team === 1 && !def.capital) { s.hp = s.maxHp = def.hp * ENEMY_TOUGH; s.shield = s.maxShield = (def.shield || 0) * ENEMY_TOUGH; }
    this.ships.push(s);
    return s;
  }

  fwd(s, out) { return out.copy(FWD).applyQuaternion(s.quat); }

  spawnBolt(pos, dir, owner, dmg, matKey) {
    let b = this.boltPool.pop();
    if (!b) b = { mesh: new THREE.Mesh(this.boltGeo, this.boltMats[matKey]), vel: new THREE.Vector3(), prev: new THREE.Vector3() };
    b.mesh.material = this.boltMats[matKey];
    b.mesh.position.copy(pos);
    m1.lookAt(dir, ZERO, UP);
    b.mesh.quaternion.setFromRotationMatrix(m1);
    b.vel.copy(dir).multiplyScalar(BOLT_SPEED);
    b.prev.copy(pos);
    b.life = this.mode === 'cut' ? 3 : BOLT_LIFE; b.team = owner.team; b.owner = owner; b.dmg = dmg;
    this.scene.add(b.mesh);
    this.bolts.push(b);
  }

  fire(s, dir) {
    if (s.cool > 0) return;
    s.cool = s.def.rof;
    const key = s.team === 0 ? 'ally' : 'foe';
    // AI wingmen and allied fighters support the player instead of winning the fight for them
    const dmg = s.isPlayer || s.team !== 0 || s.def.capital ? s.def.dmg : s.def.dmg * (s.wingman ? 0.35 : 0.5);
    for (const g of s.def.guns) {
      t4.set(g[0], g[1], g[2]).applyQuaternion(s.quat).add(s.pos);
      this.spawnBolt(t4, dir, s, dmg, key);
    }
    if (s.isPlayer) { this.audio.laser(s.pilot.idx === 0 ? 0.2 : 0.14); this.stats.shots += s.def.guns.length; return; }
    const d = this.ear(s.pos);
    if (d < 900) this.audio.laser(0.12 * (1 - d / 900), s.team === 1);
  }

  launchMissile(s, target, torpedo = false) {
    const R = missileRes();
    const mesh = new THREE.Group();
    mesh.add(new THREE.Mesh(torpedo ? R.torp : R.body, R.mat));
    const glow = new THREE.Sprite(s.team === 0 ? R.glowAlly : R.glowFoe);
    glow.scale.setScalar(torpedo ? 16 : 10); glow.position.z = -3;
    mesh.add(glow);
    mesh.position.set(0, -1.6, 2).applyQuaternion(s.quat).add(s.pos);
    mesh.quaternion.copy(s.quat);
    this.scene.add(mesh);
    if (s.isPlayer) this.stats.shots += 2;
    this.missiles.push({
      mesh, pos: mesh.position, quat: mesh.quaternion, target, team: s.team, owner: s,
      speed: torpedo ? 300 : Math.max(380, s.speed + 150), maxSpeed: torpedo ? 300 : 620, turn: torpedo ? 0.7 : (s.team === 0 ? 2.6 : 1.35),
      life: torpedo ? 14 : 7, dmg: torpedo ? 170 : 75, torpedo,
    });
    if (this.ear(s.pos) < 1200) this.audio.missile();
  }

  damage(s, dmg, by, point) {
    if (!s.alive) return;
    if (s.def.invulnerable || this.mode === 'cut') {
      if (s.def.ghost) return;
      this.fx.flash(point, s.def.capital ? 12 : 14, s.shield > 0 ? COL.shield : COL.spark, 0.18);
      if (this.mode === 'cut') this.fx.sparks(point, COL.spark, 5);
      return;
    }
    s.shieldT = 4.5;
    s.lastHitBy = by;
    const hadShield = s.shield > 0;
    if (hadShield) {
      s.shield -= dmg;
      if (s.shield < 0) { s.hp += s.shield; s.shield = 0; }
      this.fx.flash(point, 10, COL.shield, 0.15);
      if (!s.isPlayer) this.fx.shield(s, point);
    } else {
      s.hp -= dmg;
      this.fx.hullHit(point, COL.spark);
      this.fx.flash(point, 9, COL.spark, 0.15);
    }
    if (!s.def.capital) { s.ai.evadeT = 0.9; s.ai.evade.randomDirection(); }
    if (s.isPlayer) {
      const P = s.pilot;
      // which side was hit, and where on the hull (for the cockpit schematic)
      t5.copy(point).sub(s.pos).applyQuaternion(q3.copy(s.quat).invert());
      const ang = Math.atan2(-t5.x, t5.z);
      const side = Math.abs(ang) < Math.PI / 4 ? 'front' : Math.abs(ang) > Math.PI * 0.75 ? 'back' : ang > 0 ? 'right' : 'left';
      P.hitSide[side] = performance.now();
      const sideTxt = { front: 'BUG', back: 'HECK', left: 'BACKBORD', right: 'STEUERBORD' }[side];
      if (!hadShield) {
        P.marks.push({ x: t5.x, z: t5.z, t: performance.now() });
        if (P.marks.length > 14) P.marks.shift();
        P.cockpit?.log(`TREFFER ${sideTxt} · HÜLLE ${Math.max(0, Math.round(s.hp / s.maxHp * 100))}%`, '#ff4d6d');
        if (s.hp > 0) P.cockpit?.hit(dmg, s.hp / s.maxHp);
      } else if (Math.random() < 0.35) P.cockpit?.log(`SCHILD ${sideTxt} ABSORBIERT`, '#7fd6ff');
      P.shake = Math.min(1.2, P.shake + dmg * 0.035);
      P.hurt = Math.min(0.7, P.hurt + dmg * 0.02);
      this.audio.hit(hadShield);
      if (dmg > 5) P.ctrl.buzz?.(hadShield ? 25 : 60);
    } else if (by?.isPlayer) {
      this.stats.hits++;
    }
    if (s.def.ace && !this.def.navs[this.mission.navIdx]?.final && s.hp < s.maxHp * 0.4) return this.jumpOut(s);
    if (s.hp <= 0) {
      if (s.wingman) {
        this.ui.comm(s.who, 'Ich bin getroffen! Muss abdrehen – ihr seid auf euch allein gestellt!');
        return this.jumpOut(s);
      }
      this.kill(s, by);
    }
  }

  jumpOut(s) {
    s.alive = false;
    this.fx.flash(s.pos, 120, new THREE.Color(2, 3, 5), 0.6);
    this.fx.ring(s.pos, 40, new THREE.Color(1, 2, 4), 0.6);
    this.scene.remove(s.mesh);
    if (!s.isPlayer && !s.cut) disposeObj(s.mesh);
    for (const P of this.pilots) if (P.target === s) P.target = null;
  }

  kill(s, by) {
    s.alive = false;
    for (const P of this.pilots) if (P.target === s) P.target = null;
    const vol = Math.max(0.08, 1 - this.ear(s.pos) / 2500);
    if (s.def.capital) {
      s.dieT = 2.6; s.boomT = 0;
      this.dying.push(s);
      this.audio.explosion(vol, true);
    } else {
      this.fx.explode(s.pos, 1.3);
      this.scene.remove(s.mesh);
      if (!s.isPlayer) disposeObj(s.mesh);
      this.audio.explosion(vol * 0.7);
    }
    if (s.isPlayer) {
      const P = s.pilot;
      P.deadT = this.coop ? 7 : 3; P.shake = 2;
      P.ctrl.buzz?.(300);
      if (this.coop && this.alivePilots().length) this.ui.comm('flug', `${s.name} ist abgeschossen! Rettungskapsel geortet – Ersatzmaschine startet.`);
      return;
    }
    if (s.team === 1) {
      if (by?.isPlayer) {
        this.stats.kills++; this.stats.score += s.def.score || 100;
        this.stats.per[by.pilot.idx]++;
        by.pilot.cockpit?.log(`ZIEL ZERSTÖRT · ${s.name}`, '#ffc857');
        this.setBanner(`${s.name.toUpperCase()} ZERSTÖRT`);
        if (this.wingman?.alive && Math.random() < 0.3) this.ui.comm(this.wingman.who, ['Guter Schuss, {cs}!', 'Abschuss bestätigt!', 'Den hast du sauber erwischt!'][Math.random() * 3 | 0].replace('{cs}', () => by.name));
      } else if (by?.wingman && Math.random() < 0.5) {
        this.ui.comm(by.who, ['Einer weniger!', 'Ziel zerstört!', 'Erwischt!'][Math.random() * 3 | 0]);
      }
    }
  }

  respawn(P) {
    const mate = this.alivePilots()[0];
    const s = P.ship;
    if (mate) {
      s.pos.copy(t1.set(30, 4, -60).applyQuaternion(mate.ship.quat).add(mate.ship.pos));
      s.quat.copy(mate.ship.quat);
    } else {
      s.pos.set(70, -4, 300); s.quat.identity();
    }
    s.hp = s.maxHp; s.shield = s.maxShield; s.alive = true; s.speed = 160;
    s.missiles = Math.ceil(s.def.missiles / 2);
    s.cool = 0;
    this.scene.add(s.mesh);
    P.camQ.copy(s.quat); P.energy = 1; P.hurt = 0; P.marks = []; P.hitSide = {}; P.cockpit?.repair();
    this.fx.flash(s.pos, 120, new THREE.Color(2, 3, 5), 0.6);
    this.setBanner(`${s.name.toUpperCase()} WIEDER IM EINSATZ`);
  }

  setBanner(t) { this.banner = t; this.bannerT = 2.6; this.bannerT0 = performance.now(); }

  // ---------- AI ----------
  pickTarget(s) {
    let best = null, bd = Infinity;
    const wantCap = s.def.bomber;
    for (const o of this.ships) {
      if (!o.alive || o.team === s.team || o.team === 3) continue;
      let d = o.pos.distanceTo(s.pos);
      if (d > 6000) continue;
      if (wantCap) d *= o.def.capital ? 0.05 : 1;
      else if (o.def.capital) d *= s.team === 0 ? 2.2 : 4;
      if (o.isPlayer) d *= 0.75;
      if (s.wingman && this.pilots.some((P) => P.target === o)) d *= 0.6;
      d *= rnd(0.8, 1.2);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  steer(s, dir, dt, rate) {
    t3.set(0, 1, 0).applyQuaternion(s.quat);
    m1.lookAt(dir, ZERO, t3);
    q1.setFromRotationMatrix(m1);
    t4.copy(dir).applyQuaternion(q2.copy(s.quat).invert());
    const want = THREE.MathUtils.clamp(-t4.x * 1.6, -0.9, 0.9);
    s.bank += (want - s.bank) * Math.min(1, dt * 3);
    s.mesh.userData.body.rotation.z = s.bank;
    s.quat.rotateTowards(q1, rate * dt);
  }

  updateAI(s, dt) {
    const def = s.def, ai = s.ai;
    if (def.capital) return this.updateCapital(s, dt);
    if (s.flee) {
      t1.copy(s.flee).sub(s.pos);
      const d = t1.length();
      t1.divideScalar(d);
      for (const a of this.asteroids) {
        t3.copy(s.pos).sub(a.pos);
        const da = t3.length();
        if (da < a.radius + 90) t1.addScaledVector(t3.divideScalar(da), 2).normalize();
      }
      this.steer(s, t1, dt, def.turn);
      s.speed = s.fleeSpeed || def.speed;
      if (d < 300) { s.escaped = true; this.jumpOut(s); }
      return;
    }
    ai.retarget -= dt; ai.evadeT -= dt;
    if (!ai.target || !ai.target.alive || ai.retarget <= 0) { ai.target = this.pickTarget(s); ai.retarget = rnd(3, 6); }
    const tgt = ai.target;
    const dir = t1;
    let want = def.speed;
    this.fwd(s, t2);
    const lead = this.leadPilot()?.ship;
    if (!tgt) {
      if (s.wingman && lead?.alive) {
        dir.set(-28, 2, -22).applyQuaternion(lead.quat).add(lead.pos).sub(s.pos);
        const d = dir.length();
        if (d < 30) { this.fwd(lead, dir); want = lead.speed; }
        else { dir.divideScalar(d); t3.copy(FWD).applyQuaternion(lead.quat); dir.lerp(t3, d < 120 ? 0.5 : 0).normalize(); want = Math.min(def.boost, lead.speed + d * 1.2); }
      } else {
        dir.copy(t2).addScaledVector(t3.set(1, 0, 0).applyQuaternion(s.quat), 0.3).normalize();
      }
    } else {
      dir.copy(tgt.pos).sub(s.pos);
      const dist = dir.length();
      const breakD = tgt.radius + (tgt.def.capital ? 150 : 55);
      if (ai.mode === 'attack') {
        if (!tgt.def.capital) {
          this.fwd(tgt, t3);
          dir.addScaledVector(t3, tgt.speed * dist / BOLT_SPEED);
        }
        dir.normalize();
        const dot = t2.dot(dir);
        if (dist < breakD) {
          ai.mode = 'break'; ai.t = rnd(1.4, 2.8);
          ai.dir.randomDirection().addScaledVector(dir, -0.4).normalize();
        } else if (dot > 0.993 && dist < 900) {
          const spread = (1 - s.skill) * 0.045 + (tgt.def.capital ? 0.03 : 0.006) + (s.team === 0 ? 0.018 : 0);
          t3.copy(t2).add(t4.randomDirection().multiplyScalar(spread)).normalize();
          this.fire(s, t3);
        }
        s.mslCool -= dt;
        if (s.missiles > 0 && s.mslCool <= 0 && dot > 0.96 && dist < 1500 && dist > 400 && !tgt.def.capital && s.team === 1) {
          s.missiles--; s.mslCool = rnd(9, 16);
          this.launchMissile(s, tgt);
        }
        if (def.bomber && tgt.def.capital) {
          s.torpCool -= dt;
          if (s.torpCool <= 0 && dot > 0.95 && dist < 1300) { s.torpCool = rnd(7, 10); this.launchMissile(s, tgt, true); }
        }
        want = dist > 500 ? def.speed : def.speed * 0.72;
        if (ai.evadeT > 0 && s.skill > 0.3) dir.addScaledVector(ai.evade, 0.9).normalize();
      } else {
        ai.t -= dt;
        dir.copy(ai.dir);
        if ((ai.t <= 0 && dist > breakD + 220) || ai.t < -4) ai.mode = 'attack';
      }
    }
    for (const a of this.asteroids) {
      t3.copy(s.pos).sub(a.pos);
      const d = t3.length();
      if (d < a.radius + 70) { dir.addScaledVector(t3.divideScalar(d), 2.5 * (1 - (d - a.radius) / 70)).normalize(); }
    }
    for (const c of this.ships) {
      if (!c.def.capital || !c.alive || c === tgt || c.def.ghost) continue;
      if (s.pos.distanceToSquared(c.pos) > (c.radius + 120) ** 2) continue;
      const d = this.hullDist(c, s.pos, t3);
      if (d < 60) dir.addScaledVector(t3, 3).normalize();
    }
    this.steer(s, dir, dt, def.turn * (0.75 + s.skill * 0.25));
    s.speed += (want - s.speed) * Math.min(1, dt * 1.4);
  }

  /** Distance to a capital ship's hull: its box, plus an optional ring (torus) such as the station's. */
  hullDist(c, p, out) {
    let d = this.boxDist(c, p, out);
    // extra boxes for blades, towers and prows outside the main box (see fitStats in ships.js)
    for (const e of c.def.boxes || []) {
      const de = this.boxDist(c, p, tBox, e);
      if (de < d) { d = de; out.copy(tBox); }
    }
    const tor = c.def.torus;
    if (!tor) return d;
    const l = t5.copy(p).sub(c.pos).applyQuaternion(q3.copy(c.quat).invert());
    const radial = Math.hypot(l.x, l.y) || 1e-6;
    const qx = radial - tor[0];
    const dt = Math.hypot(qx, l.z) - tor[1];
    if (dt >= d) return d;
    out.set((l.x / radial) * qx, (l.y / radial) * qx, l.z);
    if (out.lengthSq() < 1e-9) out.set(0, 0, 1);
    out.normalize().applyQuaternion(c.quat);
    return dt;
  }

  /** Distance from point to a capital ship's oriented box; out = world-space push direction. */
  boxDist(c, p, out, e = null) {
    const b = e ? [e[3], e[4], e[5]] : c.def.box;
    t4.copy(p).sub(c.pos).applyQuaternion(q2.copy(c.quat).invert());
    if (e) t4.x -= e[0], t4.y -= e[1], t4.z -= e[2];
    const cx = THREE.MathUtils.clamp(t4.x, -b[0], b[0]), cy = THREE.MathUtils.clamp(t4.y, -b[1], b[1]), cz = THREE.MathUtils.clamp(t4.z, -b[2], b[2]);
    out.set(t4.x - cx, t4.y - cy, t4.z - cz);
    const d = out.length();
    if (d < 0.001) {
      const dx = b[0] - Math.abs(t4.x), dy = b[1] - Math.abs(t4.y), dz = b[2] - Math.abs(t4.z);
      if (dx < dy && dx < dz) out.set(Math.sign(t4.x) || 1, 0, 0); else if (dy < dz) out.set(0, Math.sign(t4.y) || 1, 0); else out.set(0, 0, Math.sign(t4.z) || 1);
      out.applyQuaternion(c.quat);
      return -Math.min(dx, dy, dz);
    }
    out.divideScalar(d).applyQuaternion(c.quat);
    return d;
  }

  updateCapital(s, dt) {
    if (s.dest) {
      t1.copy(s.dest).sub(s.pos);
      const d = t1.length();
      if (d > 250) {
        t1.divideScalar(d);
        for (const c of this.ships) {
          if (c === s || !c.alive || !c.def.capital || c.def.ghost) continue;
          t3.copy(s.pos).sub(c.pos); const dc = t3.length();
          if (dc < c.radius + s.radius + 80) t1.addScaledVector(t3.divideScalar(dc), 1.5).normalize();
        }
        this.steer(s, t1, dt, 0.35);
        s.speed = s.cruise;
      } else s.speed = Math.max(0, s.speed - dt * 30);
    }
    const tur = s.def.turrets;
    for (let i = 0; i < tur.length; i++) {
      s.turretCool[i] -= dt;
      if (s.turretCool[i] > 0) continue;
      s.turretCool[i] = rnd(0.7, 1.3);
      t1.set(tur[i][0], tur[i][1], tur[i][2]).applyQuaternion(s.quat).add(s.pos);
      let best = null, bd = 1500 * 1500;
      for (const o of this.ships) {
        if (!o.alive || o.team === s.team || o.team === 3) continue;
        const d = o.pos.distanceToSquared(t1);
        if (d < bd) { bd = d; best = o; }
      }
      if (!best) continue;
      const dist = Math.sqrt(bd);
      this.fwd(best, t2);
      t3.copy(best.pos).addScaledVector(t2, best.speed * dist / BOLT_SPEED).sub(t1).normalize();
      t3.add(t4.randomDirection().multiplyScalar(best.def.capital ? 0.03 : 0.05)).normalize();
      this.spawnBolt(t1, t3, s, s.def.dmg, s.team === 0 ? 'turret' : 'turretFoe');
    }
  }

  // ---------- player ----------
  updatePilot(P, dt) {
    const p = P.ship, c = P.ctrl, def = p.def;
    c.update?.(dt);
    if (p.seqHold) {
      // launch / landing on rails: only pause and view change are accepted
      c.throttleSet = null;
      for (const e of c.take()) { if (e === 'pause') this.ui.pause(); else if (e === 'view' && this.seq?.kind !== 'launch') { P.view = P.view === 'cockpit' ? 'chase' : 'cockpit'; this.ui.viewChanged?.(P); } }
      p.bank *= 0.9; p.mesh.userData.body.rotation.z = p.bank; p.mesh.userData.body.rotation.x = 0;
      P.aimLocked = false; P.mslLock = 0;
      return;
    }
    if (c.throttleSet != null) { P.throttle = c.throttleSet; c.throttleSet = null; }
    P.throttle = Math.min(1, Math.max(0, P.throttle + c.throttleRate * dt * 0.8));
    // small dead zone + expo curve: precise near the centre, full authority at the edge
    const shape = (v) => { const a = Math.max(0, (Math.abs(v) - 0.05) / 0.95); return Math.sign(v) * a * (0.45 + 0.55 * a * a); };
    const sx = shape(c.x), sy = shape(c.y) * (this.invert ? 1 : -1);
    const rate = def.turn * (P.boosting ? 0.7 : 1) * (this.sens || 1);
    q1.setFromAxisAngle(AX, -sy * rate * dt);
    q2.setFromAxisAngle(AY, -sx * rate * dt);
    p.quat.multiply(q1).multiply(q2).normalize();
    p.bank += (sx * 0.75 - p.bank) * Math.min(1, dt * 5);
    p.mesh.userData.body.rotation.z = p.bank;
    p.mesh.userData.body.rotation.x = -sy * 0.12;

    if (P.energy <= 0.02) P.boostLock = true;
    if (P.boostLock && (P.energy > 0.3 || !c.boosting)) P.boostLock = false;
    const boosting = c.boosting && !P.boostLock && P.energy > 0.02;
    if (boosting) P.energy = Math.max(0, P.energy - dt * 0.22);
    else P.energy = Math.min(1, P.energy + dt * 0.1);
    P.boosting = boosting;
    const want = boosting ? def.boost : def.speed * (0.15 + P.throttle * 0.85);
    p.speed += (want - p.speed) * Math.min(1, dt * (boosting ? 1.8 : 1.2));

    this.fwd(p, t1);
    P.aimPoint.copy(p.pos).addScaledVector(t1, 900);
    P.aimLocked = false;
    const tg = P.target;
    if (tg && tg.alive) {
      const dist = tg.pos.distanceTo(p.pos);
      this.fwd(tg, t2);
      P.leadPoint.copy(tg.pos).addScaledVector(t2, tg.speed * dist / BOLT_SPEED);
      t3.copy(P.leadPoint).sub(p.pos).normalize();
      if (!tg.def.capital && dist < 1100 && t3.dot(t1) > 0.9975) P.aimLocked = true;
    }
    // missile seeker: the target has to stay inside a 22° cone within 2.6 km for 1.4 s to lock
    if (tg !== P.mslTgt) { P.mslTgt = tg; P.mslLock = 0; }
    if (tg && tg.alive && p.missiles > 0) {
      t2.copy(tg.pos).sub(p.pos);
      const d = t2.length(), inCone = d < 2600 && t2.divideScalar(d || 1).dot(t1) > MSL_CONE;
      const was = P.mslLock;
      P.mslLock = inCone ? Math.min(1, P.mslLock + dt / 1.4) : Math.max(0, P.mslLock - dt * 1.5);
      // seeker growl that speeds up while locking, then a steady lock tone
      P.lockToneT -= dt;
      if (P.mslLock > 0 && P.lockToneT <= 0 && P.idx === 0) {
        if (P.mslLock >= 1) { this.audio.beep(1480, 0.07); P.lockToneT = 0.16; } else { this.audio.beep(600 + P.mslLock * 500, 0.05); P.lockToneT = 0.34 - P.mslLock * 0.22; }
      }
      if (was < 1 && P.mslLock >= 1) P.cockpit?.log(`RAKETE AUFGESCHALTET · ${tg.name}`, '#ff4d6d');
    } else P.mslLock = 0;
    if (c.firing) this.fire(p, P.aimLocked ? t3 : t1);

    for (const e of c.take()) {
      if (e === 'missile') this.playerMissile(P);
      else if (e === 'target') this.cycleTarget(P);
      else if (e === 'auto') this.autopilot();
      else if (e === 'pause') this.ui.pause();
      else if (e === 'view') { P.view = P.view === 'cockpit' ? 'chase' : 'cockpit'; this.ui.viewChanged?.(P); }
    }

    for (const a of this.asteroids) {
      t2.copy(p.pos).sub(a.pos);
      const d = t2.length();
      if (d < a.radius + 5) this.bump(P, t2.divideScalar(d), a.radius + 5 - d);
    }
    for (const cap of this.ships) {
      if (!cap.def.capital || !cap.alive || cap.def.ghost) continue;
      if (p.pos.distanceToSquared(cap.pos) > (cap.radius + 40) ** 2) continue;
      const d = this.hullDist(cap, p.pos, t2);
      if (d < 6) this.bump(P, t2, 6 - d);
    }
  }

  bump(P, normal, depth) {
    const p = P.ship;
    p.pos.addScaledVector(normal, depth + 1);
    this.fwd(p, t3);
    if (t3.dot(normal) < 0) {
      t3.addScaledVector(normal, -t3.dot(normal) * 1.4).normalize();
      m1.lookAt(t3, ZERO, t4.set(0, 1, 0).applyQuaternion(p.quat));
      p.quat.setFromRotationMatrix(m1);
    }
    if (P.bumpT <= 0) {
      P.bumpT = 0.5;
      this.damage(p, 12 + p.speed * 0.08, null, tBump.copy(p.pos).addScaledVector(normal, -p.radius * 0.8));
      p.speed *= 0.5;
    }
  }

  playerMissile(P) {
    const p = P.ship;
    if (p.missiles <= 0 || !p.alive) { this.audio.beep(220); return; }
    p.missiles--;
    // only a locked seeker guides the missile; without lock it flies straight ahead
    const locked = P.target?.alive && P.mslLock >= 1;
    this.launchMissile(p, locked ? P.target : null);
    P.cockpit?.log(`RAKETE ${p.def.missiles - p.missiles} AB → ${locked ? P.target.name : 'UNGELENKT'}`, '#ffc857');
    if (!locked) this.setBanner('KEINE AUFSCHALTUNG – RAKETE UNGELENKT');
    P.mslLock = 0;
  }

  cycleTarget(P) {
    const p = P.ship;
    const list = this.ships.filter((o) => o.alive && o.team === 1 && o.pos.distanceTo(p.pos) < 8000);
    if (!list.length) { P.target = null; return; }
    this.fwd(p, t1);
    const score = (o) => { t2.copy(o.pos).sub(p.pos); const d = t2.length(); return d * (1.6 - t2.divideScalar(d).dot(t1)); };
    list.sort((a, b) => score(a) - score(b));
    const i = list.indexOf(P.target);
    P.target = list[(i + 1) % list.length];
    P.cockpit?.log(`ZIEL: ${P.target.name} · ${Math.round(P.target.pos.distanceTo(p.pos))} M`, '#7fd6ff');
    P.targetT = performance.now();
    this.audio.lock();
  }

  hostileCount() { let n = 0; for (const s of this.ships) if (s.alive && s.team === 1) n++; return n; }

  // ---------- mission ----------
  nav() { return this.def.navs[this.mission.navIdx]; }
  navPos() {
    const m = this.mission;
    if (!m) return null;
    if (m.phase === 'return') return this.carrier.pos;
    if (m.phase !== 'travel') return null;
    const n = this.nav();
    return n.anchor && this.protect ? this.protect.pos : n._pos;
  }
  navName() { return this.mission.phase === 'return' ? 'TUS Aurora' : this.nav().name; }

  objectiveText() {
    const m = this.mission;
    const fmt = (t) => `${Math.floor(Math.max(0, t) / 60)}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, '0')}`;
    if (m.phase === 'return') return 'Kehre zur TUS Aurora zurück';
    if (m.phase === 'done') return 'Mission erfüllt';
    const n = this.nav();
    let txt;
    if (m.phase === 'travel') txt = `Fliege zu ${n.name}`;
    else if (n.type === 'scan') txt = `${n.objective || 'Scanne den Sektor'} · ${Math.floor(Math.min(1, m.prog / n.scan) * 100)} %`;
    else if (n.type === 'pickup') txt = `${n.objective || 'Bergung'} · ${this.pickups.filter((p) => p.got).length}/${this.pickups.length}`;
    else if (n.type === 'survive') txt = `${n.objective || 'Halte durch'} · ${fmt(m.surv)}`;
    else if (n.type === 'convoy') {
      const alive = (m.convoy || []).filter((c) => c.alive);
      const dist = alive.length ? Math.min(...alive.map((c) => c.pos.distanceTo(c.dest))) : 0;
      txt = `${n.objective || 'Eskortiere den Konvoi'} · ${alive.length}/${(m.convoy || []).length} · ${(dist / 1000).toFixed(1)} km`;
    }
    else if (n.type === 'dock' && m.docking) txt = `Andocken · ${Math.floor(Math.min(1, m.prog / n.dock) * 100)} %`;
    else txt = n.objective || 'Vernichte alle Feinde';
    if (m.timer != null) txt += ` · ⏱ ${fmt(m.timer)}`;
    return txt;
  }

  /** Extra HUD markers for objectives (pickups, intercept target, dock target, scan zone). */
  markers() {
    const m = this.mission, out = [];
    if (!m || m.phase !== 'fight') return out;
    const n = this.nav();
    if (n.type === 'pickup') for (const p of this.pickups) if (!p.got) out.push({ pos: p.pos, color: '#6dffb0', label: n.pickupLabel || 'FLUGSCHREIBER' });
    if (n.type === 'convoy') for (const c of m.convoy || []) if (c.alive) out.push({ pos: c.pos, color: '#6dffb0', label: c.name.toUpperCase(), main: true });
    if (n.type === 'scan' && m.prog < n.scan) out.push({ pos: n._pos, color: '#ffc857', label: 'SCANZONE', main: true });
    if (n.type === 'intercept' && m.courier?.alive) out.push({ pos: m.courier.pos, color: '#ff4d6d', label: 'KURIER', main: true });
    if (n.type === 'dock' && m.docking && m.prison?.alive) out.push({ pos: m.prison.pos, color: '#6dffb0', label: 'ANDOCKEN', main: true });
    return out;
  }

  autoAvailable() {
    const m = this.mission;
    if (!m || this.seq || this.ended || this.failReason || m.phase !== 'travel' && m.phase !== 'return' || this.frozen || this.hostileCount() > 0) return false;
    if (m.phase === 'travel' && (this.nav().type === 'escape' || m.timer != null)) return false;
    const alive = this.alivePilots();
    if (!alive.length || alive.length < this.pilots.length) return false;
    const np = this.navPos();
    return !!np && alive.every((P) => P.ship.pos.distanceTo(np) > 2600);
  }

  autopilot() {
    if (!this.autoAvailable()) { this.audio.beep(220); return; }
    this.frozen = true;
    this.audio.warp();
    this.ui.fade(() => {
      if (this.ended || !this.pilots.length || this.mode !== 'flight') { this.frozen = false; return; }
      const lead = this.pilots[0].ship, np = this.navPos();
      t1.copy(lead.pos).sub(np).normalize();
      const base = np.clone().addScaledVector(t1, 2300);
      t1.negate();
      m1.lookAt(t1, ZERO, UP);
      q1.setFromRotationMatrix(m1);
      this.pilots.forEach((P, i) => {
        P.ship.quat.copy(q1);
        P.ship.pos.copy(base).add(t2.set(i * 40, -i * 6, -i * 20).applyQuaternion(q1));
        P.camQ.copy(q1);
      });
      if (this.wingman?.alive) {
        this.wingman.pos.copy(t2.set(-30, 2, -24).applyQuaternion(q1).add(base));
        this.wingman.quat.copy(q1);
      }
      this.frozen = false;
    });
  }

  /** Called when a nav point becomes the current objective. */
  activateNav(i) {
    const n = this.def.navs[i];
    if (!n) return;
    const m = this.mission;
    m.timer = null;
    if (n.type === 'escape') {
      m.timer = n.escape;
      if (n.chasers) {
        const lead = this.leadPilot().ship;
        this.fwd(lead, t1);
        const origin = lead.pos.clone().addScaledVector(t1, -1400);
        this.spawnGroup(n.chasers, origin, lead.pos);
      }
    }
  }

  spawnGroup(entries, origin, center) {
    for (const [type, n, cond] of entries) {
      if (cond && !this.flags[cond]) continue;
      for (let i = 0; i < n; i++) {
        const cap = SHIPS[type].capital;
        const pos = origin.clone().add(new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(cap ? 0 : 160));
        const dir = new THREE.Vector3().copy(center).sub(pos).normalize();
        const s = this.spawn(type, pos, dir.lengthSq() ? dir : FWD);
        if (!cap) this.fx.flash(pos, 90, new THREE.Color(3, 1, 2.5), 0.5);
        if (this.coop && !cap) s.hp = s.maxHp = s.maxHp * 1.25;
      }
    }
  }

  spawnWave(nav, idx) {
    const center = nav.anchor && this.protect ? this.protect.pos : nav._pos;
    const base = t1.randomDirection(); base.y *= 0.35; base.normalize();
    const origin = new THREE.Vector3().copy(center).addScaledVector(base, nav.anchor ? 2600 : 1500);
    if (this.ear(origin) < 1300) origin.addScaledVector(base, 1300);
    const wave = nav.waves[idx] || [];
    for (const [type, n, cond] of wave) {
      if (cond && !this.flags[cond]) continue;
      for (let i = 0; i < n; i++) {
        const cap = SHIPS[type].capital;
        const pos = cap ? nav._pos.clone() : origin.clone().add(new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(160));
        const dir = cap ? new THREE.Vector3(1, 0, 0.2).normalize() : new THREE.Vector3().copy(center).sub(pos).normalize();
        const s = this.spawn(type, pos, dir);
        if (cap && type === 'zerstoerer') s.name = 'Dogma';
        if ((type === 'station' || type === 'relay') && nav.name) s.name = nav.name;
        if (!cap) this.fx.flash(pos, 90, new THREE.Color(3, 1, 2.5), 0.5);
        if (this.coop && !cap) s.hp = s.maxHp = s.maxHp * 1.25;
      }
    }
    if (idx > 0) { this.audio.warn(); this.setBanner('NEUE FEINDWELLE'); }
    if ((nav.type !== 'survive' && nav.type !== 'convoy') || this.mission.wave < nav.waves.length) this.say([nav.onWave?.[idx]]);
  }

  spawnPickups(nav) {
    const geo = new THREE.OctahedronGeometry(3.2, 0);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 3, 1.4) });
    for (let i = 0; i < nav.pickups; i++) {
      const a = (i / nav.pickups) * Math.PI * 2 + rnd(-0.3, 0.3);
      let pos;
      for (let tries = 0; tries < 40; tries++) {
        const r = rnd(250, 520 + tries * 15);
        pos = nav._pos.clone().add(new THREE.Vector3(Math.cos(a) * r, rnd(-120, 120), Math.sin(a) * r));
        const clear = this.asteroids.every((ast) => ast.pos.distanceTo(pos) > ast.radius + 70)
          && this.ships.every((c) => !c.def.capital || this.hullDist(c, pos, t3) > 60);
        if (clear) break;
      }
      const g = new THREE.Group();
      g.add(new THREE.Mesh(geo, mat));
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(0.5, 2.2, 1), blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.setScalar(36); g.add(glow);
      g.position.copy(pos);
      this.scene.add(g);
      this.pickups.push({ pos: g.position, mesh: g, got: false });
    }
  }

  /** Send scripted radio lines, honouring if/ifNot conditions. */
  say(lines) { lines?.forEach((l) => { if (l && passes(l, this.flags)) this.ui.comm(l.who, l.text); }); }

  fail(reason) {
    if (this.failReason) return;
    this.failReason = reason; this.failT = 3;
    this.setBanner('MISSION GESCHEITERT');
    this.audio.warn();
  }

  completeNav(nav) {
    const m = this.mission;
    this.say(nav.onClear);
    const last = m.navIdx + 1 >= this.def.navs.length;
    // objective-driven navs end the local fight: remaining enemies retreat
    if (nav.type && nav.type !== 'clear' || (last && this.def.noReturn)) {
      for (const s of this.ships) if (s.alive && s.team === 1) this.jumpOut(s);
      for (const mi of this.missiles) if (mi.team === 1) mi.life = 0;
    }
    for (const p of this.pickups) if (!p.got) { this.scene.remove(p.mesh); disposeObj(p.mesh); }
    this.pickups = []; m.dockWave = false; m.courier = null;
    m.timer = null; m.docking = false; m.prog = 0;
    m.navIdx++;
    if (m.navIdx < this.def.navs.length) { m.phase = 'travel'; this.activateNav(m.navIdx); this.setBanner('SEKTOR GESICHERT'); }
    else if (this.def.noReturn) {
      m.phase = 'done';
      const talk = (nav.onClear || []).filter((l) => passes(l, this.flags)).reduce((a, l) => a + 2.4 + l.text.length * 0.045, 0);
      m.endT = Math.max(4, talk + 1.5);
      this.setBanner('MISSIONSZIELE ERFÜLLT');
    }
    else { m.phase = 'return'; this.setBanner('MISSIONSZIELE ERFÜLLT'); }
    this.audio.beep(1200, 0.2);
  }

  updateMission(dt) {
    const m = this.mission, def = this.def;
    this.stats.time += dt;
    if (this.ended) return;
    if (m.phase === 'done') {
      for (const P of this.pilots) if (P.ship.alive) { P.ship.hp = Math.max(P.ship.hp, 1); P.ship.shield = P.ship.maxShield; }
      for (const P of this.pilots) if (!P.ship.alive) P.deadT = Math.max(0, P.deadT - dt); // keep the respawn countdown moving
      m.endT -= dt;
      if (m.endT <= 0) this.end(true);
      return;
    }
    for (const P of this.pilots) {
      if (P.ship.alive) continue;
      P.deadT -= dt;
      if (this.coop && P.deadT <= 0 && this.alivePilots().length) this.respawn(P);
    }
    // a failed objective wins over a later death, so the story branch still follows (e.g. transport lost, then shot down)
    if (this.protect && !this.protect.alive && !this.failReason) this.fail(`${/^Habitat|^Relais/.test(this.protect.name) ? 'Das' : 'Die'} ${this.protect.name} wurde zerstört.`);
    if (this.failReason) {
      this.failT -= dt;
      if (this.failT <= 0) this.end(false, this.failReason, 'objective');
      return;
    }
    const alive = this.alivePilots();
    if (!alive.length) {
      if (this.pilots.every((P) => P.deadT <= 0)) this.end(false, this.coop ? 'Beide Jäger wurden zerstört. Die Rettungskapseln wurden geborgen.' : 'Dein Jäger wurde zerstört. Du konntest dich mit der Rettungskapsel retten.', 'death');
      return;
    }
    const near = (pos, r) => alive.some((P) => P.ship.pos.distanceTo(pos) < r);
    if (m.phase === 'return') {
      if (!this.carrier.alive) return this.fail('Die TUS Aurora wurde zerstört.');
      if (this.seq) return;
      if (!this.useBay) { if (near(this.carrier.pos, 750)) this.end(true); return; }
      if (near(this.carrier.pos, 1600)) {
        const threat = this.ships.some((s) => s.alive && s.team === 1 && !s.def.capital && s.pos.distanceTo(this.carrier.pos) < 3500);
        if (!threat) this.startLanding();
        else if (!m.landWarned) { m.landWarned = true; this.ui.comm('flug', 'Negativ, {cs} – Feindkontakt am Träger. Erst den Luftraum säubern, dann Landefreigabe.'); }
      }
      return;
    }
    const nav = this.nav();
    if (m.timer != null) {
      m.timer -= dt;
      if (m.timer <= 0) { m.timer = 0; return this.fail(nav.timerFail || nav.limitFail || 'Die Zeit ist abgelaufen.'); }
    }
    if (m.phase === 'travel') {
      const np = this.navPos();
      if (nav.type === 'escape') {
        if (near(np, 650)) { this.say(nav.onArrive); this.completeNav(nav); }
        return;
      }
      if (near(np, 2500)) {
        m.phase = 'fight'; m.wave = 0; m.waveT = null; m.prog = 0; m.docking = false;
        if (nav.limit) m.timer = nav.limit;
        if (nav.type === 'survive') m.surv = nav.survive;
        if (nav.type === 'pickup') this.spawnPickups(nav);
        if (nav.type === 'convoy') {
          const to = nav.convoy.to ? new THREE.Vector3(...nav.convoy.to) : this.carrier.pos.clone().add(new THREE.Vector3(0, -40, 320));
          m.convoy = nav.convoy.types.map((type, i) => {
            const c = this.spawn(type, nav._pos.clone().add(new THREE.Vector3(i * 90 - 45, i * 20, i * 60)), to.clone().sub(nav._pos).normalize());
            c.dest = to; c.cruise = nav.convoy.speed || c.def.speed; c.speed = 0; c.name = `${SHIPS[type].name} ${i + 1}`;
            return c;
          });
        }
        if (nav.type === 'intercept') {
          const to = new THREE.Vector3(...nav.intercept.to);
          const c = this.spawn('kurier', nav._pos.clone(), to.clone().sub(nav._pos).normalize());
          c.flee = to; c.name = 'Kurierschiff';
          c.fleeSpeed = nav.intercept.fastIfNot && !this.flags[nav.intercept.fastIfNot] ? 175 : 140;
          m.courier = c;
        }
        if (nav.type === 'dock') {
          m.prison = this.spawn('prison', nav._pos.clone(), new THREE.Vector3(0.2, 0, 1).normalize());
          m.prison.name = nav.name;
        }
        this.spawnWave(nav, 0);
        this.say(nav.onArrive);
      }
      return;
    }

    // ---- fight phase ----
    const hostiles = this.hostileCount() - (m.courier?.alive ? 1 : 0);
    const lastWave = m.wave >= nav.waves.length - 1;
    // wave progression
    const cycle = nav.type === 'survive' || nav.type === 'convoy';
    if (hostiles === 0 && (!lastWave || cycle)) {
      if (m.waveT === null) m.waveT = 3;
      m.waveT -= dt;
      if (m.waveT <= 0) {
        m.waveT = null; m.wave++;
        this.spawnWave(nav, cycle ? m.wave % nav.waves.length : m.wave);
      }
    }
    let done = false;
    switch (nav.type) {
      case 'scan':
        if (near(nav._pos, 700)) m.prog += dt;
        done = m.prog >= nav.scan;
        break;
      case 'pickup':
        for (const p of this.pickups) {
          if (p.got) { continue; }
          p.mesh.rotation.y += dt * 2;
          if (near(p.pos, 45)) {
            p.got = true; this.scene.remove(p.mesh); disposeObj(p.mesh);
            this.fx.flash(p.pos, 50, new THREE.Color(0.6, 3, 1.4), 0.4);
            this.audio.beep(1600, 0.15);
            this.setBanner(`${nav.pickupLabel || 'FLUGSCHREIBER'} ${this.pickups.filter((x) => x.got).length}/${this.pickups.length} GEBORGEN`);
          }
        }
        done = this.pickups.every((p) => p.got);
        break;
      case 'intercept':
        if (m.courier.escaped) return this.fail('Das Kurierschiff hat den Sprungpunkt erreicht.');
        done = !m.courier.alive;
        break;
      case 'convoy': {
        const alive = m.convoy.filter((c) => c.alive);
        if (!alive.length) return this.fail(nav.failText || 'Der Konvoi wurde vernichtet.');
        if (alive.length < (m.convoyAlive ?? m.convoy.length)) { this.setBanner('KONVOISCHIFF VERLOREN'); this.audio.warn(); }
        m.convoyAlive = alive.length;
        done = alive.every((c) => c.pos.distanceTo(c.dest) < 300);
        break;
      }
      case 'survive':
        m.surv -= dt;
        done = m.surv <= 0;
        break;
      case 'dock':
        if (!m.docking && lastWave && hostiles === 0) {
          m.docking = true; m.prog = 0;
          this.say(nav.onDock);
          this.setBanner('ANDOCKEN FREIGEGEBEN');
        }
        if (m.docking) {
          if (near(m.prison.pos, 170)) {
            if (!m.dockWave && nav.dockWave) { m.dockWave = true; this.spawnGroup(nav.dockWave, m.prison.pos.clone().add(new THREE.Vector3(1400, 300, 0)), m.prison.pos); }
            m.prog += dt;
          }
          done = m.prog >= nav.dock;
        }
        break;
      default:
        done = lastWave && hostiles === 0;
    }
    if (done) this.completeNav(nav);
  }

  /** cause: 'death' (all pilots down → retry) or 'objective' (story may branch). */
  end(win, reason, cause = null) {
    if (this.ended) return;
    this.ended = true;
    this.audio.stopEngine();
    this.ui.missionEnd(win, reason, { ...this.stats }, cause); // a copy: bolts still in flight must not add kills afterwards
  }

  // ---------- frame ----------
  loop(t) {
    requestAnimationFrame((tt) => this.loop(tt));
    let dt = Math.min(0.05, (t - this.last) / 1000 || 0.016);
    this.lastDt = dt;
    this.last = t;
    this.ui.frame?.(dt);
    if (this.mode === 'idle' || !this.scene) return;
    const r = this.renderer;
    if (this.mode === 'cut') {
      if (!this.paused) this.updateCut(dt);
      this.env.update(this.camera);
      r.setScissorTest(false);
      r.setViewport(0, 0, this.w, this.h);
      this.hud.clearRect(0, 0, this.w, this.h);
      if (this.quality === 'high') this.composer.render(); else r.render(this.scene, this.camera);
      return;
    }
    if (this.mode === 'attract') {
      // the menu backdrop only needs 30 fps
      this.attractAcc = (this.attractAcc || 0) + dt;
      if (this.attractAcc < 1 / 31) return;
      dt = Math.min(0.1, this.attractAcc); this.attractAcc = 0;
      this.attractT += dt;
      const a = this.attractT * 0.06 + 0.9;
      this.camera.position.set(Math.cos(a) * 330 + 60, 70 + Math.sin(a * 0.7) * 30, Math.sin(a) * 330 + 60);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(30, 8, 40);
      this.fx.update(dt);
      this.env.update(this.camera);
      r.setScissorTest(false);
      r.setViewport(0, 0, this.w, this.h);
      setParticleScale(this.fx, this.h * r.getPixelRatio());
      if (this.quality === 'high') this.composer.render(); else r.render(this.scene, this.camera);
      return;
    }
    // while paused the picture is static: draw it once, then stop rendering
    if (this.paused) { if (this.pausedDrawn) return; this.pausedDrawn = true; } else this.pausedDrawn = false;
    if (!this.paused && !this.frozen) this.update(dt);
    else if (this.frozen) for (const P of this.pilots) { P.ctrl.update?.(dt); if (P.ctrl.throttleSet != null) P.throttle = P.ctrl.throttleSet; P.ctrl.take(); }
    const split = this.pilots.length > 1;
    r.setScissorTest(split);
    this.hud.clearRect(0, 0, this.w, this.h);
    for (const P of this.pilots) {
      const y = this.h - P.vy - P.vh; // WebGL origin is bottom-left
      r.setViewport(P.vx, y, P.vw, P.vh);
      setParticleScale(this.fx, P.vh * r.getPixelRatio());
      if (split) r.setScissor(P.vx, y, P.vw, P.vh);
      this.env.update(P.camera);
      const inCockpit = P.view === 'cockpit' && P.ship.alive;
      // hide only this pilot's own ship from its own cockpit view
      for (const Q of this.pilots) Q.ship.mesh.visible = !(Q === P && inCockpit);
      if (this.quality === 'high' && P.composer) P.composer.render(); else r.render(this.scene, P.camera);
      if (inCockpit) { P.cockpit.update(P, this, this.lastDt || 0.016, P.camera); P.cockpit.render(r); }
      P.camera.updateMatrixWorld();
      drawHud(this.hud, this, P);
    }
    for (const Q of this.pilots) Q.ship.mesh.visible = true;
    if (split) {
      // divider line
      const ctx = this.hud;
      ctx.fillStyle = 'rgba(127,214,255,.55)';
      const stack = this.w >= this.h;
      if (stack) ctx.fillRect(0, this.h / 2 - 1, this.w, 2); else ctx.fillRect(this.w / 2 - 1, 0, 2, this.h);
    }
    r.setScissorTest(false);
  }

  update(dt) {
    for (const P of this.pilots) {
      P.bumpT -= dt;
      if (P.ship.alive) this.updatePilot(P, dt);
      else { P.ctrl.update?.(dt); P.ctrl.take(); }
    }

    for (const s of this.ships) {
      if (!s.alive) continue;
      if (!s.isPlayer) this.updateAI(s, dt);
      s.cool -= dt;
      this.fwd(s, t1);
      if (!s.seqHold) s.pos.addScaledVector(t1, s.speed * dt);
      if (s.shieldT > 0) s.shieldT -= dt;
      else if (s.shield < s.maxShield) s.shield = Math.min(s.maxShield, s.shield + s.maxShield * 0.1 * dt);
      const boost = s.isPlayer && s.pilot.boosting;
      const k = (0.55 + Math.min(1.2, s.speed / s.def.speed) * 0.6) * (boost ? 1.7 : 1) * (0.92 + Math.random() * 0.16);
      for (const e of s.mesh.userData.engines) e.scale.setScalar(e.userData.base * k);
      for (const b of s.mesh.userData.blinkers || []) { const bl = b.userData.blink; b.visible = ((performance.now() / 1000) * bl.rate + bl.phase) % 1 < 0.14; }
      this.shipFx(s, dt, boost);
      if (!s.def.capital) this.damageSmoke(s, dt);
    }
    this.updateSeq(dt);

    this.updateBolts(dt);
    this.updateMines(dt);
    this.updateMissiles(dt);

    this.updateDying(dt);
    for (const a of this.asteroids) a.mesh.rotateOnAxis(a.axis, a.rate * dt);

    for (const P of this.pilots) {
      const p = P.ship;
      if (p.alive && (!P.target || !P.target.alive)) {
        let best = null, bd = 4500;
        for (const o of this.ships) {
          if (!o.alive || o.team !== 1) continue;
          const d = o.pos.distanceTo(p.pos) * (o.def.capital ? 1.5 : 1);
          if (d < bd) { bd = d; best = o; }
        }
        if (best !== P.target) P.targetT = performance.now();
        P.target = best;
      }
      P.missileWarn = p.alive && this.missiles.some((m) => m.target === p && m.team === 1);
      if (P.missileWarn) { P.warnT -= dt; if (P.warnT <= 0) { P.warnT = 0.4; this.audio.warn(); } }
      P.hurt = Math.max(0, P.hurt - dt * 0.8);
    }

    this.updateMission(dt);
    this.fx.update(dt);
    this.bannerT -= dt;
    this.ui.setAuto(this.autoAvailable());
    const P0 = this.pilots[0];
    this.audio.setEngine(P0.ship.alive ? P0.ship.speed / P0.ship.def.boost : 0, P0.boosting);
    this.ui.setThrottle?.(P0.throttle);

    for (const P of this.pilots) {
      const p = P.ship;
      if (p.alive) {
        let fov;
        // wide phone screens (19.5:9 and wider) would get 120°+ horizontally and stretch everything
        // towards the edges: cap the horizontal field of view, the vertical one follows the aspect
        const aspect = P.camera.aspect || 1.6;
        const capV = (hDeg) => (2 * Math.atan(Math.tan((hDeg * Math.PI) / 360) / aspect) * 180) / Math.PI;
        P.cockpitFov = Math.round(Math.min(P.baseFov + 10, capV(100)));
        if (P.view === 'cockpit') {
          // pilot's eye: locked to the ship, horizon leans into turns, slight head lag
          P.camQ.slerp(p.quat, 1 - Math.exp(-dt * 22));
          const eye = EYE[p.type] || [0, 1.2, 1.7];
          P.camera.position.copy(t1.set(eye[0], eye[1], eye[2]).applyQuaternion(p.quat).add(p.pos));
          q1.setFromAxisAngle(AZ, p.bank * 0.45);
          P.camera.quaternion.copy(P.camQ).multiply(q1).multiply(FLIP);
          fov = P.cockpitFov + (p.speed / p.def.boost) * 4;
        } else {
          P.camQ.slerp(p.quat, 1 - Math.exp(-dt * 5.5));
          const back = 27 + (p.speed / p.def.boost) * 9;
          P.camera.position.copy(t1.set(0, 7.5, -back).applyQuaternion(P.camQ).add(p.pos));
          P.camera.quaternion.copy(P.camQ).multiply(FLIP);
          fov = Math.min(P.baseFov, capV(104)) + (p.speed / p.def.boost) * 10;
        }
        if (Math.abs(fov - P.camera.fov) > 0.05) { P.camera.fov += (fov - P.camera.fov) * Math.min(1, dt * 4); P.camera.updateProjectionMatrix(); }
      }
      if (P.shake > 0) {
        P.shake = Math.max(0, P.shake - dt * 2.2);
        P.camera.position.x += rnd(-1, 1) * P.shake * 1.6;
        P.camera.position.y += rnd(-1, 1) * P.shake * 1.6;
      }
      P.invQ.copy(p.quat).invert();
    }
  }

  /** Damaged fighters trail smoke: grey wisps from 70 % hull, thick black smoke, sparks and flames below 35 %. */
  damageSmoke(s, dt) {
    const k = 1 - s.hp / s.maxHp;
    if (k < 0.3 || !s.mesh.visible || this.ear(s.pos) > 1600) return;
    // emit from a damaged spot slightly behind the cockpit, drifting back with the ship's wake
    t5.set(s.radius * 0.25 * Math.sin(s.radius * 7), s.radius * 0.12, -s.radius * 0.35).applyQuaternion(s.quat).add(s.pos);
    t4.copy(FWD).applyQuaternion(s.quat).multiplyScalar(-s.speed * 0.15);
    const rate = (k - 0.3) * 70;
    s.smokeAcc = (s.smokeAcc || 0) + rate * dt;
    while (s.smokeAcc >= 1) {
      s.smokeAcc -= 1;
      const heavy = k > 0.65;
      this.fx.smoke(t5, heavy ? rnd(5, 8) : rnd(3, 5), heavy ? rnd(2.2, 3.4) : rnd(1.4, 2.2), t4, heavy ? rnd(0.2, 0.28) : rnd(0.42, 0.55), heavy ? 0.85 : 0.6);
      if (heavy && Math.random() < 0.5) this.fx.particle(t5.x, t5.y, t5.z, t4.x + rnd(-5, 5), t4.y + rnd(-5, 5), t4.z + rnd(-5, 5), 2.8, 1.1, 0.3, rnd(3, 5), rnd(0.25, 0.45), 1.5);
      if (heavy && Math.random() < 0.15) this.fx.sparks(t5, COL.spark, 2, 50);
    }
  }

  /** Exhaust trails for fighters and fires on damaged capital ships. */
  shipFx(s, dt, boost = false) {
    if (!s.alive || !s.mesh.visible) return;
    const near = this.mode === 'cut' || this.ear(s.pos) < 1800;
    if (!near) return;
    if (s.def.capital) {
      if (s.hp < s.maxHp * 0.6 && Math.random() < dt * (s.hp < s.maxHp * 0.3 ? 9 : 4)) {
        const b = s.def.box;
        t5.set(rnd(-b[0], b[0]), rnd(-b[1], b[1]) * 0.6 + b[1] * 0.4, rnd(-b[2], b[2])).applyQuaternion(s.quat).add(s.pos);
        this.fx.particle(t5.x, t5.y, t5.z, rnd(-4, 4), rnd(2, 8), rnd(-4, 4), 2.6, 1.1, 0.3, rnd(6, 14), rnd(0.5, 1), 0.8);
        this.fx.smoke(t5, rnd(6, 10), rnd(2, 3.5), null, 0.12, 0.5);
      }
      return;
    }
    const col = s.team === 0 ? TRAIL_ALLY : TRAIL_FOE;
    for (const e of s.mesh.userData.engines) {
      e.getWorldPosition(t5);
      this.fx.trail(t5, col, (boost ? 3.2 : 2.2) * (e.userData.base / 4), boost ? 0.5 : 0.28);
    }
  }

  // ---------- mines ----------
  layMines(center, n, spread) {
    if (!MINE) {
      const geo = new THREE.IcosahedronGeometry(3, 0); geo.userData.shared = true;
      const mat = new THREE.MeshStandardMaterial({ color: 0x2a1a22, metalness: 0.8, roughness: 0.35, emissive: new THREE.Color(0.5, 0.05, 0.1) }); mat.userData.shared = true;
      const spike = new THREE.ConeGeometry(0.8, 4, 5); spike.userData.shared = true;
      const glow = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(4, 0.4, 0.3), blending: THREE.AdditiveBlending, depthWrite: false }); glow.userData.shared = true;
      MINE = { geo, mat, spike, glow };
    }
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(MINE.geo, MINE.mat));
      for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const sp = new THREE.Mesh(MINE.spike, MINE.mat);
        sp.position.set(d[0] * 3, d[1] * 3, d[2] * 3);
        sp.lookAt(d[0] * 10, d[1] * 10, d[2] * 10); sp.rotateX(Math.PI / 2);
        g.add(sp);
      }
      const light = new THREE.Sprite(MINE.glow); light.scale.setScalar(12); g.add(light);
      g.position.copy(center).add(t1.randomDirection().multiplyScalar(Math.cbrt(Math.random()) * spread).multiply(t2.set(1, 0.35, 1)));
      g.quaternion.random();
      this.scene.add(g);
      this.mines.push({ mesh: g, pos: g.position, light, alive: true, phase: Math.random() * 6, target: null });
    }
  }

  updateMines(dt) {
    const now = performance.now() / 1000;
    for (const mn of this.mines) {
      if (!mn.alive) continue;
      // home in on the nearest Union ship in range
      let best = null, bd = 170;
      for (const s of this.ships) {
        if (!s.alive || s.team !== 0 || s.def.ghost) continue;
        const d = s.pos.distanceTo(mn.pos) - (s.def.capital ? s.radius * 0.6 : 0);
        if (d < bd) { bd = d; best = s; }
      }
      const blink = best ? 10 : 2;
      mn.light.material = MINE.glow;
      mn.light.scale.setScalar(Math.sin(now * blink + mn.phase) > 0.2 ? 14 : 6);
      mn.mesh.rotateY(dt * 0.4);
      if (!best) continue;
      const trigger = best.def.capital ? this.hullDist(best, mn.pos, t3) < 18 : bd < 20;
      if (trigger) { this.detonate(mn, null); continue; }
      t1.copy(best.pos).sub(mn.pos).normalize();
      mn.pos.addScaledVector(t1, 38 * dt);
    }
  }

  detonate(mn, by) {
    mn.alive = false;
    this.scene.remove(mn.mesh);
    this.fx.explode(mn.pos, 1.1, new THREE.Color(3.4, 1.8, 1.2));
    this.audio.explosion(Math.max(0.1, 0.7 - this.ear(mn.pos) / 2500));
    for (const s of this.ships) {
      if (!s.alive || s.def.ghost) continue;
      const d = s.def.capital ? Math.max(0, this.hullDist(s, mn.pos, t3)) : s.pos.distanceTo(mn.pos);
      if (d < 75) this.damage(s, (s.def.capital ? 90 : 55) * (1 - d / 75) + 10, by, mn.pos);
    }
  }

  updateDying(dt) {
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const s = this.dying[i];
      s.dieT -= dt; s.boomT -= dt;
      if (s.boomT <= 0) {
        s.boomT = 0.13;
        const b = s.def.box;
        t1.set(rnd(-b[0], b[0]), rnd(-b[1], b[1]), rnd(-b[2], b[2])).applyQuaternion(s.quat).add(s.pos);
        this.fx.explode(t1, rnd(1.5, 3.5));
      }
      if (s.dieT <= 0) {
        this.fx.explode(s.pos, 9);
        this.fx.flash(s.pos, 1400, new THREE.Color(4, 3, 2), 1.2);
        this.scene.remove(s.mesh);
        disposeObj(s.mesh);
        this.dying.splice(i, 1);
        for (const P of this.pilots) P.shake = Math.max(P.shake, 1);
        this.audio.explosion(0.9, true);
      }
    }
  }

  updateBolts(dt) {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i], pos = b.mesh.position;
      b.prev.copy(pos);
      pos.addScaledVector(b.vel, dt);
      b.life -= dt;
      let hit = b.life <= 0;
      if (!hit) {
        for (const s of this.ships) {
          if (!s.alive || s.team === b.team || s.def.ghost) continue;
          const r = Math.max(s.radius, s.def.modelR || 0) + 4;
          if (s.def.capital) {
            if (pos.distanceToSquared(s.pos) > r * r) continue;
            let hp = null;
            for (const k of [0.25, 0.5, 0.75, 1]) {
              t2.copy(b.prev).lerp(pos, k);
              if (this.hullDist(s, t2, t1) < 2.5) { hp = t2; break; }
            }
            if (hp) { this.damage(s, b.dmg, b.owner, hp); hit = true; break; }
          } else {
            t1.copy(pos).sub(b.prev);
            const len2 = t1.lengthSq();
            const k = THREE.MathUtils.clamp(t2.copy(s.pos).sub(b.prev).dot(t1) / len2, 0, 1);
            t2.copy(b.prev).addScaledVector(t1, k);
            const rr = s.isPlayer ? s.radius * 0.85 : Math.max(s.radius * 1.15, (s.def.modelR || 0) * 0.92);
            if (t2.distanceToSquared(s.pos) < rr * rr) { this.damage(s, b.dmg, b.owner, t2); hit = true; break; }
          }
        }
      }
      if (!hit) {
        for (const a of this.asteroids) {
          if (pos.distanceToSquared(a.pos) < a.radius * a.radius) { this.fx.sparks(pos, COL.spark, 4, 40); hit = true; break; }
        }
      }
      if (!hit && b.team === 0) {
        for (const mn of this.mines) {
          if (!mn.alive) continue;
          t1.copy(pos).sub(b.prev);
          const k = THREE.MathUtils.clamp(t2.copy(mn.pos).sub(b.prev).dot(t1) / (t1.lengthSq() || 1), 0, 1);
          t2.copy(b.prev).addScaledVector(t1, k);
          if (t2.distanceToSquared(mn.pos) < 49) { this.detonate(mn, b.owner); hit = true; break; }
        }
      }
      if (hit) {
        this.scene.remove(b.mesh);
        this.bolts.splice(i, 1);
        this.boltPool.push(b);
      }
    }
  }

  updateMissiles(dt) {
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.life -= dt;
      m.speed = Math.min(m.maxSpeed, m.speed + 260 * dt);
      const tg = m.target;
      if (tg && tg.alive) {
        t1.copy(tg.pos).sub(m.pos);
        const d = t1.length();
        if (!tg.def.capital) { this.fwd(tg, t2); t1.addScaledVector(t2, tg.speed * Math.min(1.5, d / m.speed)); }
        t1.normalize();
        m1.lookAt(t1, ZERO, UP);
        q1.setFromRotationMatrix(m1);
        m.quat.rotateTowards(q1, m.turn * dt);
      }
      t1.copy(FWD).applyQuaternion(m.quat);
      const mPrev = tBump.copy(m.pos);
      m.pos.addScaledVector(t1, m.speed * dt);
      this.fx.particle(m.pos.x, m.pos.y, m.pos.z, rnd(-3, 3), rnd(-3, 3), rnd(-3, 3), 1.8, 1.2, 0.7, m.torpedo ? 5 : 3, 0.6, 0.4);
      if ((m.smokeT = (m.smokeT || 0) - dt) <= 0) { m.smokeT = 0.03; this.fx.smoke(m.pos, 1.6, 1.4, null, 0.55, 0.35); }
      let boom = m.life <= 0;
      if (!boom) {
        for (const s of this.ships) {
          if (!s.alive || s.team === m.team || s.def.ghost) continue;
          if (s.def.capital) {
            if (m.pos.distanceToSquared(s.pos) > (s.radius + 10) ** 2) continue;
            if (this.hullDist(s, m.pos, t2) < 5) { this.damage(s, m.dmg * (m.torpedo ? 1 : 2.4), m.owner, m.pos); boom = true; break; }
          } else if (segDist2(mPrev, m.pos, s.pos) < (s.radius + 7) ** 2) { // swept: fast missiles must not tunnel through
            this.damage(s, m.dmg, m.owner, m.pos); boom = true; break;
          }
        }
      }
      if (!boom) for (const a of this.asteroids) if (m.pos.distanceToSquared(a.pos) < a.radius * a.radius) { boom = true; break; }
      if (boom) {
        this.fx.explode(m.pos, m.torpedo ? 1.6 : 0.8);
        this.audio.explosion(Math.max(0, 0.6 - this.ear(m.pos) / 2500));
        this.scene.remove(m.mesh);
        disposeObj(m.mesh);
        this.missiles.splice(i, 1);
      }
    }
  }
}

installCutscenes(Game);
