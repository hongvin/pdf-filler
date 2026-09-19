/**
 * pdf-lib's bundled subsetter silently drops glyphs from some faces. Renders
 * "HongVin" with subset on and off for every bundled signature font, so we can
 * see which ones survive subsetting (and so keep the output PDF small).
 *
 *   node tools/subset-check.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import * as PDFLib from 'pdf-lib';
import * as fontkitNs from '@pdf-lib/fontkit';

const fontkit = fontkitNs.default || fontkitNs;
const DIR = 'public/fonts';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.ttf')).sort();

const doc = await PDFLib.PDFDocument.create();
doc.registerFontkit(fontkit);
const label = await doc.embedFont(PDFLib.StandardFonts.Helvetica);

const ROW = 70;
const page = doc.addPage([560, ROW * files.length * 2 + 40]);
let y = page.getHeight() - 40;

for (const file of files) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(DIR, file)));
  for (const subset of [true, false]) {
    page.drawText(`${file.replace('.ttf', '')}  subset=${subset}`, { x: 12, y: y + 12, size: 8, font: label });
    try {
      const font = await doc.embedFont(bytes, { subset });
      page.drawText('HongVin', { x: 230, y, size: 38, font });
    } catch (e) {
      page.drawText('FAILED: ' + e.message.slice(0, 40), { x: 230, y, size: 9, font: label });
    }
    y -= ROW;
  }
}

const out = await doc.save();
fs.writeFileSync('/tmp/subset-check.pdf', out);
console.log('wrote /tmp/subset-check.pdf', out.length, 'bytes');
