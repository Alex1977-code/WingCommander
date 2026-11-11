import * as THREE from 'three';

const v = new THREE.Vector3();
const GL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&@$<>/\\|=+*';
const out = { x: 0, y: 0, behind: false };
const FONT = "'Rajdhani', 'Segoe UI', system-ui, sans-serif";
const DISPLAY = "'Orbitron Variable', 'Orbitron', 'Rajdhani', system-ui, sans-serif";

function project(P, p) {
  v.copy(p).applyMatrix4(P.camera.matrixWorldInverse);
  out.behind = v.z > -1;
  v.applyMatrix4(P.camera.projectionMatrix);
  out.x = (v.x * 0.5 + 0.5) * P.vw;
  out.y = (-v.y * 0.5 + 0.5) * P.vh;
  return out;
}

const C = { ui: '#7fd6ff', ok: '#6dffb0', foe: '#ff4d6d', warn: '#ffc857', dim: 'rgba(127,214,255,.35)' };

/** Text that "decodes" from random glyphs, driven by elapsed time since t0. */
function decoded(text, t0, cps = 55, win = 5) {
  const n = Math.floor(((performance.now() - t0) / 1000) * cps);
  if (n >= text.length) return text;
  let s = text.slice(0, n);
  const seed = Math.floor(performance.now() / 50);
  for (let i = n; i < Math.min(text.length, n + win); i++) s += text[i] === ' ' ? ' ' : GL[(seed * 7 + i * 13) % GL.length];
  return s;
}

function bar(ctx, x, y, w, h, k, color, label, s) {
  ctx.fillStyle = 'rgba(8,16,28,.55)';
  ctx.fillRect(x, y, w, h);
  // segmented fill
  const segs = 20, sw = (w - 2) / segs;
  const filled = Math.max(0, Math.min(1, k)) * segs;
  ctx.fillStyle = color;
  for (let i = 0; i < Math.ceil(filled); i++) {
    const part = Math.min(1, filled - i);
    ctx.globalAlpha = part < 1 ? 0.5 : 1;
    ctx.fillRect(x + 1 + i * sw, y + 1, sw - 1, h - 2);
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = C.dim; ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.fillStyle = '#eaf7ff';
  ctx.font = `700 ${9.5 * s}px ${FONT}`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 3;
  ctx.fillText(label, x + 4 * s, y + h / 2 + 0.5);
  ctx.shadowBlur = 0;
}

function brackets(ctx, x, y, r, color, lw, spin = 0) {
  const k = r * 0.45;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(spin);
  ctx.strokeStyle = color; ctx.lineWidth = lw;
  ctx.shadowColor = color; ctx.shadowBlur = 6;
  ctx.beginPath();
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    ctx.moveTo(sx * r, sy * (r - k)); ctx.lineTo(sx * r, sy * r); ctx.lineTo(sx * (r - k), sy * r);
  }
  ctx.stroke();
  ctx.restore();
}

function glowText(ctx, text, x, y, color, blur) {
  ctx.shadowColor = color; ctx.shadowBlur = blur;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
}

