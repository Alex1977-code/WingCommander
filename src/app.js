import { Game, PILOT_COLORS } from './game.js';
import { InputHub } from './input.js';
import { Audio } from './audio.js';
import { SHIPS } from './ships.js';
import { warmHands } from './hand.js';
import { CHARS, MISSIONS, MISSION_BY_ID, INTRO, ENDINGS, CUTSCENES, ACTS, rankFor } from './campaign.js';
import { passes } from './cutscene.js';
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

const NEW_SAVE = () => ({ started: false, mission: 'm1', kills: 0, score: 0, callsign: 'Nova', done: false, flags: {}, aff: { rook: 0, kolibri: 0 }, scenes: {} });
let save = load(SAVE_KEY, NEW_SAVE());
if (typeof save.mission === 'number') save.mission = ['m1', 'm2', 'm4', 'm5', 'm12', 'm15'][save.mission] || 'm1';
if (!MISSION_BY_ID[save.mission]) save.mission = 'm1';
save.flags ||= {}; save.aff ||= { rook: 0, kolibri: 0 }; save.scenes ||= {};
const settings = load(SET_KEY, { sound: true, music: true, invert: false, sens: 1, view: 'cockpit', control: 'yoke', quality: 'high', coop: false, callsign2: 'Orion' });
// v2: touch players expect 'up = nose up', so the default changed; older saved settings are moved over once
if (settings.v !== 2) { settings.invert = false; settings.v = 2; try { localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch { /* ignore */ } }

const hub = new InputHub();
const audio = new Audio();
audio.enabled = settings.sound;
audio.musicOn = settings.music;

const fill = (t) => t.replaceAll('{cs}', () => save.callsign); // function: '$' in a callsign is not a replacement pattern
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
  if (sound) audio.ui('move');
}

let shownAt = 0, cineT1 = 0, cineT2 = 0;
const MENU_MOOD = { 's-title': 'menu', 's-name': 'menu', 's-help': 'menu', 's-settings': 'menu', 's-multi': 'menu', 's-brief': 'briefing' };

/** First mission: Rook explains the controls for the device in use. */
function tutorial() {
  const pad = hub.devices.some((d) => d.kind === 'gamepad'), touch = document.body.classList.contains('touch');
  const steer = pad ? 'Linker Stick' : touch ? 'Linke Bildschirmhälfte' : 'W, A, S, D oder Pfeiltasten';
  const fire = pad ? 'RT' : touch ? 'FEUER' : 'Leertaste';
  const msl = pad ? 'X' : touch ? 'LANZE' : 'M';
  const boost = pad ? 'LT' : touch ? 'BOOST' : 'Shift';
  const tips = [
    `Kurze Auffrischung, {cs}: ${steer} steuert. ${settings.invert ? 'Ziehen hebt die Nase, wie im Flugzeug.' : 'Nach oben drücken hebt die Nase.'}`,
    `${fire} feuert die Pulslaser. Zielst du auf den Kreis vor dem Gegner, wird dein Fadenkreuz grün und du triffst.`,
    `${msl} entlädt die Ionenlanze – halte das Ziel im Visier, bis die Zielerfassung aufschaltet, dann lenkt das Feld den Strahl ins Ziel. ${boost} zündet den Nachbrenner. Und wenn der Navpunkt weit weg ist: Autopilot.`,
  ];
  tips.forEach((t) => ui.comm('rook', t));
  save.tutorialDone = true; store(SAVE_KEY, save);
}
function show(id) {
  const prev = current;
  current = id;
  if (id !== prev) shownAt = performance.now();
  if (id !== null) { clearTimeout(cineT1); clearTimeout(cineT2); $('cine').classList.add('hidden'); }
  // a text field left focused on a screen that is now hidden would swallow every key press
  const ae = document.activeElement;
  if (ae instanceof HTMLInputElement && !(id && $(id)?.contains(ae))) ae.blur();
  for (const s of screens) s.classList.toggle('hidden', s.id !== id);
  $('cut').classList.toggle('hidden', id !== 'cut');
  $('flight').classList.toggle('hidden', !(id === null || id === 's-pause'));
  if (id && id !== prev) {
    const sc = $(id);
    const panel = sc.querySelector('.panel, .dialog') || sc;
    panel.classList.remove('holo-in'); void panel.offsetWidth; panel.classList.add('holo-in');
    if (!reduced) { const f = $('scanfx'); f.classList.remove('run'); void f.offsetWidth; f.classList.add('run'); }
    sc.querySelectorAll('header h2:not(.glitch), header > span:not(.rx), .panel h3').forEach((el, i) => {
      el._dec?.cancel();
      const txt = el.id ? el.textContent : (el.dataset.label ||= el.textContent);
      el._dec = decode(el, txt, { cps: 70, delay: 120 + i * 60 });
    });
    audio.ui('open');
    if (MENU_MOOD[id]) audio.mood(MENU_MOOD[id]);
    const list = visibleButtons();
    const primary = list.findIndex((b) => b.classList.contains('primary'));
    setFocus(id === 's-title' ? 0 : Math.max(0, primary), false);
  }
  syncPads();
}

