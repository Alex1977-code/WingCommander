import * as THREE from 'three';

const v = new THREE.Vector3();
const out = { x: 0, y: 0, behind: false };

function project(g, p) {
  v.copy(p).applyMatrix4(g.camera.matrixWorldInverse);
  out.behind = v.z > -1;
  v.applyMatrix4(g.camera.projectionMatrix);
  out.x = (v.x * 0.5 + 0.5) * g.w;
  out.y = (-v.y * 0.5 + 0.5) * g.h;
  return out;
}

const C = { ui: '#7fd6ff', ok: '#6dffb0', foe: '#ff4d6d', warn: '#ffc857', dim: 'rgba(127,214,255,.35)' };

function bar(ctx, x, y, w, h, k, color, label, s) {
  ctx.fillStyle = 'rgba(8,16,28,.55)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x + 1, y + 1, Math.max(0, (w - 2) * Math.min(1, k)), h - 2);
  ctx.strokeStyle = C.dim; ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.fillStyle = '#dff4ff';
  ctx.font = `600 ${9 * s}px system-ui,sans-serif`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x + 4 * s, y + h / 2 + 0.5);
}

function brackets(ctx, x, y, r, color, lw) {
  const k = r * 0.45;
  ctx.strokeStyle = color; ctx.lineWidth = lw;
  ctx.beginPath();
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    ctx.moveTo(x + sx * r, y + sy * (r - k)); ctx.lineTo(x + sx * r, y + sy * r); ctx.lineTo(x + sx * (r - k), y + sy * r);
  }
  ctx.stroke();
}