export function drawHud(ctx, g, P) {
  const w = P.vw, h = P.vh;
  const s = Math.max(0.85, Math.min(w, h * 1.6) / 540);
  const p = P.ship;
  const t = performance.now() / 1000;
  const solo = g.pilots.length === 1;
  const safeL = P.vx === 0 ? g.safeL : 0, safeR = P.vx + P.vw >= g.w - 1 ? g.safeR : 0;
  ctx.save();
  ctx.translate(P.vx, P.vy);
  ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();

  if (!p.alive) {
    ctx.fillStyle = 'rgba(40,0,10,.35)'; ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `800 ${16 * s}px ${DISPLAY}`;
    glowText(ctx, Math.sin(t * 6) > -0.6 ? 'ABGESCHOSSEN' : '', w / 2, h / 2 - 10 * s, C.foe, 14);
    if (g.coop && g.alivePilots().length) {
      ctx.font = `600 ${11 * s}px ${FONT}`;
      ctx.fillStyle = '#eaf6ff';
      ctx.fillText(`Ersatzmaschine startet in ${Math.max(0, Math.ceil(P.deadT))} s`, w / 2, h / 2 + 14 * s);
    }
    ctx.restore();
    return;
  }

  // --- sun lens flare (drawn under the HUD) ---
  if (g.env?.sunDir) {
    v.copy(g.env.sunDir).multiplyScalar(20000).add(P.camera.position);
    const q = project(P, v);
    if (!q.behind) {
      const cx = w / 2, cy = h / 2, dx = cx - q.x, dy = cy - q.y;
      const off = Math.max(0, Math.max(Math.abs(q.x - cx) / (w * 0.75), Math.abs(q.y - cy) / (h * 0.75)) - 0.6);
      const k = Math.max(0, 1 - off * 2.5);
      if (k > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const ghosts = [[0, 60, 'rgba(255,240,210,%)', 0.22], [0.35, 10, 'rgba(120,200,255,%)', 0.16], [0.6, 22, 'rgba(255,160,90,%)', 0.1], [0.85, 6, 'rgba(170,255,200,%)', 0.18], [1.25, 34, 'rgba(90,140,255,%)', 0.08], [1.6, 14, 'rgba(255,120,200,%)', 0.1]];
        for (const [tpos, r, c, a] of ghosts) {
          const gx = q.x + dx * tpos, gy = q.y + dy * tpos, rr = r * s;
          const gr = ctx.createRadialGradient(gx, gy, 0, gx, gy, rr);
          gr.addColorStop(0, c.replace('%', (a * k).toFixed(3)));
          gr.addColorStop(tpos === 0 ? 1 : 0.7, c.replace('%', (a * k * 0.5).toFixed(3)));
          gr.addColorStop(1, c.replace('%', '0'));
          ctx.fillStyle = gr;
          ctx.beginPath(); ctx.arc(gx, gy, rr, 0, 6.283); ctx.fill();
        }
        // anamorphic streak
        const sg = ctx.createLinearGradient(q.x - w * 0.4, 0, q.x + w * 0.4, 0);
        sg.addColorStop(0, 'rgba(150,200,255,0)'); sg.addColorStop(0.5, `rgba(200,230,255,${0.18 * k})`); sg.addColorStop(1, 'rgba(150,200,255,0)');
        ctx.fillStyle = sg; ctx.fillRect(q.x - w * 0.4, q.y - 1.2 * s, w * 0.8, 2.4 * s);
        ctx.restore();
      }
    }
  }

  // --- world markers ---
  for (const o of g.ships) {
    if (!o.alive || o === p || o === P.target) continue;
    const q = project(P, o.pos);
    if (q.behind) continue;
    const foe = o.team === 1;
    const col = o.isPlayer ? o.pilot.color : o.team === 3 ? '#9fe8ff' : foe ? C.foe : C.ok;
    ctx.strokeStyle = col; ctx.lineWidth = 1.2 * s;
    const r = 7 * s;
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    if (foe) { ctx.moveTo(q.x, q.y - r); ctx.lineTo(q.x + r, q.y); ctx.lineTo(q.x, q.y + r); ctx.lineTo(q.x - r, q.y); ctx.closePath(); }
    else ctx.arc(q.x, q.y, r, 0, 6.283);
    ctx.stroke();
    if (o.isPlayer) {
      ctx.fillStyle = col; ctx.font = `700 ${9 * s}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(`${o.pilot.label} · ${o.name}`, q.x, q.y - r - 2 * s);
    }
    ctx.globalAlpha = 1;
  }

  // nav marker
  const nav = g.navPos();
  if (nav) {
    const q = project(P, nav);
    const d = p.pos.distanceTo(nav);
    if (!q.behind && q.x > 0 && q.x < w && q.y > 0 && q.y < h) {
      ctx.strokeStyle = C.warn; ctx.lineWidth = 1.5 * s;
      const r = (10 + Math.sin(t * 4) * 1.5) * s;
      ctx.shadowColor = C.warn; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.moveTo(q.x, q.y - r); ctx.lineTo(q.x + r, q.y); ctx.lineTo(q.x, q.y + r); ctx.lineTo(q.x - r, q.y); ctx.closePath(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = C.warn; ctx.font = `700 ${10 * s}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(`${g.navName().toUpperCase()} · ${(d / 1000).toFixed(1)} KM`, q.x, q.y + r + 3 * s);
    } else if (!P.target) {
      arrow(ctx, P, nav, C.warn, s);
    }
  }

  // mines within sensor range
  let nearestMine = null, nmd = 400;
  for (const mn of g.mines || []) { if (mn.alive) { const d = p.pos.distanceTo(mn.pos); if (d < nmd) { nmd = d; nearestMine = mn; } } }
  for (const mn of g.mines || []) {
    if (!mn.alive) continue;
    const d = p.pos.distanceTo(mn.pos);
    if (d > 1100) continue;
    const q = project(P, mn.pos);
    if (q.behind || q.x < 0 || q.x > w || q.y < 0 || q.y > h) continue;
    const r = 5 * s;
    ctx.strokeStyle = '#ff7a3a'; ctx.lineWidth = 1.4 * s; ctx.globalAlpha = Math.max(0.35, 1 - d / 1100);
    ctx.beginPath(); ctx.moveTo(q.x - r, q.y - r); ctx.lineTo(q.x + r, q.y + r); ctx.moveTo(q.x + r, q.y - r); ctx.lineTo(q.x - r, q.y + r); ctx.stroke();
    if (mn === nearestMine) { ctx.fillStyle = '#ff7a3a'; ctx.font = `700 ${8 * s}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText('MINE', q.x, q.y + r + 2 * s); }
    ctx.globalAlpha = 1;
  }

  // objective markers (pickups, scan zone, intercept target, docking)
  for (const mk of g.markers()) {
    const q = project(P, mk.pos);
    const d = p.pos.distanceTo(mk.pos);
    if (!q.behind && q.x > 0 && q.x < w && q.y > 0 && q.y < h) {
      const r = (9 + Math.sin(t * 5) * 2) * s;
      ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(t * 1.5);
      ctx.strokeStyle = mk.color; ctx.lineWidth = 1.8 * s; ctx.shadowColor = mk.color; ctx.shadowBlur = 10;
      ctx.strokeRect(-r, -r, 2 * r, 2 * r);
      ctx.restore();
      ctx.fillStyle = mk.color; ctx.font = `700 ${9.5 * s}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(`${mk.label} · ${d < 1000 ? Math.round(d) + ' M' : (d / 1000).toFixed(1) + ' KM'}`, q.x, q.y + r + 5 * s);
    } else if (mk.main) arrow(ctx, P, mk.pos, mk.color, s);
  }

  // target
  const tg = P.target;
  if (tg && tg.alive) {
    const q = project(P, tg.pos);
    const on = !q.behind && q.x > 0 && q.x < w && q.y > 0 && q.y < h;
    if (on) {
      const d = p.pos.distanceTo(tg.pos);
      const r = Math.max(14 * s, Math.min(120 * s, (tg.radius * 1.2) / d * h * 1.2));
      const lockIn = Math.min(1, (performance.now() - (P.targetT || 0)) / 350);
      brackets(ctx, q.x, q.y, r * (2.2 - lockIn * 1.2), C.foe, 2 * s, (1 - lockIn) * 1.2);
      ctx.fillStyle = C.foe; ctx.font = `700 ${10 * s}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(`${Math.round(d)} M`, q.x, q.y - r - 3 * s);
      if (!tg.def.capital && d < 1400) {
        const l = project(P, P.leadPoint);
        if (!l.behind) {
          // gun solution: lead pipper with a range arc that fills as the target comes into gun range
          const col = P.aimLocked ? C.ok : C.warn;
          const inRange = Math.max(0, Math.min(1, 1 - (d - 300) / 1100));
          ctx.strokeStyle = col; ctx.lineWidth = 1.6 * s;
          ctx.shadowColor = col; ctx.shadowBlur = 6;
          ctx.beginPath(); ctx.arc(l.x, l.y, 7 * s, 0, 6.283); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(l.x - 3 * s, l.y); ctx.lineTo(l.x + 3 * s, l.y); ctx.moveTo(l.x, l.y - 3 * s); ctx.lineTo(l.x, l.y + 3 * s); ctx.stroke();
          ctx.lineWidth = 2.4 * s;
          ctx.beginPath(); ctx.arc(l.x, l.y, 12 * s, -Math.PI / 2, -Math.PI / 2 + inRange * 6.283); ctx.stroke();
          if (P.aimLocked) {
            const k = 1 + Math.sin(t * 14) * 0.15;
            ctx.beginPath();
            for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; ctx.moveTo(l.x + Math.cos(a) * 20 * s * k, l.y + Math.sin(a) * 20 * s * k); ctx.lineTo(l.x + Math.cos(a) * 14 * s, l.y + Math.sin(a) * 14 * s); }
            ctx.stroke();
            ctx.font = `800 ${8 * s}px ${DISPLAY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = col;
            ctx.fillText('KANONE ◆ TREFFERLÖSUNG', l.x, l.y + 22 * s);
          }
          ctx.shadowBlur = 0;
        }
      }
      // missile seeker: a circle that travels from the reticle onto the target while locking
      if (P.mslLock > 0 && p.missiles > 0) {
        // project() returns a shared object: copy the coordinates before the next call
        const tq = project(P, tg.pos), qx = tq.x, qy = tq.y;
        const a = project(P, P.aimPoint), ax = a.x, ay = a.y;
        const k = Math.pow(P.mslLock, 0.7), sx = ax + (qx - ax) * k, sy = ay + (qy - ay) * k;
        const locked = P.mslLock >= 1;
        const col = locked ? (Math.sin(t * 18) > -0.3 ? C.foe : '#ffffff') : C.warn;
        ctx.strokeStyle = col; ctx.lineWidth = 2 * s; ctx.shadowColor = col; ctx.shadowBlur = 8;
        const rr = (locked ? r + 10 * s : 26 * s - k * 8 * s);
        if (locked) {
          // rotating diamond around the locked target
          ctx.save(); ctx.translate(qx, qy); ctx.rotate(t * 2);
          ctx.beginPath(); ctx.moveTo(0, -rr); ctx.lineTo(rr, 0); ctx.lineTo(0, rr); ctx.lineTo(-rr, 0); ctx.closePath(); ctx.stroke();
          ctx.restore();
        } else {
          ctx.setLineDash([5 * s, 4 * s]);
          ctx.beginPath(); ctx.arc(sx, sy, rr, 0, 6.283); ctx.stroke();
          ctx.setLineDash([]);
          ctx.beginPath(); ctx.arc(sx, sy, rr + 4 * s, -Math.PI / 2, -Math.PI / 2 + P.mslLock * 6.283); ctx.stroke();
        }
        ctx.shadowBlur = 0;
        ctx.font = `800 ${9 * s}px ${DISPLAY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = col;
        ctx.fillText(locked ? 'RAKETE ◆ AUFGESCHALTET' : `SUCHKOPF ${Math.round(P.mslLock * 100)}%`, locked ? qx : sx, (locked ? qy : sy) + rr + 6 * s);
      }
    } else arrow(ctx, P, tg.pos, C.foe, s);
  }

  // reticle
  {
    const q = project(P, P.aimPoint);
    const r = 13 * s;
    const col = P.aimLocked ? C.ok : P.color;
    ctx.strokeStyle = col; ctx.lineWidth = 1.6 * s;
    ctx.shadowColor = col; ctx.shadowBlur = 5;
    ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(P.aimLocked ? t * 3 : 0);
    ctx.beginPath();
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.35; ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); ctx.arc(0, 0, r, a, a + 0.87); }
    ctx.stroke();
    ctx.restore();
    ctx.shadowBlur = 0;
    ctx.fillStyle = col;
    ctx.fillRect(q.x - s, q.y - s, 2 * s, 2 * s);
    if (P.aimLocked) {
      ctx.font = `800 ${8 * s}px ${DISPLAY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      glowText(ctx, 'LOCK', q.x, q.y + r + 4 * s, C.ok, 8);
    }
  }

  // --- launch / landing overlay ---
  if (g.seq && p.seqHold) seqHud(ctx, g, P, w, h, s, t);

  // --- cockpit head-up display: speed tape, set-speed caret, throttle and afterburner ---
  if (P.view === 'cockpit') cockpitHud(ctx, P, w, h, s, t);

  // --- status panel (top-left) ---
  const px = 12 * s + safeL, py = (solo ? 40 : 10) * s, bw = 118 * s, bh = 13 * s;
  if (!solo) {
    ctx.font = `800 ${10 * s}px ${DISPLAY}`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    glowText(ctx, `${P.label} ${p.name.toUpperCase()}`, px, py, P.color, 8);
  }
  const by = py + (solo ? 0 : 16 * s);
  bar(ctx, px, by, bw, bh, p.shield / p.maxShield, 'rgba(70,170,255,.85)', `SCHILD ${Math.max(0, Math.round(p.shield / p.maxShield * 100))}%`, s);
  bar(ctx, px, by + bh + 4 * s, bw, bh, p.hp / p.maxHp, p.hp / p.maxHp < 0.3 ? 'rgba(255,70,90,.9)' : 'rgba(110,230,160,.8)', `HÜLLE ${Math.max(0, Math.round(p.hp / p.maxHp * 100))}%`, s);
  bar(ctx, px, by + (bh + 4 * s) * 2, bw, bh, P.energy, 'rgba(255,170,60,.85)', 'NACHBRENNER', s);
  ctx.fillStyle = '#dff4ff'; ctx.font = `700 ${12 * s}px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(`${Math.round(p.speed)} M/S`, px, by + (bh + 4 * s) * 3 + 2 * s);
  ctx.fillStyle = C.warn;
  ctx.fillText(`RAK ${p.missiles}`, px + 72 * s, by + (bh + 4 * s) * 3 + 2 * s);

  // --- target panel (top-right) ---
  if (tg && tg.alive) {
    const tw = 128 * s, tx = w - tw - 12 * s - safeR, ty = (solo || P.vy === 0 ? 58 : 26) * s;
    ctx.font = `800 ${10 * s}px ${DISPLAY}`; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    glowText(ctx, decoded(tg.name.toUpperCase(), P.targetT || 0, 40), tx + tw, ty - 3 * s, C.foe, 8);
    if (tg.maxShield > 0) bar(ctx, tx, ty, tw, bh, tg.shield / tg.maxShield, 'rgba(70,170,255,.85)', 'SCHILD', s);
    bar(ctx, tx, ty + (tg.maxShield > 0 ? bh + 4 * s : 0), tw, bh, tg.hp / tg.maxHp, 'rgba(255,90,110,.85)', 'HÜLLE', s);
  }

  // --- objective (top-center) ---
  const obj = g.objectiveText().toUpperCase();
  const objKey = obj.split(' · ')[0];
  if (objKey !== g.lastObj) { g.lastObj = objKey; g.objT = performance.now(); }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.font = `700 ${10 * s}px ${DISPLAY}`;
  const oy = 10 * s;
  const ow = ctx.measureText(obj).width;
  const grow = Math.min(1, (performance.now() - g.objT) / 500);
  ctx.strokeStyle = C.dim; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(w / 2 - ow / 2 - 10 * s, oy + 6 * s); ctx.lineTo(w / 2 - ow / 2 - (10 + 40 * grow) * s, oy + 6 * s);
  ctx.moveTo(w / 2 + ow / 2 + 10 * s, oy + 6 * s); ctx.lineTo(w / 2 + ow / 2 + (10 + 40 * grow) * s, oy + 6 * s);
  ctx.stroke();
  glowText(ctx, decoded(obj, g.objT, 45), w / 2, oy, '#eaf6ff', 6);
  if (g.hostileCount() > 0) {
    ctx.fillStyle = C.foe; ctx.font = `700 ${10 * s}px ${FONT}`;
    ctx.fillText(`FEINDE: ${g.hostileCount()}`, w / 2, oy + 14 * s);
  }
  if (g.protect && g.protect.alive) {
    const k = g.protect.hp / g.protect.maxHp;
    const bw2 = 120 * s;
    bar(ctx, w / 2 - bw2 / 2, oy + 28 * s, bw2, 10 * s, k, k < 0.35 ? 'rgba(255,70,90,.9)' : 'rgba(110,230,160,.8)', g.protect.name.toUpperCase(), s * 0.85);
  }

  // --- radar (bottom-center; in the cockpit the radar lives on the right MFD) ---
  if (P.view !== 'cockpit') {
  const R = (solo ? 50 : 40) * s, rx = solo ? w / 2 : w - R - 14 * s - safeR, ry = h - R - 10 * s - (P.vy + P.vh >= g.h - 1 ? g.safeB || 0 : 0);
  ctx.fillStyle = 'rgba(6,14,24,.6)';
  ctx.beginPath(); ctx.arc(rx, ry, R, 0, 6.283); ctx.fill();
  // sweep
  const sweep = (t * 2) % 6.283;
  const grad = ctx.createConicGradient ? ctx.createConicGradient(sweep - 0.9, rx, ry) : null;
  if (grad) {
    grad.addColorStop(0, 'rgba(127,214,255,0)'); grad.addColorStop(0.14, 'rgba(127,214,255,.22)'); grad.addColorStop(0.15, 'rgba(127,214,255,0)');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(rx, ry, R, 0, 6.283); ctx.fill();
  }
  ctx.strokeStyle = C.dim; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(rx, ry, R, 0, 6.283); ctx.moveTo(rx + R * 0.5, ry); ctx.arc(rx, ry, R * 0.5, 0, 6.283);
  ctx.moveTo(rx - R, ry); ctx.lineTo(rx + R, ry); ctx.moveTo(rx, ry - R); ctx.lineTo(rx, ry + R); ctx.stroke();
  const inv = P.invQ;
  // shape tells friend from foe even at a glance: foe = diamond, friend = triangle, capital = boxed
  const blip = (pos, color, size, shape = 'sq') => {
    v.copy(pos).sub(p.pos).applyQuaternion(inv);
    const d = v.length() || 1;
    const ang = Math.acos(Math.max(-1, Math.min(1, v.z / d))) / Math.PI;
    const l = Math.hypot(v.x, v.y) || 1;
    const bx = rx - (v.x / l) * ang * R, by2 = ry - (v.y / l) * ang * R;
    ctx.beginPath();
    if (shape === 'foe') { ctx.moveTo(bx, by2 - size); ctx.lineTo(bx + size, by2); ctx.lineTo(bx, by2 + size); ctx.lineTo(bx - size, by2); }
    else if (shape === 'friend') { ctx.moveTo(bx, by2 - size); ctx.lineTo(bx + size, by2 + size * 0.8); ctx.lineTo(bx - size, by2 + size * 0.8); }
    else ctx.rect(bx - size / 2, by2 - size / 2, size, size);
    ctx.closePath();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.stroke();
    ctx.fillStyle = color; ctx.fill();
    return [bx, by2];
  };
  for (const o of g.ships) {
    if (!o.alive || o === p) continue;
    const foe = o.team === 1;
    const col = o === tg ? '#ffffff' : o.isPlayer ? o.pilot.color : o.team === 3 ? '#9fe8ff' : (foe ? C.foe : C.ok);
    const sz = (o.def.capital ? 6 : 4.2) * s;
    const [bx, by2] = blip(o.pos, col, sz, o.team === 3 ? 'sq' : foe ? 'foe' : 'friend');
    if (o.def.capital) { ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.strokeRect(bx - sz * 1.6, by2 - sz * 1.6, sz * 3.2, sz * 3.2); }
  }
  for (const m of g.missiles) if (m.team === 1) blip(m.pos, C.warn, 2.5 * s);
  for (const mn of g.mines || []) if (mn.alive && mn.pos.distanceTo(p.pos) < 2500) blip(mn.pos, '#ff7a3a', 2 * s);
  if (nav) blip(nav, C.warn, 4 * s);
  for (const mk of g.markers()) blip(mk.pos, mk.color, 3.5 * s);

  }
  // warnings
  if (P.missileWarn && Math.sin(t * 16) > 0) {
    ctx.font = `800 ${14 * s}px ${DISPLAY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    glowText(ctx, '⚠ RAKETENWARNUNG', w / 2, P.view === 'cockpit' ? h * 0.47 + 78 * s : h * 0.28, C.foe, 14); // below the reticle in the cockpit, clear of the roll scale
  }
  if (g.banner && g.bannerT > 0) {
    const a = Math.min(1, g.bannerT);
    ctx.globalAlpha = a;
    ctx.font = `800 ${16 * s}px ${DISPLAY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const txt = decoded(g.banner, g.bannerT0, 50);
    const bwid = ctx.measureText(g.banner).width;
    const e = Math.min(1, (performance.now() - g.bannerT0) / 400);
    const yb = h * 0.4;
    ctx.strokeStyle = 'rgba(127,214,255,.7)'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(w / 2 - (bwid / 2 + 14 * s) * e, yb - 14 * s); ctx.lineTo(w / 2 + (bwid / 2 + 14 * s) * e, yb - 14 * s);
    ctx.moveTo(w / 2 - (bwid / 2 + 14 * s) * e, yb + 14 * s); ctx.lineTo(w / 2 + (bwid / 2 + 14 * s) * e, yb + 14 * s);
    ctx.stroke();
    // chromatic split
    ctx.fillStyle = 'rgba(255,40,90,.55)'; ctx.fillText(txt, w / 2 - 1.5, yb);
    ctx.fillStyle = 'rgba(40,220,255,.55)'; ctx.fillText(txt, w / 2 + 1.5, yb);
    glowText(ctx, txt, w / 2, yb, '#f2fbff', 16);
    ctx.globalAlpha = 1;
  }
  if (P.hurt > 0) {
    const gr = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
    gr.addColorStop(0, 'rgba(255,40,60,0)');
    gr.addColorStop(1, `rgba(255,40,60,${Math.min(0.6, P.hurt)})`);
    ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

function arrow(ctx, P, pos, color, s) {
  v.copy(pos).sub(P.ship.pos).applyQuaternion(P.invQ);
  const a = Math.atan2(-v.y, -v.x);
  const r = Math.min(P.vw, P.vh) * 0.3;
  const x = P.vw / 2 + Math.cos(a) * r, y = P.vh / 2 + Math.sin(a) * r;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(a);
  ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.moveTo(10 * s, 0); ctx.lineTo(-6 * s, 6 * s); ctx.lineTo(-2 * s, 0); ctx.lineTo(-6 * s, -6 * s); ctx.closePath(); ctx.fill();
  ctx.restore();
}

/** speed tape (left), throttle / afterburner scale (right) and a pitch-roll ladder, projected on the combiner */
function cockpitHud(ctx, P, w, h, s, t) {
  const p = P.ship, def = p.def;
  const col = 'rgba(125,255,176,.9)', dimc = 'rgba(125,255,176,.35)';
  const cy = h * 0.47, th = 105 * s, x0 = w / 2 - 98 * s;
  ctx.save();
  ctx.shadowColor = '#6dffb0'; ctx.shadowBlur = 6;
  ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.3 * s;
  // speed tape: 1 px per m/s scaled, ticks every 10, labels every 50
  const ppm = 1.4 * s, spd = p.speed;
  ctx.save(); ctx.beginPath(); ctx.rect(x0 - 50 * s, cy - th / 2, 60 * s, th); ctx.clip();
  ctx.font = `700 ${9 * s}px ${FONT}`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let vv = Math.floor((spd - th / 2 / ppm) / 10) * 10; vv <= spd + th / 2 / ppm; vv += 10) {
    if (vv < 0) continue;
    const y = cy - (vv - spd) * ppm, major = vv % 50 === 0;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 - (major ? 10 : 5) * s, y); ctx.stroke();
    if (major) ctx.fillText(String(vv), x0 - 13 * s, y);
  }
  // cruise speed and afterburner band
  const yb = cy - (def.boost - spd) * ppm;
  ctx.fillStyle = 'rgba(127,214,255,.35)'; ctx.fillRect(x0 + 2 * s, yb - 3 * s, 4 * s, 6 * s);
  ctx.restore();
  ctx.textBaseline = 'middle'; // the restore above dropped it; the readouts below are centred
  ctx.beginPath(); ctx.moveTo(x0, cy - th / 2); ctx.lineTo(x0, cy + th / 2); ctx.stroke();
  // set-speed caret from the throttle
  const want = P.boosting ? def.boost : def.speed * (0.15 + P.throttle * 0.85);
  const yc = Math.max(cy - th / 2, Math.min(cy + th / 2, cy - (want - spd) * ppm));
  ctx.beginPath(); ctx.moveTo(x0 + 2 * s, yc); ctx.lineTo(x0 + 9 * s, yc - 5 * s); ctx.lineTo(x0 + 9 * s, yc + 5 * s); ctx.closePath(); ctx.stroke();
  // trend arrow (where the speed will be in ~1 s)
  const tr = Math.max(-th / 2, Math.min(th / 2, (want - spd) * ppm * 0.6));
  if (Math.abs(tr) > 3 * s) { ctx.beginPath(); ctx.moveTo(x0 + 13 * s, cy); ctx.lineTo(x0 + 13 * s, cy - tr); ctx.stroke(); }
  // readout box
  const bw = 52 * s, bh = 18 * s;
  ctx.fillStyle = 'rgba(0,20,10,.55)'; ctx.fillRect(x0 - bw - 4 * s, cy - bh / 2, bw, bh);
  ctx.strokeRect(x0 - bw - 4 * s, cy - bh / 2, bw, bh);
  ctx.fillStyle = col; ctx.font = `800 ${12 * s}px ${DISPLAY}`; ctx.textAlign = 'right';
  ctx.fillText(String(Math.round(spd)), x0 - 8 * s, cy + 1);
  ctx.font = `700 ${8 * s}px ${FONT}`; ctx.textAlign = 'left';
  ctx.fillText('M/S', x0 - bw - 2 * s, cy - th / 2 - 9 * s);
  if (P.boosting && Math.sin(t * 10) > -0.3) { ctx.fillStyle = '#7fd6ff'; ctx.fillText('NACHBRENNER', x0 - bw - 2 * s, cy + th / 2 + 9 * s); }

  // throttle / energy scale on the right
  const x1 = w / 2 + 98 * s;
  ctx.strokeStyle = col; ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(x1, cy - th / 2); ctx.lineTo(x1, cy + th / 2); ctx.stroke();
  for (let i = 0; i <= 10; i++) { const y = cy + th / 2 - (i / 10) * th; ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x1 + (i % 5 ? 5 : 10) * s, y); ctx.stroke(); }
  const yt = cy + th / 2 - P.throttle * th;
  ctx.beginPath(); ctx.moveTo(x1 - 2 * s, yt); ctx.lineTo(x1 - 10 * s, yt - 5 * s); ctx.lineTo(x1 - 10 * s, yt + 5 * s); ctx.closePath(); ctx.fill();
  ctx.fillStyle = P.boostLock ? (Math.sin(t * 12) > 0 ? '#ff4d6d' : 'rgba(255,77,109,.3)') : 'rgba(127,214,255,.7)';
  ctx.fillRect(x1 + 14 * s, cy + th / 2 - P.energy * th, 4 * s, P.energy * th);
  ctx.fillStyle = col; ctx.font = `700 ${8 * s}px ${FONT}`; ctx.textAlign = 'left';
  ctx.fillText(`SCHUB ${Math.round(P.throttle * 100)}%`, x1 - 8 * s, cy - th / 2 - 9 * s);
  ctx.fillText('NB', x1 + 12 * s, cy + th / 2 + 9 * s);

  // roll scale + bank pointer around the reticle area
  ctx.strokeStyle = dimc; ctx.lineWidth = 1.2 * s;
  const rr = 64 * s, rcx = w / 2, rcy = cy;
  ctx.beginPath(); ctx.arc(rcx, rcy, rr, Math.PI * 1.25, Math.PI * 1.75); ctx.stroke();
  for (let a = -45; a <= 45; a += 15) { const r0 = (a - 90) * Math.PI / 180; ctx.beginPath(); ctx.moveTo(rcx + Math.cos(r0) * rr, rcy + Math.sin(r0) * rr); ctx.lineTo(rcx + Math.cos(r0) * (rr + (a % 45 ? 4 : 8) * s), rcy + Math.sin(r0) * (rr + (a % 45 ? 4 : 8) * s)); ctx.stroke(); }
  const ba = -Math.PI / 2 - (p.bank || 0) * 0.9;
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(rcx + Math.cos(ba) * (rr - 2 * s), rcy + Math.sin(ba) * (rr - 2 * s));
  ctx.lineTo(rcx + Math.cos(ba - 0.05) * (rr - 10 * s), rcy + Math.sin(ba - 0.05) * (rr - 10 * s));
  ctx.lineTo(rcx + Math.cos(ba + 0.05) * (rr - 10 * s), rcy + Math.sin(ba + 0.05) * (rr - 10 * s)); ctx.closePath(); ctx.fill();
  ctx.restore();
}

/** catapult signal lights + countdown, or the landing guidance (centre-line cross and range to the stop mark) */
function seqHud(ctx, g, P, w, h, s, t) {
  const q = g.seq;
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const cx = w / 2, y = h * 0.3;
  if (q.kind === 'launch') {
    const GO = 2.6, lit = q.t < 1.2 ? 0 : q.t < GO ? 1 : 2;
    const cols = ['#ff3d4e', '#ffc23d', '#4dff8a'];
    for (let i = 0; i < 3; i++) {
      const x = cx + (i - 1) * 34 * s, on = i === lit;
      ctx.beginPath(); ctx.arc(x, y, 11 * s, 0, 6.283);
      ctx.fillStyle = on ? cols[i] : 'rgba(40,40,40,.7)'; ctx.shadowColor = cols[i]; ctx.shadowBlur = on ? 24 : 0; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.font = `800 ${13 * s}px ${DISPLAY}`; ctx.fillStyle = cols[lit];
    const txt = lit === 2 ? 'KATAPULT · START!' : `KATAPULT BEREIT · ${Math.max(1, Math.ceil(GO - q.t))}`;
    glowText(ctx, txt, cx, y + 30 * s, cols[lit], 10);
  } else {
    const c = g.carrier, p = P.ship;
    const L = v.copy(p.pos).sub(c.pos).applyQuaternion(c.quat.clone().invert());
    const col = '#7fd6ff';
    ctx.font = `800 ${12 * s}px ${DISPLAY}`;
    glowText(ctx, P.landStage >= 2 ? 'AUFGESETZT' : P.landStage === 1 ? 'ENDANFLUG · BUCHT 1' : 'LANDEANFLUG · AUTOPILOT', cx, y, col, 10);
    // centre-line cross: how far the ship is off the bay axis
    const R = 44 * s, gy = h * 0.5;
    ctx.strokeStyle = 'rgba(127,214,255,.5)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - R, gy - R, R * 2, R * 2);
    const dx = Math.max(-1, Math.min(1, L.x / 30)), dy = Math.max(-1, Math.min(1, (L.y - (-24)) / 20));
    ctx.strokeStyle = '#ffc857'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(cx - dx * R, gy - R); ctx.lineTo(cx - dx * R, gy + R); ctx.moveTo(cx - R, gy - dy * R); ctx.lineTo(cx + R, gy - dy * R); ctx.stroke();
    if (P.landStage === 1) {
      const dist = Math.max(0, L.z - (P.landStop || 0));
      ctx.font = `700 ${11 * s}px ${FONT}`; ctx.fillStyle = col;
      ctx.fillText(`STOPPMARKE ${Math.round(dist)} M · ${Math.round(p.speed)} M/S`, cx, gy + R + 14 * s);
    }
  }
  ctx.restore();
}
