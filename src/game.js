import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildShip, SHIPS } from './ships.js';
import { createEnvironment, createAsteroids } from './env.js';
import { Fx, glowTexture } from './fx.js';
import { drawHud } from './hud.js';

const BOLT_SPEED = 950, BOLT_LIFE = 1.15;
const t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), t3 = new THREE.Vector3(), t4 = new THREE.Vector3();
const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
const m1 = new THREE.Matrix4();
const ZERO = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), FWD = new THREE.Vector3(0, 0, 1);
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0);
const FLIP = new THREE.Quaternion().setFromAxisAngle(AY, Math.PI);
const rnd = (a, b) => a + Math.random() * (b - a);

const COL = {
  ally: new THREE.Color(0.5, 2.2, 4.5), foe: new THREE.Color(4.5, 0.5, 1.2), turret: new THREE.Color(1.2, 4, 1.0), turretFoe: new THREE.Color(4.5, 1.6, 0.3),
  shield: new THREE.Color(0.6, 1.6, 3), spark: new THREE.Color(3, 1.8, 0.6),
};
export const PILOT_COLORS = ['#7fd6ff', '#ffb347'];

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
    this.invert = true;
    this.mode = 'idle';
    this.paused = false;
    this.pilots = [];
    this.ships = []; this.bolts = []; this.missiles = []; this.asteroids = []; this.dying = [];
    this.boltPool = [];
    this.boltGeo = new THREE.BoxGeometry(0.55, 0.55, 18);
    this.boltMats = {};
    for (const k of ['ally', 'foe', 'turret', 'turretFoe']) this.boltMats[k] = new THREE.MeshBasicMaterial({ color: COL[k] });
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
    if (this.composer) { this.composer.setPixelRatio(pr); this.composer.setSize(w, h); }
    const n = this.pilots.length;
    this.pilots.forEach((P, i) => {
      // split vertically stacked on landscape screens, side by side on portrait
      const stack = w >= h;
      P.vx = stack ? 0 : (w / n) * i; P.vy = stack ? (h / n) * i : 0;
      P.vw = stack ? w : w / n; P.vh = stack ? h / n : h;
      P.camera.aspect = P.vw / P.vh;
      P.baseFov = n > 1 && stack ? 50 : 60;
      P.camera.updateProjectionMatrix();
      if (P.composer) { P.composer.setPixelRatio(pr); P.composer.setSize(P.vw, P.vh); }
    });
    const cs = getComputedStyle(document.documentElement);
    this.safeL = parseFloat(cs.getPropertyValue('--sal')) || 0;
    this.safeR = parseFloat(cs.getPropertyValue('--sar')) || 0;
  }

  setQuality(q) { this.quality = q; this.resize(); }

  loadScene(sky) {
    if (this.scene) {
      this.scene.traverse((o) => { if (o.geometry && o.geometry !== this.boltGeo) o.geometry.dispose?.(); });
      this.env?.dispose();
    }
    this.composer?.dispose();
    this.pilots.forEach((P) => P.composer?.dispose());
    this.pilots = [];
    this.scene = new THREE.Scene();
    this.env = createEnvironment(this.scene, this.renderer, sky);
    this.fx = new Fx(this.scene);
    this.ships = []; this.bolts = []; this.missiles = []; this.asteroids = []; this.dying = []; this.boltPool = [];
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
    this.hud.clearRect(0, 0, this.w, this.h);
  }

  /** controllers: one per human pilot. names: callsigns. */
  startMission(def, controllers, names) {
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
        aimPoint: new THREE.Vector3(), leadPoint: new THREE.Vector3(), aimLocked: false,
        shake: 0, hurt: 0, bumpT: 0, deadT: 0, missileWarn: false, warnT: 0,
        color: PILOT_COLORS[i], label: `P${i + 1}`, baseFov: 60, targetT: 0,
      };
      ship.pilot = P;
      ctrl.reset();
      this.pilots.push(P);
    });
    for (const P of this.pilots) if (this.quality === 'high') P.composer = this.makeComposer(P.camera);
    this.wingman = null;
    if (def.wingman) {
      this.wingman = this.spawn(def.ship, new THREE.Vector3(40, -8, 270), FWD, { wingman: true, who: def.wingman, skill: 0.75 });
      this.wingman.name = def.wingman === 'rook' ? 'Rook' : 'Kolibri';
    }
    this.protect = null;
    if (def.protect === 'carrier') this.protect = this.carrier;
    for (const n of def.navs) {
      n._pos = new THREE.Vector3(...n.pos);
      if (n.asteroids) this.asteroids.push(...createAsteroids(this.scene, n._pos, n.asteroids));
      if (def.protect === 'transport' && n.anchor) {
        this.protect = this.spawn('transport', n._pos.clone(), new THREE.Vector3(0.3, 0, 1).normalize());
      }
    }
    this.mission = { navIdx: 0, phase: 'travel', wave: 0, waveT: null };
    this.banner = null; this.bannerT = 0; this.objT = performance.now(); this.lastObj = '';
    this.resize();
    this.audio.startEngine();
    this.ui.comm('flug', this.coop ? 'Startfreigabe für beide Maschinen. Guten Flug, Nachtfalken!' : 'Startfreigabe erteilt. Guten Flug, {cs}!');
  }

  stop() { this.mode = 'idle'; this.audio.stopEngine(); }

  // ---------- helpers ----------
  alivePilots() { return this.pilots.filter((P) => P.ship.alive); }
  /** Distance from a point to the nearest living pilot (used for audio + spawn logic). */
  ear(pos) {
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
    b.life = BOLT_LIFE; b.team = owner.team; b.owner = owner; b.dmg = dmg;
    this.scene.add(b.mesh);
    this.bolts.push(b);
  }

  fire(s, dir) {
    if (s.cool > 0) return;
    s.cool = s.def.rof;
    const key = s.team === 0 ? 'ally' : 'foe';
    for (const g of s.def.guns) {
      t4.set(g[0], g[1], g[2]).applyQuaternion(s.quat).add(s.pos);
      this.spawnBolt(t4, dir, s, s.def.dmg, key);
    }
    if (s.isPlayer) { this.audio.laser(s.pilot.idx === 0 ? 0.2 : 0.14); this.stats.shots += s.def.guns.length; return; }
    const d = this.ear(s.pos);
    if (d < 900) this.audio.laser(0.12 * (1 - d / 900), s.team === 1);
  }

  launchMissile(s, target, torpedo = false) {
    const mesh = new THREE.Group();
    const body = new THREE.CylinderGeometry(0.35, 0.35, torpedo ? 7 : 4.5, 6);
    body.rotateX(Math.PI / 2);
    mesh.add(new THREE.Mesh(body, new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.6, roughness: 0.4 })));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: s.team === 0 ? new THREE.Color(3, 2.4, 1.2) : new THREE.Color(4, 0.6, 0.6), blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(torpedo ? 16 : 10); glow.position.z = -3;
    mesh.add(glow);
    mesh.position.set(0, -1.6, 2).applyQuaternion(s.quat).add(s.pos);
    mesh.quaternion.copy(s.quat);
    this.scene.add(mesh);
    this.missiles.push({
      mesh, pos: mesh.position, quat: mesh.quaternion, target, team: s.team, owner: s,
      speed: torpedo ? 300 : Math.max(380, s.speed + 150), maxSpeed: torpedo ? 300 : 620, turn: torpedo ? 0.7 : (s.team === 0 ? 2.6 : 1.35),
      life: torpedo ? 14 : 7, dmg: torpedo ? 170 : 75, torpedo,
    });
    if (this.ear(s.pos) < 1200) this.audio.missile();
  }

  damage(s, dmg, by, point) {
    if (!s.alive) return;
    s.shieldT = 4.5;
    s.lastHitBy = by;
    const hadShield = s.shield > 0;
    if (hadShield) {
      s.shield -= dmg;
      if (s.shield < 0) { s.hp += s.shield; s.shield = 0; }
      this.fx.flash(point, 14, COL.shield, 0.2);
    } else {
      s.hp -= dmg;
      this.fx.sparks(point, COL.spark, 7);
      this.fx.flash(point, 9, COL.spark, 0.15);
    }
    if (!s.def.capital) { s.ai.evadeT = 0.9; s.ai.evade.randomDirection(); }
    if (s.isPlayer) {
      const P = s.pilot;
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
        this.setBanner(`${s.name.toUpperCase()} ZERSTÖRT`);
        if (this.wingman?.alive && Math.random() < 0.3) this.ui.comm(this.wingman.who, ['Guter Schuss, {cs}!', 'Abschuss bestätigt!', 'Den hast du sauber erwischt!'][Math.random() * 3 | 0].replace('{cs}', by.name));
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
    P.camQ.copy(s.quat); P.energy = 1; P.hurt = 0;
    this.fx.flash(s.pos, 120, new THREE.Color(2, 3, 5), 0.6);
    this.setBanner(`${s.name.toUpperCase()} WIEDER IM EINSATZ`);
  }

  setBanner(t) { this.banner = t; this.bannerT = 2.6; this.bannerT0 = performance.now(); }

  // ---------- AI ----------
  pickTarget(s) {
    let best = null, bd = Infinity;
    const wantCap = s.def.bomber;
    for (const o of this.ships) {
      if (!o.alive || o.team === s.team) continue;
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
          const spread = (1 - s.skill) * 0.045 + (tgt.def.capital ? 0.03 : 0.006);
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
      if (!c.def.capital || !c.alive || c === tgt) continue;
      if (s.pos.distanceToSquared(c.pos) > (c.radius + 120) ** 2) continue;
      const d = this.boxDist(c, s.pos, t3);
      if (d < 60) dir.addScaledVector(t3, 3).normalize();
    }
    this.steer(s, dir, dt, def.turn * (0.75 + s.skill * 0.25));
    s.speed += (want - s.speed) * Math.min(1, dt * 1.4);
  }

  /** Distance from point to a capital ship's oriented box; out = world-space push direction. */
  boxDist(c, p, out) {
    const b = c.def.box;
    t4.copy(p).sub(c.pos).applyQuaternion(q2.copy(c.quat).invert());
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
    const tur = s.def.turrets;
    for (let i = 0; i < tur.length; i++) {
      s.turretCool[i] -= dt;
      if (s.turretCool[i] > 0) continue;
      s.turretCool[i] = rnd(0.7, 1.3);
      t1.set(tur[i][0], tur[i][1], tur[i][2]).applyQuaternion(s.quat).add(s.pos);
      let best = null, bd = 1500 * 1500;
      for (const o of this.ships) {
        if (!o.alive || o.team === s.team) continue;
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
    if (c.throttleSet != null) { P.throttle = c.throttleSet; c.throttleSet = null; }
    P.throttle = Math.min(1, Math.max(0, P.throttle + c.throttleRate * dt * 0.8));
    const sy = c.y * (this.invert ? 1 : -1);
    const rate = def.turn * (c.boosting ? 0.7 : 1);
    q1.setFromAxisAngle(AX, -sy * rate * dt);
    q2.setFromAxisAngle(AY, -c.x * rate * dt);
    p.quat.multiply(q1).multiply(q2).normalize();
    p.bank += (c.x * 0.75 - p.bank) * Math.min(1, dt * 5);
    p.mesh.userData.body.rotation.z = p.bank;
    p.mesh.userData.body.rotation.x = -sy * 0.12;

    const boosting = c.boosting && P.energy > 0.02;
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
    if (c.firing) this.fire(p, P.aimLocked ? t3.clone() : t1.clone());

    for (const e of c.take()) {
      if (e === 'missile') this.playerMissile(P);
      else if (e === 'target') this.cycleTarget(P);
      else if (e === 'auto') this.autopilot();
      else if (e === 'pause') this.ui.pause();
    }

    for (const a of this.asteroids) {
      t2.copy(p.pos).sub(a.pos);
      const d = t2.length();
      if (d < a.radius + 5) this.bump(P, t2.divideScalar(d), a.radius + 5 - d);
    }
    for (const cap of this.ships) {
      if (!cap.def.capital || !cap.alive) continue;
      if (p.pos.distanceToSquared(cap.pos) > (cap.radius + 40) ** 2) continue;
      const d = this.boxDist(cap, p.pos, t2);
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
      this.damage(p, 12 + p.speed * 0.08, null, p.pos);
      p.speed *= 0.5;
    }
  }

  playerMissile(P) {
    const p = P.ship;
    if (p.missiles <= 0 || !p.alive) { this.audio.beep(220); return; }
    p.missiles--;
    this.launchMissile(p, P.target && P.target.alive ? P.target : null);
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
    P.targetT = performance.now();
    this.audio.lock();
  }

  hostileCount() { let n = 0; for (const s of this.ships) if (s.alive && s.team === 1) n++; return n; }

  // ---------- mission ----------
  navPos() {
    const m = this.mission;
    if (!m) return null;
    if (m.phase === 'return') return this.carrier.pos;
    const n = this.def.navs[m.navIdx];
    if (m.phase === 'fight') return null;
    return n.anchor && this.protect ? this.protect.pos : n._pos;
  }
  navName() { return this.mission.phase === 'return' ? 'TUS Aurora' : this.def.navs[this.mission.navIdx].name; }
  objectiveText() {
    const m = this.mission;
    if (m.phase === 'return') return 'Kehre zur TUS Aurora zurück';
    const n = this.def.navs[m.navIdx];
    if (m.phase === 'travel') return `Fliege zu ${n.name}`;
    return n.objective || 'Vernichte alle Feinde';
  }
  autoAvailable() {
    const m = this.mission;
    if (!m || m.phase === 'fight' || this.frozen || this.hostileCount() > 0) return false;
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

  spawnWave(nav, idx) {
    const center = nav.anchor && this.protect ? this.protect.pos : nav._pos;
    const base = t1.randomDirection(); base.y *= 0.35; base.normalize();
    const origin = new THREE.Vector3().copy(center).addScaledVector(base, nav.anchor ? 2600 : 1500);
    if (this.ear(origin) < 1300) origin.addScaledVector(base, 1300);
    for (const [type, n] of nav.waves[idx]) {
      for (let i = 0; i < n; i++) {
        const cap = SHIPS[type].capital;
        const pos = cap ? nav._pos.clone() : origin.clone().add(new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(160));
        const dir = cap ? new THREE.Vector3(1, 0, 0.2).normalize() : new THREE.Vector3().copy(center).sub(pos).normalize();
        const s = this.spawn(type, pos, dir);
        if (cap && type === 'zerstoerer') s.name = 'Dogma';
        if (!cap) this.fx.flash(pos, 90, new THREE.Color(3, 1, 2.5), 0.5);
        // co-op is harder: tougher enemies
        if (this.coop && !cap) { s.hp = s.maxHp = s.maxHp * 1.25; }
      }
    }
    if (idx > 0) { this.audio.warn(); this.setBanner('NEUE FEINDWELLE'); }
    const line = nav.onWave?.[idx];
    if (line) this.ui.comm(line.who, line.text);
  }

  updateMission(dt) {
    const m = this.mission, def = this.def;
    this.stats.time += dt;
    if (this.ended) return;
    for (const P of this.pilots) {
      if (P.ship.alive) continue;
      P.deadT -= dt;
      if (this.coop && P.deadT <= 0 && this.alivePilots().length) this.respawn(P);
    }
    const alive = this.alivePilots();
    if (!alive.length) {
      if (this.pilots.every((P) => P.deadT <= 0)) this.end(false, this.coop ? 'Beide Jäger wurden zerstört. Die Rettungskapseln wurden geborgen.' : 'Dein Jäger wurde zerstört. Du konntest dich mit der Rettungskapsel retten.');
      return;
    }
    if (this.protect && !this.protect.alive) {
      if (!this.failT) { this.failT = 3; this.setBanner(`${this.protect.name.toUpperCase()} VERLOREN`); }
      this.failT -= dt;
      if (this.failT <= 0) this.end(false, `Die ${this.protect.name} wurde zerstört.`);
      return;
    }
    const near = (pos, r) => alive.some((P) => P.ship.pos.distanceTo(pos) < r);
    if (m.phase === 'return') {
      if (near(this.carrier.pos, 750)) this.end(true);
      return;
    }
    const nav = def.navs[m.navIdx];
    if (m.phase === 'travel') {
      if (near(this.navPos(), 2500)) {
        m.phase = 'fight'; m.wave = 0; m.waveT = null;
        this.spawnWave(nav, 0);
        nav.onArrive?.forEach((l) => this.ui.comm(l.who, l.text));
      }
    } else if (this.hostileCount() === 0) {
      if (m.waveT === null) m.waveT = 3;
      m.waveT -= dt;
      if (m.waveT <= 0) {
        m.waveT = null; m.wave++;
        if (m.wave < nav.waves.length) this.spawnWave(nav, m.wave);
        else {
          nav.onClear?.forEach((l) => this.ui.comm(l.who, l.text));
          m.navIdx++;
          m.phase = m.navIdx < def.navs.length ? 'travel' : 'return';
          this.setBanner(m.phase === 'return' ? 'MISSIONSZIELE ERFÜLLT' : 'SEKTOR GESICHERT');
          this.audio.beep(1200, 0.2);
        }
      }
    }
  }

  end(win, reason) {
    if (this.ended) return;
    this.ended = true;
    this.audio.stopEngine();
    this.ui.missionEnd(win, reason, this.stats);
  }

  // ---------- frame ----------
  loop(t) {
    requestAnimationFrame((tt) => this.loop(tt));
    const dt = Math.min(0.05, (t - this.last) / 1000 || 0.016);
    this.last = t;
    this.ui.frame?.(dt);
    if (this.mode === 'idle' || !this.scene) return;
    const r = this.renderer;
    if (this.mode === 'attract') {
      this.attractT += dt;
      const a = this.attractT * 0.06 + 0.9;
      this.camera.position.set(Math.cos(a) * 330 + 60, 70 + Math.sin(a * 0.7) * 30, Math.sin(a) * 330 + 60);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(30, 8, 40);
      this.fx.update(dt);
      this.env.update(this.camera);
      r.setScissorTest(false);
      r.setViewport(0, 0, this.w, this.h);
      if (this.quality === 'high') this.composer.render(); else r.render(this.scene, this.camera);
      return;
    }
    if (!this.paused && !this.frozen) this.update(dt);
    const split = this.pilots.length > 1;
    r.setScissorTest(split);
    this.hud.clearRect(0, 0, this.w, this.h);
    for (const P of this.pilots) {
      const y = this.h - P.vy - P.vh; // WebGL origin is bottom-left
      r.setViewport(P.vx, y, P.vw, P.vh);
      if (split) r.setScissor(P.vx, y, P.vw, P.vh);
      this.env.update(P.camera);
      if (this.quality === 'high' && P.composer) P.composer.render(); else r.render(this.scene, P.camera);
      P.camera.updateMatrixWorld();
      drawHud(this.hud, this, P);
    }
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
      s.pos.addScaledVector(t1, s.speed * dt);
      if (s.shieldT > 0) s.shieldT -= dt;
      else if (s.shield < s.maxShield) s.shield = Math.min(s.maxShield, s.shield + s.maxShield * 0.1 * dt);
      const boost = s.isPlayer && s.pilot.boosting;
      const k = (0.55 + Math.min(1.2, s.speed / s.def.speed) * 0.6) * (boost ? 1.7 : 1) * (0.92 + Math.random() * 0.16);
      for (const e of s.mesh.userData.engines) e.scale.setScalar(e.userData.base * k);
      if (!s.def.capital && s.hp < s.maxHp * 0.4 && Math.random() < dt * 14) {
        this.fx.particle(s.pos.x, s.pos.y, s.pos.z, rnd(-6, 6), rnd(-6, 6), rnd(-6, 6), 1.6, 0.7, 0.3, 4, 0.7, 0.5);
      }
    }

    this.updateBolts(dt);
    this.updateMissiles(dt);

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
        this.dying.splice(i, 1);
        for (const P of this.pilots) P.shake = Math.max(P.shake, 1);
        this.audio.explosion(0.9, true);
      }
    }
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
      P.missileWarn = this.missiles.some((m) => m.target === p && m.team === 1);
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
        P.camQ.slerp(p.quat, 1 - Math.exp(-dt * 5.5));
        const back = 27 + (p.speed / p.def.boost) * 9;
        P.camera.position.copy(t1.set(0, 7.5, -back).applyQuaternion(P.camQ).add(p.pos));
        P.camera.quaternion.copy(P.camQ).multiply(FLIP);
        const fov = P.baseFov + (p.speed / p.def.boost) * 16;
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

  updateBolts(dt) {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i], pos = b.mesh.position;
      b.prev.copy(pos);
      pos.addScaledVector(b.vel, dt);
      b.life -= dt;
      let hit = b.life <= 0;
      if (!hit) {
        for (const s of this.ships) {
          if (!s.alive || s.team === b.team) continue;
          const r = s.radius + 4;
          if (s.def.capital) {
            if (pos.distanceToSquared(s.pos) > r * r) continue;
            if (this.boxDist(s, pos, t1) < 2.5) { this.damage(s, b.dmg, b.owner, pos); hit = true; break; }
          } else {
            t1.copy(pos).sub(b.prev);
            const len2 = t1.lengthSq();
            const k = THREE.MathUtils.clamp(t2.copy(s.pos).sub(b.prev).dot(t1) / len2, 0, 1);
            t2.copy(b.prev).addScaledVector(t1, k);
            const rr = s.radius * (s.isPlayer ? 0.85 : 1.15);
            if (t2.distanceToSquared(s.pos) < rr * rr) { this.damage(s, b.dmg, b.owner, t2); hit = true; break; }
          }
        }
      }
      if (!hit) {
        for (const a of this.asteroids) {
          if (pos.distanceToSquared(a.pos) < a.radius * a.radius) { this.fx.sparks(pos, COL.spark, 4, 40); hit = true; break; }
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
      m.pos.addScaledVector(t1, m.speed * dt);
      this.fx.particle(m.pos.x, m.pos.y, m.pos.z, rnd(-3, 3), rnd(-3, 3), rnd(-3, 3), 1.8, 1.2, 0.7, m.torpedo ? 5 : 3, 0.6, 0.4);
      let boom = m.life <= 0;
      if (!boom) {
        for (const s of this.ships) {
          if (!s.alive || s.team === m.team) continue;
          if (s.def.capital) {
            if (m.pos.distanceToSquared(s.pos) > (s.radius + 10) ** 2) continue;
            if (this.boxDist(s, m.pos, t2) < 5) { this.damage(s, m.dmg * (m.torpedo ? 1 : 2.4), m.owner, m.pos); boom = true; break; }
          } else if (m.pos.distanceToSquared(s.pos) < (s.radius + 7) ** 2) {
            this.damage(s, m.dmg, m.owner, m.pos); boom = true; break;
          }
        }
      }
      if (!boom) for (const a of this.asteroids) if (m.pos.distanceToSquared(a.pos) < a.radius * a.radius) { boom = true; break; }
      if (boom) {
        this.fx.explode(m.pos, m.torpedo ? 1.6 : 0.8);
        this.audio.explosion(Math.max(0, 0.6 - this.ear(m.pos) / 2500));
        this.scene.remove(m.mesh);
        this.missiles.splice(i, 1);
      }
    }
  }
}