function menuEvent(e) {
  if (!current || busy) return;
  // ignore confirm presses that were meant for the previous screen
  if ((e === 'ok' || e === 'start') && performance.now() - shownAt < 300) return;
  navMode = true;
  if (current === 'cut') {
    if (!['ok', 'back', 'start'].includes(e) || performance.now() - shownAt < 700) return;
    if (cutArmed) game.skipCutscene();
    else { cutArmed = true; $('cut-skip').classList.add('armed'); setTimeout(() => { cutArmed = false; $('cut-skip').classList.remove('armed'); }, 2500); }
    return;
  }
  if (current === 's-dialog' && !dlg?.choosing) {
    if (e === 'ok') advance();
    else if (e === 'back' || e === 'start') skipDialog();
    return;
  }
  const list = visibleButtons();
  if (e === 'up' || e === 'left') setFocus(focusIdx - 1);
  else if (e === 'down' || e === 'right') setFocus(focusIdx + 1);
  else if (e === 'ok') { const b = list[focusIdx]; if (b) { audio.ui('ok'); b.click(); } }
  else if (e === 'back' || e === 'start') {
    const sc = $(current);
    if (!sc) return; // the page became a phone controller
    if (current === 's-pause') return resume();
    if (current === 's-dialog') return;
    const back = sc.querySelector('[data-back]') || (current === 's-brief' ? $('b-back') : null);
    if (back && e === 'back') back.click();
    else if (e === 'start') list[focusIdx]?.click();
  }
}
document.addEventListener('pointermove', () => {
  if (navMode) { navMode = false; document.querySelectorAll('.btn.focus').forEach((b) => b.classList.remove('focus')); }
}, { passive: true });
// scramble a button's label once when the mouse enters it - not again while it moves around inside
// (pointerover also fires when crossing child elements, which kept restarting the effect)
document.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse') return;
  const b = e.target.closest?.('.btn');
  if (!b || b.classList.contains('choice')) return;
  if (e.relatedTarget && b.contains(e.relatedTarget)) return; // still inside the same button
  if (b._hoverT && performance.now() - b._hoverT < 900) return;   // quick in-and-out at the edge
  b._hoverT = performance.now();
  scramble(b);
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
  audio.radio();
  commT = setTimeout(nextComm, 2400 + c.text.length * 45);
}
function clearComm() { commQ.length = 0; clearTimeout(commT); commT = null; commFrozen = false; commHold = 0; commDec?.cancel(); commHolo.on = false; $('comm').classList.add('hidden'); }

