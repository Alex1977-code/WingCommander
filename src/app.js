import { Game, PILOT_COLORS } from './game.js';
import { InputHub } from './input.js';
import { Audio } from './audio.js';
import { SHIPS } from './ships.js';
import { CHARS, MISSIONS, INTRO, ENDING, rankFor } from './campaign.js';
import { decode, scramble, glitchTitle, countUp, Hologram, Waveform, decorate, reduced, setLabel } from './textfx.js';
import { netAvailable, castAvailable, startHost, startCast, listenCastReceiver } from './net.js';

const $ = (id) => document.getElementById(id);
const SAVE_KEY = 'sternenfront.save.v1';
const SET_KEY = 'sternenfront.settings.v1';
const query = new URLSearchParams(location.search);
const TV = query.has('tv') || query.has('cast');

function load(key, fallback) {
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch { return { ...fallback }; }
}
function store(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } }

let save = load(SAVE_KEY, { started: false, mission: 0, kills: 0, score: 0, callsign: 'Nova', done: false });
const settings = load(SET_KEY, { sound: true, invert: true, quality: 'high', coop: false, callsign2: 'Orion' });

const hub = new InputHub();
const audio = new Audio();
audio.enabled = settings.sound;

const fill = (t) => t.replaceAll('{cs}', save.callsign);
const coopActive = () => settings.coop && hub.devices.length >= 1;

// touch UI only where it makes sense
if (matchMedia('(pointer: coarse)').matches && !TV) document.body.classList.add('touch');
window.addEventListener('touchstart', () => { if (!TV) document.body.classList.add('touch'); }, { once: true, passive: true });

// ---------- screens + menu navigation ----------
const screens = [...document.querySelectorAll('.screen')];
document.querySelectorAll('.panel, .dialog').forEach(decorate);
let current = 's-title';
let focusIdx = 0, navMode = false;

function visibleButtons() {
  const sc = current && $(current);
  if (!sc) return [];
  return [...sc.querySelectorAll('button.btn')].filter((b) => !b.classList.contains('hidden') && b.offsetParent !== null);
}
function setFocus(i, sound = true) {
  const list = visibleButtons();
  document.querySelectorAll('.btn.focus').forEach((b) => b.classList.remove('focus'));
  if (!list.length) return;
  focusIdx = (i + list.length) % list.length;
  const b = list[focusIdx];
  if (navMode) { b.classList.add('focus'); scramble(b); b.scrollIntoView?.({ block: 'nearest' }); }
  if (sound) audio.beep(1400, 0.04);
}

function show(id) {
  const prev = current;
  current = id;
  for (const s of screens) s.classList.toggle('hidden', s.id !== id);
  $('flight').classList.toggle('hidden', !(id === null || id === 's-pause'));
  if (id && id !== prev) {
    const sc = $(id);
    const panel = sc.querySelector('.panel, .dialog') || sc;
    panel.classList.remove('holo-in'); void panel.offsetWidth; panel.classList.add('holo-in');
    if (!reduced) { const f = $('scanfx'); f.classList.remove('run'); void f.offsetWidth; f.classList.add('run'); }
    sc.querySelectorAll('header h2:not(.glitch), header > span, .panel h3').forEach((el, i) => {
      el._dec?.cancel();
      const txt = el.id ? el.textContent : (el.dataset.label ||= el.textContent);
      el._dec = decode(el, txt, { cps: 70, delay: 120 + i * 60 });
    });
    audio.tone?.('sine', 300, 1200, 0.18, 0.05);
    const list = visibleButtons();
    const primary = list.findIndex((b) => b.classList.contains('primary'));
    setFocus(id === 's-title' ? 0 : Math.max(0, primary), false);
  }
  syncPads();
}

