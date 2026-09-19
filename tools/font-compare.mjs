/**
 * Renders "HongVin" in every candidate script font, one per line, so the
 * closest match to the reference signature can be picked by eye.
 *
 *   node tools/font-compare.mjs
 */

import fs from 'node:fs';
import * as PDFLib from 'pdf-lib';
import * as fontkitNs from '@pdf-lib/fontkit';

const fontkit = fontkitNs.default || fontkitNs;
const DIR = '/tmp/fontcandidates';

const names = fs.readdirSync(DIR).filter(f => f.endsWith('.ttf')).sort();
const usable = [];

for (const name of names) {
  try {
    const bytes = new Uint8Array(fs.readFileSync(`${DIR}/${name}`));
    fontkit.create(Buffer.from(bytes));
    usable.push({ name, bytes });
  } catch (e) {
    console.log('UNUSABLE', name, '-', e.message);
  }
}

const doc = await PDFLib.PDFDocument.create();
doc.registerFontkit(fontkit);
const label = await doc.embedFont(PDFLib.StandardFonts.Helvetica);

const ROW = 58;
const page = doc.addPage([520, ROW * usable.length + 40]);

let y = page.getHeight() - 40;
for (const { name, bytes } of usable) {
  // subset:false — pdf-lib's subsetter corrupts several of these faces.
  const font = await doc.embedFont(bytes, { subset: false });
  page.drawText(name.replace('.ttf', ''), { x: 12, y: y + 8, size: 7, font: label });
  page.drawText('HongVin', { x: 150, y, size: 34, font });
  y -= ROW;
}

fs.writeFileSync('/tmp/font-compare.pdf', await doc.save());
console.log(`rendered ${usable.length} candidates`);