// ---------- UI bridge used by the game ----------
const ui = {
  comm(who, text) {
    if (commQ.length < 6) commQ.push({ who, text });
    if (!commT) nextComm();
    const ch = CHARS[who] || CHARS.erz;
    for (const P of game.pilots) P.cockpit?.log(`${(ch.call || ch.short)}: ${fill(text)}`, ch.color, 1);
  },
  setAuto(on) { $('btn-auto').classList.toggle('on', on); },
  commActive() { return !!commT && !$('comm').classList.contains('hidden'); },
  viewChanged(P) { if (P.idx === 0) { settings.view = P.view; game.view = P.view; store(SET_KEY, settings); } audio.ui('ok'); },
  setThrottle(v) { $('throttle-fill').style.height = v * 100 + '%'; },
  fade(cb) {
    const f = $('fade');
    f.classList.remove('dark'); f.classList.add('on');
    setTimeout(() => { cb(); if (!busy) f.classList.remove('on'); }, 500); // a menu fade started meanwhile keeps it dark
  },
  pause() {
    if (game.mode !== 'flight' || game.ended) return;
    game.paused = true;
    audio.setEngine(0, false);
    if (commT) { clearTimeout(commT); commT = null; commFrozen = true; }
    show('s-pause');
  },
  missionEnd(win, reason, stats, cause) {
    clearComm();
    game.paused = false;
    hub.activeP2 = undefined;
    fadeDark(() => { game.startAttract(); document.body.classList.remove('coop'); onMissionEnd(win, reason, stats, cause); });
  },
  cutSub(who, text) {
    const ch = CHARS[who] || CHARS.erz;
    const el = $('cut-sub');
    el.style.setProperty('--ac', ch.color);
    el.classList.remove('hidden', 'show'); void el.offsetWidth; el.classList.add('show');
    setLabel(el.querySelector('b'), who === 'erz' ? '' : ch.name);
    cutSubDec?.cancel();
    const t = fill(text);
    cutSubDec = decode(el.querySelector('p'), t, { cps: 70, window: 5 });
    clearTimeout(cutSubT);
    cutSubT = setTimeout(() => el.classList.add('hidden'), 1800 + t.length * 55);
    audio.beep(700, 0.05);
  },
  cutTitle(kicker, title) {
    const el = $('cut-title');
    el.classList.remove('hidden', 'out'); void el.offsetWidth;
    decode(el.querySelector('small'), kicker, { cps: 50 });
    glitchTitle(el.querySelector('h1'), title, { cps: 20 });
    audio.tone?.('sawtooth', 70, 35, 1.6, 0.08);
    clearTimeout(cutTitleT);
    cutTitleT = setTimeout(() => el.classList.add('out'), 3600);
  },
  cutShot() { const f = $('scanfx'); f.classList.remove('run'); void f.offsetWidth; f.classList.add('run'); },
  cutEnd() {
    cutArmed = false; $('cut-skip').classList.remove('armed');
    cutSubDec?.cancel(); clearTimeout(cutSubT); clearTimeout(cutTitleT);
    $('cut-sub').classList.add('hidden'); $('cut-title').classList.add('hidden');
  },
  frame(dt) {
    if (game.mode === 'flight' && !game.paused && !game.ended && current === null) audio.mood(game.hostileCount() > 0 ? 'combat' : 'travel');
    hub.local.update(dt);
    hub.poll(dt);
    const ev = hub.takeMenu();
    if (!current) return;
    let confirmed = false;
    for (const e of ev) {
      if (e === 'ok' || e === 'start') { if (confirmed) continue; confirmed = true; }
      menuEvent(e);
    }
  },
};

let cutArmed = false, cutSubDec = null, cutSubT = 0, cutTitleT = 0, commFrozen = false;

/** Fade to black, run cb, fade back. Input is ignored while the screen is black. */
let busy = false, fadeGen = 0;
function fadeDark(cb) {
  const f = $('fade');
  busy = true;
  f.classList.add('dark', 'on');
  const gen = ++fadeGen;
  setTimeout(() => {
    busy = false;
    // never stay black if cb throws; a fade started inside cb (e.g. a cutscene) keeps the screen dark itself
    try { cb(); } finally { if (gen === fadeGen) f.classList.remove('on'); }
  }, 550);
}
// swallow clicks during transitions so nothing starts twice
// also a moment after a screen appears, so a quick double tap can't hit the next screen's button (e.g. start the mission unread)
document.addEventListener('click', (e) => { if (busy || (current && performance.now() - shownAt < 250)) { e.stopPropagation(); e.preventDefault(); } }, true);
// mouse-clicked buttons must not keep focus, or Enter/Space would trigger them a second time
document.addEventListener('pointerup', (e) => { const b = e.target.closest?.('button'); if (b) setTimeout(() => b.blur(), 0); });