function menuEvent(e) {
  if (!current) return;
  navMode = true;
  if (current === 's-dialog') {
    if (e === 'ok') advance();
    else if (e === 'back' || e === 'start') skipDialog();
    return;
  }
  const list = visibleButtons();
  if (e === 'up' || e === 'left') setFocus(focusIdx - 1);
  else if (e === 'down' || e === 'right') setFocus(focusIdx + 1);
  else if (e === 'ok') { const b = list[focusIdx]; if (b) { audio.beep(900, 0.08); b.click(); } }
  else if (e === 'back' || e === 'start') {
    const sc = $(current);
    if (current === 's-pause') return resume();
    const back = sc.querySelector('[data-back]') || (current === 's-brief' ? $('b-back') : null);
    if (back && e === 'back') back.click();
    else if (e === 'start') list[focusIdx]?.click();
  }
}
document.addEventListener('pointermove', () => {
  if (navMode) { navMode = false; document.querySelectorAll('.btn.focus').forEach((b) => b.classList.remove('focus')); }
}, { passive: true });
document.addEventListener('pointerover', (e) => {
  const b = e.target.closest?.('.btn');
  if (b && !b._hovered) { b._hovered = true; scramble(b); setTimeout(() => (b._hovered = false), 400); }
});

function setAvatarColor(el, who) { el.style.setProperty('--ac', (CHARS[who] || CHARS.erz).color); }

// ---------- in-flight comm ----------
const commHolo = new Hologram(document.querySelector('#comm .holo'));
const commQ = [];
let commT = null, commDec = null, commHold = 0;
function nextComm() {
  const el = $('comm');
  const wait = commHold - performance.now();
  if (wait > 0) { commT = setTimeout(nextComm, wait); return; }
  const c = commQ.shift();
  if (!c) { el.classList.add('hidden'); commHolo.on = false; commT = null; return; }
  const ch = CHARS[c.who] || CHARS.erz;
  setAvatarColor(el, c.who);
  commHolo.set(c.who, ch.color); commHolo.on = true; commHolo.talk = 1;
  el.querySelector('.who').textContent = ch.name;
  el.classList.remove('hidden', 'show'); void el.offsetWidth; el.classList.add('show');
  commDec?.cancel();
  const text = fill(c.text);
  commDec = decode(el.querySelector('.txt'), text, { cps: 75, window: 5 });
  commDec.done.then(() => { commHolo.talk = 0; });
  audio.beep(660, 0.1); setTimeout(() => audio.beep(990, 0.07), 90);
  commT = setTimeout(nextComm, 2400 + c.text.length * 45);
}
function clearComm() { commQ.length = 0; clearTimeout(commT); commT = null; commDec?.cancel(); commHolo.on = false; $('comm').classList.add('hidden'); }

// ---------- UI bridge used by the game ----------
const ui = {
  comm(who, text) { if (commQ.length < 4) commQ.push({ who, text }); if (!commT) nextComm(); },
  setAuto(on) { $('btn-auto').classList.toggle('on', on); },
  setThrottle(v) { $('throttle-fill').style.height = v * 100 + '%'; },
  fade(cb) {
    const f = $('fade');
    f.classList.remove('dark'); f.classList.add('on');
    setTimeout(() => { cb(); f.classList.remove('on'); }, 500);
  },
  pause() {
    if (game.mode !== 'flight' || game.ended) return;
    game.paused = true;
    show('s-pause');
  },
  missionEnd(win, reason, stats) {
    clearComm();
    fadeDark(() => { game.startAttract(); document.body.classList.remove('coop'); debrief(win, reason, stats); });
  },
  frame(dt) {
    hub.local.update(dt);
    hub.poll(dt);
    const ev = hub.takeMenu();
    if (current) ev.forEach(menuEvent);
  },
};

function fadeDark(cb) {
  const f = $('fade');
  f.classList.add('dark', 'on');
  setTimeout(() => { cb(); f.classList.remove('on'); }, 550);
}

const game = new Game($('view'), $('hud'), audio, ui);
game.invert = settings.invert;
game.setQuality(settings.quality);
game.startAttract();

