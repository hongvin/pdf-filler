/**
 * Static cross-check between the UI layer and the markup.
 *
 * app.js reaches into index.html by id, which is a link no bundler or test can
 * see. Rename an id in the markup and the code silently reads `null` at runtime
 * — usually only on the branch that touches it, so it can survive a casual
 * click-through. This catches it at build time instead.
 *
 *   node tools/check-ui-refs.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const app = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

let failures = 0;
const fail = msg => { failures++; console.log('FAIL  ' + msg); };
const ok = msg => console.log('ok    ' + msg);

// ---- $('id') references resolve -----------------------------------------
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const refs = new Set([...app.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]));
const missing = [...refs].filter(id => !htmlIds.has(id));
if (missing.length) fail(`app.js refers to ids that are not in index.html: ${missing.join(', ')}`);
else ok(`every $() reference resolves — ${refs.size} refs against ${htmlIds.size} ids`);

// ---- els.* declared vs used ---------------------------------------------
const declBlock = (app.match(/const els = \{([\s\S]*?)\n\};/) || [])[1] || '';
const declared = new Set([...declBlock.matchAll(/(\w+)\s*:/g)].map(m => m[1]));
const used = new Set([...app.matchAll(/\bels\.(\w+)/g)].map(m => m[1]));
const undeclared = [...used].filter(k => !declared.has(k));
const unused = [...declared].filter(k => !used.has(k));
if (undeclared.length) fail(`els.* used but never declared: ${undeclared.join(', ')}`);
else ok(`every els.* key is declared — ${used.size} used of ${declared.size}`);
if (unused.length) fail(`els.* declared but never used: ${unused.join(', ')}`);
else ok('no dead els.* entries');

// ---- stamp modes agree between markup, app and the writer ---------------
const modeIds = [...html.matchAll(/data-stamp="([^"]+)"/g)].map(m => m[1]);
const appModes = ((app.match(/const STAMP_MODES = \[([^\]]+)\]/) || [])[1] || '')
  .split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
const same = modeIds.length === appModes.length && modeIds.every(m => appModes.includes(m));
if (!same) fail(`stamp modes differ — markup [${modeIds}] vs app [${appModes}]`);
else ok(`stamp modes agree — ${modeIds.join(', ')}`);

// The legacy id must not survive as a *rendering* branch: setStampMode() has no
// branch for it, so a mode left at 'image' would render no panel at all. The
// one legitimate mention is the migration in loadSettings, which rewrites the
// value — recognised here as a line that compares it and then assigns a valid
// mode on the same line.
if (/data-stamp="image"/.test(html)) fail('markup still carries the legacy data-stamp="image"');
else ok('no legacy data-stamp="image" in the markup');

const legacyLines = app.split('\n')
  .map((text, i) => ({ n: i + 1, text }))
  .filter(({ text }) => /stampMode\s*===?\s*['"]image['"]/.test(text));
const strayLegacy = legacyLines.filter(({ text }) => !/stampMode\s*=\s*['"](upload|logo|generated)['"]/.test(text));
if (strayLegacy.length) {
  for (const { n, text } of strayLegacy) fail(`app.js:${n} branches on the legacy mode — ${text.trim()}`);
} else {
  ok(`no legacy 'image' rendering branch — ${legacyLines.length} mention(s), all migrations`);
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
