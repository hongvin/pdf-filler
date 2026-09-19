import fs from 'node:fs';
import * as PDFLib from 'pdf-lib';
import * as fontkitNs from '@pdf-lib/fontkit';
const fontkit = fontkitNs.default || fontkitNs;

const bytes = new Uint8Array(fs.readFileSync('/Users/hongvin/workbuddy-ai/pdf-filler/public/fonts/GreatVibes-Regular.ttf'));

// What does fontkit itself see?
const fk = fontkit.create(Buffer.from(bytes));
console.log('postscriptName:', fk.postscriptName);
console.log('numGlyphs:', fk.numGlyphs);
const layout = fk.layout('HongVin');
console.log('glyph count for "HongVin":', layout.glyphs.length);
console.log('glyph ids:', layout.glyphs.map(g => g.id));
console.log('positions:', layout.positions.map(p => Math.round(p.xAdvance)));

for (const subset of [true, false]) {
  const doc = await PDFLib.PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(bytes, { subset });
  const page = doc.addPage([400, 200]);
  page.drawText('HongVin', { x: 20, y: 100, size: 48, font });
  const out = await doc.save();
  fs.writeFileSync(`/Users/hongvin/workbuddy-ai/pdf-filler/tools/font-subset-${subset}.pdf`, out);
  console.log(`subset=${subset} -> ${out.length} bytes`);
}