// ---------- dialog ----------
const holo = new Hologram($('d-holo'));
const wave = new Waveform($('d-wave'));
let dlg = null;
function runDialog(lines, kicker, title, done) {
  dlg = { lines, i: -1, done, dec: null };
  $('d-kicker').textContent = kicker;
  show('s-dialog');
  glitchTitle($('d-title'), title);
  holo.on = true; wave.on = true;
  advance();
}
function advance() {
  if (!dlg) return;
  if (dlg.dec?.running) { dlg.dec.finish(); return; }
  dlg.i++;
  if (dlg.i >= dlg.lines.length) return closeDialog();
  const l = dlg.lines[dlg.i];
  const ch = CHARS[l.who] || CHARS.erz;
  const box = document.querySelector('.dialog');
  box.style.setProperty('--ac', ch.color);
  box.classList.remove('swap'); void box.offsetWidth; box.classList.add('swap');
  holo.set(l.who, ch.color);
  wave.color = ch.color;
  $('d-freq').textContent = `KANAL ${String(3 + (l.who.length * 7) % 17).padStart(2, '0')} · ${(120 + l.who.charCodeAt(0) * 0.37).toFixed(2)} MHZ`;
  decode($('d-who'), ch.name.toUpperCase(), { cps: 60 });
  holo.talk = 1; wave.level = 1;
  dlg.dec = decode($('d-text'), fill(l.text), { cps: 55, window: 6, cursor: true });
  dlg.dec.done.then(() => { holo.talk = 0; wave.level = 0.08; });
  audio.beep(520, 0.06);
}
function closeDialog() {
  if (!dlg) return;
  dlg.dec?.cancel();
  const d = dlg.done; dlg = null;
  holo.on = false; wave.on = false;
  d();
}
function skipDialog() { closeDialog(); }
$('d-next').onclick = advance;
$('d-skip').onclick = skipDialog;
document.querySelector('#s-dialog .dbox').addEventListener('click', advance);

