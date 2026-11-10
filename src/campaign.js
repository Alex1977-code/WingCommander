/**
 * Campaign "Sternenfront – Der Perseus-Krieg". Original story, three acts, 15 missions.
 * {cs} = player's callsign. Lines may carry conditions: if / ifNot (flag names), aff: ['kolibri', 2].
 * Lines with `choices` pause the dialog for a decision. Choices may set flags, change affinity,
 * insert reply lines and redirect the campaign (goto).
 */

export const CHARS = {
  brandt: { name: 'Kapitänin Ilse Brandt', short: 'IB', color: '#5fb8ff' },
  rook: { name: 'Major Tobias „Rook“ Adeyemi', short: 'RK', color: '#7be0a4', call: 'Rook' },
  kolibri: { name: 'Leutnant Mika „Kolibri“ Sandoval', short: 'KO', color: '#ffc857', call: 'Kolibri' },
  juno: { name: 'Leutnant Ada „Juno“ Kerimov', short: 'JU', color: '#c79bff', call: 'Juno' },
  holt: { name: 'Commander Kasimir Holt', short: 'KH', color: '#d0d6e0' },
  veyl: { name: 'Archon Veyl', short: 'AV', color: '#ff4d8d' },
  flug: { name: 'Flugleitung Aurora', short: 'FL', color: '#9fb4c8' },
  samariter: { name: 'Lazarettschiff Samariter', short: 'SA', color: '#c9f0ff' },
  erz: { name: 'Erzähler', short: '✦', color: '#8892a6' },
};

export const RANKS = [
  [0, 'Fähnrich'], [6, 'Leutnant'], [16, 'Oberleutnant'], [30, 'Hauptmann'], [50, 'Major'], [75, 'Oberst'],
];
export function rankFor(kills) {
  let r = RANKS[0][1];
  for (const [k, n] of RANKS) if (kills >= k) r = n;
  return r;
}

export const ACTS = { I: 'Akt I · Funkenflug', II: 'Akt II · Schatten', III: 'Akt III · Morgenröte' };

const A = (x, y, z) => [x, y, z];
const SKY = {
  keth: { a: '#2456ff', b: '#9a3cff', seed: 1.3, planet: ['#27475f', '#d1a877'] },
  korridor: { a: '#1f8a7a', b: '#2f55d6', seed: 4.1, planet: ['#3c2d4f', '#e09a6c'], planetDir: [0.7, 0.1, 0.6] },
  nebel: { a: '#2a9d8f', b: '#3a0ca3', seed: 9.4, planet: ['#13293d', '#7fb3d5'], planetDir: [-0.4, 0.4, 0.8] },
  tessa: { a: '#c4571d', b: '#7a1fb8', seed: 7.7, planet: ['#5a2d1c', '#e8c08a'], planetDir: [-0.3, 0.2, 0.9] },
  alarm: { a: '#b01e3c', b: '#3b2bd6', seed: 11.2, planet: ['#1d3a3a', '#8fd0c0'], planetDir: [0.2, -0.5, 0.8] },
  brut: { a: '#6b1f5a', b: '#d1495b', seed: 13.3, planet: ['#2b1b2f', '#c06c84'], planetDir: [0.6, -0.2, 0.7] },
  grab: { a: '#36454f', b: '#5c4d7d', seed: 17.1, planet: ['#1b1b24', '#6c6f7f'], planetDir: [-0.6, 0.1, 0.7] },
  sturm: { a: '#8a2be2', b: '#ff6f3c', seed: 19.6, planet: ['#2e1a47', '#ff9e7a'], planetDir: [0.5, 0.3, 0.8] },
  asche: { a: '#4a4e69', b: '#9a8c98', seed: 23.8, planet: ['#22223b', '#c9ada7'], planetDir: [0.1, -0.3, 1] },
  mahlstrom: { a: '#ff7b00', b: '#5f0f40', seed: 27.2, planet: ['#3d0c02', '#f5a65b'], planetDir: [-0.2, 0.5, 0.8] },
  orun: { a: '#1e6fd6', b: '#19c2a0', seed: 15.9, planet: ['#2b2f55', '#b9c4ff'], planetDir: [-0.7, 0.3, 0.5] },
  kern: { a: '#d6342b', b: '#f0a020', seed: 21.4, planet: ['#401818', '#ffb070'], planetDir: [0.1, 0.1, 1] },
};

// ---------------------------------------------------------------------------
// Prologue + endings
// ---------------------------------------------------------------------------

export const INTRO = [
  { who: 'brandt', text: 'Willkommen an Bord der Aurora, Fähnrich. Rufzeichen „{cs}“, richtig? Beste Simulatorwerte Ihres Jahrgangs.' },
  { who: 'brandt', text: 'Simulatoren schießen nicht zurück. Hier draußen schon. Major Adeyemi nimmt Sie unter seine Fittiche.' },
  { who: 'holt', text: 'Commander Holt, Erster Offizier. Halten Sie sich an die Vorschriften, Fähnrich, dann kommen wir gut miteinander aus.' },
  { who: 'rook', text: 'Rook. So nennt man mich hier. Bleib an meinem Flügel, {cs}, schieß nur auf das, was du triffst, und bring den Vogel heil zurück.' },
];

export const ENDINGS = {
  good: [
    { who: 'erz', text: 'Mit dem Fall der Apotheose zerbrach das Netz der Aszendenz. Ihre Schiffe verstummten, eines nach dem anderen.' },
    { who: 'kolibri', text: 'Weißt du, was Rook gesagt hätte? „Schieß nur auf das, was du triffst.“ Und du hast verdammt gut getroffen.' },
    { who: 'kolibri', text: 'Ich hab sein altes Rufzeichen auf meinen Vogel gemalt. Er fliegt jetzt mit uns. Immer.', aff: ['kolibri', 2] },
    { who: 'brandt', text: 'Die Aurora kehrt heim. Gezeichnet, aber ungebrochen. Im Namen der Union: Danke, {cs}.' },
    { who: 'erz', text: 'Man sagt, über Keth IV ging an diesem Tag die Sonne zum ersten Mal seit einem Jahr wieder auf. Ende – „Morgenröte“.' },
  ],
  bitter: [
    { who: 'erz', text: 'Mit dem Fall der Apotheose zerbrach das Netz der Aszendenz. Der Perseus-Graben war frei. Der Preis war hoch.' },
    { who: 'juno', text: 'Ich habe Kolibri nie gekannt. Aber die ganze Staffel trägt jetzt ihr Abzeichen. Und Rooks.' },
    { who: 'brandt', text: 'Ich habe einen Befehl gegeben, den ich für richtig hielt. Ich werde jede Nacht darüber nachdenken, ob er es war.', ifNot: 'defied' },
    { who: 'brandt', text: 'Ich habe Ihnen eine Stunde gegeben. Es war nicht genug. Das werde ich mir nie verzeihen.', if: 'defied' },
    { who: 'erz', text: 'Auf dem Hangardeck der Aurora hängen seitdem zwei leere Pilotenhelme. Niemand nimmt sie ab. Ende – „Asche und Sterne“.' },
  ],
};

// ---------------------------------------------------------------------------
// Cutscenes (played by the 3D engine). Camera: rel = cast id (local coordinates), look = cast id / point / 'sun'.
// ---------------------------------------------------------------------------

