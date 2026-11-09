/** Original story campaign. {cs} is replaced with the player's callsign. */

export const CHARS = {
  brandt: { name: 'Kapitänin Ilse Brandt', short: 'IB', color: '#5fb8ff' },
  rook: { name: 'Major Tobias „Rook“ Adeyemi', short: 'RK', color: '#7be0a4' },
  kolibri: { name: 'Leutnant Mika „Kolibri“ Sandoval', short: 'KO', color: '#ffc857' },
  veyl: { name: 'Archon Veyl', short: 'AV', color: '#ff4d8d' },
  flug: { name: 'Flugleitung Aurora', short: 'FL', color: '#9fb4c8' },
  samariter: { name: 'Lazarettschiff Samariter', short: 'SA', color: '#c9f0ff' },
  erz: { name: 'Erzähler', short: '✦', color: '#8892a6' },
};

export const RANKS = [
  [0, 'Fähnrich'], [6, 'Leutnant'], [16, 'Oberleutnant'], [30, 'Hauptmann'], [48, 'Major'],
];
export function rankFor(kills) {
  let r = RANKS[0][1];
  for (const [k, n] of RANKS) if (kills >= k) r = n;
  return r;
}

export const INTRO = [
  { who: 'erz', text: 'Im Jahr 2643 hat die Terranische Union den Perseus-Graben besiedelt – vierzig Welten am äußersten Rand des bekannten Raums.' },
  { who: 'erz', text: 'Dann kehrten die Verlorenen zurück. Nachfahren der ersten Kolonieschiffe, verschmolzen mit ihren Maschinen. Sie nennen sich die Aszendenz – und sie betrachten jede Kolonie als Ernte.' },
  { who: 'erz', text: 'Drei Welten sind bereits verstummt. Zwischen der Aszendenz und dem Rest des Grabens steht nur ein einziger Träger: die TUS Aurora und ihr 88. Geschwader, die „Nachtfalken“.' },
  { who: 'brandt', text: 'Willkommen an Bord, Fähnrich. Rufzeichen „{cs}“, richtig? Frisch von der Akademie, beste Simulatorwerte Ihres Jahrgangs.' },
  { who: 'brandt', text: 'Simulatoren schießen nicht zurück. Hier draußen schon. Major Adeyemi nimmt Sie unter seine Fittiche. Hören Sie auf ihn – dann erleben Sie vielleicht Ihre Beförderung.' },
  { who: 'rook', text: 'Rook. So nennt man mich hier. Bleib an meinem Flügel, {cs}, schieß nur auf das, was du triffst, und bring den Vogel heil zurück. Den Rest lernst du unterwegs.' },
];

const A = (x, y, z) => [x, y, z];