// ---------- briefing ----------
function drawMap(def) {
  const c = $('b-map'), g = c.getContext('2d'), W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  g.strokeStyle = 'rgba(127,214,255,.1)'; g.lineWidth = 1;
  for (let x = 0; x <= W; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let y = 0; y <= H; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  const pts = [{ name: 'TUS Aurora', x: 0, z: 0, home: true }, ...def.navs.map((n) => ({ name: n.name, x: n.pos[0], z: n.pos[2] }))];
  const xs = pts.map((p) => p.x), zs = pts.map((p) => p.z);
  const minX = Math.min(...xs) - 1500, maxX = Math.max(...xs) + 1500, minZ = Math.min(...zs) - 1500, maxZ = Math.max(...zs) + 1500;
  const sc = Math.min((W - 80) / (maxX - minX), (H - 80) / (maxZ - minZ));
  const P = (p) => [W / 2 + (p.x - (minX + maxX) / 2) * sc, H / 2 - (p.z - (minZ + maxZ) / 2) * sc];
  // animated route reveal
  const t0 = performance.now();
  const route = [...pts, pts[0]].map(P);
  let len = 0; const segs = [];
  for (let i = 1; i < route.length; i++) { const l = Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]); segs.push(l); len += l; }
  const draw = (now) => {
    const k = Math.min(1, (now - t0) / 1400);
    g.clearRect(0, 0, W, H);
    g.strokeStyle = 'rgba(127,214,255,.1)'; g.lineWidth = 1;
    for (let x = 0; x <= W; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 0; y <= H; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    let left = len * k;
    g.setLineDash([6, 6]); g.strokeStyle = 'rgba(255,200,87,.8)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(...route[0]);
    for (let i = 1; i < route.length && left > 0; i++) {
      const f = Math.min(1, left / segs[i - 1]);
      g.lineTo(route[i - 1][0] + (route[i][0] - route[i - 1][0]) * f, route[i - 1][1] + (route[i][1] - route[i - 1][1]) * f);
      left -= segs[i - 1];
    }
    g.stroke(); g.setLineDash([]);
    g.font = '700 13px Rajdhani, system-ui'; g.textAlign = 'center';
    pts.forEach((p, i) => {
      const a = Math.min(1, Math.max(0, k * (pts.length + 1) - i));
      if (a <= 0) return;
      const [x, y] = P(p);
      g.globalAlpha = a;
      g.fillStyle = p.home ? '#6dffb0' : '#ffc857'; g.strokeStyle = g.fillStyle;
      g.beginPath();
      if (p.home) g.rect(x - 6, y - 6, 12, 12); else { g.moveTo(x, y - 8); g.lineTo(x + 8, y); g.lineTo(x, y + 8); g.lineTo(x - 8, y); g.closePath(); }
      g.fill();
      g.beginPath(); g.arc(x, y, 15 + Math.sin(now / 300 + i) * 2, 0, 6.283); g.stroke();
      g.fillStyle = '#e6f4ff';
      g.fillText(p.name.toUpperCase(), x, y - 22);
      g.globalAlpha = 1;
    });
    // sweeping scan line
    const sx = ((now - t0) / 8 % (W + 80)) - 40;
    const gr = g.createLinearGradient(sx - 40, 0, sx, 0);
    gr.addColorStop(0, 'rgba(127,214,255,0)'); gr.addColorStop(1, 'rgba(127,214,255,.18)');
    g.fillStyle = gr; g.fillRect(sx - 40, 0, 40, H);
    if (current === 's-brief') requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

function fillBriefing() {
  const def = MISSIONS[save.mission];
  $('b-kicker').textContent = `Mission ${save.mission + 1} / ${MISSIONS.length} · ${def.sector}`;
  $('b-obj').innerHTML = def.objectives.map((o) => `<li>${o}</li>`).join('');
  const s = SHIPS[def.ship];
  $('b-ship').textContent = `${s.name} – ${s.guns.length} Kanonen · ${s.missiles} Raketen · Schild ${s.shield} · Hülle ${s.hp}`;
  const wing = def.wingman ? CHARS[def.wingman].name : 'Keiner';
  $('b-wing').textContent = coopActive() ? `${settings.callsign2} (Spieler 2) und ${wing}` : wing;
  show('s-brief');
  glitchTitle($('b-title'), def.title);
  drawMap(def);
}
function briefing() {
  const def = MISSIONS[save.mission];
  runDialog(def.briefing, `Mission ${save.mission + 1} / ${MISSIONS.length} · ${def.sector}`, `Einsatzbesprechung: ${def.title}`, fillBriefing);
}

function cinematic(def) {
  const el = $('cine');
  el.classList.remove('hidden', 'out');
  ['cine-title'].forEach((id) => { const n = $(id); n.style.animation = 'none'; void n.offsetWidth; n.style.animation = ''; });
  el.querySelectorAll('.cine-line').forEach((n) => { n.style.animation = 'none'; void n.offsetWidth; n.style.animation = ''; });
  decode($('cine-kicker'), `MISSION ${String(save.mission + 1).padStart(2, '0')} // ${def.sector.toUpperCase()}`, { cps: 60 });
  glitchTitle($('cine-title'), def.title.toUpperCase(), { cps: 22 });
  decode($('cine-sub'), def.objectives[0], { cps: 50, delay: 700 });
  audio.tone?.('sawtooth', 80, 40, 1.4, 0.08);
  commHold = performance.now() + 3700;
  setTimeout(() => el.classList.add('out'), 3300);
  setTimeout(() => el.classList.add('hidden'), 3900);
}

function launch() {
  audio.unlock();
  tryFullscreen();
  const coop = coopActive();
  fadeDark(() => {
    clearComm();
    show(null);
    document.body.classList.toggle('coop', coop);
    const ctrls = hub.assign(coop);
    const def = MISSIONS[save.mission];
    game.startMission(def, ctrls, [save.callsign, settings.callsign2 || 'Orion']);
    cinematic(def);
    syncPads();
  });
}

let lastWin = false;
function debrief(win, reason, stats) {
  lastWin = win;
  const def = MISSIONS[save.mission];
  const oldRank = rankFor(save.kills);
  const acc = stats.shots ? Math.round(Math.min(1, stats.hits / stats.shots) * 100) : 0;
  $('r-kicker').textContent = `Nachbesprechung · ${def.title}`;
  $('r-title').style.color = win ? 'var(--ok)' : 'var(--foe)';
  const mm = Math.floor(stats.time / 60), ss = String(Math.floor(stats.time % 60)).padStart(2, '0');
  $('r-stats').innerHTML = `<div><b id="st-k">0</b><span>Abschüsse</span></div><div><b id="st-a">0%</b><span>Trefferquote</span></div><div><b>${mm}:${ss}</b><span>Flugzeit</span></div><div><b id="st-s">0</b><span>Punkte</span></div>`;
  let extra = reason || '';
  if (win) {
    save.kills += stats.kills; save.score += stats.score;
    const nr = rankFor(save.kills);
    extra = `Gesamtabschüsse: ${save.kills} · Rang: ${nr}`;
    if (nr !== oldRank) extra += ` · BEFÖRDERUNG zum ${nr}!`;
    else if (stats.kills >= 8 && acc >= 30) extra += ' · Belobigung: Bronzener Falke für herausragende Leistung.';
    save.mission++;
    if (save.mission >= MISSIONS.length) { save.mission = MISSIONS.length - 1; save.done = true; save.finishedNow = true; }
    store(SAVE_KEY, save);
  }
  if (stats.per.length > 1) extra += `  ·  ${save.callsign}: ${stats.per[0]} · ${settings.callsign2}: ${stats.per[1]} Abschüsse`;
  $('r-reason').textContent = extra;
  $('r-reason').className = win ? 'medal' : '';
  setLabel($('r-next'), win ? 'Weiter' : 'Erneut versuchen');
  const after = () => {
    show('s-debrief');
    glitchTitle($('r-title'), win ? 'Mission erfolgreich' : 'Mission gescheitert');
    countUp($('st-k'), stats.kills); countUp($('st-a'), acc, '%'); countUp($('st-s'), stats.score, '', 1300);
  };
  if (win) runDialog(def.win, `Nachbesprechung · ${def.title}`, 'Zurück an Bord', after);
  else after();
}

$('r-next').onclick = () => {
  if (!lastWin) return fillBriefing();
  if (save.finishedNow) {
    save.finishedNow = false; store(SAVE_KEY, save);
    return runDialog(ENDING, 'Epilog', 'Morgenröte', () => title());
  }
  briefing();
};
$('r-menu').onclick = () => title();
$('b-back').onclick = () => title();
$('b-start').onclick = launch;

// ---------- title / menus ----------
function title() {
  $('m-continue').classList.toggle('hidden', !save.started);
  setLabel($('m-continue'), save.done ? 'Letzte Mission erneut fliegen' : `Fortsetzen · Mission ${save.mission + 1}`);
  show('s-title');
  const line = save.started ? `${rankFor(save.kills)} „${save.callsign}“ · ${save.kills} Abschüsse · ${save.score} Punkte` : '';
  decode($('pilot-line'), line, { cps: 80, delay: 400 });
  decode($('logo-kicker'), 'GESCHWADER NACHTFALKEN', { cps: 40 });
  decode($('logo-title'), 'STERNENFRONT', { cps: 18, window: 4 });
  decode($('logo-sub'), 'Der Perseus-Krieg', { cps: 30, delay: 600 });
  document.querySelectorAll('#s-title .menu .btn').forEach((b, i) => {
    b.dataset.label ||= b.textContent;
    if (!b.classList.contains('hidden')) { b._scr?.cancel(); b._scr = decode(b, b.dataset.label, { cps: 50, delay: 300 + i * 90, pad: true }); }
  });
}
$('m-continue').onclick = () => { audio.unlock(); briefing(); };
$('m-new').onclick = () => { audio.unlock(); $('callsign').value = save.callsign; show('s-name'); };
$('m-help').onclick = () => { audio.unlock(); show('s-help'); };
$('m-settings').onclick = () => { audio.unlock(); show('s-settings'); };
$('m-multi').onclick = () => { audio.unlock(); openMulti(); };
document.querySelectorAll('[data-back]').forEach((b) => (b.onclick = () => { store(SET_KEY, settings); title(); }));
$('callsign').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('name-ok').click(); });
$('name-ok').onclick = () => {
  const cs = $('callsign').value.trim().replace(/[<>{}]/g, '') || 'Nova';
  save = { started: true, mission: 0, kills: 0, score: 0, callsign: cs, done: false };
  store(SAVE_KEY, save);
  runDialog(INTRO, 'Prolog · 2643', 'Der Perseus-Graben', briefing);
};