// no WebGL (old device, blocked in the hosting frame): say so instead of leaving a black page
const game = (() => {
  try { return new Game($('view'), $('hud'), audio, ui); } catch (e) {
    document.body.innerHTML = '<div style="position:fixed;inset:0;display:grid;place-content:center;text-align:center;padding:24px;background:#05070d;color:#cfe8ff;font:600 16px system-ui,sans-serif">3D-Grafik (WebGL) ist auf diesem Gerät oder in diesem Fenster nicht verfügbar.<br>Bitte in einem aktuellen Browser öffnen.</div>';
    throw e;
  }
})();
setTimeout(warmHands, 1500); // sculpt the cockpit hands while the title screen idles
game.invert = settings.invert;
game.sens = settings.sens;
game.view = settings.view;
game.controlStyle = settings.control;
game.setQuality(settings.quality);
game.startAttract();

// ---------- dialog (with choices) ----------
const holo = new Hologram($('d-holo'));
const wave = new Waveform($('d-wave'));
let dlg = null, dlgGoto = null;
const lineVisible = (l) => passes(l, save.flags) && (!Array.isArray(l.aff) || (save.aff[l.aff[0]] || 0) >= l.aff[1]);

function runDialog(lines, kicker, title, done, mood = 'briefing') {
  audio.mood(mood);
  dlg = { lines: lines.filter(lineVisible), i: -1, done, dec: null, choosing: false, effects: [], answered: -1 };
  setLabel($('d-kicker'), kicker);
  $('d-choices').innerHTML = '';
  setDialogButtons(true);
  show('s-dialog');
  glitchTitle($('d-title'), title);
  holo.on = true; wave.on = true;
  advance();
}
function setDialogButtons(on) {
  $('d-next').classList.toggle('hidden', !on);
  $('d-skip').classList.toggle('hidden', !on);
}
function advance() {
  if (!dlg || dlg.choosing) return;
  if (dlg.dec?.running) {
    dlg.dec.finish();
    const cl = dlg.lines[dlg.i];
    if (cl?.choices && dlg.answered !== dlg.i) showChoices(cl);
    return;
  }
  if (dlg.lines[dlg.i]?.choices && dlg.answered !== dlg.i) { showChoices(dlg.lines[dlg.i]); return; }
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
  const dec = dlg.dec = decode($('d-text'), fill(l.text), { cps: 55, window: 6, cursor: true });
  dec.done.then(() => {
    holo.talk = 0; wave.level = 0.08;
    if (dlg && dlg.dec === dec && l.choices) showChoices(l);
  });
  audio.beep(520, 0.06);
}
function showChoices(l) {
  if (!dlg || dlg.choosing || dlg.answered === dlg.i) return;
  const options = l.choices.filter(lineVisible);
  if (!options.length) { dlg.answered = dlg.i; return; }
  dlg.choosing = true;
  setDialogButtons(false);
  const wrap = $('d-choices');
  wrap.innerHTML = '';
  options.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'btn choice';
    b.textContent = `${i + 1}  ${c.label}`;
    b.dataset.label = b.textContent;
    b.onclick = () => choose(c);
    wrap.appendChild(b);
    b.style.animationDelay = `${i * 90}ms`;
  });
  // ignore taps for a moment so a double tap on "Weiter" can't select an answer
  wrap.classList.add('arming');
  setTimeout(() => wrap.classList.remove('arming'), 400);
  // the same 400 ms for keyboard / gamepad: confirm presses are ignored until shownAt + 300 ms
  shownAt = performance.now() + 100;
  audio.tone?.('sine', 500, 900, 0.2, 0.06);
  setFocus(0, false);
}
function choose(c) {
  if (!dlg?.choosing) return;
  // effects are applied when the dialog closes, together with marking the scene as seen
  dlg.effects.push(c);
  dlg.answered = dlg.i;
  dlg.lines.splice(dlg.i + 1, 0, ...(c.reply || []).filter(lineVisible));
  $('d-choices').innerHTML = '';
  setDialogButtons(true);
  dlg.choosing = false;
  audio.beep(1100, 0.1);
  advance();
}
function closeDialog() {
  if (!dlg) return;
  dlg.dec?.cancel();
  const d = dlg.done, effects = dlg.effects; dlg = null;
  holo.on = false; wave.on = false;
  for (const c of effects) {
    for (const [k, v] of Object.entries(c.aff || {})) save.aff[k] = (save.aff[k] || 0) + v;
    Object.assign(save.flags, c.set || {});
    if (c.goto) dlgGoto = c.goto;
  }
  d();
}
function skipDialog() {
  if (!dlg || dlg.choosing) return;
  if (dlg.lines[dlg.i]?.choices && dlg.answered !== dlg.i) { dlg.dec?.finish(); showChoices(dlg.lines[dlg.i]); return; }
  const idx = dlg.lines.findIndex((l, i) => i > dlg.i && l.choices);
  if (idx === -1) return closeDialog();
  dlg.dec?.cancel();
  dlg.i = idx - 1;
  advance();
}
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