export const MISSIONS = [
  {
    id: 'm1', title: 'Feuertaufe', sector: 'Keth-System · Äußerer Gürtel', ship: 'sperber', wingman: 'rook',
    sky: { a: '#2456ff', b: '#9a3cff', seed: 1.3, planet: ['#27475f', '#d1a877'] },
    briefing: [
      { who: 'brandt', text: 'Routinepatrouille. Unsere Langstreckensensoren melden Geisterkontakte an zwei Navigationspunkten im äußeren Gürtel.' },
      { who: 'brandt', text: 'Vermutlich Aufklärungsdrohnen der Aszendenz, Typ „Dorn“. Leicht gepanzert, aber wendig. Finden, identifizieren, vernichten.' },
      { who: 'rook', text: 'Dein erster scharfer Einsatz, {cs}. Dorns jagen im Rudel. Lass dich nicht in die Zange nehmen und nutz den Nachbrenner, wenn es eng wird.' },
    ],
    objectives: ['Nav 1 und Nav 2 von Feindkontakten säubern', 'Zur TUS Aurora zurückkehren'],
    navs: [
      { name: 'Nav 1', pos: A(1500, 300, 7000), waves: [[['dorn', 2]]],
        onArrive: [{ who: 'rook', text: 'Kontakte auf zwölf Uhr! Zwei Dorns. Die gehören dir, {cs} – ich halte dir den Rücken frei.' }],
        onClear: [{ who: 'rook', text: 'Sauber. Nicht schlecht für einen Frischling. Weiter zu Nav 2.' }] },
      { name: 'Nav 2', pos: A(-4500, -400, 12500), waves: [[['dorn', 3]], [['dorn', 2]]],
        onArrive: [{ who: 'rook', text: 'Mehr davon. Das ist kein Aufklärer mehr, das ist ein Spähtrupp. Feuer frei!' }],
        onClear: [{ who: 'rook', text: 'Gürtel ist sauber. Ab nach Hause – die erste Runde in der Messe geht auf mich.' }] },
    ],
    win: [
      { who: 'brandt', text: 'Solide Arbeit, {cs}. Die Drohnen haben vor ihrer Zerstörung gesendet – die Aszendenz weiß jetzt, wo wir sind.' },
      { who: 'rook', text: 'Dann wissen sie auch, dass wir zurückbeißen.' },
    ],
  },
  {
    id: 'm2', title: 'Der Samariter', sector: 'Keth-System · Sprungkorridor', ship: 'sperber', wingman: 'kolibri',
    sky: { a: '#1f8a7a', b: '#2f55d6', seed: 4.1, planet: ['#3c2d4f', '#e09a6c'], planetDir: [0.7, 0.1, 0.6] },
    briefing: [
      { who: 'brandt', text: 'Das Lazarettschiff „Samariter“ evakuiert zweitausend Kolonisten von Keth IV. Es ist langsam, unbewaffnet und unersetzlich.' },
      { who: 'brandt', text: 'Sie begleiten es durch den Sprungkorridor. Rechnen Sie mit Jägern vom Typ „Klinge“ und mit Bombern der „Hammer“-Klasse. Die Bomber haben Vorrang.' },
      { who: 'kolibri', text: 'Kolibri hier. Ich bin heute dein Flügel, {cs}. Versuch mitzuhalten – und wenn nicht, zähl wenigstens meine Abschüsse mit.' },
    ],
    objectives: ['Die Samariter beschützen', 'Alle Angriffswellen abwehren', 'Zur TUS Aurora zurückkehren'],
    protect: 'transport',
    navs: [
      { name: 'Samariter', pos: A(2000, 0, 8000), anchor: true, objective: 'Beschütze die Samariter',
        waves: [[['dorn', 3]], [['klinge', 2], ['dorn', 2]], [['hammer', 2], ['dorn', 2]]],
        onArrive: [{ who: 'samariter', text: 'Nachtfalken, hier Samariter. Wir haben Kontakte auf dem Schirm. Bitte beeilen Sie sich!' }],
        onWave: [null, { who: 'kolibri', text: 'Klingen im Anflug! Die sind schneller als die Dorns – bleib in Bewegung!' }, { who: 'kolibri', text: 'Bomber! Wenn die ihre Torpedos loswerden, war es das für die Samariter!' }],
        onClear: [{ who: 'samariter', text: 'Sprungantrieb geladen. Zweitausend Menschen verdanken Ihnen ihr Leben. Samariter Ende.' }] },
    ],
    win: [
      { who: 'kolibri', text: 'Okay, ich geb’s zu: Du kannst fliegen. Erzähl das bloß nicht Rook.' },
      { who: 'brandt', text: 'Die Samariter ist sicher gesprungen. Aber unsere Abhörstation hat einen Namen aufgefangen: Archon Veyl. Der Schlächter von Tessa Prime führt die Jagdgruppe der Aszendenz an.' },
    ],
  },
  {
    id: 'm3', title: 'Im Trümmerfeld', sector: 'Tessa-System · Zerbrochener Mond', ship: 'falke', wingman: 'rook',
    sky: { a: '#c4571d', b: '#7a1fb8', seed: 7.7, planet: ['#5a2d1c', '#e8c08a'], planetDir: [-0.3, 0.2, 0.9] },
    briefing: [
      { who: 'brandt', text: 'Sie fliegen ab heute den Falken: stärkere Schilde, eine dritte Kanone, sechs Raketen. Sie werden sie brauchen.' },
      { who: 'brandt', text: 'Im Trümmerfeld des zerbrochenen Mondes von Tessa versteckt die Aszendenz ein Nachschubdepot. Säubern Sie beide Navigationspunkte.' },
      { who: 'rook', text: 'Im Feld sind die Felsen gefährlicher als der Feind. Augen auf, {cs}. Und falls Veyl auftaucht – der Mann hat meine alte Staffel ausgelöscht. Unterschätz ihn nicht.' },
    ],
    objectives: ['Nav 1 im Trümmerfeld säubern', 'Das Depot bei Nav 2 ausschalten', 'Zur TUS Aurora zurückkehren'],
    navs: [
      { name: 'Nav 1', pos: A(-2500, 200, 7500), asteroids: 46, waves: [[['dorn', 4]], [['klinge', 2]]],
        onArrive: [{ who: 'rook', text: 'Sie kommen aus dem Schatten der Felsen. Bleib dicht, aber nicht zu dicht!' }],
        onClear: [{ who: 'rook', text: 'Vorposten erledigt. Das Depot liegt tiefer im Feld.' }] },
      { name: 'Nav 2', pos: A(3500, -300, 14000), asteroids: 54, waves: [[['klinge', 3]], [['archon', 1], ['klinge', 2]]],
        onWave: [null, { who: 'veyl', text: 'Ein Nachtfalke. Wie rührend. Eure Körper sind Käfige – ich befreie euch gern daraus.' }],
        onClear: [{ who: 'rook', text: 'Er ist gesprungen. Verdammt… aber du hast ihn bluten lassen, {cs}. Das hat vor dir noch keiner geschafft.' }] },
    ],
    win: [
      { who: 'rook', text: 'Du hast heute gegen Veyl bestanden. Ich… danke dir. Für meine alte Staffel.' },
      { who: 'brandt', text: 'Das Depot ist zerstört. Die Aszendenz wird das nicht hinnehmen. Alle Stationen auf erhöhte Bereitschaft.' },
    ],
  },
  {
    id: 'm4', title: 'Alarmstart', sector: 'Tessa-System · Position der Aurora', ship: 'falke', wingman: 'kolibri',
    sky: { a: '#b01e3c', b: '#3b2bd6', seed: 11.2, planet: ['#1d3a3a', '#8fd0c0'], planetDir: [0.2, -0.5, 0.8] },
    briefing: [
      { who: 'flug', text: 'ALARMSTART! ALARMSTART! Alle Piloten zu ihren Maschinen! Das ist keine Übung!' },
      { who: 'brandt', text: 'Sie haben uns gefunden. Drei Bomberwellen im Anflug auf die Aurora. Unsere Geschütze halten die Jäger auf Abstand, aber nicht die Torpedos.' },
      { who: 'kolibri', text: 'Wenn die Aurora fällt, haben wir kein Zuhause mehr. Also, {cs}: Bomber zuerst. Alles andere ist Dekoration.' },
    ],
    objectives: ['Die TUS Aurora verteidigen', 'Alle Bomberwellen vernichten'],
    protect: 'carrier',
    navs: [
      { name: 'Aurora', pos: A(0, 0, 900), anchor: true, objective: 'Verteidige die TUS Aurora',
        waves: [[['dorn', 4]], [['hammer', 3], ['klinge', 2]], [['hammer', 4], ['klinge', 2]]],
        onArrive: [{ who: 'flug', text: 'Erste Welle in Waffenreichweite. Nachtfalken, die Aurora zählt auf euch!' }],
        onWave: [null, { who: 'flug', text: 'Bomber auf Angriffskurs! Abfangen, abfangen!' }, { who: 'brandt', text: 'Letzte Welle. Halten Sie durch – wir laden den Sprungantrieb!' }],
        onClear: [{ who: 'brandt', text: 'Radar ist frei. Gut gemacht, Nachtfalken. Kommen Sie nach Hause.' }] },
    ],
    win: [
      { who: 'brandt', text: 'Die Aurora steht noch. Das verdanken wir Ihnen, {cs}. Die Admiralität hat entschieden: Wir gehen zum Gegenangriff über.' },
      { who: 'kolibri', text: 'Gegenangriff? Endlich. Ich hab das Davonlaufen satt.' },
    ],
  },
  {
    id: 'm5', title: 'Speerspitze', sector: 'Orun-Passage · Sprungtor', ship: 'greif', wingman: 'rook',
    sky: { a: '#1e6fd6', b: '#19c2a0', seed: 15.9, planet: ['#2b2f55', '#b9c4ff'], planetDir: [-0.7, 0.3, 0.5] },
    briefing: [
      { who: 'brandt', text: 'Der Zerstörer „Dogma“ bewacht das Sprungtor der Orun-Passage. Solange er dort steht, kommt unsere Flotte nicht durch.' },
      { who: 'brandt', text: 'Sie fliegen den schweren Jagdbomber Greif: vier Kanonen, zehn Raketen. Raketen sind gegen Großkampfschiffe besonders wirksam. Brechen Sie den Geleitschutz, dann versenken Sie die Dogma.' },
      { who: 'rook', text: 'Ein Zerstörer hat Geschütztürme, {cs}. Flieg nie geradeaus auf ihn zu. Anflug, Salve, abdrehen – und wieder von vorn.' },
    ],
    objectives: ['Den Geleitschutz bei Nav 1 vernichten', 'Den Zerstörer „Dogma“ versenken', 'Zur TUS Aurora zurückkehren'],
    navs: [
      { name: 'Nav 1', pos: A(2500, -200, 7500), waves: [[['klinge', 3], ['dorn', 2]]],
        onArrive: [{ who: 'rook', text: 'Vorpostenstaffel. Mach kurzen Prozess – die Dogma hört mit.' }],
        onClear: [{ who: 'rook', text: 'Weg ist frei. Jetzt holen wir uns den großen Fisch.' }] },
      { name: 'Dogma', pos: A(-2000, 300, 14500), objective: 'Versenke den Zerstörer „Dogma“', waves: [[['zerstoerer', 1], ['dorn', 4]], [['klinge', 2]]],
        onArrive: [{ who: 'rook', text: 'Da ist sie. Hässlich wie die Nacht. Raketen auf die Dogma, {cs}!' }],
        onClear: [{ who: 'brandt', text: 'Bestätige: Dogma ist zerstört! Das Sprungtor ist offen. Hervorragend, Nachtfalken!' }] },
    ],
    win: [
      { who: 'brandt', text: 'Die Flotte sammelt sich am Tor. Hinter der Passage liegt das Kommandoschiff der Aszendenz: die „Apotheose“. Veyl ist an Bord.' },
      { who: 'rook', text: 'Dann endet es dort. So oder so.' },
    ],
  },
  {
    id: 'm6', title: 'Morgenröte', sector: 'Orun-Kern · Flotte der Aszendenz', ship: 'greif', wingman: 'kolibri',
    sky: { a: '#d6342b', b: '#f0a020', seed: 21.4, planet: ['#401818', '#ffb070'], planetDir: [0.1, 0.1, 1] },
    briefing: [
      { who: 'brandt', text: 'Das ist es. Operation Morgenröte. Die „Apotheose“ koordiniert jede Einheit der Aszendenz im Graben. Fällt sie, bricht ihr Netz zusammen.' },
      { who: 'brandt', text: 'Durchbrechen Sie den Abwehrschirm, vernichten Sie das Kommandoschiff. Veyl wird starten, sobald Sie ihm gefährlich werden.' },
      { who: 'kolibri', text: 'Rook fliegt die zweite Welle, also hast du heute mich. Bringen wir’s zu Ende, {cs}. Für Tessa Prime. Für alle.' },
    ],
    objectives: ['Den Abwehrschirm durchbrechen', 'Das Kommandoschiff „Apotheose“ vernichten', 'Archon Veyl besiegen', 'Zur TUS Aurora zurückkehren'],
    navs: [
      { name: 'Abwehrschirm', pos: A(-1500, 200, 7500), waves: [[['klinge', 4]], [['hammer', 2], ['dorn', 3]]],
        onArrive: [{ who: 'kolibri', text: 'Da kommt das Empfangskomitee. Lächeln und schießen!' }],
        onClear: [{ who: 'kolibri', text: 'Schirm durchbrochen! Die Apotheose liegt direkt voraus.' }] },
      { name: 'Apotheose', pos: A(1000, -200, 15000), objective: 'Vernichte die „Apotheose“', waves: [[['dreadnought', 1], ['dorn', 4]], [['archon', 1], ['klinge', 2]]],
        final: true,
        onArrive: [{ who: 'kolibri', text: 'Heilige… das Ding ist größer als die Aurora. Alle Raketen auf das Kommandoschiff!' }],
        onWave: [null, { who: 'veyl', text: 'Ihr habt mein Schiff verbrannt. Dafür nehme ich euch alles. Komm, kleiner Falke – zeig mir, wie Fleisch stirbt.' }],
        onClear: [{ who: 'brandt', text: 'Veyl ist gefallen. Das Netz der Aszendenz bricht zusammen – sie ziehen sich aus dem Graben zurück! Kommen Sie nach Hause, {cs}.' }] },
    ],
    win: [
      { who: 'rook', text: 'Du hast geschafft, woran ich zehn Jahre gescheitert bin. Meine Staffel kann jetzt ruhen.' },
      { who: 'kolibri', text: 'Ich sag’s nur einmal: Du bist der beste Pilot, mit dem ich je geflogen bin. So. Jetzt vergiss es wieder.' },
      { who: 'brandt', text: 'Der Perseus-Graben ist frei. Im Namen der Terranischen Union – und in meinem eigenen: Danke, {cs}. Die Nachtfalken sind stolz, Sie in ihren Reihen zu haben.' },
    ],
  },
];

export const ENDING = [
  { who: 'erz', text: 'Mit dem Fall der Apotheose endete der Vormarsch der Aszendenz. Vierzig Welten atmeten auf.' },
  { who: 'erz', text: 'Die TUS Aurora kehrte heim – gezeichnet, aber ungebrochen. Und in den Messen der Flotte erzählt man sich seitdem von einem Fähnrich, der als Frischling kam und als Legende blieb.' },
  { who: 'erz', text: 'Rufzeichen: {cs}. Geschwader: Nachtfalken. Ende der Kampagne – danke fürs Spielen!' },
];
