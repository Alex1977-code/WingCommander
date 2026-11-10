/**
 * In-engine cutscenes. A cutscene is a cast of ships plus a list of camera shots with timed events.
 * Camera: { rel?: castId, from, to?, look: castId | [x,y,z] | 'sun', lookOff?, lookTo?, fov? }
 * Events: { t, sub, text } subtitles · { t, title, kicker } title card · { t, a: 'speed'|'fire'|'missile'|'boom'|
 *          'jumpin'|'jumpout'|'show'|'capture'|'turn'|'shake', id, ... }
 * Lines/cast may carry if / ifNot flag conditions.
 */
import * as THREE from 'three';
import { createAsteroids } from './env.js';

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0), FWD = new THREE.Vector3(0, 0, 1), ZERO = new THREE.Vector3();
const m1 = new THREE.Matrix4(), q1 = new THREE.Quaternion();
const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

export function passes(item, flags) {
  if (item.if && !flags[item.if]) return false;
  if (item.ifNot && flags[item.ifNot]) return false;
  return true;
}

export function installCutscenes(Game) {
  Object.assign(Game.prototype, {
    startCutscene(def, flags, onDone) {
      this.loadScene(def.sky);
      this.mode = 'cut';
      this.paused = false;
      this.flags = flags || {};
      this.mission = null;
      if (def.rocks) {
        // keep rocks away from the cast and from fixed camera positions
        const keep = def.cast.map((c) => new THREE.Vector3(...c.pos));
        for (const sh of def.shots) if (!sh.cam.rel) { keep.push(new THREE.Vector3(...sh.cam.from)); if (sh.cam.to) keep.push(new THREE.Vector3(...sh.cam.to)); }
        for (const a of createAsteroids(this.scene, new THREE.Vector3(...def.rocks.at), def.rocks.n, def.rocks.spread)) {
          if (keep.some((k) => k.distanceTo(a.pos) < a.radius + 160)) this.scene.remove(a.mesh);
          else this.asteroids.push(a);
        }
      }
      const cast = {};
      for (const c of def.cast) {
        if (!passes(c, this.flags)) continue;
        const dir = new THREE.Vector3(...(c.dir || [0, 0, 1])).normalize();
        const s = this.spawn(c.type, new THREE.Vector3(...c.pos), dir);
        s.speed = c.speed ?? 0;
        s.cut = { speedTo: null, fire: null, turn: null, jumpT: 0 };
        if (c.name) s.name = c.name;
        if (c.hidden) { s.mesh.visible = false; s.alive = false; s.cutHidden = true; }
        cast[c.id] = s;
      }
      this.cut = { def, cast, shot: -1, t: 0, T: 0, onDone, shake: 0, sh: null, queue: [] };
      this.camera.fov = 50; this.camera.updateProjectionMatrix();
      this.nextShot();
    },

    nextShot() {
      const c = this.cut;
      c.shot++;
      if (c.shot >= c.def.shots.length) return this.endCutscene();
      c.sh = c.def.shots[c.shot];
      c.t = 0;
      c.queue = (c.sh.ev || []).filter((e) => passes(e, this.flags)).slice().sort((a, b) => a.t - b.t);
      const fov = c.sh.cam.fov || 50;
      if (fov !== this.camera.fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
      this.ui.cutShot?.(c.shot);
    },

    endCutscene() {
      if (!this.cut) return;
      const cb = this.cut.onDone;
      this.cut = null;
      this.camera.fov = 62; this.camera.updateProjectionMatrix();
      this.mode = 'idle';
      this.audio.stopEngine?.();
      this.ui.cutEnd?.();
      cb?.();
    },

    skipCutscene() { this.endCutscene(); },

    cutPoint(spec, off, out) {
      const c = this.cut;
      if (spec === 'sun') return out.copy(this.env.sunDir).multiplyScalar(20000).add(this.camera.position);
      if (typeof spec === 'string') {
        const s = c.cast[spec];
        if (!s) return out.set(0, 0, 0);
        out.copy(s.pos);
        if (off) out.add(v4.set(off[0], off[1], off[2]).applyQuaternion(s.quat));
        return out;
      }
      return out.set(spec[0], spec[1], spec[2]);
    },

    cutEvent(e) {
      const c = this.cut, s = e.id ? c.cast[e.id] : null;
      if (e.sub) return this.ui.cutSub?.(e.sub, e.text);
      if (e.title) return this.ui.cutTitle?.(e.kicker || '', e.title);
      if (e.id && !s) return;
      switch (e.a) {
        case 'speed': s.cut.speedTo = e.v; break;
        case 'fire': s.cut.fire = { at: c.cast[e.at], until: c.T + (e.dur || 2), cool: 0 }; break;
        case 'missile': this.launchMissile(s, c.cast[e.at]); break;
        case 'turn': s.cut.turn = { dir: new THREE.Vector3(...e.dir).normalize(), rate: e.rate || 0.6 }; break;
        case 'shake': c.shake = Math.max(c.shake, e.v || 1); break;
        case 'show': s.mesh.visible = true; s.alive = true; s.cutHidden = false; break;
        case 'boom':
          if (!s.alive) break;
          if (s.def.capital) this.kill(s, null);
          else { s.alive = false; this.fx.explode(s.pos, 1.6); this.scene.remove(s.mesh); this.audio.explosion(0.7); c.shake = Math.max(c.shake, 0.5); }
          break;
        case 'jumpin': {
          if (e.rel && c.cast[e.rel]) {
            const r = c.cast[e.rel];
            s.pos.copy(v1.set(...e.off).applyQuaternion(r.quat).add(r.pos));
            const face = e.face ? c.cast[e.face].pos : v2.copy(FWD).applyQuaternion(r.quat).add(s.pos);
            m1.lookAt(v3.copy(face).sub(s.pos).normalize(), ZERO, UP);
            s.quat.setFromRotationMatrix(m1);
          }
          s.mesh.visible = true; s.alive = true; s.cutHidden = false;
          // streak in from behind
          v1.copy(FWD).applyQuaternion(s.quat);
          s.cut.jumpEnd = s.pos.clone();
          s.pos.addScaledVector(v1, -900);
          s.cut.jumpT = 0.3;
          this.fx.flash(s.cut.jumpEnd, s.def.capital ? 420 : 90, new THREE.Color(3, 1.2, 3), 0.6);
          this.fx.ring(s.cut.jumpEnd, s.def.capital ? 200 : 40, new THREE.Color(2, 1, 3), 0.6);
          this.audio.warp();
          break;
        }
        case 'jumpout':
          this.fx.flash(s.pos, s.def.capital ? 380 : 120, new THREE.Color(2, 3, 5), 0.7);
          this.fx.ring(s.pos, s.def.capital ? 260 : 50, new THREE.Color(1, 2, 4), 0.7);
          s.alive = false; this.scene.remove(s.mesh);
          this.audio.warp();
          break;
        case 'capture':
          // tractor flash: ship is pulled away
          this.fx.flash(s.pos, 55, new THREE.Color(4, 0.5, 1.6), 0.9);
          this.fx.ring(s.pos, 30, new THREE.Color(3, 0.4, 1.2), 0.8);
          s.alive = false; this.scene.remove(s.mesh);
          this.audio.warn();
          break;
        default: break;
      }
    },

    updateCut(dt) {
      const c = this.cut;
      if (!c) return;
      c.t += dt; c.T += dt;
      while (c.queue.length && c.queue[0].t <= c.t) this.cutEvent(c.queue.shift());
      for (const s of Object.values(c.cast)) {
        if (!s.alive) {
          // hidden cast members keep drifting with their speed so they appear where expected
          if (s.cutHidden) s.pos.addScaledVector(v1.copy(FWD).applyQuaternion(s.quat), s.speed * dt);
          continue;
        }
        const k = s.cut;
        if (k.speedTo != null) s.speed += (k.speedTo - s.speed) * Math.min(1, dt * 1.6);
        if (k.turn) { m1.lookAt(k.turn.dir, ZERO, UP); q1.setFromRotationMatrix(m1); s.quat.rotateTowards(q1, k.turn.rate * dt); }
        if (k.jumpT > 0) {
          const step = Math.min(k.jumpT, dt);
          k.jumpT -= step;
          s.pos.lerp(k.jumpEnd, k.jumpT <= 0 ? 1 : step / (k.jumpT + step));
        } else {
          s.pos.addScaledVector(v1.copy(FWD).applyQuaternion(s.quat), s.speed * dt);
        }
        if (k.fire && c.T < k.fire.until && k.fire.at?.alive) {
          k.fire.cool -= dt;
          if (k.fire.cool <= 0) {
            const tg = k.fire.at;
            if (s.def.capital) {
              k.fire.cool = 0.12;
              const tur = s.def.turrets[(Math.random() * s.def.turrets.length) | 0];
              v2.set(tur[0], tur[1], tur[2]).applyQuaternion(s.quat).add(s.pos);
              v3.copy(tg.pos).add(v4.randomDirection().multiplyScalar(tg.radius * 0.6)).sub(v2).normalize();
              this.spawnBolt(v2, v3, s, 0, s.team === 0 ? 'turret' : 'turretFoe');
            } else {
              k.fire.cool = s.def.rof;
              v3.copy(tg.pos).sub(s.pos).normalize().add(v4.randomDirection().multiplyScalar(0.02)).normalize();
              for (const g of s.def.guns) {
                v2.set(g[0], g[1], g[2]).applyQuaternion(s.quat).add(s.pos);
                this.spawnBolt(v2, v3, s, 0, s.team === 0 ? 'ally' : 'foe');
              }
              this.audio.laser(0.08, s.team === 1);
            }
          }
        }
        const kk = (0.55 + Math.min(1.4, s.speed / Math.max(1, s.def.speed)) * 0.6) * (0.92 + Math.random() * 0.16);
        for (const e of s.mesh.userData.engines) e.scale.setScalar(e.userData.base * kk);
      }
      this.updateBolts(dt);
      this.updateMissiles(dt);
      this.updateDying(dt);
      for (const a of this.asteroids) a.mesh.rotateOnAxis(a.axis, a.rate * dt);
      this.fx.update(dt);

      // camera
      const cam = c.sh.cam;
      const k = ease(Math.min(1, c.t / c.sh.dur));
      const rel = cam.rel ? c.cast[cam.rel] : null;
      const P = (arr, out) => {
        out.set(arr[0], arr[1], arr[2]);
        if (rel) out.applyQuaternion(rel.quat).add(rel.pos);
        return out;
      };
      P(cam.from, v1);
      if (cam.to) v1.lerp(P(cam.to, v2), k);
      this.camera.position.copy(v1);
      this.cutPoint(cam.look, cam.lookOff, v3);
      if (cam.lookTo) v3.lerp(this.cutPoint(cam.lookTo, null, v2), k);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(v3);
      if (c.shake > 0) {
        c.shake = Math.max(0, c.shake - dt * 1.5);
        this.camera.position.x += (Math.random() - 0.5) * c.shake * 6;
        this.camera.position.y += (Math.random() - 0.5) * c.shake * 6;
      }
      if (c.t >= c.sh.dur) this.nextShot();
    },
  });
}