// ---------- campaign flow ----------
const cur = () => MISSION_BY_ID[save.mission] || MISSIONS[0];
const kickerFor = (def) => `${ACTS[def.act]} · Mission ${def.no} / ${MISSIONS.length} · ${def.sector}`;
function wingFor(def) {
  let w = def.wingman;
  if (w === 'kolibri' && (save.flags.kolibriLost || (save.flags.kolibriCaptured && !save.flags.kolibriSaved))) w = 'juno';
  if (w === 'rook' && save.flags.rookDead) w = 'juno';
  return w;
}

function playCut(id, done) {
  const def = CUTSCENES[id];
  if (!def) return done();
  cutArmed = false;
  clearComm();
  fadeDark(() => {
    show('cut');
    audio.mood(def.music || 'tension');
    game.startCutscene(def, save.flags, () => {
      fadeDark(() => { game.startAttract(); done(); });
    });
  });
}
$('cut-skip').onclick = () => game.skipCutscene();

/** Bord scene → cutscene → briefing for the current mission. */
function startMissionFlow() {
  const def = cur();
  const go = () => (def.preCut ? playCut(def.preCut, () => briefingFor(def)) : briefingFor(def));
  if (def.scene && !save.scenes[def.id]) {
    dlgGoto = null;
    runDialog(def.scene.lines, `Bordszene · ${ACTS[def.act]}`, def.scene.place, () => {
      save.scenes[def.id] = true;
      const g = dlgGoto; dlgGoto = null;
      if (g && g !== def.id && MISSION_BY_ID[g]) { save.mission = g; store(SAVE_KEY, save); return startMissionFlow(); }
      store(SAVE_KEY, save);
      go();
    });
  } else go();
}
function briefingFor(def) {
  runDialog(def.briefing, kickerFor(def), `Einsatzbesprechung: ${def.title}`, fillBriefing);
}

function fillBriefing() {
  const def = cur();
  setLabel($('b-kicker'), kickerFor(def));
  $('b-obj').innerHTML = def.objectives.map((o) => `<li>${o}</li>`).join('');
  const s = SHIPS[def.ship];
  $('b-ship').textContent = `${s.name} – ${s.guns.length} Pulslaser · ${s.missiles} Lanzenladungen · Schild ${s.shield} · Hülle ${s.hp}`;
  const w = wingFor(def);
  const wing = w ? CHARS[w].name : 'Keiner';
  $('b-wing').textContent = coopActive() ? `${settings.callsign2} (Spieler 2) und ${wing}` : wing;
  show('s-brief');
  glitchTitle($('b-title'), def.title);
  drawMap(def);
}