export const CUTSCENES = {
  prolog: {
    music: 'menu',
    sky: SKY.keth,
    cast: [
      { id: 'aurora', type: 'aurora', pos: A(0, 0, 0), speed: 12 },
      { id: 'f1', type: 'sperber', pos: A(70, -12, 100), speed: 12 },
      { id: 'f2', type: 'sperber', pos: A(-70, -12, 90), speed: 12 },
      { id: 'f3', type: 'sperber', pos: A(76, -16, 60), speed: 12 },
    ],
    shots: [
      { dur: 7, cam: { from: A(-760, 210, 1050), to: A(-470, 130, 640), look: 'aurora', lookOff: A(0, 0, -40) },
        ev: [{ t: 0.3, sub: 'erz', text: 'Im Jahr 2643 hat die Terranische Union den Perseus-Graben besiedelt – vierzig Welten am äußersten Rand des bekannten Raums.' }] },
      { dur: 6, cam: { rel: 'aurora', from: A(95, 40, 260), to: A(95, 28, -140), look: 'aurora', lookOff: A(0, 0, -60) },
        ev: [{ t: 0.2, sub: 'erz', text: 'Dann kehrten die Verlorenen zurück: Nachfahren der ersten Kolonieschiffe, verschmolzen mit ihren Maschinen. Sie nennen sich die Aszendenz.' }] },
      { dur: 5, cam: { rel: 'f1', from: A(16, 5, 30), to: A(10, 4, -32), look: 'f1' },
        ev: [{ t: 0.1, sub: 'erz', text: 'Drei Welten sind verstummt. Zwischen der Aszendenz und dem Rest des Grabens steht nur ein Träger: die TUS Aurora.' },
          { t: 0.6, a: 'speed', id: 'f1', v: 300 }, { t: 0.9, a: 'speed', id: 'f2', v: 300 }, { t: 1.2, a: 'speed', id: 'f3', v: 300 }] },
      { dur: 5, cam: { from: A(20, 40, 380), look: 'f1' },
        ev: [{ t: 0.4, title: 'STERNENFRONT', kicker: 'DER PERSEUS-KRIEG' }] },
    ],
  },

  samariter: {
    music: 'victory',
    sky: SKY.korridor,
    cast: [
      { id: 'sam', type: 'transport', pos: A(0, 0, 0), dir: A(0.3, 0, 1), speed: 38 },
      { id: 'p', type: 'sperber', pos: A(60, 12, -60), dir: A(0.3, 0, 1), speed: 38 },
      { id: 'k', type: 'sperber', pos: A(88, 2, -84), dir: A(0.3, 0, 1), speed: 38 },
    ],
    shots: [
      { dur: 5, cam: { rel: 'sam', from: A(-130, 34, 70), to: A(-105, 22, -50), look: 'sam' },
        ev: [{ t: 0.3, sub: 'samariter', text: 'Sprungantrieb geladen. Zweitausend Menschen an Bord, und jeder einzelne kennt Ihre Namen. Danke, Nachtfalken.' }] },
      { dur: 4, cam: { rel: 'sam', from: A(30, 70, -280), look: 'sam' },
        ev: [{ t: 1.2, a: 'jumpout', id: 'sam' }, { t: 1.6, sub: 'kolibri', text: 'Und weg sind sie. Weißt du was, {cs}? Dafür lohnt sich das alles.' }] },
      { dur: 2.5, cam: { rel: 'p', from: A(-12, 5, 30), look: 'p' }, ev: [] },
    ],
  },

  veyl: {
    music: 'tension',
    sky: SKY.tessa,
    rocks: { at: A(0, 0, 200), n: 40, spread: 900 },
    cast: [
      { id: 'v', type: 'archon', pos: A(0, 0, 0), speed: 0 },
      { id: 'k1', type: 'klinge', pos: A(-34, 6, -44), speed: 0 },
      { id: 'k2', type: 'klinge', pos: A(34, -6, -44), speed: 0 },
    ],
    shots: [
      { dur: 5, cam: { from: A(220, 60, 620), to: A(130, 30, 340), look: 'v' },
        ev: [{ t: 0.2, title: 'FEINDLICHE ÜBERTRAGUNG ABGEFANGEN', kicker: 'TESSA-SYSTEM' }, { t: 1.6, a: 'speed', id: 'v', v: 90 }, { t: 1.8, a: 'speed', id: 'k1', v: 90 }, { t: 1.8, a: 'speed', id: 'k2', v: 90 }] },
      { dur: 5, cam: { rel: 'v', from: A(7, 3, 19), to: A(4.5, 2, 13), look: 'v', lookOff: A(0, 1, 2) },
        ev: [{ t: 0.2, sub: 'veyl', text: 'Tobias Adeyemi. Zehn Jahre, und du fliegst immer noch hinter anderen her.' }] },
      { dur: 4, cam: { rel: 'v', from: A(-40, 12, -70), look: 'v', lookOff: A(0, 0, 200) },
        ev: [{ t: 0.3, a: 'speed', id: 'v', v: 280 }, { t: 0.4, a: 'speed', id: 'k1', v: 280 }, { t: 0.4, a: 'speed', id: 'k2', v: 280 },
          { t: 0.6, sub: 'veyl', text: 'Komm in das Feld, Tobias. Bring deine Küken mit.' }] },
    ],
  },

  ambush: {
    music: 'tension',
    sky: SKY.alarm,
    cast: [
      { id: 'aurora', type: 'aurora', pos: A(0, 0, 0), speed: 0 },
      { id: 'z', type: 'zerstoerer', pos: A(-480, 160, 900), dir: A(0.45, -0.1, -0.88), hidden: true, name: 'Psalm' },
      { id: 'h1', type: 'hammer', pos: A(-520, 120, 1300), dir: A(0.62, -0.05, -0.78), hidden: true, speed: 120 },
      { id: 'h2', type: 'hammer', pos: A(-470, 150, 1340), dir: A(0.62, -0.05, -0.78), hidden: true, speed: 120 },
      { id: 'h3', type: 'hammer', pos: A(-560, 90, 1380), dir: A(0.62, -0.05, -0.78), hidden: true, speed: 120 },
      { id: 'd1', type: 'dorn', pos: A(-420, 180, 1200), dir: A(0.62, -0.05, -0.78), hidden: true, speed: 140 },
    ],
    shots: [
      { dur: 4.5, cam: { from: A(-60, 110, 420), to: A(-90, 120, 470), look: A(-600, 150, 1200) },
        ev: [{ t: 0.3, sub: 'flug', text: 'Sprungsignaturen! Mehrere! Direkt vor dem Bug!' },
          { t: 0.9, a: 'jumpin', id: 'z' }, { t: 1.4, a: 'jumpin', id: 'h1' }, { t: 1.6, a: 'jumpin', id: 'h2' }, { t: 1.8, a: 'jumpin', id: 'h3' }, { t: 2.0, a: 'jumpin', id: 'd1' }] },
      { dur: 4, cam: { rel: 'h1', from: A(14, 6, -32), to: A(10, 4, -24), look: 'h1', lookOff: A(0, 0, 60) },
        ev: [{ t: 0.3, sub: 'brandt', text: 'Wir sind auf einer gesicherten Route gesprungen. Sie dürften gar nicht wissen, wo wir sind!' }] },
      { dur: 4, cam: { from: A(-260, 90, 520), look: 'aurora' },
        ev: [{ t: 0.1, a: 'fire', id: 'z', at: 'aurora', dur: 4 }, { t: 0.5, sub: 'flug', text: 'ALARMSTART! ALARMSTART! Alle Piloten zu den Maschinen!' }] },
    ],
  },

  station: {
    music: 'victory',
    sky: SKY.brut,
    cast: [
      { id: 's', type: 'station', pos: A(0, 0, 0), speed: 0 },
      { id: 'p', type: 'greif', pos: A(-60, 80, -700), dir: A(0.1, 0, 1), speed: 230 },
      { id: 'w', type: 'greif', pos: A(-90, 70, -730), dir: A(0.1, 0, 1), speed: 230 },
    ],
    shots: [
      { dur: 5.5, cam: { from: A(700, 180, -700), to: A(560, 140, -420), look: 's' },
        ev: [{ t: 0.3, a: 'boom', id: 's' }, { t: 3.4, sub: 'brandt', text: 'Treffer bestätigt! Die Brutstätte ist vernichtet!' }] },
      { dur: 4, cam: { rel: 'p', from: A(9, 4, 42), to: A(7, 3, 30), look: 'p' },
        ev: [{ t: 0.3, sub: 'rook', text: 'Das war für Keth IV. Und für jeden, den sie da drin „aufsteigen“ lassen wollten.' }] },
      { dur: 2.5, cam: { rel: 'p', from: A(-30, 10, -60), look: 'p', lookOff: A(0, 0, 300) }, ev: [] },
    ],
  },

  valkyrie: {
    music: 'sad',
    sky: SKY.grab,
    rocks: { at: A(0, 0, 0), n: 24, spread: 900 },
    cast: [
      { id: 'wr', type: 'valkyrie', pos: A(0, 0, 0), dir: A(0.25, -0.12, 1), speed: 0 },
      { id: 'p', type: 'falke', pos: A(-230, 60, -620), dir: A(0.3, -0.05, 1), speed: 90 },
    ],
    shots: [
      { dur: 7, cam: { rel: 'wr', from: A(-130, 55, 270), to: A(-115, 40, -160), look: 'wr', lookOff: A(0, 0, -40) },
        ev: [{ t: 0.3, sub: 'rook', text: 'Die TUS Valkyrie. Mein altes Schiff. Dreihundert Mann Besatzung.' },
          { t: 3.6, sub: 'rook', text: 'Wir haben nie erfahren, was in der letzten Stunde passiert ist. Ich war schon weg. Ich bin… davongeflogen.' }] },
      { dur: 4.5, cam: { from: A(-380, 80, -720), look: 'wr' },
        ev: [{ t: 0.3, sub: 'brandt', text: 'Die Flugschreiber senden noch. Holen Sie sie, bevor die Aszendenz es tut.' }] },
    ],
  },

  sacrifice: {
    music: 'sad',
    sky: SKY.sturm,
    cast: [
      { id: 'aurora', type: 'aurora', pos: A(0, 0, 0), speed: 0 },
      { id: 'z', type: 'zerstoerer', pos: A(700, 100, 1400), dir: A(-0.45, -0.05, -0.89), speed: 0, name: 'Litanei' },
      { id: 'r', type: 'greif', pos: A(-1300, -160, -2160), dir: A(0.489, 0.0636, 0.870), speed: 345 },
      { id: 'k', type: 'greif', pos: A(320, -60, 620), dir: A(0.2, 0, 1), speed: 40 },
      { id: 'v', type: 'archon', pos: A(0, 0, 0), hidden: true },
    ],
    shots: [
      { dur: 4, cam: { rel: 'aurora', from: A(-160, 70, 260), look: 'z' },
        ev: [{ t: 0.1, a: 'fire', id: 'z', at: 'aurora', dur: 8 }, { t: 0.3, sub: 'brandt', text: 'Die Litanei lädt ihr Hauptgeschütz! Wenn sie feuert, verlieren wir den Sprungantrieb!' }] },
      { dur: 4, cam: { rel: 'r', from: A(-10, 4, -30), look: 'r', lookOff: A(0, 0, 60) },
        ev: [{ t: 0.2, sub: 'rook', text: 'Kolibri, {cs}: Ihr bringt die Aurora nach Hause. Verstanden?' }, { t: 2.3, sub: 'kolibri', text: 'Rook? Rook, dreh ab! Das ist ein Befehl von—' }] },
      { dur: 3.5, cam: { rel: 'r', from: A(12, 3, 22), look: 'r', lookOff: A(0, 1, 0) },
        ev: [{ t: 0.2, sub: 'rook', text: 'Aric… Ich lasse dich nicht noch einmal zurück.' }] },
      { dur: 4.5, cam: { from: A(-220, 130, 620), look: 'z' },
        ev: [{ t: 0.1, a: 'boom', id: 'r' }, { t: 0.2, a: 'boom', id: 'z' }, { t: 2.9, a: 'shake', v: 1.5 }, { t: 3.2, sub: 'kolibri', text: 'NEIN! ROOK!' }] },
      { dur: 5, cam: { rel: 'k', from: A(-22, 9, 46), to: A(-26, 10, 56), look: 'k', lookOff: A(0, 0, -120) },
        ev: [{ t: 0.6, a: 'jumpin', id: 'v', rel: 'k', off: A(40, 14, -320), face: 'k' }, { t: 0.9, a: 'fire', id: 'v', at: 'k', dur: 1.4 },
          { t: 2.4, a: 'capture', id: 'k' }, { t: 2.6, sub: 'veyl', text: 'Trauer ist so menschlich. Die Kleine nehme ich mit. Sie wird lernen, aufzusteigen.' }, { t: 4.2, a: 'jumpout', id: 'v' }] },
      { dur: 4, cam: { from: A(260, 150, 900), look: 'aurora' },
        ev: [{ t: 0.3, sub: 'brandt', text: 'Kolibris Signal ist weg… Alle Maschinen an Bord. Sprung. Jetzt.' }, { t: 2.2, a: 'jumpout', id: 'aurora' }] },
    ],
  },

  rescue: {
    music: 'victory',
    sky: SKY.mahlstrom,
    cast: [
      { id: 'pr', type: 'prison', pos: A(0, 0, 0), speed: 22 },
      { id: 'k', type: 'falke', pos: A(0, -4, 40), speed: 22, hidden: true },
      { id: 'p', type: 'falke', pos: A(46, 12, 30), speed: 22 },
    ],
    shots: [
      { dur: 5, cam: { rel: 'pr', from: A(-90, 34, 50), look: 'pr' },
        ev: [{ t: 0.3, sub: 'kolibri', text: '{cs}? Bist du das? Ich dachte, ich höre nie wieder eine menschliche Stimme.' }] },
      { dur: 5, cam: { rel: 'pr', from: A(40, 24, 170), look: 'k' },
        ev: [{ t: 0.4, a: 'show', id: 'k' }, { t: 0.5, a: 'speed', id: 'k', v: 240 }, { t: 1.0, a: 'speed', id: 'p', v: 240 },
          { t: 0.8, sub: 'kolibri', text: 'Sie wollten mich „vollenden“. Noch ein Tag, und ich hätte ja gesagt. Bring mich nach Hause.' }] },
      { dur: 6, cam: { rel: 'k', from: A(-20, 8, -40), look: 'k', lookOff: A(0, 0, 80) },
        ev: [{ t: 0.3, sub: 'brandt', text: 'Ich sollte Sie beide vors Kriegsgericht stellen. Willkommen zurück, Leutnant Sandoval.' }] },
    ],
  },

  gate: {
    music: 'briefing',
    sky: SKY.orun,
    cast: [
      { id: 'g', type: 'gate', pos: A(0, 0, 0), speed: 0 },
      { id: 'aurora', type: 'aurora', pos: A(0, -40, -1700), speed: 160 },
      { id: 't1', type: 'transport', pos: A(-220, 70, -1950), speed: 160 },
      { id: 't2', type: 'transport', pos: A(230, -30, -2050), speed: 160 },
      { id: 'p', type: 'greif', pos: A(80, 30, -1500), speed: 160 },
    ],
    shots: [
      { dur: 5, cam: { from: A(560, 160, 420), to: A(440, 120, 220), look: 'g' },
        ev: [{ t: 0.3, sub: 'brandt', text: 'An alle Schiffe: Kurs auf das Tor. Was dahinter liegt, hat noch kein Mensch gesehen – und überlebt.' }] },
      { dur: 5.3, cam: { rel: 'aurora', from: A(-90, 50, -230), look: 'aurora', lookOff: A(0, 0, 320) },
        ev: [{ t: 4.9, a: 'jumpout', id: 'aurora' }] },
      { dur: 6.5, cam: { from: A(0, 30, 700), look: 'g' },
        ev: [{ t: 1.9, a: 'jumpout', id: 't1' }, { t: 2.5, a: 'jumpout', id: 't2' }, { t: 0.5, a: 'jumpout', id: 'p' },
          { t: 0.5, sub: 'erz', text: 'Die Flotte der Union passierte das Tor von Orun. Auf der anderen Seite wartete das Herz der Aszendenz.' }] },
    ],
  },

  apotheose: {
    music: 'tension',
    sky: SKY.kern,
    cast: [
      { id: 'd', type: 'dreadnought', pos: A(0, 0, 0), speed: 9 },
      { id: 'e1', type: 'klinge', pos: A(120, 40, 320), speed: 60 },
      { id: 'e2', type: 'klinge', pos: A(150, 30, 290), speed: 60 },
    ],
    shots: [
      { dur: 7, cam: { rel: 'd', from: A(270, 95, 430), to: A(250, 80, -270), look: 'd', lookOff: A(0, 0, -60) },
        ev: [{ t: 0.3, sub: 'veyl', text: 'Kleiner Falke. Du hast Tobias zu mir geschickt. Er ist gestorben, wie er gelebt hat: zu spät.' },
          { t: 3.8, sub: 'veyl', text: 'Und die Kleine hast du mir gestohlen. Ich werde sie zurückholen.', ifNot: 'kolibriLost' },
          { t: 3.8, sub: 'veyl', text: 'Die Kleine singt jetzt mit uns. Hörst du sie nicht?', if: 'kolibriLost' }] },
      { dur: 5, cam: { from: A(-1000, -220, 1500), look: 'd' },
        ev: [{ t: 0.3, sub: 'veyl', text: 'Komm zur Apotheose. Beenden wir, was bei Tessa Prime begonnen hat.' }] },
    ],
  },

  finale: {
    music: 'victory',
    sky: SKY.kern,
    cast: [
      { id: 'd', type: 'dreadnought', pos: A(0, 0, 0), speed: 9 },
      { id: 'p', type: 'greif', pos: A(-260, 90, 650), dir: A(-0.3, 0.1, 1), speed: 250 },
      { id: 'k', type: 'greif', pos: A(-292, 80, 630), dir: A(-0.3, 0.1, 1), speed: 250, ifNot: 'kolibriLost' },
      { id: 'j', type: 'greif', pos: A(-292, 80, 630), dir: A(-0.3, 0.1, 1), speed: 250, if: 'kolibriLost' },
      { id: 'aurora', type: 'aurora', pos: A(-1500, 40, 3400), dir: A(0.35, 0, -1), speed: 30 },
    ],
    shots: [
      { dur: 5.5, cam: { from: A(700, 220, -1000), look: 'd' },
        ev: [{ t: 0.2, a: 'boom', id: 'd' }, { t: 2.9, a: 'shake', v: 1.2 }, { t: 3.4, sub: 'brandt', text: 'Die Apotheose bricht auseinander! Ihr Netz fällt – überall im Graben!' }] },
      { dur: 5, cam: { rel: 'p', from: A(10, 5, 42), to: A(8, 4, 28), look: 'p' },
        ev: [{ t: 0.3, sub: 'kolibri', text: 'Wir haben es geschafft, {cs}. Wir haben es wirklich geschafft.', ifNot: 'kolibriLost' },
          { t: 0.3, sub: 'juno', text: 'Es ist vorbei, {cs}. Hörst du? Es ist vorbei.', if: 'kolibriLost' }] },
      { dur: 6, cam: { rel: 'aurora', from: A(-80, 60, 300), look: 'sun' },
        ev: [{ t: 0.6, title: 'MORGENRÖTE', kicker: 'DER PERSEUS-GRABEN IST FREI' }] },
    ],
  },
};

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------

