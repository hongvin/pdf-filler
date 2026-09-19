/**
 * Side-by-side: the reference signature crop from the user's screenshot, with
 * the leading font candidates rendered underneath at a matched size.
 *
 *   node tools/font-shortlist.mjs
 */

import fs from 'node:fs';
import * as PDFLib from 'pdf-lib';
import * as fontkitNs from '@pdf-lib/fontkit';

const fontkit = fontkitNs.default || fontkitNs;
const DIR = '/tmp/fontcandidates';

const shortlist = [
  'LeckerliOne.ttf',
  'Yesteryear.ttf',
  'Charm-Bold.ttf',
  'LobsterTwo-BoldItalic.ttf',
  'Pattaya.ttf',
  'Damion.ttf',
  'KaushanScript.ttf',
  'Norican.ttf',
  'MrDafoe.ttf',
  'GrandHotel.ttf',
];

const doc = await PDFLib.PDFDocument.create();
doc.registerFontkit(fontkit);
const label = await doc.embedFont(PDFLib.StandardFonts.Helvetica);

const W = 620;
const ROW = 62;
const page = doc.addPage([W, ROW * (shortlist.length + 1) + 60]);

// Reference crop at the top, scaled to a comparable width.
const refBytes = new Uint8Array(fs.readFileSync('tools/ref-signature.png'));
const ref = await doc.embedPng(refBytes);
const refW = 380;
const refH = ref.height * (refW / ref.width);
page.drawImage(ref, { x: 160, y: page.getHeight() - 30 - refH, width: refW, height: refH });
page.drawText('REFERENCE', { x: 12, y: page.getHeight() - 30 - refH / 2, size: 8, font: label });

let y = page.getHeight() - 40 - refH - ROW;
for (const name of shortlist) {
  const path = `${DIR}/${name}`;
  if (!fs.existsSync(path)) { console.log('missing', name); continue; }
  const font = await doc.embedFont(new Uint8Array(fs.readFileSync(path)), { subset: false });
  page.drawText(name.replace('.ttf', ''), { x: 12, y: y + 6, size: 8, font: label });
  page.drawText('HongVin', { x: 160, y, size: 46, font });
  y -= ROW;
}

fs.writeFileSync('/tmp/font-shortlist.pdf', await doc.save());
console.log('wrote /tmp/font-shortlist.pdf');