function cinematic(def) {
  const el = $('cine');
  el.classList.remove('hidden', 'out');
  ['cine-title'].forEach((id) => { const n = $(id); n.style.animation = 'none'; void n.offsetWidth; n.style.animation = ''; });
  el.querySelectorAll('.cine-line').forEach((n) => { n.style.animation = 'none'; void n.offsetWidth; n.style.animation = ''; });
  decode($('cine-kicker'), `MISSION ${String(def.no).padStart(2, '0')} // ${def.sector.toUpperCase()}`, { cps: 60 });
  glitchTitle($('cine-title'), def.title.toUpperCase(), { cps: 22 });
  decode($('cine-sub'), def.objectives[0], { cps: 50, delay: 700 });
  audio.tone?.('sawtooth', 80, 40, 1.4, 0.08);
  commHold = performance.now() + 3700;
  clearTimeout(cineT1); clearTimeout(cineT2);
  cineT1 = setTimeout(() => el.classList.add('out'), 3300);
  cineT2 = setTimeout(() => el.classList.add('hidden'), 3900);
}

function launch() {
  audio.unlock();
  tryFullscreen();
  const coop = coopActive();
  fadeDark(() => {
    clearComm();
    show(null);
    document.body.classList.toggle('coop', coop);
    commHold = performance.now() + 3700;
    const ctrls = hub.assign(coop);
    const def = cur();
    const w = wingFor(def);
    const wingSkill = Math.min(0.92, 0.7 + 0.06 * (save.aff[w] || 0));
    game.startMission(def, ctrls, [save.callsign, settings.callsign2 || 'Orion'], { flags: save.flags, wingman: w, wingSkill, launch: true });
    cinematic(def);
    audio.mood('travel');
    if (def.id === 'm1' && !save.tutorialDone) tutorial();
    syncPads();
  });
}

let lastResult = 'lose';
function onMissionEnd(win, reason, stats, cause) {
  const def = cur();
  const oldRank = rankFor(save.kills);
  if (win) {
    Object.assign(save.flags, def.set || {});
    save.kills += stats.kills; save.score += stats.score;
    if (def.next) save.mission = def.next; else { save.done = true; save.finished = true; }
    store(SAVE_KEY, save);
    const after = () => runDialog(def.win, `Nachbesprechung · ${def.title}`, 'Zurück an Bord', () => debrief('win', reason, stats, def, oldRank), def.id === 'm9' ? 'sad' : 'victory');
    if (def.postCut) playCut(def.postCut, after); else after();
  } else if (def.lose && cause === 'objective') {
    Object.assign(save.flags, def.lose.set || {});
    save.kills += stats.kills; save.score += stats.score;
    save.mission = def.lose.next;
    store(SAVE_KEY, save);
    runDialog(def.lose.lines, `Nachbesprechung · ${def.title}`, def.lose.title, () => debrief('branch', reason, stats, def, oldRank), 'sad');
  } else {
    debrief('lose', reason, stats, def, oldRank);
  }
}