function refreshSettings() {
  setLabel($('set-sound'), `Ton: ${settings.sound ? 'An' : 'Aus'}`);
  setLabel($('set-invert'), `Steuerung: ${settings.invert ? 'Flugzeug (runter = hoch)' : 'Direkt (hoch = hoch)'}`);
  setLabel($('set-quality'), `Grafik: ${settings.quality === 'high' ? 'Hoch (Bloom)' : 'Leistung'}`);
  store(SET_KEY, settings);
}
$('set-sound').onclick = () => { settings.sound = !settings.sound; audio.setEnabled(settings.sound); refreshSettings(); };
$('set-invert').onclick = () => { settings.invert = !settings.invert; game.invert = settings.invert; refreshSettings(); };
$('set-quality').onclick = () => { settings.quality = settings.quality === 'high' ? 'low' : 'high'; game.setQuality(settings.quality); refreshSettings(); };
$('set-full').onclick = () => { if (document.fullscreenElement) document.exitFullscreen?.(); else tryFullscreen(true); };
refreshSettings();

function tryFullscreen(force) {
  const coarse = matchMedia('(pointer: coarse)').matches;
  if (!force && !coarse) return;
  const el = document.documentElement;
  try {
    const p = el.requestFullscreen?.({ navigationUI: 'hide' });
    p?.then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
  } catch { /* not allowed here */ }
}

