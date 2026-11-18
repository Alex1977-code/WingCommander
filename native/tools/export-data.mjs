// Exports the web game's campaign and ship tables as JSON for the native version, so both share one story.
// Run from the repo root: node native/tools/export-data.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { CHARS, RANKS, ACTS, INTRO, ENDINGS, CUTSCENES, MISSIONS } from '../../src/campaign.js';

const src = readFileSync(new URL('../../src/ships.js', import.meta.url), 'utf8');
const start = src.indexOf('export const SHIPS = {');
let depth = 0, end = -1;
for (let i = src.indexOf('{', start); i < src.length; i++) {
  if (src[i] === '{') depth++;
  else if (src[i] === '}' && --depth === 0) { end = i + 1; break; }
}
// the table is plain data (numbers, strings, arrays); evaluate it in isolation
const SHIPS = Function(`"use strict"; return (${src.slice(src.indexOf('{', start), end)});`)();

const out = new URL('../assets/data/', import.meta.url);
const strip = (v) => JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'function' ? undefined : x)));
writeFileSync(new URL('campaign.json', out), JSON.stringify(strip({ chars: CHARS, ranks: RANKS, acts: ACTS, intro: INTRO, endings: ENDINGS, cutscenes: CUTSCENES, missions: MISSIONS }), null, 1));
writeFileSync(new URL('ships.json', out), JSON.stringify(strip(SHIPS), null, 1));
console.log(`exported ${MISSIONS.length} missions, ${Object.keys(SHIPS).length} ship types`);