export function drawHud(ctx, g) {
  const { w, h } = g;
  const s = Math.max(1, Math.min(w, h) / 400);
  ctx.clearRect(0, 0, w, h);
  const p = g.player;
  if (!p) return;
  const t = performance.now() / 1000;

  // --- world markers ---
  for (const o of g.ships) {
    if (!o.alive || o === p) continue;
    const q = project(g, o.pos);
    if (q.behind) continue;
    if (o === g.target) continue;
    const foe = o.team !== 0;
    ctx.strokeStyle = foe ? C.foe : C.ok; ctx.lineWidth = 1.2 * s;
    const r = 7 * s;
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    if (foe) { ctx.moveTo(q.x, q.y - r); ctx.lineTo(q.x + r, q.y); ctx.lineTo(q.x, q.y + r); ctx.lineTo(q.x - r, q.y); ctx.closePath(); }
    else ctx.arc(q.x, q.y, r, 0, 6.283);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // nav marker
  const nav = g.navPos();
  if (nav) {
    const q = project(g, nav);
    const d = p.pos.distanceTo(nav);
    if (!q.behind && q.x > 0 && q.x < w && q.y > 0 && q.y < h) {
      ctx.strokeStyle = C.warn; ctx.lineWidth = 1.5 * s;
      const r = 10 * s;
      ctx.beginPath(); ctx.moveTo(q.x, q.y - r); ctx.lineTo(q.x + r, q.y); ctx.lineTo(q.x, q.y + r); ctx.lineTo(q.x - r, q.y); ctx.closePath(); ctx.stroke();
      ctx.fillStyle = C.warn; ctx.font = `600 ${9 * s}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(`${g.navName()} · ${(d / 1000).toFixed(1)} km`, q.x, q.y + r + 3 * s);
    } else if (!g.target) {
      arrow(ctx, g, nav, C.warn, s);
    }
  }

  // target
  const tg = g.target;
  if (tg && tg.alive) {
    const q = project(g, tg.pos);
    const on = !q.behind && q.x > 0 && q.x < w && q.y > 0 && q.y < h;
    if (on) {
      const d = p.pos.distanceTo(tg.pos);
      const r = Math.max(14 * s, Math.min(120 * s, (tg.radius * 1.2) / d * h * 1.2));
      brackets(ctx, q.x, q.y, r, C.foe, 2 * s);
      ctx.fillStyle = C.foe; ctx.font = `600 ${9 * s}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(`${Math.round(d)} m`, q.x, q.y - r - 3 * s);
      // lead indicator
      if (!tg.def.capital && d < 1400) {
        const l = project(g, g.leadPoint);
        if (!l.behind) {
          ctx.strokeStyle = g.aimLocked ? C.ok : C.warn; ctx.lineWidth = 1.6 * s;
          ctx.beginPath(); ctx.arc(l.x, l.y, 7 * s, 0, 6.283); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(l.x - 3 * s, l.y); ctx.lineTo(l.x + 3 * s, l.y); ctx.moveTo(l.x, l.y - 3 * s); ctx.lineTo(l.x, l.y + 3 * s); ctx.stroke();
        }
      }
    } else arrow(ctx, g, tg.pos, C.foe, s);
  }

  // reticle
  if (p.alive) {
    const q = project(g, g.aimPoint);
    const r = 13 * s;
    ctx.strokeStyle = g.aimLocked ? C.ok : C.ui; ctx.lineWidth = 1.6 * s;
    ctx.beginPath();
    ctx.arc(q.x, q.y, r, 0.35, 1.22); ctx.moveTo(q.x - r * Math.cos(0.35), q.y + r * Math.sin(0.35));
    ctx.arc(q.x, q.y, r, Math.PI - 0.35, Math.PI - 1.22, true);
    ctx.moveTo(q.x + r * Math.cos(0.35), q.y - r * Math.sin(0.35));
    ctx.arc(q.x, q.y, r, -0.35, -1.22, true);
    ctx.moveTo(q.x - r * Math.cos(0.35), q.y - r * Math.sin(0.35));
    ctx.arc(q.x, q.y, r, Math.PI + 0.35, Math.PI + 1.22);
    ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fillRect(q.x - s, q.y - s, 2 * s, 2 * s);
  }

  // --- status panel (top-left) ---
  const px = 12 * s + g.safeL, py = 40 * s, bw = 118 * s, bh = 13 * s;
  bar(ctx, px, py, bw, bh, p.shield / p.maxShield, 'rgba(70,170,255,.85)', `SCHILD ${Math.max(0, Math.round(p.shield / p.maxShield * 100))}%`, s);
  bar(ctx, px, py + bh + 4 * s, bw, bh, p.hp / p.maxHp, p.hp / p.maxHp < 0.3 ? 'rgba(255,70,90,.9)' : 'rgba(110,230,160,.8)', `HÜLLE ${Math.max(0, Math.round(p.hp / p.maxHp * 100))}%`, s);
  bar(ctx, px, py + (bh + 4 * s) * 2, bw, bh, g.energy, 'rgba(255,170,60,.85)', 'NACHBRENNER', s);
  ctx.fillStyle = '#dff4ff'; ctx.font = `700 ${11 * s}px system-ui,sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(`${Math.round(p.speed)} m/s`, px, py + (bh + 4 * s) * 3 + 2 * s);
  ctx.fillStyle = C.warn;
  ctx.fillText(`RAK ${p.missiles}`, px + 70 * s, py + (bh + 4 * s) * 3 + 2 * s);

  // --- target panel (top-right) ---
  if (tg && tg.alive) {
    const tw = 128 * s, tx = w - tw - 12 * s - g.safeR, ty = 58 * s;
    ctx.fillStyle = C.foe; ctx.font = `700 ${10 * s}px system-ui,sans-serif`; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText(tg.name.toUpperCase(), tx + tw, ty - 3 * s);
    if (tg.maxShield > 0) bar(ctx, tx, ty, tw, bh, tg.shield / tg.maxShield, 'rgba(70,170,255,.85)', 'SCHILD', s);
    bar(ctx, tx, ty + (tg.maxShield > 0 ? bh + 4 * s : 0), tw, bh, tg.hp / tg.maxHp, 'rgba(255,90,110,.85)', 'HÜLLE', s);
  }

  // --- objective (top-center) ---
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.font = `700 ${10 * s}px system-ui,sans-serif`;
  ctx.fillStyle = 'rgba(223,244,255,.9)';
  ctx.fillText(g.objectiveText().toUpperCase(), w / 2, 10 * s);
  if (g.hostileCount() > 0) {
    ctx.fillStyle = C.foe; ctx.font = `600 ${9 * s}px system-ui,sans-serif`;
    ctx.fillText(`FEINDE: ${g.hostileCount()}`, w / 2, 24 * s);
  }
  if (g.protect && g.protect.alive) {
    const k = g.protect.hp / g.protect.maxHp;
    const bw2 = 120 * s;
    bar(ctx, w / 2 - bw2 / 2, 38 * s, bw2, 10 * s, k, k < 0.35 ? 'rgba(255,70,90,.9)' : 'rgba(110,230,160,.8)', g.protect.name.toUpperCase(), s * 0.85);
  }

  // --- radar (bottom-center) ---
  const R = 40 * s, rx = w / 2, ry = h - R - 10 * s;
  ctx.fillStyle = 'rgba(6,14,24,.6)';
  ctx.beginPath(); ctx.arc(rx, ry, R, 0, 6.283); ctx.fill();
  ctx.strokeStyle = C.dim; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(rx, ry, R, 0, 6.283); ctx.moveTo(rx + R * 0.5, ry); ctx.arc(rx, ry, R * 0.5, 0, 6.283);
  ctx.moveTo(rx - R, ry); ctx.lineTo(rx + R, ry); ctx.moveTo(rx, ry - R); ctx.lineTo(rx, ry + R); ctx.stroke();
  const inv = g.invQ;
  const blip = (pos, color, size) => {
    v.copy(pos).sub(p.pos).applyQuaternion(inv);
    const d = v.length() || 1;
    const ang = Math.acos(Math.max(-1, Math.min(1, v.z / d))) / Math.PI;
    const l = Math.hypot(v.x, v.y) || 1;
    const bx = rx - (v.x / l) * ang * R, by = ry - (v.y / l) * ang * R;
    ctx.fillStyle = color;
    ctx.fillRect(bx - size / 2, by - size / 2, size, size);
  };
  for (const o of g.ships) {
    if (!o.alive || o === p) continue;
    blip(o.pos, o === tg ? '#ffffff' : (o.team === 0 ? C.ok : C.foe), (o.def.capital ? 5 : 3) * s);
  }
  for (const m of g.missiles) if (m.team === 1) blip(m.pos, C.warn, 2.5 * s);
  if (nav) blip(nav, C.warn, 4 * s);

  // warnings
  if (g.missileWarn && Math.sin(t * 16) > 0) {
    ctx.fillStyle = C.foe; ctx.font = `800 ${14 * s}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('⚠ RAKETENWARNUNG', w / 2, h * 0.28);
  }
  if (g.banner && g.bannerT > 0) {
    ctx.globalAlpha = Math.min(1, g.bannerT);
    ctx.fillStyle = '#eaf6ff'; ctx.font = `800 ${18 * s}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(g.banner, w / 2, h * 0.4);
    ctx.globalAlpha = 1;
  }
  // damage vignette
  if (g.hurt > 0) {
    const gr = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.85);
    gr.addColorStop(0, 'rgba(255,40,60,0)');
    gr.addColorStop(1, `rgba(255,40,60,${Math.min(0.6, g.hurt)})`);
    ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
  }
}

function arrow(ctx, g, pos, color, s) {
  v.copy(pos).sub(g.player.pos).applyQuaternion(g.invQ);
  const a = Math.atan2(-v.y, -v.x);
  const r = Math.min(g.w, g.h) * 0.3;
  const x = g.w / 2 + Math.cos(a) * r, y = g.h / 2 + Math.sin(a) * r;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(a);
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(10 * s, 0); ctx.lineTo(-6 * s, 6 * s); ctx.lineTo(-2 * s, 0); ctx.lineTo(-6 * s, -6 * s); ctx.closePath(); ctx.fill();
  ctx.restore();
}
