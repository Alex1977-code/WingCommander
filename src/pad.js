/** Phone controller page (opened via QR code / ?pad=CODE, or after starting a Chromecast session). */
import { connectPad } from './net.js';
import { decode } from './textfx.js';

const html = `
<div id="pad" class="pad">
  <header class="pad-top">
    <b id="pad-role">CONTROLLER</b>
    <span id="pad-status">Verbinde…</span>
  </header>
  <section id="pad-connect" class="pad-connect">
    <h2>Mit Spiel verbinden</h2>
    <p>Gib den Code ein, der auf dem TV angezeigt wird.</p>
    <input id="pad-code" maxlength="4" autocomplete="off" spellcheck="false" placeholder="CODE">
    <input id="pad-name" maxlength="14" autocomplete="off" spellcheck="false" placeholder="Dein Name">
    <button id="pad-go" class="btn primary">Verbinden</button>
  </section>
  <section id="pad-menu" class="pad-menu hidden">
    <div class="dpad">
      <button data-m="up" class="dp up">▲</button>
      <button data-m="left" class="dp left">◀</button>
      <button data-m="right" class="dp right">▶</button>
      <button data-m="down" class="dp down">▼</button>
    </div>
    <div class="pad-actions">
      <button data-m="ok" class="pbtn big ok">OK</button>
      <button data-m="back" class="pbtn">ZURÜCK</button>
    </div>
  </section>
  <section id="pad-flight" class="pad-flight hidden">
    <div id="pad-stick" class="pad-stick"><div class="ring"><div id="pad-knob" class="knob"></div></div></div>
    <div class="pad-buttons">
      <button data-e="pause" class="pbtn sm">II</button>
      <button data-e="auto" class="pbtn sm">AUTO</button>
      <button data-e="target" class="pbtn">ZIEL</button>
      <button data-e="missile" class="pbtn msl">RAKETE</button>
      <button data-h="b" class="pbtn">BOOST</button>
      <button data-h="f" class="pbtn big fire">FEUER</button>
    </div>
    <div id="pad-thr" class="pad-thr"><div id="pad-thr-fill"></div><span>SCHUB</span></div>
  </section>
</div>`;

