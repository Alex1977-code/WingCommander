import { Game } from './game.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { SHIPS } from './ships.js';
import { CHARS, MISSIONS, INTRO, ENDING, rankFor } from './campaign.js';

const $ = (id) => document.getElementById(id);
const SAVE_KEY = 'sternenfront.save.v1';
const SET_KEY = 'sternenfront.settings.v1';

function load(key, fallback) {
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch { return { ...fallback }; }
}
function store(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } }

let save = load(SAVE_KEY, { started: false, mission: 0, kills: 0, score: 0, callsign: 'Nova', done: false });
const settings = load(SET_KEY, { sound: true, invert: true, quality: 'high' });

const input = new Input();
const audio = new Audio();
audio.enabled = settings.sound;
input.invert = settings.invert;

const fill = (t) => t.replaceAll('{cs}', save.callsign);

// ---------- screens ----------
const screens = [...document.querySelectorAll('.screen')];
let current = 's-title';
function show(id) {
  current = id;
  for (const s of screens) s.classList.toggle('hidden', s.id !== id);
  $('flight').classList.toggle('hidden', id !== null && id !== 's-pause');
  if (id === null) $('flight').classList.remove('hidden');
}
function setAvatar(el, who) {
  const c = CHARS[who] || CHARS.erz;
  el.style.setProperty('--ac', c.color);
  el.textContent = c.short;
}

// ---------- comm queue (in flight) ----------
const commQ = [];
let commT = null;
function nextComm() {
  const el = $('comm');
  const c = commQ.shift();
  if (!c) { el.classList.add('hidden'); commT = null; return; }
  setAvatar(el.querySelector('.avatar'), c.who);
  el.querySelector('.who').textContent = (CHARS[c.who] || CHARS.erz).name;
  el.querySelector('.txt').textContent = fill(c.text);
  el.classList.remove('hidden');
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  audio.beep(660, 0.1);
  commT = setTimeout(nextComm, 2200 + c.text.length * 45);
}
function clearComm() { commQ.length = 0; clearTimeout(commT); commT = null; $('comm').classList.add('hidden'); }

const ui = {
  comm(who, text) { if (commQ.length < 4) commQ.push({ who, text }); if (!commT) nextComm(); },
  setAuto(on) { $('btn-auto').classList.toggle('on', on); },
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
    fadeDark(() => { game.startAttract(); debrief(win, reason, stats); });
  },
};

function fadeDark(cb) {
  const f = $('fade');
  f.classList.add('dark', 'on');
  setTimeout(() => { cb(); f.classList.remove('on'); }, 550);
}

const game = new Game($('view'), $('hud'), input, audio, ui);
game.setQuality(settings.quality);
game.startAttract();

