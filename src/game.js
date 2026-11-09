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

export class Game {
  constructor(canvas, hudCanvas, input, audio, ui) {
    this.input = input; this.audio = audio; this.ui = ui;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.camera = new THREE.PerspectiveCamera(62, 1, 2, 90000);
    this.hudCanvas = hudCanvas;
    this.hud = hudCanvas.getContext('2d');
    this.quality = 'high';
    this.mode = 'idle';
    this.paused = false;
    this.ships = []; this.bolts = []; this.missiles = []; this.asteroids = []; this.dying = [];
    this.boltPool = [];
    this.boltGeo = new THREE.BoxGeometry(0.55, 0.55, 18);
    this.boltMats = {};
    for (const k of ['ally', 'foe', 'turret', 'turretFoe']) this.boltMats[k] = new THREE.MeshBasicMaterial({ color: COL[k] });
    this.camQ = new THREE.Quaternion();
    this.invQ = new THREE.Quaternion();
    this.aimPoint = new THREE.Vector3(); this.leadPoint = new THREE.Vector3();
    this.shake = 0; this.hurt = 0; this.energy = 1;
    this.safeL = 0; this.safeR = 0;
    this.last = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    requestAnimationFrame((t) => this.loop(t));
  }

  // ---------- setup ----------
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 2 : 1.25);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.hudCanvas.width = w * pr; this.hudCanvas.height = h * pr;
    this.hud.setTransform(pr, 0, 0, pr, 0, 0);
    this.w = w; this.h = h;
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
    }
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
    this.scene = new THREE.Scene();
    this.env = createEnvironment(this.scene, this.renderer, sky);
    this.fx = new Fx(this.scene);
    this.ships = []; this.bolts = []; this.missiles = []; this.asteroids = []; this.dying = []; this.boltPool = [];
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(this.w / 2, this.h / 2), 0.7, 0.55, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.resize();
  }

  startAttract() {
    this.loadScene({ a: '#2456ff', b: '#b03cff', seed: 2.2, planet: ['#27475f', '#d1a877'], planetDir: [-0.75, -0.15, 0.4] });
    this.mode = 'attract';
    this.player = null; this.target = null; this.mission = null;
    const c = this.spawn('aurora', new THREE.Vector3(0, 0, 0), FWD);
    c.speed = 0;
    this.spawn('sperber', new THREE.Vector3(70, 22, 120), FWD).speed = 0;
    this.spawn('falke', new THREE.Vector3(92, 16, 96), FWD).speed = 0;
    this.spawn('greif', new THREE.Vector3(112, 10, 70), FWD).speed = 0;
    this.attractT = 0;
    this.hud.clearRect(0, 0, this.w, this.h);
  }

  startMission(def) {
    this.loadScene(def.sky);
    this.mode = 'flight';
    this.paused = false; this.frozen = false; this.ended = false;
    this.def = def;
    this.stats = { kills: 0, shots: 0, hits: 0, time: 0, score: 0 };
    this.carrier = this.spawn('aurora', new THREE.Vector3(0, 0, 0), FWD);
    this.player = this.spawn(def.ship, new THREE.Vector3(70, -4, 300), FWD);
    this.player.isPlayer = true;
    this.player.speed = 160;
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
    this.mission = { navIdx: 0, phase: 'travel', wave: 0, waveT: null, pending: false };
    this.target = null;
    this.energy = 1; this.shake = 0; this.hurt = 0; this.deadT = 0;
    this.missileWarn = false; this.banner = null; this.bannerT = 0;
    this.camQ.copy(this.player.quat);
    this.input.reset();
    this.audio.startEngine();
    this.setBanner(def.title.toUpperCase());
    this.ui.comm('flug', 'Startfreigabe erteilt. Guten Flug, {cs}!');
  }

  stop() { this.mode = 'idle'; this.audio.stopEngine(); }

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
    const d = this.player ? s.pos.distanceTo(this.player.pos) : 9999;
    if (s === this.player) { this.audio.laser(0.2); this.stats.shots += s.def.guns.length; }
    else if (d < 900) this.audio.laser(0.12 * (1 - d / 900), s.team === 1);
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
    const d = this.player ? s.pos.distanceTo(this.player.pos) : 9999;
    if (d < 1200) this.audio.missile();
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
    if (s === this.player) {
      this.shake = Math.min(1.2, this.shake + dmg * 0.035);
      this.hurt = Math.min(0.7, this.hurt + dmg * 0.02);
      this.audio.hit(hadShield);
      if (navigator.vibrate && dmg > 5) navigator.vibrate(30);
    } else if (by === this.player) {
      this.stats.hits++;
    }
    if (s.def.ace && !this.def.navs[this.mission.navIdx]?.final && s.hp < s.maxHp * 0.4) return this.jumpOut(s);
    if (s.hp <= 0) {
      if (s.wingman) {
        this.ui.comm(s.who, 'Ich bin getroffen! Muss abdrehen – du bist auf dich allein gestellt, {cs}!');
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
    if (this.target === s) this.target = null;
  }

  kill(s, by) {
    s.alive = false;
    if (this.target === s) this.target = null;
    const d = this.player ? s.pos.distanceTo(this.player.pos) : 0;
    const vol = Math.max(0.08, 1 - d / 2500);
    if (s.def.capital) {
      s.dieT = 2.6; s.boomT = 0;
      this.dying.push(s);
      this.audio.explosion(vol, true);
    } else {
      this.fx.explode(s.pos, 1.3);
      this.scene.remove(s.mesh);
      this.audio.explosion(vol * 0.7);
    }
    if (s === this.player) { this.deadT = 3; this.shake = 2; return; }
    if (s.team === 1) {
      if (by === this.player) {
        this.stats.kills++; this.stats.score += s.def.score || 100;
        this.setBanner(`${s.name.toUpperCase()} ZERSTÖRT`);
        if (this.wingman?.alive && Math.random() < 0.3) this.ui.comm(this.wingman.who, ['Guter Schuss, {cs}!', 'Abschuss bestätigt!', 'Den hast du sauber erwischt!'][Math.random() * 3 | 0]);
      } else if (by?.wingman && Math.random() < 0.5) {
        this.ui.comm(by.who, ['Einer weniger!', 'Ziel zerstört!', 'Erwischt!'][Math.random() * 3 | 0]);
      }
    }
  }

  setBanner(t) { this.banner = t; this.bannerT = 2.5; }

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
      if (o === this.player) d *= 0.75;
      if (s.wingman && o === this.target) d *= 0.6;
      d *= rnd(0.8, 1.2);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  steer(s, dir, dt, rate) {
    t3.set(0, 1, 0).applyQuaternion(s.quat);
    m1.lookAt(dir, ZERO, t3);
    q1.setFromRotationMatrix(m1);
    // bank proportional to lateral turn
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
    if (!tgt) {
      if (s.wingman && this.player.alive) {
        const p = this.player;
        dir.set(-28, 2, -22).applyQuaternion(p.quat).add(p.pos).sub(s.pos);
        const d = dir.length();
        if (d < 30) { this.fwd(p, dir); want = p.speed; }
        else { dir.divideScalar(d); t3.copy(FWD).applyQuaternion(p.quat); dir.lerp(t3, d < 120 ? 0.5 : 0).normalize(); want = Math.min(def.boost, p.speed + d * 1.2); }
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
        // missiles
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
    // obstacle avoidance
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
      // inside: push out through nearest face
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
  updatePlayer(dt) {
    const p = this.player, inp = this.input, def = p.def;
    const rate = def.turn * (this.input.boosting ? 0.7 : 1);
    q1.setFromAxisAngle(AX, -inp.y * rate * dt);
    q2.setFromAxisAngle(AY, -inp.x * rate * dt);
    p.quat.multiply(q1).multiply(q2).normalize();
    p.bank += (inp.x * 0.75 - p.bank) * Math.min(1, dt * 5);
    p.mesh.userData.body.rotation.z = p.bank;
    p.mesh.userData.body.rotation.x = -inp.y * 0.12;

    let boosting = inp.boosting && this.energy > 0.02;
    if (boosting) this.energy = Math.max(0, this.energy - dt * 0.22);
    else this.energy = Math.min(1, this.energy + dt * 0.1);
    this.boosting = boosting;
    const want = boosting ? def.boost : def.speed * (0.15 + inp.throttle * 0.85);
    p.speed += (want - p.speed) * Math.min(1, dt * (boosting ? 1.8 : 1.2));

    // aiming
    this.fwd(p, t1);
    this.aimPoint.copy(p.pos).addScaledVector(t1, 900);
    this.aimLocked = false;
    const tg = this.target;
    if (tg && tg.alive) {
      const dist = tg.pos.distanceTo(p.pos);
      this.fwd(tg, t2);
      this.leadPoint.copy(tg.pos).addScaledVector(t2, tg.speed * dist / BOLT_SPEED);
      t3.copy(this.leadPoint).sub(p.pos).normalize();
      if (!tg.def.capital && dist < 1100 && t3.dot(t1) > 0.9975) this.aimLocked = true;
    }
    if (inp.firing) this.fire(p, this.aimLocked ? t3.clone() : t1);

    for (const e of inp.take()) {
      if (e === 'missile') this.playerMissile();
      else if (e === 'target') this.cycleTarget();
      else if (e === 'auto') this.autopilot();
      else if (e === 'pause') this.ui.pause();
    }

    // collisions with rocks and big ships
    for (const a of this.asteroids) {
      t2.copy(p.pos).sub(a.pos);
      const d = t2.length();
      if (d < a.radius + 5) this.bump(t2.divideScalar(d), a.radius + 5 - d);
    }
    for (const c of this.ships) {
      if (!c.def.capital || !c.alive) continue;
      if (p.pos.distanceToSquared(c.pos) > (c.radius + 40) ** 2) continue;
      const d = this.boxDist(c, p.pos, t2);
      if (d < 6) this.bump(t2, 6 - d);
    }
  }

  bump(normal, depth) {
    const p = this.player;
    p.pos.addScaledVector(normal, depth + 1);
    this.fwd(p, t3);
    if (t3.dot(normal) < 0) {
      // deflect heading along surface
      t3.addScaledVector(normal, -t3.dot(normal) * 1.4).normalize();
      m1.lookAt(t3, ZERO, t4.set(0, 1, 0).applyQuaternion(p.quat));
      p.quat.setFromRotationMatrix(m1);
    }
    if (!this.bumpT || this.bumpT <= 0) {
      this.bumpT = 0.5;
      this.damage(p, 12 + p.speed * 0.08, null, p.pos);
      p.speed *= 0.5;
    }
  }

  playerMissile() {
    const p = this.player;
    if (p.missiles <= 0 || !p.alive) { this.audio.beep(220); return; }
    p.missiles--;
    this.launchMissile(p, this.target && this.target.alive ? this.target : null);
  }

  cycleTarget() {
    const p = this.player;
    const list = this.ships.filter((o) => o.alive && o.team === 1 && o.pos.distanceTo(p.pos) < 8000);
    if (!list.length) { this.target = null; return; }
    this.fwd(p, t1);
    list.sort((a, b) => this.targetScore(a) - this.targetScore(b));
    const i = list.indexOf(this.target);
    this.target = list[(i + 1) % list.length];
    this.audio.lock();
  }
  targetScore(o) {
    t2.copy(o.pos).sub(this.player.pos);
    const d = t2.length();
    return d * (1.6 - t2.divideScalar(d).dot(t1));
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
    const m = this.mission, p = this.player;
    if (!m || !p.alive || m.phase === 'fight' || this.frozen) return false;
    const np = this.navPos();
    if (!np || np.distanceTo(p.pos) < 2600) return false;
    return this.hostileCount() === 0;
  }

  autopilot() {
    if (!this.autoAvailable()) { this.audio.beep(220); return; }
    this.frozen = true;
    this.audio.warp();
    this.ui.fade(() => {
      const p = this.player, np = this.navPos();
      t1.copy(p.pos).sub(np).normalize();
      p.pos.copy(np).addScaledVector(t1, 2300);
      t1.negate();
      m1.lookAt(t1, ZERO, UP);
      p.quat.setFromRotationMatrix(m1);
      this.camQ.copy(p.quat);
      if (this.wingman?.alive) {
        this.wingman.pos.copy(t2.set(-30, 2, -24).applyQuaternion(p.quat).add(p.pos));
        this.wingman.quat.copy(p.quat);
      }
      this.frozen = false;
    });
  }

  spawnWave(nav, idx) {
    const p = this.player;
    const center = nav.anchor && this.protect ? this.protect.pos : nav._pos;
    const base = t1.randomDirection(); base.y *= 0.35; base.normalize();
    const origin = new THREE.Vector3().copy(center).addScaledVector(base, nav.anchor ? 2600 : 1500);
    if (origin.distanceTo(p.pos) < 1300) origin.addScaledVector(base, 1300);
    for (const [type, n] of nav.waves[idx]) {
      for (let i = 0; i < n; i++) {
        const cap = SHIPS[type].capital;
        const pos = cap ? nav._pos.clone() : origin.clone().add(new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(160));
        const dir = cap ? new THREE.Vector3(1, 0, 0.2).normalize() : new THREE.Vector3().copy(center).sub(pos).normalize();
        const s = this.spawn(type, pos, dir);
        if (cap && type === 'zerstoerer') s.name = 'Dogma';
        if (!cap) { this.fx.flash(pos, 90, new THREE.Color(3, 1, 2.5), 0.5); }
      }
    }
    if (idx > 0) { this.audio.warn(); this.setBanner('NEUE FEINDWELLE'); }
    const line = nav.onWave?.[idx];
    if (line) this.ui.comm(line.who, line.text);
  }

  updateMission(dt) {
    const m = this.mission, p = this.player, def = this.def;
    this.stats.time += dt;
    if (this.ended) return;
    if (!p.alive) {
      this.deadT -= dt;
      if (this.deadT <= 0) this.end(false, 'Dein Jäger wurde zerstört. Du konntest dich mit der Rettungskapsel retten.');
      return;
    }
    if (this.protect && !this.protect.alive) {
      if (!this.failT) { this.failT = 3; this.setBanner(`${this.protect.name.toUpperCase()} VERLOREN`); }
      this.failT -= dt;
      if (this.failT <= 0) this.end(false, `Die ${this.protect.name} wurde zerstört.`);
      return;
    }
    if (m.phase === 'return') {
      if (p.pos.distanceTo(this.carrier.pos) < 750) this.end(true);
      return;
    }
    const nav = def.navs[m.navIdx];
    if (m.phase === 'travel') {
      const np = this.navPos();
      if (p.pos.distanceTo(np) < 2500) {
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
    if (this.mode === 'idle' || !this.scene) return;
    if (this.mode === 'attract') {
      this.attractT += dt;
      const a = this.attractT * 0.06 + 0.9;
      this.camera.position.set(Math.cos(a) * 330 + 60, 70 + Math.sin(a * 0.7) * 30, Math.sin(a) * 330 + 60);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(30, 8, 40);
      this.fx.update(dt);
    } else if (!this.paused && !this.frozen) {
      this.update(dt);
    }
    this.env.update(this.camera);
    if (this.quality === 'high') this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    if (this.mode === 'flight') {
      this.camera.updateMatrixWorld();
      drawHud(this.hud, this);
    }
  }

  update(dt) {
    const p = this.player;
    this.input.update(dt);
    if (p.alive) this.updatePlayer(dt); else this.input.take();
    this.bumpT = (this.bumpT || 0) - dt;

    for (const s of this.ships) {
      if (!s.alive) continue;
      if (s !== p) this.updateAI(s, dt);
      s.cool -= dt;
      this.fwd(s, t1);
      s.pos.addScaledVector(t1, s.speed * dt);
      if (s.shieldT > 0) s.shieldT -= dt;
      else if (s.shield < s.maxShield) s.shield = Math.min(s.maxShield, s.shield + s.maxShield * 0.1 * dt);
      const boost = s === p && this.boosting;
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
        this.shake = Math.max(this.shake, 1);
        this.audio.explosion(0.9, true);
      }
    }
    for (const a of this.asteroids) a.mesh.rotateOnAxis(a.axis, a.rate * dt);

    // auto-target
    if (p.alive && (!this.target || !this.target.alive)) {
      let best = null, bd = 4500;
      for (const o of this.ships) {
        if (!o.alive || o.team !== 1) continue;
        const d = o.pos.distanceTo(p.pos) * (o.def.capital ? 1.5 : 1);
        if (d < bd) { bd = d; best = o; }
      }
      this.target = best;
    }
    this.missileWarn = this.missiles.some((m) => m.target === p && m.team === 1);
    if (this.missileWarn) { this.warnT = (this.warnT || 0) - dt; if (this.warnT <= 0) { this.warnT = 0.4; this.audio.warn(); } }

    this.updateMission(dt);
    this.fx.update(dt);
    this.bannerT -= dt;
    this.hurt = Math.max(0, this.hurt - dt * 0.8);
    this.ui.setAuto(this.autoAvailable());
    this.audio.setEngine(p.alive ? p.speed / p.def.boost : 0, this.boosting);

    // camera
    if (p.alive) {
      this.camQ.slerp(p.quat, 1 - Math.exp(-dt * 5.5));
      const back = 27 + (p.speed / p.def.boost) * 9;
      t1.set(0, 7.5, -back).applyQuaternion(this.camQ).add(p.pos);
      this.camera.position.copy(t1);
      this.camera.quaternion.copy(this.camQ).multiply(FLIP);
      const fov = 60 + (p.speed / p.def.boost) * 16;
      if (Math.abs(fov - this.camera.fov) > 0.05) { this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 4); this.camera.updateProjectionMatrix(); }
    }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.2);
      this.camera.position.x += rnd(-1, 1) * this.shake * 1.6;
      this.camera.position.y += rnd(-1, 1) * this.shake * 1.6;
    }
    this.invQ.copy(p.quat).invert();
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
            // segment vs sphere
            t1.copy(pos).sub(b.prev);
            const len2 = t1.lengthSq();
            const k = THREE.MathUtils.clamp(t2.copy(s.pos).sub(b.prev).dot(t1) / len2, 0, 1);
            t2.copy(b.prev).addScaledVector(t1, k);
            const rr = s.radius * (s === this.player ? 0.85 : 1.15);
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
        const d = this.player.pos.distanceTo(m.pos);
        this.audio.explosion(Math.max(0, 0.6 - d / 2500));
        this.scene.remove(m.mesh);
        this.missiles.splice(i, 1);
      }
    }
  }
}