export function startPadPage(code, existingTransport) {
  document.body.innerHTML = html;
  document.body.classList.add('pad-mode');
  const $ = (id) => document.getElementById(id);
  const state = { x: 0, y: 0, f: false, b: false, th: 0.75 };
  let tr = null, dirty = true;

  const setStatus = (t, ok) => { $('pad-status').textContent = t; $('pad-status').className = ok ? 'ok' : ''; };
  const setMode = (m) => {
    $('pad-connect').classList.toggle('hidden', m !== 'connect');
    $('pad-menu').classList.toggle('hidden', m !== 'menu');
    $('pad-flight').classList.toggle('hidden', m !== 'flight');
  };
  const buzz = (ms) => { try { navigator.vibrate?.(ms); } catch { /* ignore */ } };

  const attach = (t) => {
    tr = t;
    setStatus('Verbunden', true);
    setMode('menu');
    t.send({ t: 'hello', name: localStorage.getItem('sf.padname') || 'Handy' });
    t.onMessage((m) => {
      if (m.t === 'role') {
        const el = $('pad-role');
        el.style.color = m.color || '';
        decode(el, `SPIELER ${m.p}`, { cps: 30 });
      }
      if (m.t === 'mode') setMode(m.mode === 'flight' ? 'flight' : 'menu');
      if (m.t === 'buzz') buzz(Math.min(200, m.ms | 0));
    });
    t.onClose(() => { tr = null; setStatus('Verbindung getrennt – Seite neu laden', false); setMode('connect'); });
  };

  let connecting = false;
  const go = async () => {
    if (connecting) return;
    const c = $('pad-code').value.trim().toUpperCase();
    const n = $('pad-name').value.trim() || 'Handy';
    try { localStorage.setItem('sf.padname', n); } catch { /* ignore */ }
    if (c.length !== 4) { setStatus('Code hat 4 Zeichen', false); return; }
    setStatus('Verbinde…');
    connecting = true; $('pad-go').disabled = true;
    try {
      const t = await connectPad(c, n);
      tr?.close?.();
      attach(t);
    } catch (e) {
      const type = e?.type || e?.message || 'network';
      setStatus(type === 'peer-unavailable' ? 'Kein Spiel mit diesem Code gefunden. Code prüfen.' : `Keine Verbindung (${type}). Netzwerk prüfen und erneut versuchen.`, false);
    } finally { connecting = false; $('pad-go').disabled = false; }
  };
  $('pad-go').onclick = go;
  try { $('pad-name').value = localStorage.getItem('sf.padname') || ''; } catch { /* ignore */ }

  if (existingTransport) attach(existingTransport);
  else if (code) { $('pad-code').value = code; setMode('connect'); go(); }
  else { setMode('connect'); setStatus('Nicht verbunden'); }

  // menu buttons
  document.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('pointerdown', (e) => {
    e.preventDefault(); tr?.send({ t: 'm', e: b.dataset.m }); buzz(8);
    b.classList.add('down'); setTimeout(() => b.classList.remove('down'), 120);
  }));
  document.querySelectorAll('[data-e]').forEach((b) => b.addEventListener('pointerdown', (e) => {
    e.preventDefault(); tr?.send({ t: 'e', e: b.dataset.e }); buzz(10);
    b.classList.add('down'); setTimeout(() => b.classList.remove('down'), 120);
  }));
  document.querySelectorAll('[data-h]').forEach((b) => {
    const k = b.dataset.h;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); state[k] = true; dirty = true; b.classList.add('down'); buzz(6); });
    const up = () => { state[k] = false; dirty = true; b.classList.remove('down'); };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
  });

  // stick
  const zone = $('pad-stick'), knob = $('pad-knob');
  let sid = null, ox = 0, oy = 0;
  const R = 60;
  zone.addEventListener('pointerdown', (e) => { sid = e.pointerId; ox = e.clientX; oy = e.clientY; zone.setPointerCapture(sid); e.preventDefault(); });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== sid) return;
    let dx = (e.clientX - ox) / R, dy = (e.clientY - oy) / R;
    const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    state.x = dx; state.y = dy; dirty = true;
    knob.style.transform = `translate(${dx * R}px, ${dy * R}px)`;
  });
  const end = (e) => { if (e.pointerId !== sid) return; sid = null; state.x = state.y = 0; dirty = true; knob.style.transform = ''; };
  zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);

  // throttle
  const thr = $('pad-thr');
  const setThr = (e) => {
    const r = thr.getBoundingClientRect();
    state.th = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height)); dirty = true;
    $('pad-thr-fill').style.height = state.th * 100 + '%';
  };
  thr.addEventListener('pointerdown', (e) => { thr.setPointerCapture(e.pointerId); setThr(e); e.preventDefault(); });
  thr.addEventListener('pointermove', (e) => { if (thr.hasPointerCapture(e.pointerId)) setThr(e); });
  $('pad-thr-fill').style.height = '75%';

  let keep = 0;
  setInterval(() => {
    keep++;
    if (!tr || (!dirty && keep < 10)) return;
    tr.send({ t: 's', x: +state.x.toFixed(3), y: +state.y.toFixed(3), f: state.f, b: state.b, th: +state.th.toFixed(3) });
    dirty = false; keep = 0;
  }, 33);

  document.addEventListener('contextmenu', (e) => e.preventDefault());
  // keep screen on while controlling
  try { navigator.wakeLock?.request('screen').catch(() => {}); } catch { /* ignore */ }
  document.addEventListener('pointerdown', () => {
    const el = document.documentElement;
    if (!document.fullscreenElement && matchMedia('(pointer: coarse)').matches) el.requestFullscreen?.().then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
  }, { once: true });
}