// ---------- dialog ----------
let dlg = null;
function runDialog(lines, kicker, title, done) {
  dlg = { lines, i: -1, done, typing: null, full: '' };
  $('d-kicker').textContent = kicker;
  $('d-title').textContent = title;
  show('s-dialog');
  advance();
}
function advance() {
  if (!dlg) return;
  if (dlg.typing) { clearInterval(dlg.typing); dlg.typing = null; $('d-text').textContent = dlg.full; return; }
  dlg.i++;
  if (dlg.i >= dlg.lines.length) { const d = dlg.done; dlg = null; d(); return; }
  const l = dlg.lines[dlg.i];
  setAvatar($('d-avatar'), l.who);
  $('d-who').textContent = (CHARS[l.who] || CHARS.erz).name;
  dlg.full = fill(l.text);
  let n = 0;
  $('d-text').textContent = '';
  dlg.typing = setInterval(() => {
    n += 2;
    $('d-text').textContent = dlg.full.slice(0, n);
    if (n >= dlg.full.length) { clearInterval(dlg.typing); dlg.typing = null; }
  }, 22);
  audio.beep(520, 0.06);
}
$('d-next').onclick = advance;
$('d-skip').onclick = () => { if (!dlg) return; clearInterval(dlg.typing); const d = dlg.done; dlg = null; d(); };

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
  g.setLineDash([6, 6]); g.strokeStyle = 'rgba(255,200,87,.7)'; g.lineWidth = 1.5;
  g.beginPath();
  [...pts, pts[0]].forEach((p, i) => { const [x, y] = P(p); i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.stroke(); g.setLineDash([]);
  g.font = '600 13px system-ui'; g.textAlign = 'center';
  for (const p of pts) {
    const [x, y] = P(p);
    g.fillStyle = p.home ? '#6dffb0' : '#ffc857'; g.strokeStyle = g.fillStyle;
    g.beginPath();
    if (p.home) g.rect(x - 6, y - 6, 12, 12); else { g.moveTo(x, y - 8); g.lineTo(x + 8, y); g.lineTo(x, y + 8); g.lineTo(x - 8, y); g.closePath(); }
    g.fill();
    g.beginPath(); g.arc(x, y, 15, 0, 6.283); g.stroke();
    g.fillStyle = '#e6f4ff';
    g.fillText(p.name.toUpperCase(), x, y - 22);
  }
}

function briefing() {
  const def = MISSIONS[save.mission];
  const kicker = `Mission ${save.mission + 1} / ${MISSIONS.length} · ${def.sector}`;
  runDialog(def.briefing, kicker, `Einsatzbesprechung: ${def.title}`, () => {
    $('b-kicker').textContent = kicker;
    $('b-title').textContent = def.title;
    $('b-obj').innerHTML = def.objectives.map((o) => `<li>${o}</li>`).join('');
    const s = SHIPS[def.ship];
    $('b-ship').textContent = `${s.name} – ${s.guns.length} Kanonen · ${s.missiles} Raketen · Schild ${s.shield} · Hülle ${s.hp}`;
    $('b-wing').textContent = def.wingman ? CHARS[def.wingman].name : 'Keiner';
    drawMap(def);
    show('s-brief');
  });
}

function launch() {
  audio.unlock();
  tryFullscreen();
  fadeDark(() => {
    clearComm();
    show(null);
    game.startMission(MISSIONS[save.mission]);
  });
}

let lastWin = false;
function debrief(win, reason, stats) {
  lastWin = win;
  const def = MISSIONS[save.mission];
  const oldRank = rankFor(save.kills);
  const acc = stats.shots ? Math.round(Math.min(1, stats.hits / stats.shots) * 100) : 0;
  $('r-kicker').textContent = `Nachbesprechung · ${def.title}`;
  $('r-title').textContent = win ? 'Mission erfolgreich' : 'Mission gescheitert';
  $('r-title').style.color = win ? '#6dffb0' : '#ff4d6d';
  const mm = Math.floor(stats.time / 60), ss = String(Math.floor(stats.time % 60)).padStart(2, '0');
  $('r-stats').innerHTML = `<div><b>${stats.kills}</b><span>Abschüsse</span></div><div><b>${acc}%</b><span>Trefferquote</span></div><div><b>${mm}:${ss}</b><span>Flugzeit</span></div><div><b>${stats.score}</b><span>Punkte</span></div>`;
  let extra = reason || '';
  if (win) {
    save.kills += stats.kills; save.score += stats.score;
    const nr = rankFor(save.kills);
    extra = `Gesamtabschüsse: ${save.kills} · Rang: ${nr}`;
    if (nr !== oldRank) extra += ` — BEFÖRDERUNG zum ${nr}!`;
    else if (stats.kills >= 8 && acc >= 30) extra += ' — Belobigung: Bronzener Falke für herausragende Leistung.';
    save.mission++;
    if (save.mission >= MISSIONS.length) { save.mission = MISSIONS.length - 1; save.done = true; save.finishedNow = true; }
    store(SAVE_KEY, save);
  }
  $('r-reason').textContent = extra;
  $('r-reason').className = win ? 'medal' : '';
  $('r-next').textContent = win ? 'Weiter' : 'Erneut versuchen';
  const after = () => show('s-debrief');
  if (win) runDialog(def.win, `Nachbesprechung · ${def.title}`, 'Zurück an Bord', after);
  else after();
}

$('r-next').onclick = () => {
  if (!lastWin) return briefingShort();
  if (save.finishedNow) {
    save.finishedNow = false; store(SAVE_KEY, save);
    return runDialog(ENDING, 'Epilog', 'Morgenröte', () => title());
  }
  briefing();
};
function briefingShort() {
  const def = MISSIONS[save.mission];
  $('b-kicker').textContent = `Mission ${save.mission + 1} / ${MISSIONS.length} · ${def.sector}`;
  $('b-title').textContent = def.title;
  $('b-obj').innerHTML = def.objectives.map((o) => `<li>${o}</li>`).join('');
  const s = SHIPS[def.ship];
  $('b-ship').textContent = `${s.name} – ${s.guns.length} Kanonen · ${s.missiles} Raketen · Schild ${s.shield} · Hülle ${s.hp}`;
  $('b-wing').textContent = def.wingman ? CHARS[def.wingman].name : 'Keiner';
  drawMap(def);
  show('s-brief');
}
$('r-menu').onclick = () => title();
$('b-back').onclick = () => title();
$('b-start').onclick = launch;

// ---------- title / menus ----------
function title() {
  $('m-continue').classList.toggle('hidden', !save.started);
  $('m-continue').textContent = save.done ? 'Letzte Mission erneut fliegen' : `Fortsetzen · Mission ${save.mission + 1}`;
  $('pilot-line').textContent = save.started ? `${rankFor(save.kills)} „${save.callsign}“ · ${save.kills} Abschüsse · ${save.score} Punkte` : '';
  show('s-title');
}
$('m-continue').onclick = () => { audio.unlock(); briefing(); };
$('m-new').onclick = () => { audio.unlock(); $('callsign').value = save.callsign; show('s-name'); };
$('m-help').onclick = () => { audio.unlock(); show('s-help'); };
$('m-settings').onclick = () => { audio.unlock(); show('s-settings'); };
document.querySelectorAll('[data-back]').forEach((b) => (b.onclick = () => title()));
$('name-ok').onclick = () => {
  const cs = $('callsign').value.trim().replace(/[<>{}]/g, '') || 'Nova';
  save = { started: true, mission: 0, kills: 0, score: 0, callsign: cs, done: false };
  store(SAVE_KEY, save);
  runDialog(INTRO, 'Prolog · 2643', 'Der Perseus-Graben', briefing);
};

function refreshSettings() {
  $('set-sound').textContent = `Ton: ${settings.sound ? 'An' : 'Aus'}`;
  $('set-invert').textContent = `Steuerung: ${settings.invert ? 'Flugzeug (runter = hoch)' : 'Direkt (hoch = hoch)'}`;
  $('set-quality').textContent = `Grafik: ${settings.quality === 'high' ? 'Hoch (Bloom)' : 'Leistung'}`;
  store(SET_KEY, settings);
}
$('set-sound').onclick = () => { settings.sound = !settings.sound; audio.setEnabled(settings.sound); refreshSettings(); };
$('set-invert').onclick = () => { settings.invert = !settings.invert; input.invert = settings.invert; refreshSettings(); };
$('set-quality').onclick = () => { settings.quality = settings.quality === 'high' ? 'low' : 'high'; game.setQuality(settings.quality); refreshSettings(); };
$('set-full').onclick = () => { if (document.fullscreenElement) document.exitFullscreen?.(); else tryFullscreen(true); };
refreshSettings();

function tryFullscreen(force) {
  const coarse = matchMedia('(pointer: coarse)').matches;
  if (!force && !coarse) return;
  const el = document.documentElement;
  const p = el.requestFullscreen?.({ navigationUI: 'hide' });
  p?.then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
}

// ---------- pause ----------
$('p-resume').onclick = () => { game.paused = false; show(null); };
$('p-restart').onclick = () => { game.stop(); launch(); };
$('p-quit').onclick = () => { game.stop(); clearComm(); fadeDark(() => { game.startAttract(); title(); }); };
document.addEventListener('visibilitychange', () => { if (document.hidden) ui.pause(); });
window.addEventListener('keydown', (e) => {
  if (current === 's-dialog' && (e.code === 'Space' || e.code === 'Enter')) { e.preventDefault(); advance(); }
  else if (current === 's-pause' && e.code === 'Escape') { input.take(); game.paused = false; show(null); }
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

title();
if (import.meta.env?.DEV || location.search.includes('debug')) window.__game = { game, save: () => save, input, MISSIONS };
