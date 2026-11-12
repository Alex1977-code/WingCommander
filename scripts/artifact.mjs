// Turns dist-artifact/index.html into a body fragment suitable for a hosted single page.
// Only the document shell is rewritten; inlined <script>/<style> payloads are left untouched.
import { readFileSync, writeFileSync } from 'node:fs';

const [, , src = 'dist-artifact/index.html', out = 'dist-artifact/sternenfront.html'] = process.argv;
const full = readFileSync(src, 'utf8');
const parts = full.split(/(<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>)/i);
for (let i = 0; i < parts.length; i += 2) {
  parts[i] = parts[i]
    .replace(/<!doctype html>/i, '')
    .replace(/<\/?html[^>]*>/gi, '')
    .replace(/<\/?head>/gi, '')
    .replace(/<\/?body[^>]*>/gi, '')
    .replace(/<meta[^>]*name="viewport"[^>]*>/i, '')
    .replace(/<meta charset[^>]*>/i, '')
    .replace(/<link[^>]*rel="(manifest|icon|apple-touch-icon)"[^>]*>/gi, '');
}
let html = parts.join('');
// title first so it is found within the first bytes
const title = (html.match(/<title>.*?<\/title>/) || ['<title>Sternenfront</title>'])[0];
html = title + '\n' + html.replace(title, '');
writeFileSync(out, html.trim() + '\n');
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