// ---------- multiplayer / TV ----------
let lobby = null, lobbyStarting = false;
function renderSlots() {
  const coop = coopActive();
  const devs = hub.devices;
  const rows = [];
  const p1 = ['Touch / Tastatur', ...devs.filter((d) => hub.roleOf(d, coop) === 1).map((d) => d.name)];
  rows.push(`<li><b style="color:${PILOT_COLORS[0]}">P1</b><span>${p1.join(' + ')}</span></li>`);
  if (settings.coop) {
    const p2 = devs.find((d) => hub.roleOf(d, coop) === 2);
    rows.push(p2 ? `<li><b style="color:${PILOT_COLORS[1]}">P2</b><span>${p2.name}</span></li>` : '<li class="empty"><b>P2</b><span>Wartet auf Controller: Gamepad-Taste drücken oder Handy verbinden</span></li>');
  }
  $('mp-slots').innerHTML = rows.join('');
  setLabel($('mp-coop'), `Koop für 2 Spieler: ${settings.coop ? 'An' : 'Aus'}`);
}
hub.onChange(() => { renderSlots(); syncPads(); if (current === 's-multi' && hub.devices.length) audio.beep(1500, 0.1); });
$('mp-coop').onclick = () => { settings.coop = !settings.coop; store(SET_KEY, settings); renderSlots(); syncPads(); };
$('callsign2').addEventListener('input', () => { settings.callsign2 = $('callsign2').value.trim().replace(/[<>{}]/g, '').slice(0, 12) || 'Orion'; store(SET_KEY, settings); });