function debrief(result, reason, stats, def, oldRank) {
  lastResult = result;
  const acc = stats.shots ? Math.round(Math.min(1, stats.hits / stats.shots) * 100) : 0;
  setLabel($('r-kicker'), `Nachbesprechung · ${def.title}`);
  $('r-title').style.color = result === 'win' ? 'var(--ok)' : result === 'branch' ? 'var(--warn)' : 'var(--foe)';
  const mm = Math.floor(stats.time / 60), ss = String(Math.floor(stats.time % 60)).padStart(2, '0');
  $('r-stats').innerHTML = `<div><b id="st-k">0</b><span>Abschüsse</span></div><div><b id="st-a">0%</b><span>Trefferquote</span></div><div><b>${mm}:${ss}</b><span>Flugzeit</span></div><div><b id="st-s">0</b><span>Punkte</span></div>`;
  let extra = reason || '';
  if (result !== 'lose') {
    const nr = rankFor(save.kills);
    extra = `${result === 'branch' ? `${reason || ''} Die Geschichte geht weiter. · ` : ''}Gesamtabschüsse: ${save.kills} · Rang: ${nr}`;
    if (nr !== oldRank) extra += ` · BEFÖRDERUNG zum ${nr}!`;
    else if (stats.kills >= 8 && acc >= 30) extra += ' · Belobigung: Bronzener Falke.';
  }
  if (stats.per.length > 1) extra += `  ·  ${save.callsign}: ${stats.per[0]} · ${settings.callsign2}: ${stats.per[1]} Abschüsse`;
  $('r-reason').textContent = extra;
  $('r-reason').className = result === 'win' ? 'medal' : '';
  setLabel($('r-next'), result === 'lose' ? 'Erneut versuchen' : 'Weiter');
  show('s-debrief');
  audio.mood(result === 'win' ? 'victory' : result === 'branch' ? 'sad' : 'briefing');
  glitchTitle($('r-title'), result === 'win' ? 'Mission erfolgreich' : result === 'branch' ? 'Mission verloren' : 'Mission gescheitert');
  countUp($('st-k'), stats.kills); countUp($('st-a'), acc, '%'); countUp($('st-s'), stats.score, '', 1300);
}

function playEnding() {
  save.finished = false; store(SAVE_KEY, save);
  const bitter = !!save.flags.kolibriLost;
  runDialog(bitter ? ENDINGS.bitter : ENDINGS.good, 'Epilog', bitter ? 'Asche und Sterne' : 'Morgenröte', () => title(), bitter ? 'sad' : 'victory');
}

$('r-next').onclick = () => {
  if (lastResult === 'lose') return fillBriefing();
  if (save.finished) return playEnding();
  startMissionFlow();
};
$('r-menu').onclick = () => title();
$('b-back').onclick = () => title();
$('b-start').onclick = launch;

// ---------- title / menus ----------
function title() {
  $('m-continue').classList.toggle('hidden', !save.started);
  const def = cur();
  setLabel($('m-continue'), save.finished ? 'Epilog ansehen' : save.done ? 'Finale erneut fliegen' : `Fortsetzen · ${def.no}. ${def.title}`);
  show('s-title');
  const line = save.started ? `${rankFor(save.kills)} „${save.callsign}“ · ${ACTS[def.act]} · ${save.kills} Abschüsse` : '';
  decode($('pilot-line'), line, { cps: 80, delay: 400 });
  decode($('logo-kicker'), 'GESCHWADER NACHTFALKEN', { cps: 40 });
  decode($('logo-title'), 'STERNENFRONT', { cps: 18, window: 4 });
  decode($('logo-sub'), 'Der Perseus-Krieg', { cps: 30, delay: 600 });
  document.querySelectorAll('#s-title .menu .btn').forEach((b, i) => {
    b.dataset.label ||= b.textContent;
    if (!b.classList.contains('hidden')) { b._scr?.cancel(); b._lockW = false; b.style.width = b.style.height = ''; b._scr = decode(b, b.dataset.label, { cps: 50, delay: 300 + i * 90, pad: true }); }
  });
}
$('m-continue').onclick = () => { audio.unlock(); if (save.finished) playEnding(); else startMissionFlow(); };
$('m-new').onclick = () => { audio.unlock(); $('callsign').value = save.callsign; show('s-name'); };
$('m-help').onclick = () => { audio.unlock(); show('s-help'); };
$('m-settings').onclick = () => { audio.unlock(); show('s-settings'); };
$('m-multi').onclick = () => { audio.unlock(); openMulti(); };
document.querySelectorAll('[data-back]').forEach((b) => (b.onclick = () => { store(SET_KEY, settings); title(); }));
$('callsign').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('name-ok').click(); });
$('name-ok').onclick = () => {
  $('callsign').blur(); // a focused hidden input would swallow the keys that advance the prolog
  const cs = $('callsign').value.trim().replace(/[<>{}]/g, '') || 'Nova';
  save = { ...NEW_SAVE(), started: true, callsign: cs };
  store(SAVE_KEY, save);
  playCut('prolog', () => runDialog(INTRO, 'Prolog · 2643', 'An Bord der Aurora', startMissionFlow));
};

