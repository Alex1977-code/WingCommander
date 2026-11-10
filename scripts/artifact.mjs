// Turns dist-artifact/index.html into a body fragment suitable for a hosted single page.
import { readFileSync, writeFileSync } from 'node:fs';

const [, , src = 'dist-artifact/index.html', out = 'dist-artifact/sternenfront.html'] = process.argv;
let html = readFileSync(src, 'utf8');
html = html
  .replace(/<!doctype html>/i, '')
  .replace(/<\/?html[^>]*>/gi, '')
  .replace(/<\/?head>/gi, '')
  .replace(/<\/?body>/gi, '')
  .replace(/<meta[^>]*name="viewport"[^>]*>/i, '')
  .replace(/<meta charset[^>]*>/i, '')
  .replace(/<link[^>]*rel="(manifest|icon|apple-touch-icon)"[^>]*>/gi, '');
// title first so it is found within the first bytes
const title = html.match(/<title>.*?<\/title>/)[0];
html = title + '\n' + html.replace(title, '');
writeFileSync(out, html.trim() + '\n');
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