async function drawQR(canvas, url, size) {
  try {
    const QR = await import('qrcode');
    await QR.toCanvas(canvas, url, { margin: 1, width: size, color: { dark: '#05070d', light: '#ffffff' } });
  } catch { /* qr optional */ }
}

async function ensureLobby() {
  if (lobby || lobbyStarting || !netAvailable()) return;
  lobbyStarting = true;
  const st = $('mp-status');
  st.textContent = 'Verbindungsdienst wird gestartet…'; st.className = 'small';
  try {
    lobby = await startHost((transport, name) => {
      hub.addRemote(transport, name);
      audio.beep(1500, 0.12);
      ui.comm?.('flug', `Controller verbunden: ${name || 'Handy'}.`);
    }, (s, info) => {
      if (s === 'error') { st.textContent = `Verbindungsdienst nicht erreichbar (${info}).`; st.className = 'small err'; }
    });
    $('mp-code').textContent = lobby.code;
    $('mp-url').textContent = lobby.url;
    st.textContent = 'Bereit: Handys können sich jetzt verbinden.'; st.className = 'small ok';
    drawQR($('mp-qr'), lobby.url, 180);
    updateTvBadge();
  } catch {
    st.textContent = 'Verbindungsdienst nicht erreichbar. Gamepads funktionieren trotzdem.'; st.className = 'small err';
  } finally { lobbyStarting = false; }
}

function updateTvBadge() {
  const b = $('tv-badge');
  if (!lobby || !TV) { b.classList.add('hidden'); return; }
  b.innerHTML = '<canvas width="92" height="92"></canvas><div>Handy als Controller:<b></b>QR-Code scannen</div>';
  b.querySelector('b').textContent = lobby.code;
  drawQR(b.querySelector('canvas'), lobby.url, 92);
  b.classList.remove('hidden');
}

function openMulti() {
  $('callsign2').value = settings.callsign2;
  const online = netAvailable();
  $('mp-online').classList.toggle('hidden', !online);
  $('mp-offline').classList.toggle('hidden', online);
  $('mp-cast').classList.toggle('hidden', !castAvailable() || TV);
  renderSlots();
  show('s-multi');
  ensureLobby();
}

$('mp-cast').onclick = async () => {
  try {
    const transport = await startCast();
    game.stop();
    const { startPadPage } = await import('./pad.js');
    startPadPage(null, transport);
  } catch (e) {
    $('mp-status').textContent = `Streamen nicht möglich: ${e?.message || e}`; $('mp-status').className = 'small err';
  }
};

if (query.has('cast')) {
  listenCastReceiver((t, name) => hub.addRemote(t, name));
}
if (TV && netAvailable()) ensureLobby();

/** Tell phone controllers their role and whether to show flight or menu controls. */
let lastPadMode = '';
function syncPads() {
  const coop = coopActive();
  const mode = current === null ? 'flight' : 'menu';
  for (const d of hub.devices) {
    if (d.kind !== 'remote') continue;
    const role = hub.roleOf(d, coop);
    d.send({ t: 'role', p: role, color: PILOT_COLORS[role - 1] });
    d.send({ t: 'mode', mode });
  }
  lastPadMode = mode;
}

// ---------- pause ----------
function resume() {
  game.paused = false;
  game.pilots.forEach((P) => { P.ctrl.take(); });
  show(null);
}
$('p-resume').onclick = resume;
$('p-restart').onclick = () => { game.stop(); launch(); };
$('p-quit').onclick = () => { game.stop(); clearComm(); document.body.classList.remove('coop'); fadeDark(() => { game.startAttract(); title(); }); };
document.addEventListener('visibilitychange', () => { if (document.hidden) ui.pause(); });
document.addEventListener('contextmenu', (e) => e.preventDefault());

title();
if (import.meta.env?.DEV || query.has('debug')) window.__game = { game, save: () => save, hub, MISSIONS, settings, show, launch };