function refreshSettings() {
  setLabel($('set-music'), `Musik: ${settings.music ? 'An' : 'Aus'}`);
  setLabel($('set-control'), `Steuer im Cockpit: ${settings.control === 'stick' ? 'Steuerknüppel' : 'Steuerjoch'}`);
  setLabel($('set-sens'), `Empfindlichkeit: ${settings.sens < 1 ? 'Niedrig' : settings.sens > 1 ? 'Hoch' : 'Normal'}`);
  setLabel($('set-sound'), `Ton: ${settings.sound ? 'An' : 'Aus'}`);
  setLabel($('set-invert'), `Steuerung: ${settings.invert ? 'Flugzeug (runter = hoch)' : 'Direkt (hoch = hoch)'}`);
  setLabel($('set-quality'), `Grafik: ${settings.quality === 'high' ? 'Hoch (Bloom)' : 'Leistung'}`);
  store(SET_KEY, settings);
}
$('set-music').onclick = () => { settings.music = !settings.music; audio.setMusic(settings.music); refreshSettings(); };
$('set-control').onclick = () => { settings.control = settings.control === 'stick' ? 'yoke' : 'stick'; game.controlStyle = settings.control; for (const P of game.pilots) P.cockpit?.setStyle(settings.control); refreshSettings(); };
$('set-sens').onclick = () => { settings.sens = settings.sens < 1 ? 1 : settings.sens === 1 ? 1.25 : 0.8; game.sens = settings.sens; refreshSettings(); };
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
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function renderSlots() {
  const coop = coopActive();
  const devs = hub.devices;
  const rows = [];
  const p1 = ['Touch / Tastatur', ...devs.filter((d) => hub.roleOf(d, coop) === 1).map((d) => d.name)];
  rows.push(`<li><b style="color:${PILOT_COLORS[0]}">P1</b><span>${p1.map(esc).join(' + ')}</span></li>`);
  if (settings.coop) {
    const p2 = devs.find((d) => hub.roleOf(d, coop) === 2);
    rows.push(p2 ? `<li><b style="color:${PILOT_COLORS[1]}">P2</b><span>${esc(p2.name)}</span></li>` : '<li class="empty"><b>P2</b><span>Wartet auf Controller: Gamepad-Taste drücken oder Handy verbinden</span></li>');
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
      if (s === 'open' && lobby) { st.textContent = 'Bereit: Handys können sich jetzt verbinden.'; st.className = 'small ok'; }
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
  if (game.mode !== 'flight' || game.ended) return;
  game.paused = false;
  game.pilots.forEach((P) => { P.ctrl.take(); });
  show(null);
  if (commFrozen) { commFrozen = false; clearTimeout(commT); commT = setTimeout(nextComm, 1200); }
}
$('p-resume').onclick = resume;
$('p-restart').onclick = () => { if (game.ended) return; game.stop(); launch(); };
$('p-quit').onclick = () => { if (game.ended) return; hub.activeP2 = undefined; game.stop(); clearComm(); document.body.classList.remove('coop'); fadeDark(() => { game.startAttract(); title(); }); };
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { ui.pause(); audio.ctx?.suspend().catch(() => {}); } else audio.ctx?.resume().catch(() => {});
});
document.addEventListener('contextmenu', (e) => e.preventDefault());
// turning a phone to portrait covers the game with a hint, so pause the flight
matchMedia('(orientation: portrait) and (max-width: 700px)').addEventListener?.('change', (e) => { if (e.matches) ui.pause(); });

title();
if (import.meta.env?.DEV || query.has('debug')) window.__game = { game, save: () => save, hub, MISSIONS, CUTSCENES, settings, show, launch, startMissionFlow, playCut, setSave: (s) => { save = s; } };