export const MISSIONS = [
  // ============================== AKT I ==============================
  {
    id: 'm1', act: 'I', title: 'Feuertaufe', sector: 'Keth-System · Äußerer Gürtel', ship: 'sperber', wingman: 'rook', sky: SKY.keth,
    briefing: [
      { who: 'brandt', text: 'Routinepatrouille. Unsere Langstreckensensoren melden Geisterkontakte an zwei Navigationspunkten im äußeren Gürtel.' },
      { who: 'brandt', text: 'Vermutlich Aufklärungsdrohnen der Aszendenz, Typ „Dorn“. Finden, identifizieren, vernichten.' },
      { who: 'rook', text: 'Dein erster scharfer Einsatz, {cs}. Dorns jagen im Rudel. Lass dich nicht in die Zange nehmen.' },
    ],
    objectives: ['Nav 1 und Nav 2 von Feindkontakten säubern', 'Zur TUS Aurora zurückkehren'],
    navs: [
      { name: 'Nav 1', pos: A(1500, 300, 7000), waves: [[['dorn', 2]]],
        onArrive: [{ who: 'rook', text: 'Kontakte auf zwölf Uhr! Zwei Dorns. Die gehören dir, {cs}.' }],
        onClear: [{ who: 'rook', text: 'Sauber. Nicht schlecht für einen Frischling. Weiter zu Nav 2.' }] },
      { name: 'Nav 2', pos: A(-4500, -400, 12500), waves: [[['dorn', 3]], [['dorn', 2]]],
        onArrive: [{ who: 'rook', text: 'Das ist kein Aufklärer mehr, das ist ein Spähtrupp. Feuer frei!' }],
        onClear: [{ who: 'rook', text: 'Gürtel ist sauber. Ab nach Hause, die erste Runde geht auf mich.' }] },
    ],
    win: [
      { who: 'brandt', text: 'Solide Arbeit, {cs}. Die Drohnen haben vor ihrer Zerstörung gesendet. Die Aszendenz weiß jetzt, wo wir sind.' },
      { who: 'rook', text: 'Dann wissen sie auch, dass wir zurückbeißen.' },
    ],
    next: 'a1',
  },
  {
    id: 'a1', act: 'I', title: 'Notruf von Halden-7', sector: 'Keth-System · Bergbaukolonie Halden-7', ship: 'sperber', wingman: 'rook',
    sky: { a: '#2b6cb0', b: '#6b2fb3', seed: 3.3, planet: ['#3a3226', '#b89068'], planetDir: [0.5, -0.2, 0.8] },
    briefing: [
      { who: 'flug', text: 'Notruf von der Bergbaukolonie Halden-7: Die Station ist von Dorns zerschossen worden. Vier Rettungskapseln treiben im Asteroidengürtel.' },
      { who: 'brandt', text: 'Die Lebenserhaltung der Kapseln reicht noch vier Minuten. Fliegen Sie dicht an jede Kapsel heran, Ihr Traktorstrahl übernimmt den Rest.' },
      { who: 'rook', text: 'Retten geht vor Kämpfen, {cs}. Ich halte dir die Dorns vom Leib. Du sammelst.' },
    ],
    objectives: ['Vier Rettungskapseln bergen, bevor die Luft ausgeht', 'Die Angreifer abwehren', 'Zur TUS Aurora zurückkehren'],
    navs: [
      { name: 'Halden-7', pos: A(-3000, 300, 8000), type: 'pickup', pickups: 4, pickupLabel: 'RETTUNGSKAPSEL', limit: 240, limitFail: 'Die Lebenserhaltung der Kapseln ist erloschen.',
        objective: 'Berge die Rettungskapseln', asteroids: 22, waves: [[['dorn', 3]], [['dorn', 2], ['klinge', 1]]],
        onArrive: [{ who: 'rook', text: 'Kapseln auf dem Schirm! Grüne Markierungen. Los, {cs}, die Uhr läuft.' }],
        onWave: [null, { who: 'rook', text: 'Eine Klinge! Die ist schneller als die Dorns. Lass dich nicht von den Kapseln weglocken.' }],
        onClear: [{ who: 'flug', text: 'Alle Kapseln an Bord. Vierzehn Überlebende. Gute Arbeit, Nachtfalken.' }] },
    ],
    win: [
      { who: 'brandt', text: 'Vierzehn Bergleute gerettet. Einer von ihnen sagt, die Dorns hätten die Station erst gescannt und dann angegriffen.' },
      { who: 'rook', text: 'Sie suchen etwas. Oder jemanden. Mir gefällt das nicht, {cs}.' },
    ],
    next: 'm2',
  },
  {
    id: 'm2', act: 'I', title: 'Der Samariter', sector: 'Keth-System · Sprungkorridor', ship: 'sperber', wingman: 'kolibri', sky: SKY.korridor,
    postCut: 'samariter',
    briefing: [
      { who: 'brandt', text: 'Das Lazarettschiff „Samariter“ evakuiert zweitausend Kolonisten von Keth IV. Langsam, unbewaffnet, unersetzlich.' },
      { who: 'brandt', text: 'Rechnen Sie mit Jägern vom Typ „Klinge“ und Bombern der „Hammer“-Klasse. Die Bomber haben Vorrang.' },
      { who: 'kolibri', text: 'Kolibri hier, heute bin ich dein Flügel. Versuch mitzuhalten – und zähl wenigstens meine Abschüsse mit.' },
    ],
    objectives: ['Die Samariter beschützen', 'Alle Angriffswellen abwehren', 'Zur TUS Aurora zurückkehren'],
    protect: 'transport',
    navs: [
      { name: 'Samariter', pos: A(2000, 0, 8000), anchor: true, objective: 'Beschütze die Samariter',
        waves: [[['dorn', 3]], [['klinge', 2], ['dorn', 2]], [['hammer', 2], ['dorn', 2]]],
        onArrive: [{ who: 'samariter', text: 'Nachtfalken, hier Samariter. Kontakte auf dem Schirm. Bitte beeilen Sie sich!' }],
        onWave: [null, { who: 'kolibri', text: 'Klingen im Anflug! Schneller als die Dorns – bleib in Bewegung!' }, { who: 'kolibri', text: 'Bomber! Wenn die ihre Torpedos loswerden, war es das für die Samariter!' }],
        onClear: [{ who: 'samariter', text: 'Sprungantrieb geladen. Wir sind gleich weg!' }] },
    ],
    win: [
      { who: 'kolibri', text: 'Okay, ich geb’s zu: Du kannst fliegen. Erzähl das bloß nicht Rook.' },
      { who: 'brandt', text: 'Die Samariter ist in Sicherheit. Unsere Abhörstation hat einen Namen aufgefangen: Archon Veyl. Der Schlächter von Tessa Prime.' },
    ],
    lose: {
      next: 'm3', set: { samariterLost: true }, title: 'Die Samariter ist verloren',
      lines: [
        { who: 'kolibri', text: 'Zweitausend Menschen… Ich hab die Rettungskapseln gezählt, {cs}. Es waren elf.' },
        { who: 'brandt', text: 'Wir trauern, wenn der Krieg vorbei ist. Jetzt brauche ich Sie bei klarem Verstand.' },
        { who: 'brandt', text: 'Unsere Abhörstation hat den Namen des Angreifers aufgefangen: Archon Veyl. Der Schlächter von Tessa Prime.' },
      ],
    },
    next: 'm3',
  },
  {
    id: 'm3', act: 'I', title: 'Stille Signale', sector: 'Keth-Nebel', ship: 'falke', wingman: 'kolibri', sky: SKY.nebel,
    scene: { place: 'Messe der Aurora', lines: [
      { who: 'erz', text: 'Nach dem Einsatz. In der Messe riecht es nach verbranntem Kaffee und Maschinenöl.' },
      { who: 'kolibri', text: 'Wir haben die Samariter da rausgeholt. Rook, du schuldest mir einen Drink.', ifNot: 'samariterLost' },
      { who: 'kolibri', text: 'Ich krieg die Bilder nicht aus dem Kopf. Elf Kapseln, Rook. Elf.', if: 'samariterLost' },
      { who: 'rook', text: 'Ich schulde dir eine ganze Menge. Was ist mit dir, {cs}? Du bist so still.' },
      { who: 'rook', text: 'Wie geht es dir nach den ersten Einsätzen?', choices: [
        { label: 'Ich will besser werden. Bring mir alles bei.', aff: { rook: 1 }, reply: [{ who: 'rook', text: 'Das wollte ich hören. Morgen, sechs Uhr, Simulator. Und dann noch mal draußen.' }] },
        { label: 'Ehrlich gesagt: Ich hatte Angst.', aff: { rook: 1, kolibri: 1 }, reply: [{ who: 'kolibri', text: 'Wer keine Angst hat, lügt oder ist tot. Willkommen im Club.' }] },
        { label: 'Kolibri, wetten, dass ich nächstes Mal mehr Abschüsse habe?', aff: { kolibri: 1 }, reply: [{ who: 'kolibri', text: 'Oh, die Wette gilt. Der Verlierer putzt eine Woche lang den Vogel des Gewinners.' }] },
      ] },
    ] },
    briefing: [
      { who: 'brandt', text: 'Im Keth-Nebel wurden Signale aufgefangen, die wie Flottenverkehr der Aszendenz aussehen. Wir brauchen Gewissheit.' },
      { who: 'brandt', text: 'Sie fliegen ab heute den Falken. Scannen Sie drei Punkte im Nebel. Bleiben Sie in Scanreichweite, bis die Daten vollständig sind.' },
      { who: 'holt', text: 'Das ist eine Aufklärungsmission, Fähnrich. Keine Heldentaten. Daten holen, zurückkommen.' },
    ],
    objectives: ['Drei Scanpunkte im Nebel aufklären', 'Zur TUS Aurora zurückkehren'],
    navs: [
      { name: 'Scan Alpha', pos: A(-2500, 400, 6500), type: 'scan', scan: 10, objective: 'Scanne Alpha', waves: [[['dorn', 2]]],
        onArrive: [{ who: 'kolibri', text: 'Scanner läuft. Bleib nah am Punkt, {cs}, ich halte dir die Dorns vom Hals.' }],
        onClear: [{ who: 'kolibri', text: 'Daten von Alpha sind drin. Weiter.' }] },
      { name: 'Scan Beta', pos: A(1500, -300, 11500), type: 'scan', scan: 12, objective: 'Scanne Beta', waves: [[['klinge', 2]], [['dorn', 2]]],
        onClear: [{ who: 'kolibri', text: 'Beta erledigt. Was zur Hölle… Die benutzen unsere Flottencodes, {cs}.' }] },
      { name: 'Scan Gamma', pos: A(5500, 200, 16000), type: 'scan', scan: 12, objective: 'Scanne Gamma', waves: [[['dorn', 3]], [['klinge', 2]]],
        onClear: [{ who: 'kolibri', text: 'Alles drin. Und ein Signal, das von einer Union-Frequenz kommt. Das gefällt mir gar nicht.' }] },
    ],
    win: [
      { who: 'brandt', text: 'Die Aszendenz sammelt eine Flotte. Und sie kennt unsere Codes. Das bleibt vorerst unter uns.' },
      { who: 'holt', text: 'Vermutlich erbeutete Daten der Valkyrie. Kein Grund zur Panik, Kapitänin.' },
    ],
    next: 'a2',
  },
  {
    id: 'a2', act: 'I', title: 'Treibstoff', sector: 'Keth-Nebel · Depot Arne', ship: 'falke', wingman: 'kolibri',
    sky: { a: '#1d7f8c', b: '#30289c', seed: 10.6, planet: ['#16303a', '#6cb0c0'], planetDir: [-0.5, 0.3, 0.8] },
    briefing: [
      { who: 'brandt', text: 'Die Aurora hat bei der Evakuierung mehr Treibstoff verbraucht als geplant. Zwei Tanker warten am Depot Arne.' },
      { who: 'brandt', text: 'Die Aszendenz hat die Route vermint. Eskortieren Sie die Tanker zur Aurora. Mindestens einer muss durchkommen.' },
      { who: 'kolibri', text: 'Minen jagen alles, was nach Union riecht, auch die Tanker. Schieß sie ab, bevor sie andocken. Rote Kreuze auf dem Schirm.' },
    ],
    objectives: ['Am Depot Arne zu den Tankern stoßen', 'Die Tanker zur Aurora eskortieren (mindestens einer)', 'Minen abschießen, bevor sie die Tanker erreichen'],
    noReturn: true,
    navs: [
      { name: 'Depot Arne', pos: A(2600, 0, 9000), type: 'convoy', convoy: { types: ['tanker', 'tanker'], speed: 75 }, objective: 'Eskortiere die Tanker',
        failText: 'Beide Tanker wurden zerstört.',
        mines: { at: A(1300, -20, 4600), n: 28, spread: 900 },
        waves: [[['dorn', 3]], [['hammer', 2], ['dorn', 1]], [['klinge', 2]], [['hammer', 2], ['dorn', 2]]],
        onArrive: [{ who: 'kolibri', text: 'Tanker in Sicht, sie legen ab. Ab jetzt sind wir ihr Schutzengel, {cs}.' }],
        onWave: [null, { who: 'kolibri', text: 'Bomber auf die Tanker! Die zuerst!' }, { who: 'flug', text: 'Die Aurora hat den Konvoi auf dem Schirm. Noch ein Stück!' }],
        onClear: [{ who: 'flug', text: 'Tanker angedockt. Wir haben wieder Treibstoff. Danke, Nachtfalken.' }] },
    ],
    win: [
      { who: 'kolibri', text: 'Wer hätte gedacht, dass Tanker so nervenaufreibend sein können. Ich brauch jetzt einen Kaffee. Einen großen.' },
      { who: 'holt', text: 'Die Minen lagen genau auf unserer geplanten Route. Zufall, vermutlich.' },
    ],
    next: 'm4',
  },
  {
    id: 'm4', act: 'I', title: 'Im Trümmerfeld', sector: 'Tessa-System · Zerbrochener Mond', ship: 'falke', wingman: 'rook', sky: SKY.tessa,
    preCut: 'veyl',
    briefing: [
      { who: 'brandt', text: 'Wir haben die Übertragung entschlüsselt. Veyl wartet im Trümmerfeld des zerbrochenen Mondes von Tessa. Mit einem Depot.' },
      { who: 'rook', text: 'Er kennt meinen Namen. Meinen echten Namen, {cs}. Den kennt niemand mehr, der noch lebt.' },
      { who: 'rook', text: 'Im Feld sind die Felsen gefährlicher als der Feind. Augen auf. Und unterschätz ihn nicht.' },
    ],
    objectives: ['Nav 1 im Trümmerfeld säubern', 'Veyls Staffel bei Nav 2 vertreiben', 'Zur TUS Aurora zurückkehren'],
    navs: [
      { name: 'Nav 1', pos: A(-2500, 200, 7500), asteroids: 46, waves: [[['dorn', 4]], [['klinge', 2]]],
        onArrive: [{ who: 'rook', text: 'Sie kommen aus dem Schatten der Felsen. Bleib dicht, aber nicht zu dicht!' }],
        onClear: [{ who: 'rook', text: 'Vorposten erledigt. Das Depot liegt tiefer im Feld.' }] },
      { name: 'Nav 2', pos: A(3500, -300, 14000), asteroids: 54, waves: [[['klinge', 3]], [['archon', 1], ['klinge', 2]]],
        onWave: [null, { who: 'veyl', text: 'Tobias. Du hast einen neuen Flügelmann. Ob du ihn auch zurücklässt?' }],
        onClear: [{ who: 'rook', text: 'Er ist gesprungen. Aber du hast ihn bluten lassen, {cs}. Das hat vor dir noch keiner geschafft.' }] },
    ],
    win: [
      { who: 'rook', text: '„Ob du ihn auch zurücklässt.“ Er weiß von der Valkyrie. Er weiß Dinge, die er nicht wissen kann.' },
      { who: 'brandt', text: 'Veyls Staffel ist zerschlagen. Die Aszendenz wird das nicht hinnehmen. Erhöhte Bereitschaft.' },
    ],
    next: 'm5',
  },
  {
    id: 'm5', act: 'I', title: 'Alarmstart', sector: 'Tessa-System · Position der Aurora', ship: 'falke', wingman: 'kolibri', sky: SKY.alarm,
    preCut: 'ambush',
    briefing: [
      { who: 'brandt', text: 'Drei Bomberwellen im Anflug auf die Aurora. Unsere Geschütze halten die Jäger auf Abstand, aber nicht die Torpedos.' },
      { who: 'kolibri', text: 'Wenn die Aurora fällt, haben wir kein Zuhause mehr. Bomber zuerst, {cs}. Alles andere ist Dekoration.' },
    ],
    objectives: ['Die TUS Aurora verteidigen', 'Alle Bomberwellen vernichten'],
    protect: 'carrier', noReturn: true,
    navs: [
      { name: 'Aurora', pos: A(0, 0, 900), anchor: true, objective: 'Verteidige die TUS Aurora',
        waves: [[['dorn', 4]], [['hammer', 3], ['klinge', 2]], [['hammer', 4], ['klinge', 2]]],
        onArrive: [{ who: 'flug', text: 'Erste Welle in Waffenreichweite. Nachtfalken, die Aurora zählt auf euch!' }],
        onWave: [null, { who: 'flug', text: 'Bomber auf Angriffskurs! Abfangen, abfangen!' }, { who: 'brandt', text: 'Letzte Welle. Halten Sie durch!' }],
        onClear: [{ who: 'brandt', text: 'Radar ist frei. Gut gemacht, Nachtfalken.' }] },
    ],
    win: [
      { who: 'brandt', text: 'Die Aurora steht noch. Aber sie haben uns auf einer gesicherten Route gefunden. Jemand hat sie hergeführt.' },
      { who: 'kolibri', text: 'Ein Verräter? Auf unserem Schiff?' },
    ],
    next: 'm6',
  },
  {
    id: 'm6', act: 'I', title: 'Hammerschlag', sector: 'Brutstätte Keth', ship: 'greif', wingman: 'rook', sky: SKY.brut,
    postCut: 'station',
    scene: { place: 'Brücke der Aurora', lines: [
      { who: 'brandt', text: 'Fähnrich. Sie haben die Signale im Nebel als Erster gesehen. Ich will Ihre ehrliche Einschätzung.' },
      { who: 'holt', text: 'Bei allem Respekt, Kapitänin: Ein Fähnrich ist kein Nachrichtenoffizier.' },
      { who: 'brandt', text: 'Ich habe nicht Sie gefragt, Commander. {cs}?', choices: [
        { label: 'Jemand an Bord sendet. Die Kommunikationslogs sollten geprüft werden.', set: { reportedLeak: true }, reply: [
          { who: 'holt', text: '…Selbstverständlich. Ich kümmere mich persönlich darum.' },
          { who: 'brandt', text: 'Nein, Commander. Darum kümmere ich mich. Danke, {cs}.' }] },
        { label: 'Ich glaube, die Codes stammen aus dem Wrack der Valkyrie.', reply: [
          { who: 'holt', text: 'Genau das sage ich die ganze Zeit. Kluger Pilot.' },
          { who: 'brandt', text: 'Hm. Vielleicht. Wir werden sehen.' }] },
      ] },
    ] },
    briefing: [
      { who: 'brandt', text: 'Zeit zurückzuschlagen. Die „Brutstätte“ ist eine Station, in der die Aszendenz Gefangene… umwandelt.' },
      { who: 'brandt', text: 'Sie fliegen den schweren Jagdbomber Greif. Zehn Raketen. Brechen Sie den Abwehrring, dann zerstören Sie den Kern der Station.' },
      { who: 'rook', text: 'Stationen weichen nicht aus, aber sie schießen zurück. Anflug, Salve, abdrehen – und wieder von vorn.' },
    ],
    objectives: ['Den Abwehrring bei Nav 1 durchbrechen', 'Die Brutstätte zerstören', 'Zur TUS Aurora zurückkehren'],
    navs: [
      { name: 'Abwehrring', pos: A(2500, -200, 7000), waves: [[['klinge', 2], ['dorn', 3]]],
        onArrive: [{ who: 'rook', text: 'Der Ring. Mach kurzen Prozess, die Station hört mit.' }],
        onClear: [{ who: 'rook', text: 'Durch. Jetzt der große Brocken.' }] },
      { name: 'Brutstätte', pos: A(-1500, 300, 14000), objective: 'Zerstöre die Brutstätte', waves: [[['station', 1], ['dorn', 4]], [['hammer', 2], ['klinge', 2]]],
        onArrive: [{ who: 'rook', text: 'Da ist sie. Alle Raketen auf den Kern, {cs}!' }],
        onClear: [{ who: 'rook', text: 'Sie brennt! Raus hier!' }] },
    ],
    win: [
      { who: 'brandt', text: 'Die Brutstätte ist Geschichte. Damit endet die Zeit, in der wir nur reagiert haben.' },
      { who: 'rook', text: 'Kapitänin… Ich bitte um Erlaubnis, das Wrack der Valkyrie anzufliegen. Ich muss wissen, was damals passiert ist.' },
    ],
    next: 'm7',
  },

  // ============================== AKT II ==============================
  {
    id: 'm7', act: 'II', title: 'Grabstätte', sector: 'Tessa Prime · Wrackfeld', ship: 'falke', wingman: 'rook', sky: SKY.grab,
    preCut: 'valkyrie',
    briefing: [
      { who: 'brandt', text: 'Das Wrack der TUS Valkyrie treibt seit zehn Jahren im Orbit von Tessa Prime. Vier Flugschreiber senden noch.' },
      { who: 'brandt', text: 'Bergen Sie alle vier. Fliegen Sie dicht an die Signalbojen heran. Plünderer der Aszendenz sind vor Ort.' },
      { who: 'rook', text: 'Danke, dass du mitkommst, {cs}. Allein hätte ich das nicht gekonnt.' },
    ],
    objectives: ['Vier Flugschreiber der Valkyrie bergen', 'Plünderer vertreiben', 'Zur TUS Aurora zurückkehren'],
    navs: [
      { name: 'Wrack Valkyrie', pos: A(1500, 200, 8000), type: 'pickup', pickups: 4, objective: 'Berge die Flugschreiber', asteroids: 26, wreck: true,
        waves: [[['dorn', 3]], [['klinge', 2], ['dorn', 2]], [['klinge', 3]]],
        onArrive: [{ who: 'rook', text: 'Vier Signale. Ich decke dich, du sammelst. Grüne Markierungen.' }],
        onClear: [{ who: 'rook', text: 'Alle vier. Spiel die letzte Aufzeichnung ab, {cs}. Ich… ich muss sie hören.' }] },
    ],
    win: [
      { who: 'erz', text: 'Aufzeichnung Flugschreiber 4. Stimme: Leutnant Aric Lennart, Staffel Valkyrie.' },
      { who: 'erz', text: '„Tobias ist durchgebrochen. Gut. Ich halte sie auf, solange ich kann. Sie entern uns… sie sagen, es tut nicht weh…“' },
      { who: 'rook', text: 'Aric Lennart. Mein Flügelmann. Er hat mir den Rücken freigehalten, und ich bin nicht umgekehrt.' },
      { who: 'rook', text: 'Veyl ist Aric, {cs}. Sie haben ihn genommen und daraus… das gemacht.' },
      { who: 'brandt', text: 'Und noch etwas: In den Daten steckt ein Sendeprotokoll. Jemand auf der Aurora funkt der Aszendenz unsere Position.' },
    ],
    next: 'b1',
  },
  {
    id: 'b1', act: 'II', title: 'Keth IV', sector: 'Keth IV · Orbitalhabitat', ship: 'greif', wingman: 'rook',
    sky: { a: '#2f6fd0', b: '#28a28e', seed: 6.2, planet: ['#2f4a2c', '#9cc48a'], planetDir: [0.1, -0.4, 0.9] },
    protect: 'habitat',
    briefing: [
      { who: 'brandt', text: 'Eine Angriffsflotte der Aszendenz hält auf Keth IV zu. Im Orbitalhabitat leben vierzigtausend Menschen, die sich geweigert haben zu gehen.' },
      { who: 'brandt', text: 'Das Habitat hat eigene Geschütze, aber gegen Bomber ist es wehrlos. Halten Sie sie auf.' },
      { who: 'rook', text: 'Wenn Aric bei ihnen ist… nein. Heute nicht. Heute fliege ich für die vierzigtausend da drin.' },
    ],
    objectives: ['Das Habitat Keth IV verteidigen', 'Alle Angriffswellen vernichten', 'Zur TUS Aurora zurückkehren'],
    navs: [
      { name: 'Habitat Keth IV', pos: A(1500, 200, 8500), anchor: true, objective: 'Verteidige das Habitat',
        waves: [[['dorn', 4]], [['hammer', 3], ['klinge', 1]], [['hammer', 3], ['klinge', 2]], [['archon', 1], ['hammer', 2], ['dorn', 2]]],
        onArrive: [{ who: 'flug', text: 'Erste Welle im Anflug auf das Habitat. Alle Maschinen: Abfangen!' }],
        onWave: [null, { who: 'rook', text: 'Bomber! Wenn die das Habitat treffen, gibt es dort kein Entkommen.' }, { who: 'flug', text: 'Hüllenbruch im Ring drei! Sie dürfen nicht noch einmal treffen!' },
          { who: 'veyl', text: 'Tobias. Vierzigtausend Seelen, die aufsteigen könnten. Und du stehst ihnen im Weg.' }],
        onClear: [{ who: 'flug', text: 'Das Habitat hält! Die Kolonisten jubeln über alle Frequenzen!' }] },
    ],
    win: [
      { who: 'brandt', text: 'Keth IV steht. Aber die Funkaufklärung zeigt: Der Angriff wurde von einer Union-Frequenz aus koordiniert. Von der Aurora.' },
      { who: 'rook', text: 'Dann ist der Verräter einer von uns. Jemand, mit dem wir jeden Tag essen.' },
    ],
    next: 'm8',
  },
  {
    id: 'm8', act: 'II', title: 'Der Verräter', sector: 'Tessa-System · Sprungpunkt Ost', ship: 'falke', wingman: 'kolibri', sky: SKY.asche,
    scene: { place: 'Hangardeck', lines: [
      { who: 'erz', text: 'Nachtschicht. Rook sitzt auf der Tragfläche seines Greifs und starrt in die Dunkelheit hinter dem Hangarschild.' },
      { who: 'rook', text: 'Zehn Jahre habe ich gedacht, er ist tot. Und jetzt wünschte ich, er wäre es.' },
      { who: 'rook', text: 'Was würdest du tun, {cs}? Wenn er dein Freund gewesen wäre?', choices: [
        { label: 'Es war nicht deine Schuld. Du hättest ihn nicht retten können.', aff: { rook: 1 }, reply: [{ who: 'rook', text: 'Vielleicht. Aber ich werde nie erfahren, ob ich es hätte versuchen sollen.' }] },
        { label: 'Wenn noch etwas von Aric übrig ist, holen wir ihn zurück.', aff: { rook: 2 }, set: { hopeAric: true }, reply: [{ who: 'rook', text: 'Du bist ein Idiot, {cs}. Ein guter Idiot. Danke.' }] },
        { label: 'Er ist der Feind. Wir erledigen ihn.', reply: [{ who: 'rook', text: 'Ja. Vermutlich hast du recht. Vermutlich.' }] },
      ] },
      { who: 'flug', text: 'Alarm! Unbefugter Start aus Hangar drei! Das Kurierschiff hebt ab!' },
      { who: 'brandt', text: 'Es ist Holt. Er hat die Logs gelöscht und sich ein Schiff genommen. Alle verfügbaren Piloten raus!' },
    ] },
    briefing: [
      { who: 'brandt', text: 'Commander Holt flieht mit dem Kurierschiff zum Sprungpunkt Ost. An Bord: die Sprungkoordinaten der gesamten Flotte.' },
      { who: 'brandt', text: 'Ihre Meldung hat uns Zeit verschafft, {cs}. Er hatte keine Gelegenheit, den Antrieb voll aufzuladen.', if: 'reportedLeak' },
      { who: 'brandt', text: 'Er darf den Sprungpunkt nicht erreichen. Zerstören Sie das Kurierschiff, um jeden Preis.' },
      { who: 'kolibri', text: 'Holt. Der mit seinen Vorschriften. Ich hab ihm nie getraut, {cs}. Holen wir ihn uns.' },
    ],
    objectives: ['Das Kurierschiff abfangen und zerstören', 'Holt darf den Sprungpunkt nicht erreichen'],
    noReturn: true,
    navs: [
      { name: 'Kurier', pos: A(0, 200, 6000), type: 'intercept', objective: 'Zerstöre das Kurierschiff',
        intercept: { to: A(1500, 600, 14000), fastIfNot: 'reportedLeak' },
        waves: [[['klinge', 2]], [['dorn', 3]]],
        onArrive: [{ who: 'holt', text: 'Ihr versteht es nicht. Die Aszendenz bietet das Ende von Schmerz, von Alter, von Tod. Ich habe mich entschieden.' }],
        onWave: [null, { who: 'kolibri', text: 'Er hat Freunde gerufen! Ignorier sie, {cs}, nur der Kurier zählt!' }],
        onClear: [{ who: 'holt', text: 'Ihr… seid Narren…' }, { who: 'kolibri', text: 'Kurier zerstört. Fahr zur Hölle, Holt.' }] },
    ],
    win: [
      { who: 'brandt', text: 'Holt ist tot, die Koordinaten sind sicher. Ich habe zwölf Jahre mit diesem Mann gedient.' },
      { who: 'rook', text: 'Wir alle haben ihm vertraut. Das ist das Schlimmste daran.' },
    ],
    set: { holtDead: true },
    lose: {
      next: 'm9', set: { holtEscaped: true }, title: 'Holt ist entkommen',
      lines: [
        { who: 'kolibri', text: 'Er ist gesprungen. Verdammt, {cs}, er ist weg – und mit ihm unsere Koordinaten.' },
        { who: 'brandt', text: 'Dann wissen sie, wohin wir springen. Wir ändern den Kurs, aber das kostet Zeit. Machen Sie sich auf einen harten Kampf gefasst.' },
      ],
    },
    next: 'm9',
  },
  {
    id: 'm9', act: 'II', title: 'Nebelwand', sector: 'Sturmnebel von Varn', ship: 'greif', wingman: 'rook', sky: SKY.sturm,
    postCut: 'sacrifice', set: { rookDead: true, kolibriCaptured: true },
    briefing: [
      { who: 'brandt', text: 'Sie haben uns im Sturmnebel gestellt. Ein Treffer hat den Sprungantrieb beschädigt. Die Techniker brauchen drei Minuten.' },
      { who: 'brandt', text: 'Holt hat ihnen unsere Route verraten. Sie kommen mit allem, was sie haben.', if: 'holtEscaped' },
      { who: 'rook', text: 'Drei Minuten. Das ist nichts, {cs}. Das haben wir schon hundertmal gemacht.' },
      { who: 'kolibri', text: 'Ich fliege die zweite Rotte. Wenn wir heute Abend alle zurück sind, gebe ich einen aus. Versprochen.' },
    ],
    objectives: ['Die Aurora drei Minuten lang verteidigen', 'Sprungantrieb schützen'],
    protect: 'carrier', noReturn: true,
    navs: [
      { name: 'Aurora', pos: A(0, 0, 900), anchor: true, type: 'survive', survive: 180, objective: 'Halte durch',
        waves: [[['dorn', 4], ['klinge', 1, 'holtEscaped']], [['hammer', 2], ['klinge', 2]], [['klinge', 3], ['dorn', 2]], [['hammer', 3], ['dorn', 2], ['klinge', 1, 'holtEscaped']]],
        onArrive: [{ who: 'flug', text: 'Kontakte aus allen Richtungen! Sprungantrieb bei zehn Prozent!' }],
        onWave: [null, { who: 'rook', text: 'Bomber! Kolibri, links. {cs}, mit mir!' }, { who: 'flug', text: 'Sprungantrieb bei sechzig Prozent!' }, { who: 'brandt', text: 'Fast geschafft. Noch eine Welle!' }],
        onClear: [{ who: 'flug', text: 'Sprungantrieb geladen! Aber… ein Zerstörer springt direkt vor uns rein!' }] },
    ],
    win: [
      { who: 'erz', text: 'Die Aurora sprang. Hinter ihr verglühten die Trümmer der Litanei – und eines Greifs mit der Kennung „Rook“.' },
      { who: 'brandt', text: 'Major Tobias Adeyemi. Gefallen im Dienst. Leutnant Mika Sandoval: vermisst, vermutlich in Gefangenschaft.' },
    ],
    next: 'm10',
  },
  {
    id: 'm10', act: 'II', title: 'Fährte', sector: 'Der Mahlstrom', ship: 'falke', wingman: 'juno', sky: SKY.mahlstrom,
    scene: { place: 'Hangardeck · Gedenkfeier', lines: [
      { who: 'erz', text: 'Die Besatzung steht stumm vor einem leeren Startplatz. Jemand hat Rooks Helm auf die Tragfläche eines Greifs gestellt.' },
      { who: 'brandt', text: 'Major Adeyemi hat einmal gesagt: „Bring den Vogel heil zurück.“ Er hat sich nicht daran gehalten. Dafür leben wir noch.' },
      { who: 'juno', text: 'Leutnant Ada Kerimov, Rufzeichen Juno. Ich bin von der Ares versetzt worden. Ich… es tut mir leid, dass wir uns so kennenlernen.' },
      { who: 'juno', text: 'Sie sagen, du warst sein Schüler. Willst du etwas sagen?', choices: [
        { label: '„Schieß nur auf das, was du triffst.“ Für Rook.', aff: { kolibri: 1 }, reply: [{ who: 'juno', text: 'Für Rook.' }, { who: 'erz', text: 'Hundert Stimmen wiederholen es leise. Für Rook.' }] },
        { label: 'Wir holen Kolibri zurück. Das ist alles, was zählt.', set: { vowRescue: true }, reply: [{ who: 'juno', text: 'Dann bin ich dabei. Egal, was der Befehl sagt.' }] },
      ] },
    ] },
    briefing: [
      { who: 'brandt', text: 'Wir haben Kolibris Notsender geortet. Er führt durch den Mahlstrom, ein instabiles Asteroidenfeld.' },
      { who: 'brandt', text: 'Fliegen Sie die Fährte nach und markieren Sie den Kurs des Gefangenentransporters. Sie haben vier Minuten, dann verwischt der Sturm die Spur.' },
      { who: 'juno', text: 'Ich kenne den Mahlstrom. Flieg einfach dicht hinter mir, {cs}, und halt dich von den großen Brocken fern.' },
    ],
    objectives: ['Den Mahlstrom in vier Minuten durchqueren', 'Verfolger abschütteln oder vernichten', 'Den Peilpunkt erreichen'],
    noReturn: true,
    navs: [
      { name: 'Peilpunkt', pos: A(-1800, 300, 13000), type: 'escape', escape: 240, objective: 'Erreiche den Peilpunkt',
        field: { at: A(-900, 150, 6500), n: 90, spread: 2400 }, chasers: [['dorn', 3], ['klinge', 1]],
        onArrive: [{ who: 'juno', text: 'Peilung steht! Ich habe den Kurs des Transporters!' }],
        timerFail: 'Der Sturm hat die Spur verwischt.' },
    ],
    win: [
      { who: 'juno', text: 'Der Transporter „Ketten“ fliegt zur Orun-Passage. Kolibri ist an Bord. Sie lebt, {cs}.' },
      { who: 'brandt', text: 'Gute Arbeit. Kommen Sie zurück. Ich muss mit der Admiralität sprechen.' },
    ],
    next: 'm11',
  },

  // ============================== AKT III ==============================
  {
    id: 'm11', act: 'III', title: 'Ketten', sector: 'Orun-Vorfeld', ship: 'falke', wingman: 'juno', sky: SKY.mahlstrom,
    postCut: 'rescue',
    scene: { place: 'Brücke der Aurora', lines: [
      { who: 'brandt', text: 'Die Admiralität hat entschieden. Der Angriff auf die Orun-Passage beginnt in sechs Stunden. Jeder Pilot wird dort gebraucht.' },
      { who: 'brandt', text: 'Eine Rettungsaktion für Leutnant Sandoval ist… nicht genehmigt.' },
      { who: 'juno', text: 'Das ist ein Todesurteil für sie.' },
      { who: 'brandt', text: 'Ich weiß. {cs}, ich kann Ihnen diesen Befehl nicht ersparen. Was werden Sie tun?', choices: [
        { label: 'Ich hole sie zurück. Mit oder ohne Befehl.', set: { defied: true }, aff: { kolibri: 2 }, reply: [
          { who: 'brandt', text: 'Das habe ich nicht gehört. Hangar zwei ist unbewacht. Sie haben eine Stunde.' },
          { who: 'juno', text: 'Ich komme mit.' }] },
        { label: 'Verstanden, Kapitänin. Die Flotte geht vor.', set: { kolibriLost: true }, goto: 'm12', reply: [
          { who: 'brandt', text: 'Danke. Ich weiß, was das für Sie bedeutet.' },
          { who: 'juno', text: 'Du hast an Rooks Startplatz geschworen, sie zurückzuholen. Ich habe es gehört.', if: 'vowRescue' },
          { who: 'juno', text: 'Ich hoffe, du kannst damit leben. Ich weiß nicht, ob ich es könnte.' }] },
      ] },
    ] },
    briefing: [
      { who: 'juno', text: 'Der Transporter „Ketten“ hat Geleitschutz. Wir räumen die Eskorte ab, dann gehst du längsseits und hältst Position.' },
      { who: 'juno', text: 'Das Enterteam braucht acht Sekunden Andockzeit. Bleib nah dran, dann schneiden sie Kolibri raus.' },
      { who: 'brandt', text: 'Und {cs}: Der Transporter springt in fünf Minuten. Danach ist sie verloren.' },
    ],
    objectives: ['Die Eskorte der „Ketten“ vernichten', 'Am Transporter andocken (8 Sekunden)', 'Vor dem Sprung des Transporters fertig sein'],
    noReturn: true,
    navs: [
      { name: 'Ketten', pos: A(1500, 0, 8500), type: 'dock', dock: 8, limit: 300, objective: 'Vernichte die Eskorte', limitFail: 'Der Transporter ist gesprungen.',
        waves: [[['klinge', 3]], [['dorn', 3], ['klinge', 1]], [['archon', 1], ['klinge', 1]]], dockWave: [['dorn', 3]],
        onArrive: [{ who: 'juno', text: 'Da ist sie! Eskorte auf zwei Uhr!' }],
        onWave: [null, null, { who: 'veyl', text: 'Du willst sie zurück? Dann nimm sie mir weg, kleiner Falke.' }],
        onDock: [{ who: 'juno', text: 'Eskorte weg! Geh längsseits, {cs}! Grüne Markierung!' }],
        onClear: [{ who: 'juno', text: 'Enterteam meldet: Wir haben sie! Wir haben Kolibri!' }] },
    ],
    win: [
      { who: 'kolibri', text: 'Rook ist tot, oder? Ich hab es gesehen, bevor sie mich geholt haben.' },
      { who: 'kolibri', text: 'Dann fliegen wir jetzt für ihn. Alle beide.' },
    ],
    set: { kolibriSaved: true },
    lose: {
      next: 'm12', set: { kolibriLost: true }, title: 'Die Ketten ist gesprungen',
      lines: [
        { who: 'juno', text: 'Die Ketten ist weg. Und Kolibri mit ihr. Es tut mir so leid, {cs}.' },
        { who: 'brandt', text: 'Kommen Sie zurück zur Flotte. Ich brauche Sie in Orun. Wir tun es jetzt auch für sie.' },
      ],
    },
    next: 'm12',
  },
  {
    id: 'm12', act: 'III', title: 'Speerspitze', sector: 'Orun-Passage · Sprungtor', ship: 'greif', wingman: 'kolibri', sky: SKY.orun,
    postCut: 'gate',
    briefing: [
      { who: 'brandt', text: 'Der Zerstörer „Dogma“ bewacht das Sprungtor der Orun-Passage. Solange er dort steht, kommt unsere Flotte nicht durch.' },
      { who: 'brandt', text: 'Brechen Sie den Geleitschutz, dann versenken Sie die Dogma. Raketen sind gegen Großkampfschiffe besonders wirksam.' },
      { who: 'kolibri', text: 'Rook hat immer gesagt: Nie geradeaus auf einen Zerstörer zu. Anflug, Salve, abdrehen.', ifNot: 'kolibriLost' },
      { who: 'juno', text: 'Ich habe die Dogma schon einmal gesehen. Sie hat die Ares halbiert. Lass sie das nicht noch einmal tun.', if: 'kolibriLost' },
    ],
    objectives: ['Den Geleitschutz bei Nav 1 vernichten', 'Den Zerstörer „Dogma“ versenken'],
    noReturn: true,
    navs: [
      { name: 'Nav 1', pos: A(2500, -200, 7500), waves: [[['klinge', 3], ['dorn', 2]]],
        onArrive: [{ who: 'flug', text: 'Vorpostenstaffel. Kurzen Prozess, die Dogma hört mit.' }],
        onClear: [{ who: 'flug', text: 'Weg ist frei. Ziel: die Dogma.' }] },
      { name: 'Dogma', pos: A(-2000, 300, 14500), objective: 'Versenke den Zerstörer „Dogma“', waves: [[['zerstoerer', 1], ['dorn', 4]], [['klinge', 2]]],
        onArrive: [{ who: 'flug', text: 'Da ist sie. Alle Raketen auf die Dogma!' }],
        onClear: [{ who: 'brandt', text: 'Dogma ist zerstört! Das Tor ist offen! Flotte, vorrücken!' }] },
    ],
    win: [
      { who: 'brandt', text: 'Hinter dem Tor liegt das Herz der Aszendenz. Was wir dort finden, entscheidet diesen Krieg.' },
    ],
    next: 'm13',
  },
  {
    id: 'm13', act: 'III', title: 'Torwächter', sector: 'Jenseits von Orun', ship: 'greif', wingman: 'kolibri', sky: SKY.orun,
    briefing: [
      { who: 'brandt', text: 'Wir sind durch. Aber eine Wächterstation versucht, das Tor hinter uns zu schließen. Dann sitzt die halbe Flotte fest.' },
      { who: 'brandt', text: 'Zerstören Sie die Station, bevor sie das Tor kollabieren lässt.' },
      { who: 'kolibri', text: 'Noch so ein Ding wie die Brutstätte? Gut. Ich hab mit diesen Stationen noch eine Rechnung offen.', ifNot: 'kolibriLost' },
      { who: 'juno', text: 'Eine Station, die ein Sprungtor kollabieren lässt. Wenn wir versagen, sitzt die halbe Flotte in der Falle. Kein Druck.', if: 'kolibriLost' },
    ],
    objectives: ['Die Abfangjäger bei Nav 1 vernichten', 'Die Wächterstation zerstören'],
    noReturn: true,
    navs: [
      { name: 'Nav 1', pos: A(-2000, 200, 6500), waves: [[['klinge', 3]], [['hammer', 2], ['dorn', 2]]],
        onClear: [{ who: 'flug', text: 'Abfangjäger erledigt. Die Station lädt den Kollaps – beeilen Sie sich!' }] },
      { name: 'Wächterstation', pos: A(1800, -200, 12500), objective: 'Zerstöre die Wächterstation', limit: 300, limitFail: 'Das Tor ist kollabiert. Die Flotte ist abgeschnitten.',
        waves: [[['station', 1], ['klinge', 2], ['dorn', 2]], [['klinge', 3]]],
        onArrive: [{ who: 'brandt', text: 'Sie haben fünf Minuten, bis das Tor kollabiert!' }],
        onClear: [{ who: 'brandt', text: 'Station vernichtet! Das Tor bleibt offen. Die Flotte kommt durch!' }] },
    ],
    win: [
      { who: 'brandt', text: 'Unsere Langstreckensensoren sehen sie jetzt: die Apotheose. Und davor die gesamte Schattenflotte.' },
    ],
    next: 'c1',
  },
  {
    id: 'c1', act: 'III', title: 'Rettungsanker', sector: 'Jenseits von Orun · Wrack der Ares II', ship: 'greif', wingman: 'kolibri',
    sky: { a: '#2a4d8f', b: '#1aa38f', seed: 31.5, planet: ['#1f2440', '#8fa4ff'], planetDir: [-0.2, 0.4, 0.9] },
    briefing: [
      { who: 'brandt', text: 'Der Kreuzer Ares II ist beim Kampf um das Tor auseinandergebrochen. Fünf Rettungskapseln treiben in einem Minenfeld der Aszendenz.' },
      { who: 'juno', text: 'Die Ares II ist das Schwesterschiff meiner alten Ares. Ich kenne Leute auf diesem Schiff, {cs}. Bitte.' },
      { who: 'brandt', text: 'Vier Minuten, dann ist ihr Sauerstoff aufgebraucht. Vorsicht mit den Minen: Sie folgen Ihnen.' },
    ],
    objectives: ['Fünf Rettungskapseln der Ares II bergen', 'Minen meiden oder abschießen', 'Zur TUS Aurora zurückkehren'],
    navs: [
      { name: 'Wrackfeld Ares II', pos: A(2200, -300, 8000), type: 'pickup', pickups: 5, pickupLabel: 'RETTUNGSKAPSEL', limit: 240, limitFail: 'Der Sauerstoff in den Kapseln ist aufgebraucht.',
        objective: 'Berge die Rettungskapseln', mines: { n: 34, spread: 700 }, asteroids: 12,
        waves: [[['klinge', 2], ['dorn', 2]], [['dorn', 3]]],
        onArrive: [{ who: 'juno', text: 'Ich sehe die Kapseln! Und… verdammt, überall Minen. Langsam, {cs}.' }],
        onClear: [{ who: 'juno', text: 'Alle fünf an Bord. Kapitän Olsen lebt. Danke, {cs}. Danke.' }] },
    ],
    win: [
      { who: 'brandt', text: 'Einundzwanzig Überlebende der Ares II. Und ihr Kapitän hat etwas mitgebracht: die Position der Relaisstationen, über die die Schattenflotte kommuniziert.' },
    ],
    next: 'c2',
  },
  {
    id: 'c2', act: 'III', title: 'Funkstille', sector: 'Orun-Kern · Relaisnetz', ship: 'greif', wingman: 'kolibri',
    sky: { a: '#c0392b', b: '#8e44ad', seed: 33.7, planet: ['#3b1f2b', '#e0a0a0'], planetDir: [0.4, 0.2, 0.9] },
    briefing: [
      { who: 'brandt', text: 'Drei Relaisstationen verbinden die Schattenflotte mit der Apotheose. Zerstören Sie alle drei, und die Flotte kämpft blind.' },
      { who: 'kolibri', text: 'Endlich mal ein Ziel, das nicht ausweicht. Drei Türme, drei Feuerwerke.', ifNot: 'kolibriLost' },
      { who: 'juno', text: 'Drei Türme. Nach dem Wrackfeld fühlt sich das fast wie Urlaub an.', if: 'kolibriLost' },
    ],
    objectives: ['Relaisstation Alpha zerstören', 'Relaisstation Beta zerstören', 'Relaisstation Gamma zerstören'],
    noReturn: true,
    navs: [
      { name: 'Relais Alpha', pos: A(-2200, 200, 7000), objective: 'Zerstöre Relais Alpha', waves: [[['relay', 1], ['klinge', 2]]],
        onArrive: [{ who: 'flug', text: 'Relais Alpha voraus. Geschütztürme aktiv.' }],
        onClear: [{ who: 'flug', text: 'Alpha ist still. Weiter zu Beta.' }] },
      { name: 'Relais Beta', pos: A(1800, -300, 12500), objective: 'Zerstöre Relais Beta', mines: { n: 20, spread: 600 }, waves: [[['relay', 1], ['dorn', 3]]],
        onArrive: [{ who: 'flug', text: 'Beta ist vermint. Vorsicht beim Anflug.' }],
        onClear: [{ who: 'flug', text: 'Beta ist still. Noch eine.' }] },
      { name: 'Relais Gamma', pos: A(-1000, 400, 18000), objective: 'Zerstöre Relais Gamma', waves: [[['relay', 1], ['hammer', 2], ['klinge', 1]], [['klinge', 2]]],
        onArrive: [{ who: 'veyl', text: 'Ihr schneidet mir die Stimme ab? Dann höre ich euch eben beim Sterben zu.' }],
        onClear: [{ who: 'brandt', text: 'Funkstille in der gesamten Schattenflotte! Jetzt oder nie.' }] },
    ],
    win: [
      { who: 'brandt', text: 'Die Schattenflotte ist taub und blind. Wir greifen an, sobald alle Maschinen aufgetankt sind.' },
    ],
    next: 'm14',
  },
  {
    id: 'm14', act: 'III', title: 'Schattenflotte', sector: 'Orun-Kern · Vorfeld', ship: 'greif', wingman: 'kolibri', sky: SKY.kern,
    scene: { place: 'Hangardeck · Die Nacht vor der Schlacht', lines: [
      { who: 'kolibri', text: 'Kannst du auch nicht schlafen? Ich sehe immer noch ihre Gesichter. Die anderen Gefangenen auf der Ketten.', ifNot: 'kolibriLost' },
      { who: 'kolibri', text: 'Hey, {cs}. Wenn das morgen schiefgeht…', ifNot: 'kolibriLost', choices: [
        { label: 'Es geht nicht schief. Wir fliegen zusammen raus und kommen zusammen zurück.', aff: { kolibri: 1 }, reply: [{ who: 'kolibri', text: 'Versprochen? Gut. Ich halte dich daran fest.' }] },
        { label: 'Dann war es mir eine Ehre, mit dir zu fliegen.', aff: { kolibri: 1 }, reply: [{ who: 'kolibri', text: 'Idiot. Jetzt muss ich heulen. Die Ehre war meine.' }] },
      ] },
      { who: 'juno', text: 'Ich habe Kolibris Akte gelesen. Sie wäre gern hier gewesen, oder?', if: 'kolibriLost', choices: [
        { label: 'Sie ist hier. Jedes Mal, wenn wir starten.', reply: [{ who: 'juno', text: 'Dann fliegen wir morgen zu dritt.' }] },
        { label: 'Ich hätte sie holen sollen.', ifNot: 'defied', reply: [{ who: 'juno', text: 'Vielleicht. Aber dann stünde die Flotte jetzt nicht hier. Es gibt keine richtige Antwort, {cs}.' }] },
        { label: 'Wir waren so nah dran. Ich war zu langsam.', if: 'defied', reply: [{ who: 'juno', text: 'Du hast es versucht, gegen jeden Befehl. Mehr kann niemand verlangen, {cs}.' }] },
      ] },
    ] },
    briefing: [
      { who: 'brandt', text: 'Die Schattenflotte steht zwischen uns und der Apotheose. Unsere Kreuzer binden die Großkampfschiffe. Sie räumen die Jäger ab.' },
      { who: 'brandt', text: 'Und noch etwas: Unter den feindlichen Signalen ist eine Union-Kennung. Holt fliegt für sie.', if: 'holtEscaped' },
    ],
    objectives: ['Zwei Verteidigungslinien der Schattenflotte durchbrechen'],
    noReturn: true,
    navs: [
      { name: 'Linie Alpha', pos: A(-2500, 0, 7000), waves: [[['klinge', 3], ['dorn', 2]], [['hammer', 2], ['klinge', 2]]],
        onArrive: [{ who: 'flug', text: 'Feindliche Jäger in Massen. Alle Nachtfalken: Feuer frei!' }],
        onClear: [{ who: 'flug', text: 'Linie Alpha durchbrochen!' }] },
      { name: 'Linie Beta', pos: A(1500, 300, 13000), waves: [[['klinge', 4]], [['holt', 1, 'holtEscaped'], ['klinge', 2]], [['dorn', 4]]],
        onWave: [null, { who: 'holt', text: 'Ihr hättet aufsteigen können. Alle. Jetzt sterbt ihr als das, was ihr seid.', if: 'holtEscaped' }],
        onClear: [{ who: 'brandt', text: 'Die Schattenflotte weicht zurück! Der Weg zur Apotheose ist frei!' }] },
    ],
    win: [
      { who: 'holt', text: 'Ich… wollte nur… nicht mehr… Angst haben…', if: 'holtEscaped' },
      { who: 'brandt', text: 'Das ist es. Bereiten Sie sich vor. Morgenröte beginnt in einer Stunde.' },
    ],
    next: 'm15',
  },
  {
    id: 'm15', act: 'III', title: 'Morgenröte', sector: 'Orun-Kern · Die Apotheose', ship: 'greif', wingman: 'kolibri', sky: SKY.kern,
    preCut: 'apotheose', postCut: 'finale', final: true,
    briefing: [
      { who: 'brandt', text: 'Operation Morgenröte. Die Apotheose koordiniert jede Einheit der Aszendenz. Fällt sie, bricht ihr Netz zusammen.' },
      { who: 'brandt', text: 'Durchbrechen Sie den Abwehrschirm, vernichten Sie das Kommandoschiff. Veyl wird starten, sobald Sie ihm gefährlich werden.' },
      { who: 'kolibri', text: 'Für Rook. Für Tessa Prime. Für alle, die sie geholt haben. Bringen wir’s zu Ende, {cs}.', ifNot: 'kolibriLost' },
      { who: 'juno', text: 'Für Rook. Für Kolibri. Ich bin an deinem Flügel, {cs}. Bis zum Schluss.', if: 'kolibriLost' },
    ],
    objectives: ['Den Abwehrschirm durchbrechen', 'Das Kommandoschiff „Apotheose“ vernichten', 'Archon Veyl besiegen'],
    noReturn: true,
    navs: [
      { name: 'Abwehrschirm', pos: A(-1500, 200, 7500), waves: [[['klinge', 4]], [['hammer', 2], ['dorn', 3]]],
        onArrive: [{ who: 'flug', text: 'Das Empfangskomitee. Lächeln und schießen!' }],
        onClear: [{ who: 'flug', text: 'Schirm durchbrochen! Die Apotheose liegt direkt voraus.' }] },
      { name: 'Apotheose', pos: A(1000, -200, 15000), objective: 'Vernichte die „Apotheose“', final: true,
        waves: [[['dreadnought', 1], ['dorn', 4]], [['archon', 1], ['klinge', 2]]],
        onArrive: [{ who: 'flug', text: 'Heilige… das Ding ist größer als die Aurora. Alle Raketen auf das Kommandoschiff!' }],
        onWave: [null, { who: 'veyl', text: 'Du hast mein Schiff verbrannt. Komm, kleiner Falke. Zeig mir, wie Fleisch stirbt.' }],
        onClear: [
          { who: 'veyl', text: 'Tobias…? Bist du das? Es ist so hell hier… Es tut… nicht mehr weh…', if: 'hopeAric' },
          { who: 'veyl', text: 'Das Netz… verstummt… Ich höre… nur noch mich selbst…', ifNot: 'hopeAric' },
          { who: 'brandt', text: 'Veyl ist gefallen. Kommen Sie nach Hause, {cs}.' }] },
    ],
    win: [
      { who: 'brandt', text: 'Es ist vorbei. Alle Einheiten der Aszendenz ziehen sich aus dem Graben zurück.' },
    ],
    next: null,
  },
];

export const MISSION_BY_ID = Object.fromEntries(MISSIONS.map((m) => [m.id, m]));
// number missions along the story path
{
  let id = 'm1', n = 1;
  const seen = new Set();
  while (id && !seen.has(id)) { seen.add(id); MISSION_BY_ID[id].no = n++; id = MISSION_BY_ID[id].next; }
}
